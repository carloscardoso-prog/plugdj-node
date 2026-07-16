import { createId } from '../utils/ids.js';
import { config } from '../config/index.js';

export function createUser({ username, avatar, role = 'user', clientId = null, id = null }) {
    return {
        id: id || createId(),
        clientId: clientId || createId(),
        username,
        avatar,
        role,
        liked: false,
        disliked: false,
        playlisted: false,
        inQueue: false,
        library: [],
        playlists: [],
        activePlaylistId: null,
        stageLeft: null,
        stageBottom: null,
        absentSince: null,
        joinedAt: Date.now(),
        lastChatAt: 0
    };
}

export function createRoom({
    id = null,
    slug,
    name,
    code = null,
    background = 'bg-neon-city',
    hostUsername = null,
    hostClientId = null,
    passwordHash = null,
    password = null,
    aboutCommunity = '',
    welcomeTitle = null,
    welcomeMessage = null,
    createdAt = null
}) {
    const roomUUID = id || createId();
    const roomSlug = slug || roomUUID;
    const title = welcomeTitle || `Welcome to ${name}!`;
    const message = welcomeMessage || 'Be kind, respect the DJ queue and enjoy the music together.';
    // Prefer passwordHash; accept legacy plaintext `password` only for hydration
    const resolvedHash = passwordHash || null;

    return {
        id: roomUUID,
        roomUUID,
        slug: roomSlug,
        code,
        name,
        background,
        hostUsername,
        hostClientId: hostClientId || null,
        ownerClientId: hostClientId || null,
        passwordHash: resolvedHash,
        /** Transient legacy field — serialize hashes it then clears */
        password: resolvedHash ? null : (password || null),
        aboutCommunity: aboutCommunity || '',
        welcomeTitle: title,
        welcomeMessage: message,
        ownerId: null,
        users: [],
        queue: [],
        currentDJ: null,
        currentSong: null,
        votes: {
            woot: 0,
            grab: 0,
            meh: 0
        },
        votesByTrack: {},
        visitorUsernames: [],
        visitorClientIds: [],
        totalVisitors: 0,
        favoriteUsernames: [],
        favoriteClientIds: [],
        totalFavorites: 0,
        favoritesByUser: {},
        favoritesByClientId: {},
        librariesByUser: {},
        playlistsByUser: {},
        recentPlays: [],
        bans: [],
        mutes: [],
        moderationLog: [],
        chatHistory: [],
        chatRateLimitMs: config.defaultChatRateLimitMs,
        createdAt: createdAt || Date.now()
    };
}

export class MemoryDatabase {
    constructor() {
        this.rooms = new Map();
        this.roomsBySlug = new Map();
        this.roomsByCode = new Map();
        this.connections = new Map();
    }

    getRoom(roomId) {
        if (roomId == null || roomId === '') return null;
        const key = String(roomId);
        return this.rooms.get(key)
            || this.roomsBySlug.get(key.toLowerCase())
            || this.roomsByCode.get(key.toLowerCase())
            || null;
    }

    roomExists(roomId) {
        return this.getRoom(roomId) !== null;
    }

    slugExists(slug) {
        return this.roomsBySlug.has(String(slug || '').toLowerCase());
    }

    saveRoom(room) {
        this.rooms.set(room.id, room);
        if (room.slug) {
            this.roomsBySlug.set(String(room.slug).toLowerCase(), room);
        }
        if (room.code) {
            this.roomsByCode.set(String(room.code).toLowerCase(), room);
        }
        return room;
    }

    deleteRoom(roomId) {
        const room = this.getRoom(roomId);
        if (!room) return null;
        this.rooms.delete(room.id);
        if (room.slug) this.roomsBySlug.delete(String(room.slug).toLowerCase());
        if (room.code) this.roomsByCode.delete(String(room.code).toLowerCase());
        return room;
    }

    codeExists(code) {
        return this.roomsByCode.has(String(code || '').toLowerCase());
    }

    listRooms() {
        return Array.from(this.rooms.values()).map((room) => ({
            id: room.id,
            roomUUID: room.id,
            slug: room.slug,
            code: room.code,
            name: room.name,
            userCount: room.users.length,
            hasPassword: !!(room.passwordHash || room.password),
            createdAt: room.createdAt
        }));
    }

    bindConnection(socketId, meta) {
        this.connections.set(socketId, meta);
    }

    getConnection(socketId) {
        return this.connections.get(socketId) || null;
    }

    unbindConnection(socketId) {
        this.connections.delete(socketId);
    }

    appendChatMessage(room, message) {
        room.chatHistory.push(message);
        if (room.chatHistory.length > config.chatHistoryLimit) {
            room.chatHistory.shift();
        }
        return message;
    }
}

export const db = new MemoryDatabase();
