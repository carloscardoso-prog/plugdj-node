import { createId } from '../utils/ids.js';

const MAX_LIBRARY = 50;
const MAX_PLAYLISTS = 20;
const MAX_PLAYLIST_TRACKS = 100;
const MAX_RECENT_PLAYS = 40;

function trackKey(track) {
    return track?.mediaKey || track?.sourceUrl || track?.id || null;
}

function publicTrack(track, recentKeys = new Set()) {
    if (!track) return null;
    const key = trackKey(track);
    return {
        id: track.id,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        provider: track.provider || null,
        sourceUrl: track.sourceUrl || null,
        mediaKey: track.mediaKey || null,
        thumbnailUrl: track.thumbnailUrl || null,
        artworkUrl: track.artworkUrl || track.thumbnailUrl || null,
        playMode: track.playMode || 'artwork',
        isRepeat: key ? recentKeys.has(key) : false
    };
}

function userKey(user) {
    return user.clientId || user.username;
}

function makePlaylist(name = 'Favorites') {
    return {
        id: `plist-${createId()}`,
        name: String(name || 'Favorites').slice(0, 48),
        tracks: []
    };
}

function normalizePlaylists(raw) {
    if (Array.isArray(raw) && raw.length && raw[0]?.tracks) {
        return raw.map((p) => ({
            id: p.id || `plist-${createId()}`,
            name: String(p.name || 'Playlist').slice(0, 48),
            tracks: Array.isArray(p.tracks) ? p.tracks.map((t) => ({ ...t })) : []
        }));
    }
    // Legacy: flat track array → one playlist
    if (Array.isArray(raw) && raw.length && (raw[0]?.title || raw[0]?.sourceUrl)) {
        const pl = makePlaylist('Favorites');
        pl.tracks = raw.map((t) => ({ ...t }));
        return [pl];
    }
    return [makePlaylist('Favorites')];
}

export class LibraryService {
    ensureRoomMedia(room) {
        if (!room.librariesByUser) room.librariesByUser = {};
        if (!room.playlistsByUser) room.playlistsByUser = {};
        if (!room.recentPlays) room.recentPlays = [];
    }

    ensureUserMedia(room, user) {
        this.ensureRoomMedia(room);
        const key = userKey(user);

        if (!Array.isArray(user.library)) {
            user.library = Array.isArray(room.librariesByUser[key])
                ? room.librariesByUser[key].map((t) => ({ ...t }))
                : [];
        }

        if (!Array.isArray(user.playlists)) {
            const stored = room.playlistsByUser[key];
            user.playlists = normalizePlaylists(stored);
        } else {
            user.playlists = normalizePlaylists(user.playlists);
        }

        if (!user.activePlaylistId || !user.playlists.some((p) => p.id === user.activePlaylistId)) {
            user.activePlaylistId = user.playlists[0].id;
        }

        return user;
    }

    persistUserMedia(room, user) {
        this.ensureRoomMedia(room);
        const key = userKey(user);
        room.librariesByUser[key] = (user.library || []).map((t) => ({ ...t }));
        room.playlistsByUser[key] = (user.playlists || []).map((p) => ({
            id: p.id,
            name: p.name,
            tracks: (p.tracks || []).map((t) => ({ ...t }))
        }));
    }

    /** Replace session playlists from the client's local profile. */
    syncPlaylistsFromClient(room, user, playlists, activePlaylistId) {
        this.ensureUserMedia(room, user);
        if (Array.isArray(playlists) && playlists.length) {
            user.playlists = normalizePlaylists(playlists).slice(0, MAX_PLAYLISTS);
        }
        if (activePlaylistId && user.playlists.some((p) => p.id === activePlaylistId)) {
            user.activePlaylistId = activePlaylistId;
        } else {
            user.activePlaylistId = user.playlists[0].id;
        }
        this.persistUserMedia(room, user);
        return this.toPublicLibraryState(room, user);
    }

    /** Sync library + playlists from the client's local profile on join. */
    syncFromClient(room, user, { library, playlists, activePlaylistId } = {}) {
        this.ensureUserMedia(room, user);
        if (Array.isArray(library)) {
            user.library = library.slice(0, MAX_LIBRARY).map((t) => ({ ...t }));
        }
        this.syncPlaylistsFromClient(room, user, playlists, activePlaylistId);
        return this.toPublicLibraryState(room, user);
    }

    recentKeySet(room) {
        this.ensureRoomMedia(room);
        return new Set(
            room.recentPlays
                .map((p) => p.mediaKey || p.sourceUrl)
                .filter(Boolean)
        );
    }

    isRepeat(room, track) {
        const key = trackKey(track);
        if (!key) return false;
        return this.recentKeySet(room).has(key);
    }

