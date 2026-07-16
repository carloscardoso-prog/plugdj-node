import { db } from '../database/memory.js';
import { roomService } from '../rooms/RoomService.js';
import { chatService } from '../chat/ChatService.js';
import { broadcastService } from '../services/BroadcastService.js';
import { queueService } from '../queue/QueueService.js';
import { moderationService } from '../moderation/ModerationService.js';
import { toPublicRoomState, toPublicUser, toPublicQueueEntry } from '../utils/serialize.js';
import { ServerEvents } from '../types/events.js';
import { validateJoinPayload } from '../utils/validate.js';
import { createId } from '../utils/ids.js';
import { libraryService } from '../library/LibraryService.js';
import { serverStore } from '../database/serverStore.js';

/** Soft-disconnect grace: user stays in the room until they reconnect or this elapses. */
const ABSENCE_GRACE_MS = 5 * 60 * 1000;

export class SessionService {
    constructor(database = db, rooms = roomService, chat = chatService, broadcast = broadcastService, queue = queueService, moderation = moderationService) {
        this.db = database;
        this.rooms = rooms;
        this.chat = chat;
        this.broadcast = broadcast;
        this.queue = queue;
        this.moderation = moderation;
        /** @type {Map<string, NodeJS.Timeout>} */
        this.absenceTimers = new Map();
    }

    absenceKey(roomId, userId) {
        return `${roomId}:${userId}`;
    }

