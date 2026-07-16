(function(global) {
    'use strict';

    /**
     * Client identity (browser: localStorage; desktop: would be profile.json).
     *
     * Shape:
     * {
     *   userUUID, username, avatar, settings, playlists, library,
     *   history: [{ serverUUID, serverIssuedUUID, url, roomName, roomSlug, lastConnected }]
     * }
     */
    const PROFILE_KEY = 'plugdj-profile';

    const DEFAULT_SETTINGS = {
        showOnlineStatus: true,
        masterVolume: 70,
        normalizeVolume: true,
        chatTimestamps: true,
        chatCompact: false,
        chatFontSize: 'Medium',
        desktopNotifications: false,
        soundAlerts: true,
        notifyTurn: true
    };

    function uuid() {
        if (global.crypto?.randomUUID) return global.crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    function defaultProfile() {
        const userUUID = uuid();
        return {
            userUUID,
            userId: userUUID, // legacy alias
            username: '',
            displayName: '',
            avatar: '80s01',
            settings: { ...DEFAULT_SETTINGS },
            playlists: [{ id: uuid(), name: 'Favorites', tracks: [] }],
            activePlaylistId: null,
            library: [],
            history: []
        };
    }

    function normalizeHistory(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((h) => h && h.serverUUID)
            .map((h) => ({
                serverUUID: String(h.serverUUID),
                serverIssuedUUID: h.serverIssuedUUID ? String(h.serverIssuedUUID) : null,
                url: String(h.url || ''),
                roomName: String(h.roomName || ''),
                roomSlug: String(h.roomSlug || ''),
                lastConnected: h.lastConnected || new Date().toISOString()
            }))
            .slice(0, 40);
    }

    function normalize(raw) {
        const base = defaultProfile();
        if (!raw || typeof raw !== 'object') return base;
        const playlists = Array.isArray(raw.playlists) && raw.playlists.length
            ? raw.playlists.map((p) => ({
                id: p.id || uuid(),
                name: String(p.name || 'Playlist').slice(0, 48),
                tracks: Array.isArray(p.tracks) ? p.tracks : []
            }))
            : base.playlists;
        const userUUID = raw.userUUID || raw.userId || base.userUUID;
        const username = String(raw.username || raw.displayName || '').slice(0, 24);
        return {
            userUUID,
            userId: userUUID,
            username,
            displayName: username,
            avatar: raw.avatar || '80s01',
            settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
            playlists,
            activePlaylistId: raw.activePlaylistId && playlists.some((p) => p.id === raw.activePlaylistId)
                ? raw.activePlaylistId
                : playlists[0].id,
            library: Array.isArray(raw.library) ? raw.library : [],
            history: normalizeHistory(raw.history)
        };
    }

    class ProfileService {
        load() {
            try {
                const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
                const profile = normalize(parsed);
                if (!parsed) {
                    const legacyName = localStorage.getItem('plugdj-username') || '';
                    const legacyAvatar = localStorage.getItem('plugdj-room-avatar') || '';
                    if (legacyName) {
                        profile.username = legacyName;
                        profile.displayName = legacyName;
                    }
                    if (legacyAvatar) profile.avatar = legacyAvatar;
                }
                this.save(profile);
                return profile;
            } catch {
                const profile = defaultProfile();
                this.save(profile);
                return profile;
            }
        }

        save(profile) {
            const next = normalize(profile);
            localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
            if (next.username) localStorage.setItem('plugdj-username', next.username);
            if (next.avatar) localStorage.setItem('plugdj-room-avatar', next.avatar);
            return next;
        }

        update(patch) {
            const current = this.load();
            const merged = {
                ...current,
                ...patch,
                settings: { ...current.settings, ...(patch.settings || {}) }
            };
            if (patch.displayName != null && patch.username == null) {
                merged.username = patch.displayName;
            }
            if (patch.username != null) {
                merged.displayName = patch.username;
            }
            return this.save(merged);
        }

        getServerIssuedUUID(serverUUID) {
            if (!serverUUID) return null;
            const hit = this.load().history.find((h) => h.serverUUID === serverUUID);
            return hit?.serverIssuedUUID || null;
        }

        /** Upsert connection history after a successful room_state. */
        rememberConnection({ serverUUID, serverIssuedUUID, url, roomName, roomSlug }) {
            if (!serverUUID || !serverIssuedUUID) return this.load();
            const current = this.load();
            const nextHistory = current.history.filter((h) => h.serverUUID !== serverUUID);
            nextHistory.unshift({
                serverUUID,
                serverIssuedUUID,
                url: url || '',
                roomName: roomName || '',
                roomSlug: roomSlug || '',
                lastConnected: new Date().toISOString()
            });
            return this.save({ ...current, history: nextHistory.slice(0, 40) });
        }

        exportJson() {
            return JSON.stringify(this.load(), null, 2);
        }

        importJson(text) {
            const parsed = JSON.parse(text);
            return this.save(parsed);
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.ProfileService = ProfileService;
    global.PlugDJ.getProfile = () => new ProfileService().load();
    global.PlugDJ.saveProfile = (profile) => new ProfileService().save(profile);
    global.PlugDJ.updateProfile = (patch) => new ProfileService().update(patch);
    global.PlugDJ.rememberServerConnection = (meta) => new ProfileService().rememberConnection(meta);
    global.PlugDJ.getServerIssuedUUID = (serverUUID) => new ProfileService().getServerIssuedUUID(serverUUID);
})(window);
