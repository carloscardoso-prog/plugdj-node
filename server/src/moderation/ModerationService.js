import { createId } from '../utils/ids.js';
import { roomService } from '../rooms/RoomService.js';

function matchesIdentity(entry, { clientId, username }) {
    if (clientId && entry.clientId && entry.clientId === clientId) return true;
    if (username && entry.username === username) return true;
    return false;
}

function findBan(room, identity) {
    return room.bans.find((ban) => matchesIdentity(ban, identity)) || null;
}

function findMute(room, identity) {
    return room.mutes.find((mute) => matchesIdentity(mute, identity)) || null;
}

function isMuteActive(mute) {
    if (!mute) return false;
    if (!mute.until) return true;
    return mute.until > Date.now();
}

function resolveOwner(room) {
    const owner = room.users.find((user) => user.role === 'owner');
    return {
        username: owner?.username || room.hostUsername || null,
        clientId: owner?.clientId || room.ownerClientId || room.hostClientId || null
    };
}

function isProtectedOwner(room, { clientId, username }) {
    const owner = resolveOwner(room);
    if (clientId && owner.clientId && owner.clientId === clientId) return true;
    if (!owner.clientId && username && owner.username === username) return true;
    return false;
}

function canActorModerateTarget(actor, targetUser, room, identity) {
    if (actor.role !== 'owner') {
        return { ok: false, error: 'Only the room owner can moderate users' };
    }
    if (isProtectedOwner(room, identity)) {
        return { ok: false, error: 'The room owner cannot be moderated' };
    }
    if (targetUser?.role === 'owner') {
        return { ok: false, error: 'Cannot moderate the room owner' };
    }
    if (targetUser?.role === 'admin' && actor.role !== 'owner') {
        return { ok: false, error: 'Only the owner can moderate admins' };
    }
    return { ok: true };
}

export class ModerationService {
    constructor(rooms = roomService) {
        this.rooms = rooms;
    }

    identityFrom(userOrIdentity) {
        if (!userOrIdentity) return { clientId: null, username: null };
        if (typeof userOrIdentity === 'string') {
            return { clientId: null, username: userOrIdentity };
        }
        return {
            clientId: userOrIdentity.clientId || null,
            username: userOrIdentity.username || null
        };
    }

    isBanned(room, userOrIdentity) {
        return !!findBan(room, this.identityFrom(userOrIdentity));
    }

    getBan(room, userOrIdentity) {
        return findBan(room, this.identityFrom(userOrIdentity));
    }

    isMuted(room, userOrIdentity) {
        const identity = this.identityFrom(userOrIdentity);
        const mute = findMute(room, identity);
        if (!isMuteActive(mute)) {
            if (mute) {
                room.mutes = room.mutes.filter((item) => !matchesIdentity(item, identity));
            }
            return false;
        }
        return true;
    }

    getMute(room, userOrIdentity) {
        const mute = findMute(room, this.identityFrom(userOrIdentity));
        return isMuteActive(mute) ? mute : null;
    }

    logAction(room, entry) {
        const record = {
            id: createId(),
            at: Date.now(),
            ...entry
        };
        room.moderationLog.unshift(record);
        if (room.moderationLog.length > 200) {
            room.moderationLog.length = 200;
        }
        this.rooms.persist?.();
        return record;
    }

    setRole(room, actor, targetUser, role) {
        if (actor.role !== 'owner') {
            return { ok: false, error: 'Only the room owner can change roles' };
        }
        if (targetUser.role === 'owner') {
            return { ok: false, error: 'Cannot change the owner role' };
        }
        if (!['admin', 'user'].includes(role)) {
            return { ok: false, error: 'Invalid role' };
        }

        targetUser.role = role;
        this.logAction(room, {
            type: role === 'admin' ? 'promote_admin' : 'demote_admin',
            target: targetUser.username,
            targetClientId: targetUser.clientId || null,
            by: actor.username,
            reason: null
        });

        return { ok: true, data: { user: targetUser } };
    }

