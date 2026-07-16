import { ClientEvents } from '../../types/events.js';
import { sessionService } from '../../users/SessionService.js';
import { roomService } from '../../rooms/RoomService.js';
import { queueService } from '../../queue/QueueService.js';
import { mediaService } from '../../media/MediaService.js';
import { libraryService } from '../../library/LibraryService.js';
import { chatService } from '../../chat/ChatService.js';
import { moderationService } from '../../moderation/ModerationService.js';
import { broadcastService } from '../../services/BroadcastService.js';
import { toPublicUser, toPublicQueueEntry } from '../../utils/serialize.js';
import { isAllowedMediaUrl } from '../../media/detectProvider.js';
import {
    canChangeBackground,
    canEditRoomMeta,
    canClearChat,
    canManageRoles,
    canModerateUsers,
    canSkipTrack
} from '../../services/PermissionService.js';
import {
    validateChatPayload,
    validateAvatarPayload,
    validateUsernamePayload,
    validateBackgroundPayload,
    validateVotePayload,
    validateSetRolePayload,
    validateModeratePayload,
    validateUnpunishPayload,
    validateRoomMetaPayload
} from '../../utils/validate.js';
import { ServerEvents } from '../../types/events.js';

function requireSession(socket) {
    if (!socket.userId || !socket.roomId) {
        return { ok: false, error: 'Join a room before sending events' };
    }
    return { ok: true };
}

export function createMessageRouter() {
    const handlers = {
        [ClientEvents.JOIN_ROOM]: handleJoinRoom,
        [ClientEvents.CHAT_MESSAGE]: handleChatMessage,
        [ClientEvents.CHANGE_AVATAR]: handleChangeAvatar,
        [ClientEvents.CHANGE_USERNAME]: handleChangeUsername,
        [ClientEvents.CHANGE_BACKGROUND]: handleChangeBackground,
        [ClientEvents.VOTE]: handleVote,
        [ClientEvents.FAVORITE_TRACK]: handleFavoriteTrack,
        [ClientEvents.QUEUE_JOIN]: handleQueueJoin,
        [ClientEvents.QUEUE_LEAVE]: handleQueueLeave,
        [ClientEvents.LIBRARY_ADD]: handleLibraryAdd,
        [ClientEvents.LIBRARY_REMOVE]: handleLibraryRemove,
        [ClientEvents.LIBRARY_REORDER]: handleLibraryReorder,
        [ClientEvents.LIBRARY_GRAB_CURRENT]: handleLibraryGrabCurrent,
        [ClientEvents.PLAYLIST_GRAB_CURRENT]: handlePlaylistGrabCurrent,
        [ClientEvents.PLAYLIST_ADD]: handlePlaylistAdd,
        [ClientEvents.PLAYLIST_REMOVE]: handlePlaylistRemove,
        [ClientEvents.PLAYLIST_PROMOTE]: handlePlaylistPromote,
        [ClientEvents.PLAYLIST_PROMOTE_ALL]: handlePlaylistPromoteAll,
        [ClientEvents.PLAYLIST_CREATE]: handlePlaylistCreate,
        [ClientEvents.PLAYLIST_RENAME]: handlePlaylistRename,
        [ClientEvents.PLAYLIST_DELETE]: handlePlaylistDelete,
        [ClientEvents.PLAYLIST_SET_ACTIVE]: handlePlaylistSetActive,
        [ClientEvents.SKIP_TRACK]: handleSkipTrack,
        [ClientEvents.SET_ROLE]: handleSetRole,
        [ClientEvents.MODERATE_USER]: handleModerateUser,
        [ClientEvents.UNPUNISH_USER]: handleUnpunishUser,
        [ClientEvents.UPDATE_ROOM_META]: handleUpdateRoomMeta,
        [ClientEvents.CLEAR_CHAT]: handleClearChat,
        [ClientEvents.LEAVE_ROOM]: handleLeaveRoom
    };

    return function routeMessage(socket, rawMessage) {
        let payload;
        try {
            payload = JSON.parse(rawMessage);
        } catch {
            broadcastService.sendError(socket.id, 'Invalid JSON payload');
            return;
        }

        const type = payload?.type;
        const handler = handlers[type];
        if (!handler) {
            broadcastService.sendError(socket.id, `Unknown event type: ${type}`);
            return;
        }

        handler(socket, payload);
    };
}

function handleJoinRoom(socket, payload) {
    const result = sessionService.joinRoom(socket, payload);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error, result.code || null);
    }
}

