import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { db } from '../database/memory.js';
import { hydrateRoomsFromDisk } from '../database/hydrate.js';
import { roomsStore } from '../database/roomsStore.js';
import { serverStore } from '../database/serverStore.js';
import { attachWebSocketServer } from '../websocket/WebSocketServer.js';
import { registerRoomRoutes } from './routes/rooms.js';
import { registerMediaRoutes } from './routes/media.js';
import { slugifyRoom } from '../utils/validate.js';
import { getDataDir } from '../config/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../');
const roomHtml = path.join(rootDir, 'room.html');

/** Paths that must never be treated as room slugs. */
const RESERVED_SLUGS = new Set([
    'api',
    'ws',
    'assets',
    'client',
    'components',
    'js',
    'server',
    'data',
    'node_modules',
    'media-cache',
    '.media-cache',
    'favicon.ico',
    'robots.txt'
]);

function looksLikeFile(segment) {
    return /\.[a-z0-9]{1,12}$/i.test(segment);
}

function setStaticHeaders(res, filePath = '') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // HTML/JS/CSS change often in dev — don't stick clients on stale panels
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (['.html', '.js', '.css', '.json'].includes(ext)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}

export function createApp() {
    const app = express();

    // ngrok / reverse proxies
    app.set('trust proxy', true);
    app.use(express.json({ limit: '32kb' }));

    app.get('/api/health', (_req, res) => {
        res.json({
            ok: true,
            service: 'plug-dj',
            serverUUID: serverStore.getServerUUID(),
            port: config.port
        });
    });

    registerRoomRoutes(app);
    registerMediaRoutes(app);

    // Legacy: /room.html?room=slug → /slug
    app.get('/room.html', (req, res, next) => {
        const slug = slugifyRoom(req.query.room || '');
        if (slug) {
            return res.redirect(302, `/${slug}`);
        }
        return next();
    });

    // Explicit GET static mounts (ngrok / tunnel friendly) — no fallthrough to room slug
    const assetDirs = [
        ['/assets', path.join(rootDir, 'assets')],
        ['/client', path.join(rootDir, 'client')],
        ['/components', path.join(rootDir, 'components')]
    ];
    for (const [mount, dir] of assetDirs) {
        app.use(mount, express.static(dir, {
            fallthrough: false,
            index: false,
            setHeaders: (res, filePath) => setStaticHeaders(res, filePath)
        }));
    }

    app.use(express.static(rootDir, {
        index: 'index.html',
        // Don't hijack unknown paths — pretty room routes handle them
        fallthrough: true,
        setHeaders: (res, filePath) => setStaticHeaders(res, filePath)
    }));

    // Pretty room URLs: /nome-da-sala → room.html
    app.get('/:slug', (req, res, next) => {
        const raw = String(req.params.slug || '');
        if (!raw || looksLikeFile(raw) || RESERVED_SLUGS.has(raw.toLowerCase())) {
            return next();
        }

        const slug = slugifyRoom(raw);
        if (!slug) {
            return next();
        }

        // Canonicalize slug in the URL
        if (raw !== slug) {
            return res.redirect(302, `/${slug}`);
        }

        // If a real file exists at root with this name, let 404/static handle it
        const asFile = path.join(rootDir, raw);
        if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) {
            return next();
        }

        if (!fs.existsSync(roomHtml)) {
            return res.status(500).send('room.html missing');
        }

        res.sendFile(roomHtml);
    });

    return app;
}

export function startServer() {
    serverStore.load();
    const restored = hydrateRoomsFromDisk(db);
    const app = createApp();
    const server = http.createServer(app);
    attachWebSocketServer(server);

    const shutdown = () => {
        // Closing the process drops all WebSocket clients immediately.
        // Room metadata persists on disk; live queue/DJ/users do not.
        try {
            roomsStore.saveNow(() => Array.from(db.rooms.values()));
            serverStore.saveNow();
        } catch (err) {
            console.error('[persist] flush on shutdown failed', err.message);
        }
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    server.listen(config.port, config.host, () => {
        console.log(`plug.dj LAN host at http://${config.host}:${config.port}`);
        console.log(`Server UUID: ${serverStore.getServerUUID()}`);
        console.log(`Data dir: ${getDataDir()}`);
        console.log(`WebSocket: ws://${config.host}:${config.port}/ws`);
        console.log(`Invite URL: http://<host>:${config.port}/<room-slug>`);
        if (restored) {
            console.log(`Restored ${restored} local room(s) from rooms.json`);
        }
    });

    return server;
}

startServer();