    moderateUser(room, actor, { username, clientId, action, durationMinutes = 10, reason = '' }) {
        const target = room.users.find((user) =>
            (clientId && user.clientId === clientId) || (username && user.username === username)
        ) || null;
        const identity = {
            clientId: clientId || target?.clientId || null,
            username: username || target?.username || null
        };
        if (!identity.username && !identity.clientId) {
            return { ok: false, error: 'User not found' };
        }

        const permission = canActorModerateTarget(actor, target, room, identity);
        if (!permission.ok) {
            return permission;
        }

        if (action === 'ban') {
            room.bans = room.bans.filter((ban) => !matchesIdentity(ban, identity));
            room.bans.push({
                username: identity.username,
                clientId: identity.clientId,
                reason: reason || null,
                bannedAt: Date.now(),
                bannedBy: actor.username
            });
            room.mutes = room.mutes.filter((mute) => !matchesIdentity(mute, identity));
            this.logAction(room, {
                type: 'ban',
                target: identity.username,
                targetClientId: identity.clientId,
                by: actor.username,
                reason: reason || null
            });
            this.rooms.persist?.();
            return { ok: true, data: { action: 'ban', username: identity.username, clientId: identity.clientId } };
        }

        if (action === 'mute') {
            const minutes = Math.max(1, Math.min(1440, Number(durationMinutes) || 10));
            room.mutes = room.mutes.filter((mute) => !matchesIdentity(mute, identity));
            room.mutes.push({
                username: identity.username,
                clientId: identity.clientId,
                reason: reason || null,
                mutedAt: Date.now(),
                mutedBy: actor.username,
                until: Date.now() + minutes * 60 * 1000
            });
            this.logAction(room, {
                type: 'mute',
                target: identity.username,
                targetClientId: identity.clientId,
                by: actor.username,
                reason: reason || `${minutes}m`
            });
            this.rooms.persist?.();
            return {
                ok: true,
                data: {
                    action: 'mute',
                    username: identity.username,
                    clientId: identity.clientId,
                    until: Date.now() + minutes * 60 * 1000
                }
            };
        }

        return { ok: false, error: 'Invalid moderation action' };
    }

    unpunishUser(room, actor, { username, clientId, action }) {
        if (actor.role !== 'owner') {
            return { ok: false, error: 'Only the room owner can remove punishments' };
        }
        const identity = { username: username || null, clientId: clientId || null };
        if (isProtectedOwner(room, identity)) {
            return { ok: false, error: 'The room owner cannot be moderated' };
        }

        if (action === 'ban' || action === 'all') {
            room.bans = room.bans.filter((ban) => !matchesIdentity(ban, identity));
            this.logAction(room, {
                type: 'unban',
                target: identity.username,
                targetClientId: identity.clientId,
                by: actor.username,
                reason: null
            });
        }

        if (action === 'mute' || action === 'all') {
            room.mutes = room.mutes.filter((mute) => !matchesIdentity(mute, identity));
            this.logAction(room, {
                type: 'unmute',
                target: identity.username,
                targetClientId: identity.clientId,
                by: actor.username,
                reason: null
            });
        }

        this.rooms.persist?.();
        return { ok: true, data: identity };
    }

    getPublicState(room) {
        const activeMutes = room.mutes.filter(isMuteActive);
        return {
            bans: room.bans.map((ban) => ({
                username: ban.username,
                clientId: ban.clientId || null,
                reason: ban.reason,
                bannedAt: ban.bannedAt,
                bannedBy: ban.bannedBy
            })),
            mutes: activeMutes.map((mute) => ({
                username: mute.username,
                clientId: mute.clientId || null,
                reason: mute.reason,
                mutedAt: mute.mutedAt,
                mutedBy: mute.mutedBy,
                until: mute.until
            })),
            moderationLog: room.moderationLog.slice(0, 50)
        };
    }
}

export const moderationService = new ModerationService();
