import { WebSocketServer } from 'ws';
import { sessionService } from '../users/SessionService.js';
import { createMessageRouter } from './handlers/index.js';

export function attachWebSocketServer(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    const routeMessage = createMessageRouter();

    wss.on('connection', (socket) => {
        sessionService.registerSocket(socket);

        socket.on('message', (rawMessage) => {
            routeMessage(socket, rawMessage.toString());
        });

        socket.on('close', () => {
            sessionService.disconnect(socket);
        });

        socket.on('error', () => {
            sessionService.disconnect(socket);
        });
    });

    return wss;
}