function handleChatMessage(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    if (!room) {
        broadcastService.sendError(socket.id, 'Room not found');
        return;
    }

    const user = roomService.findUser(room, socket.userId);
    if (!user) {
        broadcastService.sendError(socket.id, 'Session expired. Rejoin the room.', 'session_expired');
        return;
    }

    if (moderationService.isMuted(room, user)) {
        broadcastService.sendError(socket.id, 'You are muted and cannot chat.');
        return;
    }

    const validation = validateChatPayload(payload);
    if (!validation.ok) {
        broadcastService.sendError(socket.id, validation.error);
        return;
    }

    const result = chatService.sendMessage(socket.roomId, socket.userId, validation.data.message);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.CHAT_MESSAGE,
        ...result.data
    });
}

function handleChangeAvatar(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const validation = validateAvatarPayload(payload);
    if (!validation.ok) {
        broadcastService.sendError(socket.id, validation.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.updateUserAvatar(room, socket.userId, validation.data.avatar);
    if (!user) {
        broadcastService.sendError(socket.id, 'User not found');
        return;
    }

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.USER_UPDATED,
        user: toPublicUser(user)
    });
}

function handleChangeUsername(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const validation = validateUsernamePayload(payload);
    if (!validation.ok) {
        broadcastService.sendError(socket.id, validation.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.updateUserUsername(room, socket.userId, validation.data.username);
    if (!user) {
        broadcastService.sendError(socket.id, 'User not found');
        return;
    }

    socket.username = user.username;

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.USER_UPDATED,
        user: toPublicUser(user)
    });

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.QUEUE_UPDATED,
        queue: room.queue.map(toPublicQueueEntry)
    });

    if (room.currentDJ?.id === user.id) {
        broadcastService.broadcastRoom(socket.roomId, {
            type: ServerEvents.ROOM_UPDATED,
            currentDJ: toPublicUser(room.currentDJ)
        });
    }
}

function handleChangeBackground(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const validation = validateBackgroundPayload(payload);
    if (!validation.ok) {
        broadcastService.sendError(socket.id, validation.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);

    if (!canChangeBackground(user, room)) {
        broadcastService.sendError(socket.id, 'Only staff can change the background');
        return;
    }

    roomService.updateBackground(room, validation.data.background);

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.ROOM_UPDATED,
        background: room.background
    });
}

function handleVote(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const validation = validateVotePayload(payload);
    if (!validation.ok) {
        broadcastService.sendError(socket.id, validation.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    if (!roomService.canVote(room, user)) {
        const message = room.currentDJ?.id === user?.id
            ? 'The DJ cannot vote on their own track'
            : 'No track is playing';
        broadcastService.sendError(socket.id, message);
        return;
    }

    const result = roomService.toggleVote(room, socket.userId, validation.data.value);
    if (!result) {
        broadcastService.sendError(socket.id, 'Invalid vote');
        return;
    }

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.VOTE_UPDATED,
        votes: result.votes
    });

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.USER_UPDATED,
        user: toPublicUser(result.user)
    });
}

function handleFavoriteTrack(socket) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    if (!user) {
        broadcastService.sendError(socket.id, 'User not found');
        return;
    }

    const result = roomService.toggleFavorite(room, user);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }

    broadcastService.send(socket.id, {
        type: ServerEvents.ROOM_UPDATED,
        favorited: result.data.favorited,
        favorites: result.data.favorites,
        totalFavorites: result.data.totalFavorites
    });

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.ROOM_UPDATED,
        totalFavorites: result.data.totalFavorites
    }, socket.id);
}

function broadcastVoteState(room) {
    roomService.syncRoomVoteState(room);
    broadcastService.broadcastRoom(room.id, {
        type: ServerEvents.VOTE_UPDATED,
        votes: room.votes
    });
    room.users.forEach((user) => {
        broadcastService.broadcastRoom(room.id, {
            type: ServerEvents.USER_UPDATED,
            user: toPublicUser(user)
        });
    });
}

function sendLibraryState(socket, room, user) {
    const state = libraryService.toPublicLibraryState(room, user);
    broadcastService.send(socket.id, {
        type: ServerEvents.LIBRARY_STATE,
        ...state
    });
}

async function resolveMetaFromUrl(url) {
    if (!url || !isAllowedMediaUrl(url)) {
        return { ok: false, error: 'Only YouTube, SoundCloud, or Spotify URLs are allowed' };
    }
    const resolved = await mediaService.resolveUrl(url);
    if (!resolved.ok) return resolved;
    return { ok: true, data: mediaService.buildSongRecord(resolved.data, 'user') };
}

