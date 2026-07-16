import { config } from '../config/index.js';

export function toPublicUser(user) {
    return {
        id: user.id,
        serverIssuedUUID: user.id,
        clientId: user.clientId || null,
        userUUID: user.clientId || null,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        liked: !!user.liked,
        disliked: !!user.disliked,
        playlisted: !!user.playlisted,
        inQueue: !!user.inQueue,
        stageLeft: Number.isFinite(user.stageLeft) ? user.stageLeft : null,
        stageBottom: Number.isFinite(user.stageBottom) ? user.stageBottom : null,
        joinedAt: user.joinedAt
    };
}

export function toPublicSong(song) {
    if (!song) return null;
    return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        duration: song.duration,
        addedBy: song.addedBy,
        startedAt: song.startedAt,
        provider: song.provider || null,
        sourceUrl: song.sourceUrl || null,
        thumbnailUrl: song.thumbnailUrl || null,
        artworkUrl: song.artworkUrl || song.thumbnailUrl || null,
        playMode: song.playMode || 'artwork',
        mediaUrl: song.mediaUrl || null,
        mediaStatus: song.mediaStatus || null
    };
}

export function toPublicRoomState(room, moderationState = null, serverUUID = null) {
    return {
        id: room.id,
        roomUUID: room.id,
        slug: room.slug,
        code: room.code || null,
        name: room.name,
        serverUUID: serverUUID || null,
        background: room.background,
        aboutCommunity: room.aboutCommunity || '',
        welcomeTitle: room.welcomeTitle || '',
        welcomeMessage: room.welcomeMessage || '',
        chatRateLimitMs: room.chatRateLimitMs || config.defaultChatRateLimitMs,
        ownerId: room.ownerId,
        hostUsername: room.hostUsername || null,
        totalVisitors: room.totalVisitors || 0,
        totalFavorites: room.totalFavorites || 0,
        users: room.users.map(toPublicUser),
        queue: room.queue.map(toPublicQueueEntry),
        currentDJ: room.currentDJ ? toPublicUser(room.currentDJ) : null,
        currentSong: toPublicSong(room.currentSong),
        votes: { ...room.votes },
        chatHistory: room.chatHistory,
        moderation: moderationState
    };
}

export function toPublicRoomSummary(room, serverUUID = null) {
    return {
        id: room.id,
        roomUUID: room.id,
        slug: room.slug,
        code: room.code || null,
        name: room.name,
        serverUUID: serverUUID || null,
        userCount: room.users.length,
        hasPassword: !!(room.passwordHash || room.password),
        createdAt: room.createdAt
    };
}

export function toPublicQueueEntry(entry) {
    return {
        id: entry.id,
        userId: entry.userId,
        username: entry.username,
        song: toPublicSong(entry.song)
    };
}

export function toPublicUserMedia(user) {
    const playlistTracks = Array.isArray(user?.playlists)
        ? user.playlists.reduce((n, p) => n + (p.tracks?.length || 0), 0)
        : (Array.isArray(user?.playlist) ? user.playlist.length : 0);
    return {
        libraryCount: Array.isArray(user?.library) ? user.library.length : 0,
        playlistCount: playlistTracks,
        playlistsCount: Array.isArray(user?.playlists) ? user.playlists.length : 0
    };
}