    recordPlay(room, song, username) {
        this.ensureRoomMedia(room);
        const key = trackKey(song);
        if (!key) return;
        room.recentPlays = [
            {
                mediaKey: song.mediaKey || null,
                sourceUrl: song.sourceUrl || null,
                title: song.title,
                artist: song.artist,
                playedBy: username,
                playedAt: Date.now()
            },
            ...room.recentPlays.filter((p) => (p.mediaKey || p.sourceUrl) !== key)
        ].slice(0, MAX_RECENT_PLAYS);
    }

    getActivePlaylist(user) {
        return user.playlists.find((p) => p.id === user.activePlaylistId) || user.playlists[0];
    }

    toPublicLibraryState(room, user) {
        this.ensureUserMedia(room, user);
        const recent = this.recentKeySet(room);
        return {
            library: user.library.map((t) => publicTrack(t, recent)),
            playlists: user.playlists.map((p) => ({
                id: p.id,
                name: p.name,
                tracks: p.tracks.map((t) => publicTrack(t, recent))
            })),
            activePlaylistId: user.activePlaylistId,
            recentPlays: room.recentPlays.slice(0, 20)
        };
    }

    addToLibrary(room, user, songMeta) {
        this.ensureUserMedia(room, user);
        if (user.library.length >= MAX_LIBRARY) {
            return { ok: false, error: 'Library is full (max 50)' };
        }
        const key = trackKey(songMeta);
        if (key && user.library.some((t) => trackKey(t) === key)) {
            return { ok: false, error: 'Already in Library', code: 'duplicate' };
        }
        const track = {
            ...songMeta,
            id: `lib-${createId()}`,
            mediaToken: null,
            mediaUrl: null,
            mediaStatus: songMeta.playMode === 'artwork' ? 'ready' : 'pending'
        };
        user.library.push(track);
        this.persistUserMedia(room, user);
        return { ok: true, data: track, isRepeat: this.isRepeat(room, track) };
    }

    /** Copy the room's current song into the user's personal library. */
    grabCurrentToLibrary(room, user) {
        if (!room.currentSong) {
            return { ok: false, error: 'No track playing' };
        }
        const song = room.currentSong;
        return this.addToLibrary(room, user, {
            title: song.title,
            artist: song.artist,
            duration: song.duration,
            provider: song.provider,
            sourceUrl: song.sourceUrl,
            mediaKey: song.mediaKey,
            thumbnailUrl: song.thumbnailUrl,
            artworkUrl: song.artworkUrl || song.thumbnailUrl,
            playMode: song.playMode || 'artwork',
            addedBy: user.username
        });
    }

    /** Copy the room's current song into the user's active playlist. */
    grabCurrentToPlaylist(room, user, playlistId = null) {
        if (!room.currentSong) {
            return { ok: false, error: 'No track playing' };
        }
        const song = room.currentSong;
        return this.addToPlaylist(room, user, {
            title: song.title,
            artist: song.artist,
            duration: song.duration,
            provider: song.provider,
            sourceUrl: song.sourceUrl,
            mediaKey: song.mediaKey,
            thumbnailUrl: song.thumbnailUrl,
            artworkUrl: song.artworkUrl || song.thumbnailUrl,
            playMode: song.playMode || 'artwork',
            addedBy: user.username
        }, playlistId);
    }

    removeFromLibrary(room, user, trackId) {
        this.ensureUserMedia(room, user);
        const before = user.library.length;
        user.library = user.library.filter((t) => t.id !== trackId);
        this.persistUserMedia(room, user);
        return { ok: before !== user.library.length };
    }

    /** Reorder library by full ordered list of track ids. */
    reorderLibrary(room, user, orderedIds) {
        this.ensureUserMedia(room, user);
        if (!Array.isArray(orderedIds) || !orderedIds.length) {
            return { ok: false, error: 'Invalid order' };
        }
        const byId = new Map(user.library.map((t) => [t.id, t]));
        if (orderedIds.length !== user.library.length) {
            return { ok: false, error: 'Order does not match library' };
        }
        const next = [];
        const seen = new Set();
        for (const id of orderedIds) {
            if (seen.has(id)) return { ok: false, error: 'Duplicate track in order' };
            const track = byId.get(id);
            if (!track) return { ok: false, error: 'Unknown track in order' };
            seen.add(id);
            next.push(track);
        }
        user.library = next;
        this.persistUserMedia(room, user);
        return { ok: true };
    }

    shiftLibraryHead(room, user) {
        this.ensureUserMedia(room, user);
        if (!user.library.length) return null;
        const [head] = user.library.splice(0, 1);
        this.persistUserMedia(room, user);
        return head;
    }

    peekLibraryHead(room, user) {
        this.ensureUserMedia(room, user);
        return user.library[0] || null;
    }

    createPlaylist(room, user, name) {
        this.ensureUserMedia(room, user);
        if (user.playlists.length >= MAX_PLAYLISTS) {
            return { ok: false, error: 'Too many playlists (max 20)' };
        }
        const pl = makePlaylist(name || `Playlist ${user.playlists.length + 1}`);
        user.playlists.push(pl);
        user.activePlaylistId = pl.id;
        this.persistUserMedia(room, user);
        return { ok: true, data: pl };
    }

