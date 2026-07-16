import { ServerEvents } from '../types/events.js';

export class BroadcastService {
    constructor() {
        this.clients = new Map();
    }

    register(socketId, socket) {
        this.clients.set(socketId, socket);
    }

    unregister(socketId) {
        this.clients.delete(socketId);
    }

    send(socketId, payload) {
        const socket = this.clients.get(socketId);
        if (!socket || socket.readyState !== socket.OPEN) return false;
        socket.send(JSON.stringify(payload));
        return true;
    }

    sendError(socketId, message, code = null) {
        return this.send(socketId, {
            type: ServerEvents.ERROR,
            message,
            code
        });
    }

    broadcastRoom(roomId, payload, exceptSocketId = null) {
        for (const [socketId, socket] of this.clients.entries()) {
            if (socketId === exceptSocketId) continue;
            if (socket.roomId !== roomId) continue;
            if (socket.readyState !== socket.OPEN) continue;
            socket.send(JSON.stringify(payload));
        }
    }

    broadcastAll(payload) {
        for (const socket of this.clients.values()) {
            if (socket.readyState !== socket.OPEN) continue;
            socket.send(JSON.stringify(payload));
        }
    }

    findSocketsInRoom(roomId, userId = null) {
        const matches = [];
        for (const [socketId, socket] of this.clients.entries()) {
            if (socket.roomId !== roomId) continue;
            if (userId && socket.userId !== userId) continue;
            matches.push({ socketId, socket });
        }
        return matches;
    }

    findSocketsByUsername(roomId, username) {
        const matches = [];
        for (const [socketId, socket] of this.clients.entries()) {
            if (socket.roomId !== roomId) continue;
            if (socket.username !== username) continue;
            matches.push({ socketId, socket });
        }
        return matches;
    }
}

export const broadcastService = new BroadcastService();