async function handleLibraryAdd(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }
    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    if (!user) {
        broadcastService.sendError(socket.id, 'User not found');
        return;
    }

    const meta = await resolveMetaFromUrl(String(payload?.url || '').trim());
    if (!meta.ok) {
        broadcastService.sendError(socket.id, meta.error);
        return;
    }
    meta.data.addedBy = user.username;

    const result = libraryService.addToLibrary(room, user, meta.data);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }
    sendLibraryState(socket, room, user);
    if (result.isRepeat) {
        broadcastService.send(socket.id, {
            type: ServerEvents.ACK,
            action: 'library_add',
            warning: 'repeat',
            message: 'This track was already played in this room'
        });
    }
}

function handleLibraryRemove(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }
    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    if (!user) {
        broadcastService.sendError(socket.id, 'User not found');
        return;
    }
    libraryService.removeFromLibrary(room, user, payload?.trackId);

    // Empty library while waiting → leave waitlist (can't DJ)
    if (!user.library.length && user.inQueue && room.currentDJ?.id !== user.id) {
        queueService.leaveQueue(room, user.id);
        broadcastService.broadcastRoom(socket.roomId, {
            type: ServerEvents.QUEUE_UPDATED,
            queue: room.queue.map(toPublicQueueEntry)
        });
        broadcastService.broadcastRoom(socket.roomId, {
            type: ServerEvents.USER_UPDATED,
            user: toPublicUser(user)
        });
    }

    sendLibraryState(socket, room, user);
}

function handleLibraryReorder(socket, payload) {
    const ctx = requireLibraryUser(socket);
    if (!ctx.ok) {
        broadcastService.sendError(socket.id, ctx.error);
        return;
    }
    const result = libraryService.reorderLibrary(ctx.room, ctx.user, payload?.orderedIds);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        sendLibraryState(socket, ctx.room, ctx.user);
        return;
    }
    sendLibraryState(socket, ctx.room, ctx.user);
}

function handleLibraryGrabCurrent(socket) {
    const ctx = requireLibraryUser(socket);
    if (!ctx.ok) {
        broadcastService.sendError(socket.id, ctx.error);
        return;
    }
    const result = libraryService.grabCurrentToLibrary(ctx.room, ctx.user);
    if (!result.ok) {
        if (result.code !== 'duplicate') {
            broadcastService.sendError(socket.id, result.error);
        }
        sendLibraryState(socket, ctx.room, ctx.user);
        return;
    }
    sendLibraryState(socket, ctx.room, ctx.user);
    broadcastService.send(socket.id, {
        type: ServerEvents.ACK,
        action: 'library_grab_current',
        message: result.isRepeat ? 'Added to Library (repeat in this room)' : 'Added to Library'
    });
}

function handlePlaylistGrabCurrent(socket, payload) {
    const ctx = requireLibraryUser(socket);
    if (!ctx.ok) {
        broadcastService.sendError(socket.id, ctx.error);
        return;
    }
    const result = libraryService.grabCurrentToPlaylist(
        ctx.room,
        ctx.user,
        payload?.playlistId || null
    );
    if (!result.ok) {
        if (result.code !== 'duplicate') {
            broadcastService.sendError(socket.id, result.error);
        }
        sendLibraryState(socket, ctx.room, ctx.user);
        return;
    }
    sendLibraryState(socket, ctx.room, ctx.user);
    broadcastService.send(socket.id, {
        type: ServerEvents.ACK,
        action: 'playlist_grab_current',
        message: result.isRepeat ? 'Added to Playlist (repeat in this room)' : 'Added to Playlist'
    });
}

async function handlePlaylistAdd(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }
    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    if (!user) {
        broadcastService.sendError(socket.id, 'User not found');
        return;
    }

    const meta = await resolveMetaFromUrl(String(payload?.url || '').trim());
    if (!meta.ok) {
        broadcastService.sendError(socket.id, meta.error);
        return;
    }
    meta.data.addedBy = user.username;

    const result = libraryService.addToPlaylist(room, user, meta.data, payload?.playlistId || null);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }
    sendLibraryState(socket, room, user);
    if (result.isRepeat) {
        broadcastService.send(socket.id, {
            type: ServerEvents.ACK,
            action: 'playlist_add',
            warning: 'repeat',
            message: 'This track was already played in this room'
        });
    }
}

