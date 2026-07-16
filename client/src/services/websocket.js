(function(global) {
    'use strict';

    const ClientEvents = {
        JOIN_ROOM: 'join_room',
        CHAT_MESSAGE: 'chat_message',
        CHANGE_AVATAR: 'change_avatar',
        CHANGE_USERNAME: 'change_username',
        CHANGE_BACKGROUND: 'change_background',
        VOTE: 'vote',
        FAVORITE_TRACK: 'favorite_track',
        QUEUE_JOIN: 'queue_join',
        QUEUE_LEAVE: 'queue_leave',
        LIBRARY_ADD: 'library_add',
        LIBRARY_REMOVE: 'library_remove',
        LIBRARY_REORDER: 'library_reorder',
        LIBRARY_GRAB_CURRENT: 'library_grab_current',
        PLAYLIST_GRAB_CURRENT: 'playlist_grab_current',
        PLAYLIST_ADD: 'playlist_add',
        PLAYLIST_REMOVE: 'playlist_remove',
        PLAYLIST_PROMOTE: 'playlist_promote',
        PLAYLIST_PROMOTE_ALL: 'playlist_promote_all',
        PLAYLIST_CREATE: 'playlist_create',
        PLAYLIST_RENAME: 'playlist_rename',
        PLAYLIST_DELETE: 'playlist_delete',
        PLAYLIST_SET_ACTIVE: 'playlist_set_active',
        SKIP_TRACK: 'skip_track',
        SET_ROLE: 'set_role',
        MODERATE_USER: 'moderate_user',
        UNPUNISH_USER: 'unpunish_user',
        UPDATE_ROOM_META: 'update_room_meta',
        CLEAR_CHAT: 'clear_chat',
        LEAVE_ROOM: 'leave_room'
    };

    const ServerEvents = {
        ROOM_STATE: 'room_state',
        USER_JOINED: 'user_joined',
        USER_LEFT: 'user_left',
        USER_UPDATED: 'user_updated',
        CHAT_MESSAGE: 'chat_message',
        CHAT_CLEARED: 'chat_cleared',
        ROOM_UPDATED: 'room_updated',
        QUEUE_UPDATED: 'queue_updated',
        DJ_UPDATED: 'dj_updated',
        VOTE_UPDATED: 'vote_updated',
        LIBRARY_STATE: 'library_state',
        MODERATION_UPDATED: 'moderation_updated',
        ERROR: 'error',
        ACK: 'ack'
    };

    function defaultWsUrl() {
        if (typeof global.PlugDJ.getWebSocketUrl === 'function') {
            return global.PlugDJ.getWebSocketUrl();
        }
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${location.host}/ws`;
    }

    class WebSocketService {
        constructor(options = {}) {
            this.url = options.url || defaultWsUrl();
            this.socket = null;
            this.handlers = new Map();
            this.reconnectDelay = options.reconnectDelay || 2000;
            this.shouldReconnect = true;
            this.connecting = false;
        }

        on(eventType, handler) {
            if (!this.handlers.has(eventType)) {
                this.handlers.set(eventType, new Set());
            }
            this.handlers.get(eventType).add(handler);
            return () => this.handlers.get(eventType).delete(handler);
        }

        emit(eventType, payload) {
            const handlers = this.handlers.get(eventType);
            if (!handlers) return;
            handlers.forEach((handler) => handler(payload));
        }

        connect() {
            if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
                return Promise.resolve();
            }

            this.connecting = true;

            return new Promise((resolve, reject) => {
                const socket = new WebSocket(this.url);
                this.socket = socket;

                socket.addEventListener('open', () => {
                    this.connecting = false;
                    this.emit('connection_open');
                    resolve();
                });

                socket.addEventListener('message', (event) => {
                    let payload;
                    try {
                        payload = JSON.parse(event.data);
                    } catch {
                        this.emit(ServerEvents.ERROR, { message: 'Invalid server payload' });
                        return;
                    }
                    if (payload?.type) {
                        this.emit(payload.type, payload);
                        this.emit('*', payload);
                    }
                });

                socket.addEventListener('close', () => {
                    this.connecting = false;
                    this.emit('connection_close');
                    if (this.shouldReconnect) {
                        setTimeout(() => this.connect().catch(() => {}), this.reconnectDelay);
                    }
                });

                socket.addEventListener('error', () => {
                    this.connecting = false;
                    const viaApache = String(location.port || '') !== '3000';
                    reject(new Error(
                        viaApache
                            ? 'WebSocket failed. Point ngrok at Node: ngrok http 3000'
                            : 'WebSocket connection failed'
                    ));
                });
            });
        }

        disconnect() {
            this.shouldReconnect = false;
            if (this.socket) {
                this.socket.close();
                this.socket = null;
            }
        }

        send(type, payload = {}) {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                return false;
            }
            this.socket.send(JSON.stringify({ type, ...payload }));
            return true;
        }

        joinRoom(data) { return this.send(ClientEvents.JOIN_ROOM, data); }
        sendChat(message) { return this.send(ClientEvents.CHAT_MESSAGE, { message }); }
        changeAvatar(avatar) { return this.send(ClientEvents.CHANGE_AVATAR, { avatar }); }
        changeUsername(username) { return this.send(ClientEvents.CHANGE_USERNAME, { username }); }
        changeBackground(background) { return this.send(ClientEvents.CHANGE_BACKGROUND, { background }); }
        vote(value) { return this.send(ClientEvents.VOTE, { value }); }
        favoriteTrack() { return this.send(ClientEvents.FAVORITE_TRACK); }
        queueJoin() { return this.send(ClientEvents.QUEUE_JOIN); }
        queueLeave() { return this.send(ClientEvents.QUEUE_LEAVE); }
        libraryAdd(url) { return this.send(ClientEvents.LIBRARY_ADD, { url }); }
        libraryRemove(trackId) { return this.send(ClientEvents.LIBRARY_REMOVE, { trackId }); }
        libraryReorder(orderedIds) { return this.send(ClientEvents.LIBRARY_REORDER, { orderedIds }); }
        libraryGrabCurrent() { return this.send(ClientEvents.LIBRARY_GRAB_CURRENT); }
        playlistGrabCurrent(playlistId) {
            return this.send(ClientEvents.PLAYLIST_GRAB_CURRENT, { playlistId: playlistId || null });
        }
        playlistAdd(url, playlistId) { return this.send(ClientEvents.PLAYLIST_ADD, { url, playlistId }); }
        playlistRemove(trackId, playlistId) { return this.send(ClientEvents.PLAYLIST_REMOVE, { trackId, playlistId }); }
        playlistPromote(trackId, playlistId) { return this.send(ClientEvents.PLAYLIST_PROMOTE, { trackId, playlistId }); }
        playlistPromoteAll(playlistId) { return this.send(ClientEvents.PLAYLIST_PROMOTE_ALL, { playlistId }); }
        playlistCreate(name) { return this.send(ClientEvents.PLAYLIST_CREATE, { name }); }
        playlistRename(playlistId, name) { return this.send(ClientEvents.PLAYLIST_RENAME, { playlistId, name }); }
        playlistDelete(playlistId) { return this.send(ClientEvents.PLAYLIST_DELETE, { playlistId }); }
        playlistSetActive(playlistId) { return this.send(ClientEvents.PLAYLIST_SET_ACTIVE, { playlistId }); }
        skipTrack() { return this.send(ClientEvents.SKIP_TRACK); }
        setRole(username, role, clientId) { return this.send(ClientEvents.SET_ROLE, { username, role, clientId }); }
        moderateUser(data) { return this.send(ClientEvents.MODERATE_USER, data); }
        unpunishUser(username, action, clientId) { return this.send(ClientEvents.UNPUNISH_USER, { username, action, clientId }); }
        updateRoomMeta(data) { return this.send(ClientEvents.UPDATE_ROOM_META, data); }
        clearChat() { return this.send(ClientEvents.CLEAR_CHAT); }
        leaveRoom() { return this.send(ClientEvents.LEAVE_ROOM); }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.ClientEvents = ClientEvents;
    global.PlugDJ.ServerEvents = ServerEvents;
    global.PlugDJ.WebSocketService = WebSocketService;
})(window);
