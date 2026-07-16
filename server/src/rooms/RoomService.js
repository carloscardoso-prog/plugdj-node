import { db, createRoom } from '../database/memory.js';
import { createUser } from '../database/memory.js';
import { createId, createRoomCode } from '../utils/ids.js';
import { assignStagePosition } from './stageSlots.js';
import { scheduleRoomsPersist } from '../database/hydrate.js';
import { hashPassword, verifyPasswordHash } from '../utils/password.js';
import { roomsStore } from '../database/roomsStore.js';

export class RoomService {
    constructor(database = db) {
        this.db = database;
    }

    persist() {
        scheduleRoomsPersist(this.db);
    }

    getRoom(roomId) {
        return this.db.getRoom(roomId);
    }

    roomExists(roomId) {
        return this.db.roomExists(roomId);
    }

    listRooms() {
        return this.db.listRooms();
    }

    createRoom({ slug, name, hostUsername, hostClientId, background, password, aboutCommunity, welcomeTitle, welcomeMessage }) {
        if (this.db.slugExists(slug) || this.db.roomExists(slug)) {
            return { ok: false, error: 'Room already exists' };
        }

        const room = createRoom({
            id: createId(),
            slug,
            name,
            code: this.generateUniqueCode(),
            hostUsername,
            hostClientId,
            background,
            passwordHash: hashPassword(password),
            aboutCommunity,
            welcomeTitle,
            welcomeMessage
        });
        this.db.saveRoom(room);
        this.persist();
        return { ok: true, data: room };
    }

    /** Hard-delete: remove from memory + rooms.json. Caller must kick live sockets. */
    deleteRoom(roomId) {
        const removed = this.db.deleteRoom(roomId);
        if (!removed) return { ok: false, error: 'Room not found' };
        roomsStore.saveNow(() => Array.from(this.db.rooms.values()));
        return { ok: true, data: removed };
    }

    generateUniqueCode() {
        let code = createRoomCode();
        while (this.db.codeExists(code)) {
            code = createRoomCode();
        }
        return code;
    }

    verifyPassword(room, password) {
        const stored = room?.passwordHash || room?.password || null;
        return verifyPasswordHash(password, stored);
    }

    hasPassword(room) {
        return !!(room?.passwordHash || room?.password);
    }

    recordVisitor(room, { clientId, username }) {
        if (!Array.isArray(room.visitorClientIds)) room.visitorClientIds = [];
        if (!Array.isArray(room.visitorUsernames)) room.visitorUsernames = [];

        if (clientId && !room.visitorClientIds.includes(clientId)) {
            room.visitorClientIds.push(clientId);
            room.totalVisitors += 1;
            this.persist();
        }
        if (username && !room.visitorUsernames.includes(username)) {
            room.visitorUsernames.push(username);
        }
        return room.totalVisitors;
    }

    findUser(room, userId) {
        return room.users.find((user) => user.id === userId) || null;
    }

    findUserByUsername(room, username) {
        return room.users.find((user) => user.username === username) || null;
    }

    findUserByClientId(room, clientId) {
        if (!clientId) return null;
        return room.users.find((user) => user.clientId === clientId) || null;
    }

    addUser(room, { username, avatar, role = 'user', clientId, serverIssuedUUID = null }) {
        const existing = clientId
            ? this.findUserByClientId(room, clientId)
            : (serverIssuedUUID ? this.findUser(room, serverIssuedUUID) : null);

        if (existing) {
            existing.username = username || existing.username;
            if (avatar) existing.avatar = avatar;
            if (clientId) existing.clientId = clientId;
            // Soft reconnect keeps position; backfill if an older session lacked one
            assignStagePosition(room, existing);
            this.applyUserVoteFlags(room, existing);
            return existing;
        }

        const user = createUser({
            username,
            avatar,
            role,
            clientId,
            id: serverIssuedUUID || null
        });
        room.users.push(user);
        assignStagePosition(room, user);
        this.applyUserVoteFlags(room, user);
        return user;
    }

    assignOwnerIfHost(room, user) {
        if (room.ownerId) return user;

        const byClient = room.hostClientId && user.clientId && room.hostClientId === user.clientId;
        const byName = !room.hostClientId && room.hostUsername && room.hostUsername === user.username;

        if (byClient || byName) {
            user.role = 'owner';
            room.ownerId = user.id;
            room.ownerClientId = user.clientId || room.hostClientId || null;
            this.persist();
        }
        return user;
    }

    removeUser(room, userId) {
        const index = room.users.findIndex((user) => user.id === userId);
        if (index === -1) return null;
        const [removed] = room.users.splice(index, 1);
        if (room.ownerId === removed.id) {
            room.ownerId = null;
        }
        return removed;
    }

    updateUserAvatar(room, userId, avatar) {
        const user = this.findUser(room, userId);
        if (!user) return null;
        user.avatar = avatar;
        return user;
    }

    updateUserUsername(room, userId, username) {
        const user = this.findUser(room, userId);
        if (!user) return null;
        user.username = username;
        room.queue.forEach((entry) => {
            if (entry.userId === userId) entry.username = username;
        });
        if (room.currentDJ?.id === userId) {
            room.currentDJ.username = username;
        }
        return user;
    }

    updateBackground(room, background) {
        room.background = background;
        this.persist();
        return room;
    }

    updateRoomMeta(room, { aboutCommunity, welcomeTitle, welcomeMessage, chatRateLimitMs }) {
        if (aboutCommunity != null) room.aboutCommunity = aboutCommunity;
        if (welcomeTitle != null) room.welcomeTitle = welcomeTitle;
        if (welcomeMessage != null) room.welcomeMessage = welcomeMessage;
        if (chatRateLimitMs != null) room.chatRateLimitMs = chatRateLimitMs;
        this.persist();
        return room;
    }