function handlePlaylistRemove(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }
    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    if (!user) {
        broadcastService.sendError(socket.id, 'User not found');
        return;
    }
    libraryService.removeFromPlaylist(room, user, payload?.trackId, payload?.playlistId || null);
    sendLibraryState(socket, room, user);
}

function handlePlaylistPromote(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }
    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    if (!user) {
        broadcastService.sendError(socket.id, 'User not found');
        return;
    }
    const result = libraryService.promotePlaylistToLibrary(room, user, payload?.trackId, payload?.playlistId || null);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }
    sendLibraryState(socket, room, user);
    if (result.isRepeat) {
        broadcastService.send(socket.id, {
            type: ServerEvents.ACK,
            action: 'playlist_promote',
            warning: 'repeat',
            message: 'This track was already played in this room'
        });
    }
}

function handlePlaylistPromoteAll(socket, payload) {
    const ctx = requireLibraryUser(socket);
    if (!ctx.ok) {
        broadcastService.sendError(socket.id, ctx.error);
        return;
    }
    const result = libraryService.promoteEntirePlaylist(ctx.room, ctx.user, payload?.playlistId || null);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }
    sendLibraryState(socket, ctx.room, ctx.user);
    const { added, skipped, capped } = result.data;
    let message = `Sent ${added} track${added === 1 ? '' : 's'} to Library`;
    if (skipped) message += ` (${skipped} already there)`;
    if (capped) message += ' — library full';
    broadcastService.send(socket.id, {
        type: ServerEvents.ACK,
        action: 'playlist_promote_all',
        message
    });
}

function requireLibraryUser(socket) {
    const session = requireSession(socket);
    if (!session.ok) return session;
    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    if (!user) return { ok: false, error: 'User not found' };
    return { ok: true, room, user };
}

function handlePlaylistCreate(socket, payload) {
    const ctx = requireLibraryUser(socket);
    if (!ctx.ok) {
        broadcastService.sendError(socket.id, ctx.error);
        return;
    }
    const result = libraryService.createPlaylist(ctx.room, ctx.user, payload?.name);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }
    sendLibraryState(socket, ctx.room, ctx.user);
}

function handlePlaylistRename(socket, payload) {
    const ctx = requireLibraryUser(socket);
    if (!ctx.ok) {
        broadcastService.sendError(socket.id, ctx.error);
        return;
    }
    const result = libraryService.renamePlaylist(ctx.room, ctx.user, payload?.playlistId, payload?.name);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }
    sendLibraryState(socket, ctx.room, ctx.user);
}

function handlePlaylistDelete(socket, payload) {
    const ctx = requireLibraryUser(socket);
    if (!ctx.ok) {
        broadcastService.sendError(socket.id, ctx.error);
        return;
    }
    const result = libraryService.deletePlaylist(ctx.room, ctx.user, payload?.playlistId);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }
    sendLibraryState(socket, ctx.room, ctx.user);
}

function handlePlaylistSetActive(socket, payload) {
    const ctx = requireLibraryUser(socket);
    if (!ctx.ok) {
        broadcastService.sendError(socket.id, ctx.error);
        return;
    }
    const result = libraryService.setActivePlaylist(ctx.room, ctx.user, payload?.playlistId);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }
    sendLibraryState(socket, ctx.room, ctx.user);
}

function handleQueueJoin(socket) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    if (!user) {
        broadcastService.sendError(socket.id, 'User not found');
        return;
    }

    const result = queueService.joinQueue(room, user);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.QUEUE_UPDATED,
        queue: room.queue.map(toPublicQueueEntry)
    });

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.USER_UPDATED,
        user: toPublicUser(user)
    });

    if (result.data.promoted) {
        broadcastService.broadcastRoom(socket.roomId, {
            type: ServerEvents.DJ_UPDATED,
            currentDJ: toPublicUser(result.data.promoted),
            currentSong: queueService.toPublicCurrentSong(room)
        });
        broadcastVoteState(room);
    }
}

function handleQueueLeave(socket) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);

    const result = queueService.leaveQueue(room, socket.userId);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.QUEUE_UPDATED,
        queue: room.queue.map(toPublicQueueEntry)
    });

    if (user) {
        broadcastService.broadcastRoom(socket.roomId, {
            type: ServerEvents.USER_UPDATED,
            user: toPublicUser(user)
        });
    }

    if (result.data.wasDJ) {
        broadcastService.broadcastRoom(socket.roomId, {
            type: ServerEvents.DJ_UPDATED,
            currentDJ: result.data.promoted ? toPublicUser(result.data.promoted) : null,
            currentSong: queueService.toPublicCurrentSong(room)
        });
        broadcastVoteState(room);
    }
}

