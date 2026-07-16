import fs from 'fs';
import { dataFile, ensureDataDir } from '../config/paths.js';
import { hashPassword, isHashedPassword } from '../utils/password.js';

const ROOMS_FILE = dataFile('rooms.json');

/**
 * Snapshot of room fields that survive restarts (this host only).
 * Live users / queue / DJ / chat are never persisted.
 */
export function serializeRoomForDisk(room) {
    let passwordHash = room.passwordHash || null;
    if (!passwordHash && room.password) {
        passwordHash = isHashedPassword(room.password)
            ? room.password
            : hashPassword(room.password);
    }

    return {
        roomUUID: room.id,
        id: room.id,
        slug: room.slug,
        code: room.code,
        name: room.name,
        passwordHash,
        background: room.background,
        hostUsername: room.hostUsername || null,
        hostClientId: room.hostClientId || null,
        ownerClientId: room.ownerClientId || null,
        aboutCommunity: room.aboutCommunity || '',
        welcomeTitle: room.welcomeTitle || '',
        welcomeMessage: room.welcomeMessage || '',
        chatRateLimitMs: room.chatRateLimitMs,
        visitorClientIds: room.visitorClientIds || [],
        visitorUsernames: room.visitorUsernames || [],
        totalVisitors: room.totalVisitors || 0,
        favoriteClientIds: room.favoriteClientIds || [],
        favoriteUsernames: room.favoriteUsernames || [],
        totalFavorites: room.totalFavorites || 0,
        favoritesByClientId: room.favoritesByClientId || {},
        bans: room.bans || [],
        mutes: room.mutes || [],
        moderationLog: (room.moderationLog || []).slice(-100),
        recentPlays: (room.recentPlays || []).slice(0, 40),
        createdAt: room.createdAt
    };
}

export class RoomsStore {
    constructor(filePath = ROOMS_FILE) {
        this.filePath = filePath;
        this.writeTimer = null;
    }

    load() {
        ensureDataDir();
        if (!fs.existsSync(this.filePath)) {
            return [];
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            // Support both { rooms: [...] } and bare array
            if (Array.isArray(raw)) return raw;
            return Array.isArray(raw.rooms) ? raw.rooms : [];
        } catch (err) {
            console.error('[roomsStore] failed to load', err.message);
            return [];
        }
    }

    saveSoon(getRooms) {
        if (this.writeTimer) clearTimeout(this.writeTimer);
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null;
            this.saveNow(getRooms);
        }, 400);
    }

    saveNow(getRooms) {
        ensureDataDir();
        const rooms = typeof getRooms === 'function' ? getRooms() : getRooms;
        const payload = {
            savedAt: Date.now(),
            rooms: rooms.map(serializeRoomForDisk)
        };
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
        fs.renameSync(tmp, this.filePath);
    }
}

export const roomsStore = new RoomsStore();
