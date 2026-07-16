(function(global) {
    'use strict';

    class RoomStore {
        constructor() {
            this.selfId = null;
            this.selfClientId = null;
            this.selfRole = 'user';
            this.room = null;
            this.favorites = [];
            this.favorited = false;
            this.listeners = new Set();
        }

        reset() {
            this.selfId = null;
            this.selfClientId = null;
            this.selfRole = 'user';
            this.room = null;
            this.favorites = [];
            this.favorited = false;
            this.notify();
        }

        setRoomState(payload) {
            this.selfId = payload.selfId || null;
            this.selfClientId = payload.selfClientId || null;
            this.selfRole = payload.selfRole || 'user';
            this.favorites = payload.favorites || [];
            this.favorited = !!payload.favorited;
            this.room = {
                id: payload.id,
                slug: payload.slug || payload.id,
                name: payload.name,
                background: payload.background,
                aboutCommunity: payload.aboutCommunity || '',
                welcomeTitle: payload.welcomeTitle || '',
                welcomeMessage: payload.welcomeMessage || '',
                chatRateLimitMs: payload.chatRateLimitMs || 2000,
                ownerId: payload.ownerId || null,
                hostUsername: payload.hostUsername || null,
                totalVisitors: payload.totalVisitors || 0,
                totalFavorites: payload.totalFavorites || 0,
                users: payload.users || [],
                queue: payload.queue || [],
                currentDJ: payload.currentDJ || null,
                currentSong: payload.currentSong || null,
                votes: payload.votes || { woot: 0, grab: 0, meh: 0 },
                chatHistory: payload.chatHistory || [],
                moderation: payload.moderation || { bans: [], mutes: [], moderationLog: [] }
            };
            if (this.selfRole === 'owner' || this.selfRole === 'admin') {
                localStorage.setItem('plugdj-role', this.selfRole);
            } else {
                localStorage.removeItem('plugdj-role');
            }
            this.notify();
        }

        patchRoom(patch) {
            if (!this.room) return;
            if (patch.favorited != null) this.favorited = !!patch.favorited;
            if (patch.favorites) this.favorites = patch.favorites;
            if (patch.moderation) this.room.moderation = patch.moderation;
            this.room = { ...this.room, ...patch };
            this.notify();
        }

        addUser(user) {
            if (!this.room) return;
            const existingIndex = this.room.users.findIndex(
                (item) => item.id === user.id
                    || (user.clientId && item.clientId === user.clientId)
            );
            if (existingIndex !== -1) {
                this.room.users[existingIndex] = user;
                this.notify();
                return;
            }
            this.room.users.push(user);
            this.notify();
        }

        removeUser(userId) {
            if (!this.room) return;
            this.room.users = this.room.users.filter((user) => user.id !== userId);
            this.notify();
        }

        updateUser(user) {
            if (!this.room) return;
            const index = this.room.users.findIndex((item) => item.id === user.id);
            if (index === -1) return;
            this.room.users[index] = user;
            this.notify();
        }

        addChatMessage(message) {
            if (!this.room) return;
            this.room.chatHistory.push(message);
            this.notify();
        }

        clearChat() {
            if (!this.room) return;
            this.room.chatHistory = [];
            this.notify();
        }

        isStaff() {
            return this.selfRole === 'owner' || this.selfRole === 'admin';
        }

        isOwner() {
            return this.selfRole === 'owner';
        }

        isAdmin() {
            return this.isStaff();
        }

        subscribe(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }

        getState() {
            return {
                selfId: this.selfId,
                selfClientId: this.selfClientId,
                selfRole: this.selfRole,
                favorited: this.favorited,
                favorites: [...this.favorites],
                room: this.room ? {
                    ...this.room,
                    users: [...this.room.users],
                    chatHistory: [...this.room.chatHistory]
                } : null
            };
        }

        notify() {
            const snapshot = this.getState();
            this.listeners.forEach((listener) => listener(snapshot));
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.RoomStore = RoomStore;
})(window);