function handleSkipTrack(socket) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);
    const isSelfSkip = room.currentDJ && room.currentDJ.id === socket.userId;

    if (!isSelfSkip && !canSkipTrack(user, room)) {
        broadcastService.sendError(socket.id, 'Only staff can skip other DJs');
        return;
    }

    const result = queueService.skipTrack(room);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }
}

function handleSetRole(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const validation = validateSetRolePayload(payload);
    if (!validation.ok) {
        broadcastService.sendError(socket.id, validation.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const actor = roomService.findUser(room, socket.userId);
    const { username, clientId, role } = validation.data;
    const target = (clientId && roomService.findUserByClientId(room, clientId))
        || (username && roomService.findUserByUsername(room, username))
        || null;

    if (!canManageRoles(actor, room)) {
        broadcastService.sendError(socket.id, 'Only the owner can change roles');
        return;
    }
    if (!target) {
        broadcastService.sendError(socket.id, 'User not found in room');
        return;
    }

    const result = moderationService.setRole(room, actor, target, role);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }

    broadcastModeration(room);
    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.USER_UPDATED,
        user: toPublicUser(result.data.user)
    });
}

function handleModerateUser(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const validation = validateModeratePayload(payload);
    if (!validation.ok) {
        broadcastService.sendError(socket.id, validation.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const actor = roomService.findUser(room, socket.userId);

    if (!canModerateUsers(actor, room)) {
        broadcastService.sendError(socket.id, 'Only the owner can moderate users');
        return;
    }

    const result = moderationService.moderateUser(room, actor, validation.data);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }

    broadcastModeration(room);

    if (validation.data.action === 'ban') {
        const { username, clientId } = validation.data;
        const target = room.users.find((user) =>
            (clientId && user.clientId === clientId) || (username && user.username === username)
        );
        if (target) {
            kickUserFromRoom(socket.roomId, target.id);
        }
    }
}

function handleUnpunishUser(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const validation = validateUnpunishPayload(payload);
    if (!validation.ok) {
        broadcastService.sendError(socket.id, validation.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const actor = roomService.findUser(room, socket.userId);

    if (!canModerateUsers(actor, room)) {
        broadcastService.sendError(socket.id, 'Only the owner can remove punishments');
        return;
    }

    const result = moderationService.unpunishUser(room, actor, validation.data);
    if (!result.ok) {
        broadcastService.sendError(socket.id, result.error);
        return;
    }

    broadcastModeration(room);
}

function handleUpdateRoomMeta(socket, payload) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const validation = validateRoomMetaPayload(payload);
    if (!validation.ok) {
        broadcastService.sendError(socket.id, validation.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);

    if (!canEditRoomMeta(user, room)) {
        broadcastService.sendError(socket.id, 'Only staff can edit room info');
        return;
    }

    roomService.updateRoomMeta(room, validation.data);

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.ROOM_UPDATED,
        aboutCommunity: room.aboutCommunity,
        welcomeTitle: room.welcomeTitle,
        welcomeMessage: room.welcomeMessage,
        chatRateLimitMs: room.chatRateLimitMs
    });
}

function handleClearChat(socket) {
    const session = requireSession(socket);
    if (!session.ok) {
        broadcastService.sendError(socket.id, session.error);
        return;
    }

    const room = roomService.getRoom(socket.roomId);
    const user = roomService.findUser(room, socket.userId);

    if (!canClearChat(user, room)) {
        broadcastService.sendError(socket.id, 'Only staff can clear chat');
        return;
    }

    chatService.clearChat(socket.roomId);

    broadcastService.broadcastRoom(socket.roomId, {
        type: ServerEvents.CHAT_CLEARED
    });
}

function handleLeaveRoom(socket) {
    sessionService.disconnect(socket, { force: true });
}

function broadcastModeration(room) {
    broadcastService.broadcastRoom(room.id, {
        type: ServerEvents.MODERATION_UPDATED,
        moderation: moderationService.getPublicState(room)
    });
}

function kickUserFromRoom(roomId, userId) {
    const sockets = broadcastService.findSocketsInRoom(roomId, userId);
    sockets.forEach(({ socket }) => {
        broadcastService.sendError(socket.id, 'You have been banned from this room.', 'banned');
        sessionService.disconnect(socket, { force: true });
    });
}
