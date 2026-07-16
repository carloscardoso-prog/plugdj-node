import { roomService } from '../../rooms/RoomService.js';
import { moderationService } from '../../moderation/ModerationService.js';
import { sessionService } from '../../users/SessionService.js';
import { broadcastService } from '../../services/BroadcastService.js';
import { validateCreateRoomPayload, validateVerifyPasswordPayload } from '../../utils/validate.js';
import { toPublicRoomSummary } from '../../utils/serialize.js';
import { serverStore } from '../../database/serverStore.js';

function sanitizeUsername(value) {
    return String(value || '').trim().slice(0, 24);
}

function withServer(room) {
    return toPublicRoomSummary(room, serverStore.getServerUUID());
}

export function registerRoomRoutes(app) {
    /** Local rooms hosted by this process only — no public discovery. */
    app.get('/api/rooms', (_req, res) => {
        res.json({
            serverUUID: serverStore.getServerUUID(),
            rooms: roomService.listRooms().map((r) => ({
                ...r,
                serverUUID: serverStore.getServerUUID()
            }))
        });
    });

    app.get('/api/rooms/:slug', (req, res) => {
        const room = roomService.getRoom(req.params.slug);
        if (!room) {
            return res.status(404).json({ ok: false, error: 'Room not found' });
        }
        res.json({ ok: true, room: withServer(room) });
    });

    app.post('/api/rooms/:slug/check-access', (req, res) => {
        const room = roomService.getRoom(req.params.slug);
        if (!room) {
            return res.status(404).json({ ok: false, error: 'Room not found', code: 'room_not_found' });
        }

        const username = sanitizeUsername(req.body?.username);
        const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.trim()
            : (typeof req.body?.userUUID === 'string' ? req.body.userUUID.trim() : null);
        if (!username) {
            return res.status(400).json({ ok: false, error: 'Nickname is required' });
        }

        if (moderationService.isBanned(room, { clientId, username })) {
            const ban = moderationService.getBan(room, { clientId, username });
            return res.status(403).json({
                ok: false,
                error: ban?.reason || 'You are banned from this room.',
                code: 'banned',
                reason: ban?.reason || null
            });
        }

        if (roomService.hasPassword(room)) {
            const validation = validateVerifyPasswordPayload(req.body);
            if (!validation.ok) {
                return res.status(400).json({ ok: false, error: validation.error });
            }
            if (!roomService.verifyPassword(room, validation.data.password)) {
                return res.status(403).json({ ok: false, error: 'Wrong password', code: 'wrong_password' });
            }
        }

        res.json({
            ok: true,
            serverUUID: serverStore.getServerUUID(),
            room: withServer(room)
        });
    });

    app.post('/api/rooms/:slug/verify', (req, res) => {
        const room = roomService.getRoom(req.params.slug);
        if (!room) {
            return res.status(404).json({ ok: false, error: 'Room not found' });
        }

        if (!roomService.hasPassword(room)) {
            return res.json({ ok: true });
        }

        const validation = validateVerifyPasswordPayload(req.body);
        if (!validation.ok) {
            return res.status(400).json({ ok: false, error: validation.error });
        }

        if (!roomService.verifyPassword(room, validation.data.password)) {
            return res.status(403).json({ ok: false, error: 'Wrong password', code: 'wrong_password' });
        }

        res.json({ ok: true });
    });

    app.post('/api/rooms', (req, res) => {
        const validation = validateCreateRoomPayload(req.body);
        if (!validation.ok) {
            return res.status(400).json({ ok: false, error: validation.error });
        }

        const result = roomService.createRoom(validation.data);
        if (!result.ok) {
            return res.status(409).json({ ok: false, error: result.error });
        }

        res.status(201).json({
            ok: true,
            serverUUID: serverStore.getServerUUID(),
            room: withServer(result.data)
        });
    });

    /** Hard-delete a locally hosted room and drop live connections. */
    app.delete('/api/rooms/:slug', (req, res) => {
        const room = roomService.getRoom(req.params.slug);
        if (!room) {
            return res.status(404).json({ ok: false, error: 'Room not found' });
        }

        const sockets = broadcastService.findSocketsInRoom(room.id);
        sockets.forEach(({ socket }) => {
            try {
                sessionService.disconnect(socket, { force: true });
                if (socket.readyState === socket.OPEN) socket.close();
            } catch {
                // ignore
            }
        });

        const result = roomService.deleteRoom(room.id);
        if (!result.ok) {
            return res.status(500).json({ ok: false, error: result.error });
        }

        res.json({ ok: true, deleted: { roomUUID: room.id, slug: room.slug } });
    });
}
