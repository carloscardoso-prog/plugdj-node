(function(global) {
    'use strict';

    const STORAGE_USERNAME = 'plugdj-username';
    const STORAGE_ROOM = 'plugdj-room';
    const STORAGE_ROLE = 'plugdj-role';
    const STORAGE_PASSWORDS = 'plugdj-room-passwords';
    const STORAGE_LAST_SERVER = 'plugdj-last-server-uuid';
    const LEGACY_PASSWORD = 'plugdj-room-password';

    function slugify(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function readPasswordMap() {
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_PASSWORDS) || '{}');
        } catch {
            return {};
        }
    }

    function writePasswordMap(map) {
        sessionStorage.setItem(STORAGE_PASSWORDS, JSON.stringify(map));
    }

    function getRoomPassword(slug) {
        const room = slugify(slug);
        if (!room) return '';

        const map = readPasswordMap();
        if (map[room]) return map[room];

        const legacyRoom = slugify(localStorage.getItem(STORAGE_ROOM) || '');
        const legacyPassword = sessionStorage.getItem(LEGACY_PASSWORD) || '';
        if (legacyRoom === room && legacyPassword) {
            setRoomPassword(room, legacyPassword);
            sessionStorage.removeItem(LEGACY_PASSWORD);
            return legacyPassword;
        }

        return '';
    }

    function setRoomPassword(slug, password) {
        const room = slugify(slug);
        if (!room) return;

        const map = readPasswordMap();
        const trimmed = String(password || '').trim();
        if (trimmed) {
            map[room] = trimmed;
        } else {
            delete map[room];
        }
        writePasswordMap(map);
        sessionStorage.removeItem(LEGACY_PASSWORD);
    }

    class LobbyService {
        constructor(api) {
            this.api = api || new global.PlugDJ.ApiService();
        }

        saveSession({ username, room, role, password, serverUUID }) {
            const slug = slugify(room);
            localStorage.setItem(STORAGE_USERNAME, username);
            localStorage.setItem(STORAGE_ROOM, slug);
            if (role) {
                localStorage.setItem(STORAGE_ROLE, role);
            } else {
                localStorage.removeItem(STORAGE_ROLE);
            }
            if (serverUUID) {
                localStorage.setItem(STORAGE_LAST_SERVER, serverUUID);
            }
            setRoomPassword(slug, password || '');
        }

        getSession() {
            const room = localStorage.getItem(STORAGE_ROOM) || '';
            return {
                username: localStorage.getItem(STORAGE_USERNAME) || '',
                room,
                role: localStorage.getItem(STORAGE_ROLE) || 'user',
                password: getRoomPassword(room),
                serverUUID: localStorage.getItem(STORAGE_LAST_SERVER) || ''
            };
        }

        redirectToRoom(slug) {
            const clean = slugify(slug);
            const onNode = String(location.port || '') === '3000'
                || /localhost|127\.0\.0\.1/i.test(location.hostname);
            window.location.href = onNode
                ? `/${encodeURIComponent(clean)}`
                : `/room.html?room=${encodeURIComponent(clean)}`;
        }

        async listLocalRooms() {
            return this.api.listRooms();
        }

        async deleteLocalRoom(slug) {
            return this.api.deleteRoom(slug);
        }

        async joinRoom({ nickname, room, password }) {
            const slug = slugify(room);
            if (!nickname.trim()) throw new Error('Nickname is required');
            if (!slug || slug.length < 3) throw new Error('Enter a valid room name / slug');

            const profile = global.PlugDJ.updateProfile?.({ displayName: nickname.trim(), username: nickname.trim() })
                || global.PlugDJ.getProfile?.();
            const trimmedPassword = String(password || '').trim();
            const access = await this.api.checkRoomAccess(slug, {
                username: nickname.trim(),
                password: trimmedPassword,
                clientId: profile?.userUUID || profile?.userId,
                userUUID: profile?.userUUID || profile?.userId
            });

            if (!access.ok) {
                if (access.code === 'banned') {
                    this.showBanned(access.error, access.reason);
                    return;
                }
                throw new Error(access.error || 'Could not join room');
            }

            this.saveSession({
                username: nickname.trim(),
                room: slug,
                password: access.room.hasPassword ? trimmedPassword : '',
                serverUUID: access.serverUUID || access.room?.serverUUID
            });
            this.redirectToRoom(slug);
        }

        showBanned(message, reason) {
            $('#login-page-content').attr('hidden', '');
            $('#login-banned').removeAttr('hidden');
            $('#login-banned-message').text(message || 'You are banned from this room.');
            if (reason) $('#login-banned-reason').text(`Reason: ${reason}`).removeAttr('hidden');
        }

        async createRoom({ nickname, name, slug, password, aboutCommunity, welcomeTitle, welcomeMessage }) {
            const finalSlug = slugify(slug || name);
            if (!nickname.trim()) throw new Error('Nickname is required');
            if (!name.trim()) throw new Error('Room name is required');
            if (!finalSlug || finalSlug.length < 3) throw new Error('Room slug must be at least 3 characters');

            const trimmedPassword = String(password || '').trim();

            const profile = global.PlugDJ.updateProfile?.({ displayName: nickname.trim(), username: nickname.trim() })
                || global.PlugDJ.getProfile?.();

            const result = await this.api.createRoom({
                username: nickname.trim(),
                clientId: profile?.userUUID || profile?.userId,
                userUUID: profile?.userUUID || profile?.userId,
                name: name.trim(),
                slug: finalSlug,
                password: trimmedPassword,
                aboutCommunity: aboutCommunity || '',
                welcomeTitle: welcomeTitle || '',
                welcomeMessage: welcomeMessage || ''
            });

            if (!result.ok) throw new Error(result.error || 'Could not create room');

            this.saveSession({
                username: nickname.trim(),
                room: result.room.slug,
                role: 'owner',
                password: trimmedPassword,
                serverUUID: result.serverUUID || result.room?.serverUUID
            });
            this.redirectToRoom(result.room.slug);
        }

        inviteUrl(slug) {
            const clean = slugify(slug);
            return `${location.origin}/${encodeURIComponent(clean)}`;
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.LobbyService = LobbyService;
    global.PlugDJ.STORAGE_USERNAME = STORAGE_USERNAME;
    global.PlugDJ.STORAGE_ROOM = STORAGE_ROOM;
    global.PlugDJ.STORAGE_ROLE = STORAGE_ROLE;
    global.PlugDJ.STORAGE_PASSWORDS = STORAGE_PASSWORDS;
    global.PlugDJ.getRoomPassword = getRoomPassword;
    global.PlugDJ.setRoomPassword = setRoomPassword;
    global.PlugDJ.slugify = slugify;
})(window);