    renamePlaylist(room, user, playlistId, name) {
        this.ensureUserMedia(room, user);
        const pl = user.playlists.find((p) => p.id === playlistId);
        if (!pl) return { ok: false, error: 'Playlist not found' };
        pl.name = String(name || pl.name).trim().slice(0, 48) || pl.name;
        this.persistUserMedia(room, user);
        return { ok: true, data: pl };
    }

    deletePlaylist(room, user, playlistId) {
        this.ensureUserMedia(room, user);
        if (user.playlists.length <= 1) {
            return { ok: false, error: 'Keep at least one playlist' };
        }
        user.playlists = user.playlists.filter((p) => p.id !== playlistId);
        if (user.activePlaylistId === playlistId) {
            user.activePlaylistId = user.playlists[0].id;
        }
        this.persistUserMedia(room, user);
        return { ok: true };
    }

    setActivePlaylist(room, user, playlistId) {
        this.ensureUserMedia(room, user);
        if (!user.playlists.some((p) => p.id === playlistId)) {
            return { ok: false, error: 'Playlist not found' };
        }
        user.activePlaylistId = playlistId;
        this.persistUserMedia(room, user);
        return { ok: true };
    }

    addToPlaylist(room, user, songMeta, playlistId = null) {
        this.ensureUserMedia(room, user);
        const pl = user.playlists.find((p) => p.id === (playlistId || user.activePlaylistId))
            || this.getActivePlaylist(user);
        if (!pl) return { ok: false, error: 'Playlist not found' };
        if (pl.tracks.length >= MAX_PLAYLIST_TRACKS) {
            return { ok: false, error: 'Playlist is full (max 100)' };
        }
        const key = trackKey(songMeta);
        if (key && pl.tracks.some((t) => trackKey(t) === key)) {
            return { ok: false, error: 'Already in this playlist', code: 'duplicate' };
        }
        const track = {
            ...songMeta,
            id: `pl-${createId()}`,
            mediaToken: null,
            mediaUrl: null,
            mediaStatus: songMeta.playMode === 'artwork' ? 'ready' : 'pending'
        };
        pl.tracks.push(track);
        this.persistUserMedia(room, user);
        return { ok: true, data: track, playlistId: pl.id, isRepeat: this.isRepeat(room, track) };
    }

    removeFromPlaylist(room, user, trackId, playlistId = null) {
        this.ensureUserMedia(room, user);
        const pl = user.playlists.find((p) => p.id === (playlistId || user.activePlaylistId))
            || this.getActivePlaylist(user);
        if (!pl) return { ok: false };
        const before = pl.tracks.length;
        pl.tracks = pl.tracks.filter((t) => t.id !== trackId);
        this.persistUserMedia(room, user);
        return { ok: before !== pl.tracks.length };
    }

    promotePlaylistToLibrary(room, user, trackId, playlistId = null) {
        this.ensureUserMedia(room, user);
        const pl = user.playlists.find((p) => p.id === (playlistId || user.activePlaylistId))
            || this.getActivePlaylist(user);
        const track = pl?.tracks.find((t) => t.id === trackId);
        if (!track) return { ok: false, error: 'Track not found in playlist' };
        return this.addToLibrary(room, user, {
            ...track,
            id: `lib-${createId()}`
        });
    }

    /** Push every track from a playlist into the library (skip duplicates / stop at cap). */
    promoteEntirePlaylist(room, user, playlistId = null) {
        this.ensureUserMedia(room, user);
        const pl = user.playlists.find((p) => p.id === (playlistId || user.activePlaylistId))
            || this.getActivePlaylist(user);
        if (!pl) return { ok: false, error: 'Playlist not found' };
        if (!pl.tracks.length) return { ok: false, error: 'Playlist is empty' };

        const existingKeys = new Set(
            user.library.map((t) => trackKey(t)).filter(Boolean)
        );
        let added = 0;
        let skipped = 0;
        let capped = false;

        for (const track of pl.tracks) {
            if (user.library.length >= MAX_LIBRARY) {
                capped = true;
                break;
            }
            const key = trackKey(track);
            if (key && existingKeys.has(key)) {
                skipped += 1;
                continue;
            }
            const result = this.addToLibrary(room, user, {
                ...track,
                id: `lib-${createId()}`
            });
            if (result.ok) {
                added += 1;
                if (key) existingKeys.add(key);
            }
        }

        if (!added && capped) {
            return { ok: false, error: 'Library is full (max 50)' };
        }
        if (!added) {
            return { ok: false, error: skipped ? 'All tracks already in Library' : 'Nothing to add' };
        }

        return { ok: true, data: { added, skipped, capped } };
    }
}

export const libraryService = new LibraryService();
