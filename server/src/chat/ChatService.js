import { config } from '../config/index.js';
import { roomService } from '../rooms/RoomService.js';

function isStaff(user) {
    return user?.role === 'owner' || user?.role === 'admin';
}

export class ChatService {
    constructor(rooms = roomService) {
        this.rooms = rooms;
    }

    createMessage(user, message) {
        return {
            id: `${user.id}-${Date.now()}`,
            user: {
                id: user.id,
                clientId: user.clientId || null,
                username: user.username,
                avatar: user.avatar,
                role: user.role
            },
            message,
            timestamp: Date.now()
        };
    }

    checkRateLimit(room, user) {
        if (isStaff(user)) return { ok: true };

        const limitMs = Math.max(
            config.minChatRateLimitMs,
            Math.min(config.maxChatRateLimitMs, room.chatRateLimitMs || config.defaultChatRateLimitMs)
        );
        const elapsed = Date.now() - (user.lastChatAt || 0);
        if (user.lastChatAt && elapsed < limitMs) {
            const waitSec = Math.ceil((limitMs - elapsed) / 1000);
            return { ok: false, error: `Slow down — wait ${waitSec}s before sending another message.` };
        }
        return { ok: true };
    }

    sendMessage(roomId, userId, message) {
        const room = this.rooms.getRoom(roomId);
        if (!room) return { ok: false, error: 'Room not found' };

        const user = this.rooms.findUser(room, userId);
        if (!user) return { ok: false, error: 'User not in room' };

        const rateCheck = this.checkRateLimit(room, user);
        if (!rateCheck.ok) return rateCheck;

        const chatMessage = this.createMessage(user, message);
        user.lastChatAt = Date.now();
        room.chatHistory.push(chatMessage);
        if (room.chatHistory.length > config.chatHistoryLimit) {
            room.chatHistory.shift();
        }

        return { ok: true, data: chatMessage };
    }

    clearChat(roomId) {
        const room = this.rooms.getRoom(roomId);
        if (!room) return { ok: false, error: 'Room not found' };
        room.chatHistory = [];
        return { ok: true };
    }
}

export const chatService = new ChatService();
