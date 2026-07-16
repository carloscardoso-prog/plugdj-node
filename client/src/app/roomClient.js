(function(global) {
    'use strict';

    const ServerEvents = global.PlugDJ.ServerEvents;
    const STORAGE_USERNAME = 'plugdj-username';
    const STORAGE_AVATAR = 'plugdj-room-avatar';
    const STORAGE_BG = 'plugdj-room-bg';
    const STORAGE_ROOM = 'plugdj-room';

    const VOTE_MAP = { like: 'woot', dislike: 'meh', playlist: 'grab' };
    const BLOCKED_CODES = new Set(['wrong_password', 'room_not_found', 'access_denied', 'banned']);

    class RoomClient {
        constructor(options = {}) {
            this.roomId = options.roomId || localStorage.getItem(STORAGE_ROOM) || '';
            this.api = options.api || new global.PlugDJ.ApiService();
            this.ws = new global.PlugDJ.WebSocketService(options.ws || {});
            this.store = new global.PlugDJ.RoomStore();
            this.chatUI = new global.PlugDJ.ChatUI();
            this.libraryUI = new global.PlugDJ.LibraryUI();
            this.settingsUI = new global.PlugDJ.SettingsUI();
            this.roomUI = new global.PlugDJ.RoomUI({
                onBackgroundChange: (backgroundId) => this.handleBackgroundSync(backgroundId)
            });
            this.connected = false;
            this.joined = false;
            this.blocked = false;
            this.roomPassword = '';
            this.lastChatSentAt = 0;
            this.joinCredentials = null;
            this.lastSyncedSongKey = null;
            this.prevDjId = null;
        }

        buildJoinPayload() {
            const profile = global.PlugDJ.getProfile?.() || {};
            const creds = this.joinCredentials || {};
            const userUUID = profile.userUUID || profile.userId;
            const serverUUID = this.lastServerUUID
                || localStorage.getItem('plugdj-last-server-uuid')
                || '';
            const serverIssuedUUID = serverUUID
                ? (global.PlugDJ.getServerIssuedUUID?.(serverUUID) || null)
                : null;
            return {
                roomId: this.roomId,
                username: creds.username || profile.displayName || profile.username || 'Guest',
                avatar: creds.avatar || profile.avatar || '80s01',
                password: creds.password || this.roomPassword || '',
                clientId: userUUID,
                userUUID,
                serverIssuedUUID,
                playlists: profile.playlists || [],
                activePlaylistId: profile.activePlaylistId || null,
                library: profile.library || []
            };
        }

        showLoading() {
            $('#room-loading').removeAttr('hidden');
            $('.app').attr('hidden', '');
        }

        hideLoading() {
            $('#room-loading').attr('hidden', '');
            $('.app').removeAttr('hidden');
        }

        rejoinRoom() {
            if (!this.joinCredentials || this.blocked) return;
            this.joined = false;
            this.ws.joinRoom(this.buildJoinPayload());
        }

        leaveRoom() {
            this.ws.leaveRoom();
            this.ws.disconnect();
            localStorage.removeItem(STORAGE_ROOM);
            window.location.href = '/';
        }

        async init(options = {}) {
            if (!this.roomId) {
                window.location.href = '/';
                return Promise.reject(new Error('No room selected'));
            }

            const profile = global.PlugDJ.getProfile?.() || {};
            const username = options.username || profile.displayName || localStorage.getItem(STORAGE_USERNAME) || 'Guest';
            const avatar = options.avatar || profile.avatar || localStorage.getItem(STORAGE_AVATAR) || '80s01';
            this.roomPassword = String(
                options.password
                || (typeof global.PlugDJ.getRoomPassword === 'function' ? global.PlugDJ.getRoomPassword(this.roomId) : '')
                || ''
            ).trim();

            global.PlugDJ.updateProfile?.({ displayName: username, avatar });
            localStorage.setItem(STORAGE_USERNAME, username);
            localStorage.setItem(STORAGE_ROOM, this.roomId);
            this.joinCredentials = { username, avatar, password: this.roomPassword };
            this.settingsUI.ensureBound();
            // Apply saved volume + chat prefs once on join (persists across refresh)
            this.settingsUI.applyRuntime(global.PlugDJ.getProfile?.(), { applyVolume: true });

            const preflight = await this.preflightJoin(username);
            if (!preflight.ok) {
                this.showBlocked(preflight.message, preflight.code);
                return Promise.reject(new Error(preflight.message));
            }

            this.showLoading();
            this.bindServerEvents();
            this.bindUiEvents();
            this.store.subscribe((state) => this.render(state));

            return this.ws.connect().catch(() => {
                if (!this.blocked) {
                    this.showBlocked('Could not connect to the room server. Try again from the login page.');
                }
            });
        }

        async preflightJoin(username) {
            try {
                const profile = global.PlugDJ.getProfile?.() || {};
                const result = await this.api.checkRoomAccess(this.roomId, {
                    username,
                    password: this.roomPassword,
                    clientId: profile.userUUID || profile.userId,
                    userUUID: profile.userUUID || profile.userId
                });
                if (!result.ok) {
                    return { ok: false, message: result.error, code: result.code };
                }
                if (result.serverUUID || result.room?.serverUUID) {
                    this.lastServerUUID = result.serverUUID || result.room.serverUUID;
                    localStorage.setItem('plugdj-last-server-uuid', this.lastServerUUID);
                }
                if (!result.room.hasPassword && typeof global.PlugDJ.setRoomPassword === 'function') {
                    global.PlugDJ.setRoomPassword(this.roomId, '');
                }
                return { ok: true };
            } catch (error) {
                const backend = typeof global.PlugDJ.getBackendBase === 'function' ? global.PlugDJ.getBackendBase() : '';
                const hint = String(location.port) === '3000'
                    ? 'Run "npm run dev".'
                    : 'Point ngrok at Node: ngrok http 3000 (not port 80).';
                return {
                    ok: false,
                    message: error?.message
                        || `Could not reach the API at ${backend || location.origin}. ${hint}`
                };
            }
        }

        isStaff() { return this.store.isStaff(); }
        isOwner() { return this.store.isOwner(); }
        isAdmin() { return this.store.isStaff(); }

        showBlocked(message, code) {
            if (this.blocked) return;
            this.blocked = true;
            this.ws.disconnect();
            this.hideLoading();
            $('.app').attr('hidden', '');
            $('#room-blocked-message').text(message || 'Could not enter this room.');
            if (code === 'banned') {
                $('#room-blocked-image').attr('src', 'assets/error/error3.webp');
            }
            $('#room-blocked').removeAttr('hidden');
        }

        bindServerEvents() {
            this.ws.on('connection_open', () => {
                this.connected = true;
                this.rejoinRoom();
            });

            this.ws.on('connection_close', () => {
                this.connected = false;
                if (!this.joined && !this.blocked && String(location.port || '') !== '3000') {
                    global.PlugDJ.showToast?.(
                        'WebSocket offline — run: ngrok http 3000'
                    );
                }
                this.joined = false;
            });

            this.ws.on(ServerEvents.ROOM_STATE, (payload) => {
                this.joined = true;
                // Force media resync after refresh/rejoin (seek to room clock)
                this.lastSyncedSongKey = null;
                this.store.setRoomState(payload);
                if (payload.serverUUID && payload.serverIssuedUUID) {
                    this.lastServerUUID = payload.serverUUID;
                    localStorage.setItem('plugdj-last-server-uuid', payload.serverUUID);
                    global.PlugDJ.rememberServerConnection?.({
                        serverUUID: payload.serverUUID,
                        serverIssuedUUID: payload.serverIssuedUUID,
                        url: `${location.origin}/${payload.slug || this.roomId}`,
                        roomName: payload.name || '',
                        roomSlug: payload.slug || this.roomId
                    });
                }
                this.chatUI.renderHistory(payload.chatHistory || []);
                this.libraryUI.apply({
                    library: payload.library || [],
                    playlists: payload.playlists,
                    activePlaylistId: payload.activePlaylistId,
                    playlist: payload.playlist || [],
                    recentPlays: payload.recentPlays || []
                });
                this.hideLoading();
                this.prevDjId = payload.currentDJ?.id || null;
                const song = payload.currentSong || null;
                global.PlugDJ.forceSyncMedia?.(song);
                global.PlugDJ.syncPlayerPosition?.(song);
                if (song) {
                    // Cached media after refresh must not sit paused
                    setTimeout(() => global.PlugDJ.forcePlayMedia?.(), 0);
                    setTimeout(() => global.PlugDJ.forcePlayMedia?.(), 300);
                }
            });

            this.ws.on(ServerEvents.LIBRARY_STATE, (payload) => {
                this.libraryUI.apply(payload);
            });

            this.ws.on(ServerEvents.ACK, (payload) => {
                if (payload?.warning === 'repeat') {
                    global.PlugDJ.showToast?.(payload.message || 'Repeat track');
                    return;
                }
                if (payload?.action === 'playlist_promote_all' && payload.message) {
                    global.PlugDJ.showToast?.(payload.message);
                    return;
                }
                if (payload?.action === 'library_grab_current' && payload.message) {
                    global.PlugDJ.showToast?.(payload.message);
                    global.PlugDJ.openLibraryPanel?.();
                }
                if (payload?.action === 'playlist_grab_current' && payload.message) {
                    global.PlugDJ.showToast?.(payload.message);
                    global.PlugDJ.openPlaylistPanel?.();
                }
            });

            this.ws.on(ServerEvents.USER_JOINED, (payload) => this.store.addUser(payload.user));
            this.ws.on(ServerEvents.USER_LEFT, (payload) => this.store.removeUser(payload.id));
            this.ws.on(ServerEvents.USER_UPDATED, (payload) => this.store.updateUser(payload.user));

            this.ws.on(ServerEvents.CHAT_MESSAGE, (payload) => {
                this.store.addChatMessage(payload);
                this.chatUI.appendMessage(payload);
                this.settingsUI.onChatMessage(payload, this.store.selfId);
            });

            this.ws.on(ServerEvents.CHAT_CLEARED, () => {
                this.store.clearChat();
                this.chatUI.renderHistory([]);
            });

            this.ws.on(ServerEvents.ROOM_UPDATED, (payload) => {
                const patch = { ...payload };
                delete patch.type;
                this.store.patchRoom(patch);
                if (payload.background) this.roomUI.onBackgroundChange(payload.background);
            });

            this.ws.on(ServerEvents.QUEUE_UPDATED, (payload) => {
                this.store.patchRoom({ queue: payload.queue || [] });
            });

            this.ws.on(ServerEvents.DJ_UPDATED, (payload) => {
                const prevDjId = this.prevDjId ?? this.store.getState()?.room?.currentDJ?.id ?? null;
                const nextDjId = payload.currentDJ?.id || null;
                this.lastSyncedSongKey = null;
                this.store.patchRoom({
                    currentDJ: payload.currentDJ || null,
                    currentSong: payload.currentSong || null
                });
                this.prevDjId = nextDjId;

                if (nextDjId && nextDjId === this.store.selfId && nextDjId !== prevDjId) {
                    this.settingsUI.onYourTurn();
                }

                // Always sync — including null when DJ leaves mid-track (reset timer)
                const song = payload.currentSong || null;
                global.PlugDJ.forceSyncMedia?.(song);
                global.PlugDJ.syncPlayerPosition?.(song);
                if (song) {
                    setTimeout(() => global.PlugDJ.forcePlayMedia?.(), 0);
                    setTimeout(() => global.PlugDJ.forcePlayMedia?.(), 300);
                }
            });

            this.ws.on(ServerEvents.VOTE_UPDATED, (payload) => {
                this.store.patchRoom({ votes: payload.votes });
            });

            this.ws.on(ServerEvents.MODERATION_UPDATED, (payload) => {
                this.store.patchRoom({ moderation: payload.moderation });
            });

            this.ws.on(ServerEvents.ERROR, (payload) => {
                if (payload.code === 'session_expired') {
                    this.rejoinRoom();
                    return;
                }
                if (!this.joined && payload.code && BLOCKED_CODES.has(payload.code)) {
                    this.showBlocked(payload.message, payload.code);
                    return;
                }
                if (typeof global.PlugDJ.showToast === 'function') {
                    global.PlugDJ.showToast(payload.message);
                }
            });
        }

        bindUiEvents() {
            const self = this;

            $('#btn-leave-room').on('click', () => self.leaveRoom());

            global.PlugDJ.sendChatMessage = (message) => {
                if (!self.connected) return false;
                const state = self.store.getState();
                const isStaff = self.isStaff();
                const limitMs = state.room?.chatRateLimitMs || 2000;
                if (!isStaff && self.lastChatSentAt) {
                    const elapsed = Date.now() - self.lastChatSentAt;
                    if (elapsed < limitMs) {
                        const waitSec = Math.ceil((limitMs - elapsed) / 1000);
                        global.PlugDJ.showToast?.(`Wait ${waitSec}s before sending another message`);
                        return false;
                    }
                }
                const sent = self.ws.sendChat(message);
                if (sent) self.lastChatSentAt = Date.now();
                return sent;
            };
            global.PlugDJ.changeAvatar = (avatarId) => {
                localStorage.setItem(STORAGE_AVATAR, avatarId);
                global.PlugDJ.updateProfile?.({ avatar: avatarId });
                if (self.connected) self.ws.changeAvatar(avatarId);
            };
            global.PlugDJ.renameUser = (username) => {
                const name = String(username || '').trim().slice(0, 24);
                if (!name) return false;
                localStorage.setItem(STORAGE_USERNAME, name);
                global.PlugDJ.updateProfile?.({ displayName: name });
                if (self.joinCredentials) self.joinCredentials.username = name;
                global.PlugDJ.setLocalUsername?.(name);
                return self.connected && self.ws.changeUsername(name);
            };
            global.PlugDJ.changeBackground = (backgroundId) => {
                if (!self.isStaff()) {
                    global.PlugDJ.showToast?.('Only staff can change the background');
                    return false;
                }
                localStorage.setItem(STORAGE_BG, backgroundId);
                return self.connected && self.ws.changeBackground(backgroundId);
            };
            global.PlugDJ.sendVote = (reaction) => {
                const state = self.store.getState();
                if (!state.room?.currentSong || !state.room?.currentDJ) {
                    global.PlugDJ.showToast?.('No track is playing');
                    return false;
                }
                if (state.room.currentDJ.id === state.selfId) {
                    global.PlugDJ.showToast?.('The DJ cannot vote on their own track');
                    return false;
                }
                const value = VOTE_MAP[reaction];
                return value && self.connected && self.ws.vote(value);
            };
            global.PlugDJ.toggleQueue = () => {
                if (!self.connected) return false;
                const state = self.store.getState();
                const selfUser = state.room?.users.find((u) => u.id === state.selfId);
                if (selfUser?.inQueue) return self.ws.queueLeave();
                if (!self.libraryUI.state.library.length) {
                    global.PlugDJ.showToast?.('Add a track to your Library first');
                    return false;
                }
                return self.ws.queueJoin();
            };
            global.PlugDJ.libraryAdd = (url) => self.connected && self.ws.libraryAdd(url);
            global.PlugDJ.libraryRemove = (trackId) => self.connected && self.ws.libraryRemove(trackId);
            global.PlugDJ.libraryReorder = (orderedIds) => self.connected && self.ws.libraryReorder(orderedIds);
            global.PlugDJ.playlistAdd = (url) => {
                const playlistId = self.libraryUI.state.activePlaylistId;
                return self.connected && self.ws.playlistAdd(url, playlistId);
            };
            global.PlugDJ.playlistRemove = (trackId) => {
                const playlistId = self.libraryUI.state.activePlaylistId;
                return self.connected && self.ws.playlistRemove(trackId, playlistId);
            };
            global.PlugDJ.playlistPromote = (trackId) => {
                const playlistId = self.libraryUI.state.activePlaylistId;
                return self.connected && self.ws.playlistPromote(trackId, playlistId);
            };
            global.PlugDJ.playlistPromoteAll = () => {
                const playlistId = self.libraryUI.state.activePlaylistId;
                return self.connected && self.ws.playlistPromoteAll(playlistId);
            };
            global.PlugDJ.playlistCreate = (name) => self.connected && self.ws.playlistCreate(name);
            global.PlugDJ.playlistRename = (playlistId, name) => self.connected && self.ws.playlistRename(playlistId, name);
            global.PlugDJ.playlistDelete = (playlistId) => self.connected && self.ws.playlistDelete(playlistId);
            global.PlugDJ.playlistSetActive = (playlistId) => self.connected && self.ws.playlistSetActive(playlistId);
            global.PlugDJ.getLibraryUI = () => self.libraryUI;
            global.PlugDJ.getSettingsUI = () => self.settingsUI;
            global.PlugDJ.openSettingsPanel = () => self.settingsUI.hydrate();
            global.PlugDJ.toggleFavorite = () => self.connected && self.ws.favoriteTrack();
            global.PlugDJ.grabCurrentToLibrary = () => self.connected && self.ws.libraryGrabCurrent();
            global.PlugDJ.grabCurrentToPlaylist = () => {
                const playlistId = self.libraryUI.state.activePlaylistId;
                return self.connected && self.ws.playlistGrabCurrent(playlistId);
            };
            global.PlugDJ.skipTrack = () => self.connected && self.ws.skipTrack();
            global.PlugDJ.clearChat = () => self.connected && self.ws.clearChat();
            global.PlugDJ.setUserRole = (username, role, clientId) => self.connected && self.ws.setRole(username, role, clientId);
            global.PlugDJ.moderateUser = (data) => self.connected && self.ws.moderateUser(data);
            global.PlugDJ.unpunishUser = (username, action, clientId) => self.connected && self.ws.unpunishUser(username, action, clientId);
            global.PlugDJ.updateRoomMeta = (data) => self.connected && self.ws.updateRoomMeta(data);
            global.PlugDJ.getRoomState = () => self.store.getState();
            global.PlugDJ.isRoomOwner = () => self.isOwner();
            global.PlugDJ.isRoomStaff = () => self.isStaff();
            global.PlugDJ.leaveRoom = () => self.leaveRoom();
        }

        render(state) {
            this.roomUI.applyRoomState(state);
            global.PlugDJ.syncStage?.(state);
            this.roomUI.renderFavorite(state);
            this.libraryUI.renderMusicQueue();
            this.libraryUI.updatePlayButton();
            this.syncPlayer(state);
        }

        syncPlayer(state) {
            const song = state.room?.currentSong || null;
            // Use 'none' (not null) so clearing the track after lastSyncedSongKey=null still resets
            const songKey = song
                ? `${song.id}:${song.startedAt || 'wait'}:${song.mediaUrl || ''}:${song.mediaStatus || ''}`
                : 'none';
            if (songKey === this.lastSyncedSongKey) {
                if (song) global.PlugDJ.syncMedia?.(song);
                return;
            }
            this.lastSyncedSongKey = songKey;
            global.PlugDJ.syncMedia?.(song);
            global.PlugDJ.syncPlayerPosition?.(song);
        }

        handleBackgroundSync(backgroundId) {
            global.PlugDJ.applyBackgroundById?.(backgroundId);
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.RoomClient = RoomClient;
})(window);