    canVote(room, user) {
        if (!room.currentSong || !room.currentDJ) return false;
        if (user?.id === room.currentDJ.id) return false;
        return true;
    }

    ensureVotesByTrack(room) {
        if (!room.votesByTrack) room.votesByTrack = {};
        return room.votesByTrack;
    }

    getTrackVoteBucket(room, songId) {
        const store = this.ensureVotesByTrack(room);
        if (!store[songId]) {
            store[songId] = { woot: [], meh: [], grab: [] };
        }
        return store[songId];
    }

    voteIdentity(user) {
        return user.clientId || user.username;
    }

    applyUserVoteFlags(room, user) {
        user.liked = false;
        user.disliked = false;
        user.playlisted = false;
        if (!room.currentSong || !user) return user;

        const bucket = this.getTrackVoteBucket(room, room.currentSong.id);
        const key = this.voteIdentity(user);
        if (bucket.woot.includes(key) || bucket.woot.includes(user.username)) user.liked = true;
        if (bucket.meh.includes(key) || bucket.meh.includes(user.username)) user.disliked = true;
        if (bucket.grab.includes(key) || bucket.grab.includes(user.username)) user.playlisted = true;
        return user;
    }

    syncRoomVoteState(room) {
        if (!room.currentSong) {
            room.votes = { woot: 0, meh: 0, grab: 0 };
            room.users.forEach((user) => {
                user.liked = false;
                user.disliked = false;
                user.playlisted = false;
            });
            return room.votes;
        }

        const bucket = this.getTrackVoteBucket(room, room.currentSong.id);
        room.votes = {
            woot: bucket.woot.length,
            meh: bucket.meh.length,
            grab: bucket.grab.length
        };
        room.users.forEach((user) => this.applyUserVoteFlags(room, user));
        return room.votes;
    }

    toggleListVote(list, key, enable) {
        const index = list.indexOf(key);
        if (enable) {
            if (index === -1) list.push(key);
        } else if (index !== -1) {
            list.splice(index, 1);
        }
    }

    toggleVote(room, userId, voteKey) {
        const user = this.findUser(room, userId);
        if (!user) return null;
        if (!this.canVote(room, user)) return null;

        const flagMap = {
            woot: 'liked',
            meh: 'disliked',
            grab: 'playlisted'
        };
        const flag = flagMap[voteKey];
        if (!flag) return null;

        const bucket = this.getTrackVoteBucket(room, room.currentSong.id);
        const key = this.voteIdentity(user);
        const enabling = !user[flag];

        if (voteKey === 'woot') {
            this.toggleListVote(bucket.woot, key, enabling);
            if (enabling) {
                this.toggleListVote(bucket.meh, key, false);
                user.disliked = false;
            }
            user.liked = enabling;
        } else if (voteKey === 'meh') {
            this.toggleListVote(bucket.meh, key, enabling);
            if (enabling) {
                this.toggleListVote(bucket.woot, key, false);
                user.liked = false;
            }
            user.disliked = enabling;
        } else if (voteKey === 'grab') {
            this.toggleListVote(bucket.grab, key, enabling);
            user.playlisted = enabling;
        }

        const votes = this.syncRoomVoteState(room);
        return { user: this.findUser(room, userId), votes };
    }

    favoritesKey(user) {
        return user?.clientId || user?.username || null;
    }

    /** Room-level favorite (heart in player-right) — any user, anytime. */
    isRoomFavorited(room, user) {
        if (!room || !user) return false;
        if (!Array.isArray(room.favoriteClientIds)) room.favoriteClientIds = [];
        if (!Array.isArray(room.favoriteUsernames)) room.favoriteUsernames = [];
        if (user.clientId && room.favoriteClientIds.includes(user.clientId)) return true;
        if (user.username && room.favoriteUsernames.includes(user.username)) return true;
        return false;
    }

    toggleFavorite(room, user) {
        if (!user) return { ok: false, error: 'User required' };
        if (!Array.isArray(room.favoriteClientIds)) room.favoriteClientIds = [];
        if (!Array.isArray(room.favoriteUsernames)) room.favoriteUsernames = [];

        const favorited = this.isRoomFavorited(room, user);
        if (!favorited) {
            if (user.clientId && !room.favoriteClientIds.includes(user.clientId)) {
                room.favoriteClientIds.push(user.clientId);
            }
            if (user.username && !room.favoriteUsernames.includes(user.username)) {
                room.favoriteUsernames.push(user.username);
            }
        } else {
            if (user.clientId) {
                room.favoriteClientIds = room.favoriteClientIds.filter((id) => id !== user.clientId);
            }
            if (user.username) {
                room.favoriteUsernames = room.favoriteUsernames.filter((name) => name !== user.username);
            }
        }

        room.totalFavorites = Math.max(
            room.favoriteClientIds.length,
            room.favoriteUsernames.length
        );
        this.persist();

        return {
            ok: true,
            data: {
                favorited: !favorited,
                favorites: this.getUserFavorites(room, user),
                totalFavorites: room.totalFavorites
            }
        };
    }

    getUserFavorites(room, user) {
        if (!user) return [];
        if (!room.favoritesByClientId) room.favoritesByClientId = {};
        const key = this.favoritesKey(user);
        return room.favoritesByClientId?.[key]
            || room.favoritesByUser?.[user.username]
            || [];
    }

    isSongFavorited(room, user, songId) {
        const list = this.getUserFavorites(room, user);
        return list.some((item) => item.id === songId);
    }

    isStaff(user) {
        return user?.role === 'owner' || user?.role === 'admin';
    }

    isOwner(user) {
        return user?.role === 'owner';
    }

    isRoomAdmin(room, user) {
        return this.isStaff(user);
    }
}

export const roomService = new RoomService();
