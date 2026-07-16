import { createRoom } from './memory.js';
import { roomsStore } from './roomsStore.js';
import { hashPassword, isHashedPassword } from '../utils/password.js';

/** Restore rooms from data/rooms.json into the in-memory DB (this host only). */
export function hydrateRoomsFromDisk(database) {
    const snapshots = roomsStore.load();
    let count = 0;
    let migrated = false;

    for (const snap of snapshots) {
        // Prefer roomUUID; legacy rows used id === slug
        const roomUUID = snap.roomUUID || snap.id;
        if (!roomUUID) continue;

        let passwordHash = snap.passwordHash || null;
        if (!passwordHash && snap.password) {
            passwordHash = isHashedPassword(snap.password)
                ? snap.password
                : hashPassword(snap.password);
            migrated = true;
        }

        const slug = snap.slug || snap.id || roomUUID;

        const room = createRoom({
            id: roomUUID,
            slug,
            name: snap.name || slug,
            code: snap.code || null,
            background: snap.background || 'bg-neon-city',
            hostUsername: snap.hostUsername || null,
            hostClientId: snap.hostClientId || null,
            passwordHash,
            aboutCommunity: snap.aboutCommunity || '',
            welcomeTitle: snap.welcomeTitle || null,
            welcomeMessage: snap.welcomeMessage || null,
            createdAt: snap.createdAt || Date.now()
        });

        room.ownerClientId = snap.ownerClientId || snap.hostClientId || null;
        room.chatRateLimitMs = snap.chatRateLimitMs || room.chatRateLimitMs;
        room.visitorClientIds = Array.isArray(snap.visitorClientIds) ? snap.visitorClientIds : [];
        room.visitorUsernames = Array.isArray(snap.visitorUsernames) ? snap.visitorUsernames : [];
        room.totalVisitors = Number(snap.totalVisitors) || room.visitorClientIds.length || 0;
        room.favoriteClientIds = Array.isArray(snap.favoriteClientIds) ? snap.favoriteClientIds : [];
        room.favoriteUsernames = Array.isArray(snap.favoriteUsernames) ? snap.favoriteUsernames : [];
        room.totalFavorites = Number(snap.totalFavorites) || room.favoriteClientIds.length || 0;
        room.favoritesByClientId = snap.favoritesByClientId && typeof snap.favoritesByClientId === 'object'
            ? snap.favoritesByClientId
            : {};
        room.favoritesByUser = {};
        room.bans = Array.isArray(snap.bans) ? snap.bans : [];
        room.mutes = Array.isArray(snap.mutes) ? snap.mutes : [];
        room.moderationLog = Array.isArray(snap.moderationLog) ? snap.moderationLog : [];
        room.recentPlays = Array.isArray(snap.recentPlays) ? snap.recentPlays : [];

        // Live session state always starts empty (host process restart)
        room.users = [];
        room.queue = [];
        room.currentDJ = null;
        room.currentSong = null;
        room.ownerId = null;
        room.chatHistory = [];
        room.votes = { woot: 0, grab: 0, meh: 0 };
        room.votesByTrack = {};
        room.librariesByUser = {};
        room.playlistsByUser = {};

        database.saveRoom(room);
        count += 1;
    }

    // Only rewrite disk when we upgraded legacy plaintext → hash (never wipe hashes)
    if (migrated) {
        roomsStore.saveNow(() => Array.from(database.rooms.values()));
    }

    return count;
}

export function scheduleRoomsPersist(database) {
    roomsStore.saveSoon(() => Array.from(database.rooms.values()));
}
