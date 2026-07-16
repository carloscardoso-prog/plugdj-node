import { config } from '../config/index.js';

export function sanitizeString(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
}

export function isNonEmptyString(value, maxLength = 255) {
    const sanitized = sanitizeString(value, maxLength);
    return sanitized.length > 0 ? sanitized : null;
}

export function slugifyRoom(value) {
    const slug = sanitizeString(value, 64)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (slug.length < 3 || slug.length > 32) {
        return null;
    }
    return slug;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClientId(value) {
    return typeof value === 'string' && UUID_RE.test(value.trim());
}

export function validateJoinPayload(payload) {
    const username = isNonEmptyString(payload?.username, config.maxUsernameLength);
    const avatar = isNonEmptyString(payload?.avatar, 64);
    const rawRoom = sanitizeString(payload?.roomId || payload?.room || '', 64);
    const roomSlug = slugifyRoom(rawRoom);
    const roomUUID = isClientId(rawRoom) ? rawRoom.trim() : null;
    const roomId = roomSlug || roomUUID;
    const password = sanitizeString(payload?.password, 64);
    const userUUID = isClientId(payload?.userUUID || payload?.clientId)
        ? String(payload.userUUID || payload.clientId).trim()
        : null;
    const serverIssuedUUID = isClientId(payload?.serverIssuedUUID)
        ? payload.serverIssuedUUID.trim()
        : null;

    if (!username) {
        return { ok: false, error: 'Nickname is required' };
    }

    if (!userUUID) {
        return { ok: false, error: 'Client identity (userUUID) is required' };
    }

    if (!roomId) {
        return { ok: false, error: 'Valid room slug or roomUUID is required' };
    }

    return {
        ok: true,
        data: {
            roomId,
            username,
            clientId: userUUID,
            userUUID,
            serverIssuedUUID,
            avatar: avatar || '80s01',
            password,
            playlists: Array.isArray(payload?.playlists) ? payload.playlists : null,
            activePlaylistId: typeof payload?.activePlaylistId === 'string' ? payload.activePlaylistId : null,
            library: Array.isArray(payload?.library) ? payload.library : null
        }
    };
}

export function validateCreateRoomPayload(payload) {
    const username = isNonEmptyString(payload?.username || payload?.hostUsername, config.maxUsernameLength);
    const name = isNonEmptyString(payload?.name, 48);
    const slug = slugifyRoom(payload?.slug || payload?.roomId || payload?.name || '');
    const password = sanitizeString(payload?.password, 64);
    const hostClientId = isClientId(payload?.clientId || payload?.hostClientId)
        ? String(payload.clientId || payload.hostClientId).trim()
        : null;

    if (!username) {
        return { ok: false, error: 'Nickname is required' };
    }

    if (!hostClientId) {
        return { ok: false, error: 'Client identity (UUID) is required' };
    }

    if (!name) {
        return { ok: false, error: 'Room name is required' };
    }

    if (!slug) {
        return { ok: false, error: 'Room slug must be 3-32 characters (letters, numbers, hyphens)' };
    }

    return {
        ok: true,
        data: {
            slug,
            name,
            hostUsername: username,
            hostClientId,
            background: sanitizeString(payload?.background, 64) || 'bg-neon-city',
            password: normalizeRoomPassword(password),
            aboutCommunity: sanitizeString(payload?.aboutCommunity, 500),
            welcomeTitle: sanitizeString(payload?.welcomeTitle, 80) || null,
            welcomeMessage: sanitizeString(payload?.welcomeMessage, 300) || null
        }
    };
}

export function normalizeRoomPassword(value) {
    const password = sanitizeString(value, 64);
    return password || null;
}

export function validateVerifyPasswordPayload(payload) {
    const password = sanitizeString(payload?.password, 64);
    return { ok: true, data: { password } };
}

export function validateChatPayload(payload) {
    const message = isNonEmptyString(payload?.message, config.maxMessageLength);
    if (!message) {
        return { ok: false, error: 'Message cannot be empty' };
    }
    return { ok: true, data: { message } };
}

export function validateAvatarPayload(payload) {
    const avatar = isNonEmptyString(payload?.avatar, 64);
    if (!avatar) {
        return { ok: false, error: 'Avatar is required' };
    }
    return { ok: true, data: { avatar } };
}

export function validateUsernamePayload(payload) {
    const username = isNonEmptyString(payload?.username, config.maxUsernameLength);
    if (!username) {
        return { ok: false, error: 'Display name is required' };
    }
    return { ok: true, data: { username } };
}

export function validateBackgroundPayload(payload) {
    const background = isNonEmptyString(payload?.background, 64);
    if (!background) {
        return { ok: false, error: 'Background is required' };
    }
    return { ok: true, data: { background } };
}

export function validateVotePayload(payload) {
    const allowed = new Set(['woot', 'grab', 'meh']);
    const value = sanitizeString(payload?.value, 16);
    if (!allowed.has(value)) {
        return { ok: false, error: 'Invalid vote value' };
    }
    return { ok: true, data: { value } };
}

export function validateSetRolePayload(payload) {
    const username = isNonEmptyString(payload?.username, config.maxUsernameLength);
    const clientId = isClientId(payload?.clientId) ? payload.clientId.trim() : null;
    const role = sanitizeString(payload?.role, 16);
    if (!username && !clientId) return { ok: false, error: 'Username or clientId is required' };
    if (!['admin', 'user'].includes(role)) return { ok: false, error: 'Invalid role' };
    return { ok: true, data: { username, clientId, role } };
}

export function validateModeratePayload(payload) {
    const username = isNonEmptyString(payload?.username, config.maxUsernameLength);
    const clientId = isClientId(payload?.clientId) ? payload.clientId.trim() : null;
    const action = sanitizeString(payload?.action, 16);
    if (!username && !clientId) return { ok: false, error: 'Username or clientId is required' };
    if (!['ban', 'mute'].includes(action)) return { ok: false, error: 'Invalid moderation action' };
    return {
        ok: true,
        data: {
            username,
            clientId,
            action,
            durationMinutes: Number(payload?.durationMinutes) || 10,
            reason: sanitizeString(payload?.reason, 200)
        }
    };
}

export function validateUnpunishPayload(payload) {
    const username = isNonEmptyString(payload?.username, config.maxUsernameLength);
    const clientId = isClientId(payload?.clientId) ? payload.clientId.trim() : null;
    const action = sanitizeString(payload?.action, 16) || 'all';
    if (!username && !clientId) return { ok: false, error: 'Username or clientId is required' };
    if (!['ban', 'mute', 'all'].includes(action)) return { ok: false, error: 'Invalid unpunish action' };
    return { ok: true, data: { username, clientId, action } };
}

export function validateRoomMetaPayload(payload) {
    let chatRateLimitMs;
    if (payload?.chatRateLimitMs != null) {
        const seconds = Number(payload.chatRateLimitMs);
        if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 30) {
            return { ok: false, error: 'Chat rate limit must be between 0.5 and 30 seconds' };
        }
        chatRateLimitMs = Math.round(seconds * 1000);
    }

    return {
        ok: true,
        data: {
            aboutCommunity: payload?.aboutCommunity != null ? sanitizeString(payload.aboutCommunity, 500) : undefined,
            welcomeTitle: payload?.welcomeTitle != null ? sanitizeString(payload.welcomeTitle, 80) : undefined,
            welcomeMessage: payload?.welcomeMessage != null ? sanitizeString(payload.welcomeMessage, 300) : undefined,
            chatRateLimitMs
        }
    };
}