    cancelAbsencePurge(roomId, userId) {
        const key = this.absenceKey(roomId, userId);
        const timer = this.absenceTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.absenceTimers.delete(key);
        }
    }

    scheduleAbsencePurge(roomId, userId) {
        this.cancelAbsencePurge(roomId, userId);
        const key = this.absenceKey(roomId, userId);
        const timer = setTimeout(() => {
            this.absenceTimers.delete(key);
            this.purgeUserIfAbsent(roomId, userId);
        }, ABSENCE_GRACE_MS);
        this.absenceTimers.set(key, timer);
    }

    registerSocket(socket) {
        const socketId = createId();
        socket.id = socketId;
        this.broadcast.register(socketId, socket);
        this.db.bindConnection(socketId, { socketId, userId: null, roomId: null });
        return socketId;
    }

    /**
     * @param {{ force?: boolean }} [options]
     * force=true → Leave Room / ban: remove immediately.
     * force=false → soft disconnect: stay in room 5 minutes (DJ keeps booth until song ends).
     */
    disconnect(socket, options = {}) {
        const force = options.force === true;
        if (!socket?.id) return null;

        const connection = this.db.getConnection(socket.id);
        this.broadcast.unregister(socket.id);
        this.db.unbindConnection(socket.id);

        if (!connection?.userId || !connection?.roomId) {
            return null;
        }

        const room = this.rooms.getRoom(connection.roomId);
        if (!room) return null;

        const user = this.rooms.findUser(room, connection.userId);

        if (!force && user) {
            // Soft disconnect: keep membership + stage position; purge if still absent after grace
            user.absentSince = Date.now();
            socket.roomId = null;
            socket.userId = null;
            socket.username = null;
            this.scheduleAbsencePurge(room.id, user.id);
            return null;
        }

        return this.removeUserFromRoom(room, connection.userId);
    }

    removeUserFromRoom(room, userId) {
        this.cancelAbsencePurge(room.id, userId);

        const existing = this.rooms.findUser(room, userId);
        if (existing) {
            libraryService.persistUserMedia(room, existing);
        }

        const removed = this.rooms.removeUser(room, userId);
        if (!removed) return null;

        const queueResult = this.queue.handleUserLeft(room, removed.id);

        this.broadcast.broadcastRoom(room.id, {
            type: ServerEvents.USER_LEFT,
            id: removed.id
        });

        this.broadcast.broadcastRoom(room.id, {
            type: ServerEvents.QUEUE_UPDATED,
            queue: room.queue.map(toPublicQueueEntry)
        });

        if (queueResult.data?.promoted) {
            this.broadcast.broadcastRoom(room.id, {
                type: ServerEvents.DJ_UPDATED,
                currentDJ: toPublicUser(queueResult.data.promoted),
                currentSong: this.queue.toPublicCurrentSong(room)
            });
            this.broadcastVoteState(room);
        } else if (queueResult.data?.wasDJ) {
            this.broadcast.broadcastRoom(room.id, {
                type: ServerEvents.DJ_UPDATED,
                currentDJ: null,
                currentSong: null
            });
            this.broadcastVoteState(room);
        }

        return removed;
    }

    /**
     * After grace (or track advance): drop users with no live socket.
     * Active DJ with a playing track is kept until the song ends.
     */
    purgeUserIfAbsent(roomId, userId) {
        const room = this.rooms.getRoom(roomId);
        if (!room) return;

        const user = this.rooms.findUser(room, userId);
        if (!user) return;

        if (this.broadcast.findSocketsInRoom(room.id, userId).length > 0) {
            user.absentSince = null;
            return;
        }

        if (room.currentDJ?.id === userId && room.currentSong) {
            // Still DJing while away — check again when the track should end
            const elapsed = Date.now() - (room.currentSong.startedAt || Date.now());
            const remainingMs = Math.max(1000, (room.currentSong.duration || 0) * 1000 - elapsed + 1500);
            const key = this.absenceKey(roomId, userId);
            const timer = setTimeout(() => {
                this.absenceTimers.delete(key);
                this.purgeUserIfAbsent(roomId, userId);
            }, remainingMs);
            this.absenceTimers.set(key, timer);
            return;
        }

        this.removeUserFromRoom(room, userId);
    }

    /** Remove all socket-less users except an active DJ mid-track. */
    purgeAbsentUsers(room) {
        if (!room) return;

        const absentIds = room.users
            .filter((user) => {
                if (room.currentDJ?.id === user.id && room.currentSong) return false;
                return this.broadcast.findSocketsInRoom(room.id, user.id).length === 0;
            })
            .map((user) => user.id);

        absentIds.forEach((userId) => this.removeUserFromRoom(room, userId));
    }

    kickSocket(socket) {
        if (!socket?.id) return;

        this.broadcast.unregister(socket.id);
        this.db.unbindConnection(socket.id);
        socket.roomId = null;
        socket.userId = null;
        socket.username = null;

        if (socket.readyState === socket.OPEN) {
            socket.close();
        }
    }

    broadcastVoteState(room) {
        this.rooms.syncRoomVoteState(room);
        this.broadcast.broadcastRoom(room.id, {
            type: ServerEvents.VOTE_UPDATED,
            votes: room.votes
        });
        room.users.forEach((user) => {
            this.broadcast.broadcastRoom(room.id, {
                type: ServerEvents.USER_UPDATED,
                user: toPublicUser(user)
            });
        });
    }

    disconnectDuplicateSessions(roomId, clientId, keepSocket) {
        const room = this.rooms.getRoom(roomId);
        if (!room || !clientId) return;

        const existing = room.users.find((user) => user.clientId === clientId);
        if (existing) {
            const byUserId = this.broadcast.findSocketsInRoom(roomId, existing.id);
            byUserId.forEach(({ socket }) => {
                if (socket !== keepSocket) this.kickSocket(socket);
            });
        }
    }

    joinRoom(socket, payload) {
        const validation = validateJoinPayload(payload);
        if (!validation.ok) {
            return { ok: false, error: validation.error };
        }

        const {
            roomId,
            username,
            avatar,
            password,
            clientId,
            userUUID,
            serverIssuedUUID: presentedIssuedUUID,
            playlists,
            activePlaylistId,
            library
        } = validation.data;
        const room = this.rooms.getRoom(roomId);

        if (!room) {
            return { ok: false, error: 'Room not found. Create it first or check the slug.', code: 'room_not_found' };
        }

        if (!this.rooms.verifyPassword(room, password)) {
            return { ok: false, error: 'Wrong password for this room.', code: 'wrong_password' };
        }

        if (this.moderation.isBanned(room, { clientId, username })) {
            const ban = this.moderation.getBan(room, { clientId, username });
            return {
                ok: false,
                error: ban?.reason || 'You are banned from this room.',
                code: 'banned'
            };
        }

        const identity = serverStore.resolveIdentity({
            userUUID: userUUID || clientId,
            serverIssuedUUID: presentedIssuedUUID,
            username
        });

        // Canonical id always (payload may carry slug / short code)
        const canonicalRoomId = room.id;

        this.disconnectDuplicateSessions(canonicalRoomId, identity.userUUID, socket);

        const isReconnect = !!this.rooms.findUserByClientId(room, identity.userUUID)
            || !!this.rooms.findUser(room, identity.serverIssuedUUID);
        const user = this.rooms.addUser(room, {
            username,
            avatar,
            clientId: identity.userUUID,
            serverIssuedUUID: identity.serverIssuedUUID
        });
        this.rooms.assignOwnerIfHost(room, user);
        libraryService.syncFromClient(room, user, { library, playlists, activePlaylistId });

        // Back online within the grace window — keep stage position, cancel purge
        user.absentSince = null;
        this.cancelAbsencePurge(canonicalRoomId, user.id);

        if (!isReconnect) {
            this.rooms.recordVisitor(room, { clientId: identity.userUUID, username });
        }

        socket.roomId = canonicalRoomId;
        socket.userId = user.id;
        socket.username = username;
        socket.clientId = identity.userUUID;

        this.db.bindConnection(socket.id, {
            socketId: socket.id,
            userId: user.id,
            roomId: canonicalRoomId,
            clientId: identity.userUUID
        });

        const moderationState = this.moderation.getPublicState(room);
        const state = toPublicRoomState(room, moderationState, serverStore.getServerUUID());
        const favorites = this.rooms.getUserFavorites(room, user);
        const favorited = this.rooms.isRoomFavorited(room, user);
        const mediaState = libraryService.toPublicLibraryState(room, user);
        const activePlaylist = mediaState.playlists.find((p) => p.id === mediaState.activePlaylistId)
            || mediaState.playlists[0];

        this.broadcast.send(socket.id, {
            type: ServerEvents.ROOM_STATE,
            ...state,
            selfId: user.id,
            selfClientId: user.clientId,
            selfRole: user.role,
            serverUUID: serverStore.getServerUUID(),
            serverIssuedUUID: user.id,
            userUUID: identity.userUUID,
            favorites,
            favorited,
            library: mediaState.library,
            playlists: mediaState.playlists,
            activePlaylistId: mediaState.activePlaylistId,
            playlist: activePlaylist?.tracks || [],
            recentPlays: mediaState.recentPlays
        });

        this.broadcast.send(socket.id, {
            type: ServerEvents.LIBRARY_STATE,
            ...mediaState
        });

        if (!isReconnect) {
            this.broadcast.broadcastRoom(canonicalRoomId, {
                type: ServerEvents.USER_JOINED,
                user: toPublicUser(user)
            }, socket.id);
        } else {
            this.broadcast.broadcastRoom(canonicalRoomId, {
                type: ServerEvents.USER_UPDATED,
                user: toPublicUser(user)
            }, socket.id);
        }

        this.broadcast.broadcastRoom(canonicalRoomId, {
            type: ServerEvents.ROOM_UPDATED,
            totalVisitors: room.totalVisitors
        }, socket.id);

        return { ok: true, data: { user, room } };
    }
}

export const sessionService = new SessionService();
