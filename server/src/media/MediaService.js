import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createId } from '../utils/ids.js';
import { detectProvider, isAllowedMediaUrl, isYoutubeLiveUrl } from './detectProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../../.media-cache');
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
const MAX_DURATION_SEC = 10 * 60 * 60; // 10 hours

// Prefer ~480p merged AV, fall back to best ≤480 / best overall — keeps files small
const FORMAT_SELECTOR = 'bv*[height<=480]+ba/b[height<=480]/b';

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

function runYtDlp(args, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(YT_DLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('yt-dlp timed out'));
        }, timeoutMs);

        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(stderr.trim() || `yt-dlp exited with ${code}`));
        });
    });
}

async function resolveSpotify(url) {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Could not resolve Spotify track');
    const data = await res.json();
    const title = String(data.title || 'Spotify Track').slice(0, 120);
    // oEmbed title is often "Song · Artist"
    let artist = 'Spotify';
    const parts = title.split('·').map((s) => s.trim());
    if (parts.length >= 2) {
        artist = parts[parts.length - 1].slice(0, 80);
    }
    return {
        provider: 'spotify',
        sourceUrl: url,
        title: parts[0] || title,
        artist,
        duration: 210,
        thumbnailUrl: data.thumbnail_url || null,
        artworkUrl: data.thumbnail_url || null,
        playMode: 'artwork'
    };
}

function isLiveStatus(info) {
    if (info.is_live === true || info.livestream === true) return true;
    // yt-dlp uses values like "not_live", "is_live", "was_live", "is_upcoming"
    const status = String(info.live_status || '').toLowerCase();
    if (!status || status === 'not_live' || status === 'none') return false;
    return status === 'is_live' || status === 'is_upcoming' || status === 'live';
}

function assertPlayableInfo(info, url) {
    const live = isLiveStatus(info)
        || isYoutubeLiveUrl(url)
        || (info.was_live === true && !info.duration);

    if (live) {
        throw new Error('YouTube lives / livestreams are not supported');
    }

    const duration = Number(info.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('Could not read media duration (lives and unfinished streams are blocked)');
    }
    if (duration > MAX_DURATION_SEC) {
        throw new Error('Media longer than 10 hours is not allowed');
    }
    return Math.round(duration);
}

async function resolveViaYtDlp(url, provider) {
    const { stdout } = await runYtDlp([
        '-J',
        '--no-playlist',
        '--no-warnings',
        '--js-runtimes', 'node',
        url
    ], { timeoutMs: 60000 });

    const info = JSON.parse(stdout);
    const duration = assertPlayableInfo(info, url);
    const title = String(info.title || info.fulltitle || 'Untitled').slice(0, 120);
    const artist = String(info.uploader || info.channel || info.creator || provider).slice(0, 80);
    const thumbnailUrl = info.thumbnail
        || (Array.isArray(info.thumbnails) && info.thumbnails.length
            ? info.thumbnails[info.thumbnails.length - 1].url
            : null);

    return {
        provider,
        sourceUrl: url,
        mediaKey: String(info.id || createId()),
        title,
        artist,
        duration,
        thumbnailUrl,
        artworkUrl: thumbnailUrl,
        playMode: provider === 'soundcloud' ? 'audio' : 'video',
        extHint: info.ext || 'mp4'
    };
}

function downloadTimeoutMs(song) {
    // Long tracks need more time at ~480p; cap at 30 minutes
    const duration = Number(song?.duration) || 0;
    const fromDuration = duration > 0 ? Math.ceil(duration * 250) : 180000;
    return Math.min(30 * 60 * 1000, Math.max(3 * 60 * 1000, fromDuration));
}

export class MediaService {
    constructor() {
        ensureCacheDir();
        /** @type {Map<string, { filePath: string, mime: string, createdAt: number, mediaKey?: string }>} */
        this.files = new Map();
        /** @type {Map<string, Promise<object>>} */
        this.downloads = new Map();
        /** @type {Map<string, string>} mediaKey → token for completed downloads */
        this.readyByKey = new Map();
    }

    mediaDedupeKey(song) {
        return `${song.provider}:${song.mediaKey || song.sourceUrl}`;
    }

    applyReady(song, token) {
        const meta = this.files.get(token);
        if (!meta) return false;
        song.mediaToken = token;
        song.mediaUrl = `/api/media/${token}`;
        song.mediaStatus = 'ready';
        if (meta.playMode) song.playMode = meta.playMode;
        return true;
    }

    async resolveUrl(rawUrl) {
        const url = String(rawUrl || '').trim();
        if (isYoutubeLiveUrl(url)) {
            return { ok: false, error: 'YouTube lives / livestreams are not supported' };
        }
        if (!isAllowedMediaUrl(url)) {
            return { ok: false, error: 'Only YouTube, SoundCloud, or Spotify URLs are allowed' };
        }

        const provider = detectProvider(url);
        try {
            if (provider === 'spotify') {
                const meta = await resolveSpotify(url);
                return { ok: true, data: meta };
            }
            const meta = await resolveViaYtDlp(url, provider);
            return { ok: true, data: meta };
        } catch (err) {
            return { ok: false, error: err.message || 'Failed to resolve media' };
        }
    }

    buildSongRecord(meta, username) {
        const id = `track-${createId()}`;
        return {
            id,
            title: meta.title,
            artist: meta.artist,
            duration: meta.duration,
            addedBy: username,
            provider: meta.provider,
            sourceUrl: meta.sourceUrl,
            mediaKey: meta.mediaKey || null,
            thumbnailUrl: meta.thumbnailUrl || null,
            artworkUrl: meta.artworkUrl || meta.thumbnailUrl || null,
            playMode: meta.playMode || 'artwork',
            mediaToken: null,
            mediaUrl: null,
            mediaStatus: meta.playMode === 'artwork' ? 'ready' : 'pending'
        };
    }

    /** Download YT/SC into cache; Spotify is artwork-only (no download). */
    ensurePlayback(song) {
        if (!song || song.playMode === 'artwork' || song.provider === 'spotify') {
            return Promise.resolve({
                mediaToken: song?.mediaToken || null,
                mediaUrl: song?.mediaUrl || null,
                mediaStatus: 'ready',
                playMode: song?.playMode || 'artwork'
            });
        }

        if (song.mediaToken && this.applyReady(song, song.mediaToken)) {
            return Promise.resolve({
                mediaToken: song.mediaToken,
                mediaUrl: song.mediaUrl,
                mediaStatus: 'ready',
                playMode: song.playMode
            });
        }

        const dedupeKey = this.mediaDedupeKey(song);
        const cachedToken = this.readyByKey.get(dedupeKey);
        if (cachedToken && this.applyReady(song, cachedToken)) {
            return Promise.resolve({
                mediaToken: song.mediaToken,
                mediaUrl: song.mediaUrl,
                mediaStatus: 'ready',
                playMode: song.playMode
            });
        }

        if (this.downloads.has(dedupeKey)) {
            song.mediaStatus = 'downloading';
            return this.downloads.get(dedupeKey).then((ready) => Object.assign(song, ready));
        }

        song.mediaStatus = 'downloading';
        const work = this._download(song)
            .then((ready) => {
                this.downloads.delete(dedupeKey);
                this.readyByKey.set(dedupeKey, ready.mediaToken);
                return ready;
            })
            .catch((err) => {
                this.downloads.delete(dedupeKey);
                song.mediaStatus = 'error';
                song.mediaError = err.message;
                throw err;
            });

        this.downloads.set(dedupeKey, work);
        return work;
    }

    async _download(song) {
        ensureCacheDir();
        const token = createId();
        const outTemplate = path.join(CACHE_DIR, `${token}.%(ext)s`);
        const dedupeKey = this.mediaDedupeKey(song);

        const args = [
            '--no-playlist',
            '--no-warnings',
            '--js-runtimes', 'node',
            '-f', FORMAT_SELECTOR,
            '--merge-output-format', 'mp4',
            '-o', outTemplate,
            song.sourceUrl
        ];

        // SoundCloud is usually audio — prefer compact audio when video merge fails
        if (song.provider === 'soundcloud') {
            args.splice(args.indexOf('-f'), 2, '-f', 'bestaudio/best');
        }

        await runYtDlp(args, { timeoutMs: downloadTimeoutMs(song) });

        const files = fs.readdirSync(CACHE_DIR).filter((name) => name.startsWith(`${token}.`));
        if (!files.length) throw new Error('Download produced no file');

        const filePath = path.join(CACHE_DIR, files[0]);
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === '.mp3' ? 'audio/mpeg'
            : ext === '.webm' ? (song.playMode === 'audio' ? 'audio/webm' : 'video/webm')
            : ext === '.m4a' ? 'audio/mp4'
            : 'video/mp4';

        if (song.provider === 'soundcloud' || ext === '.mp3' || ext === '.m4a') {
            song.playMode = 'audio';
        } else {
            song.playMode = 'video';
        }

        this.files.set(token, {
            filePath,
            mime,
            createdAt: Date.now(),
            mediaKey: dedupeKey,
            playMode: song.playMode
        });
        this.readyByKey.set(dedupeKey, token);
        song.mediaToken = token;
        song.mediaUrl = `/api/media/${token}`;
        song.mediaStatus = 'ready';
        return {
            mediaToken: token,
            mediaUrl: song.mediaUrl,
            mediaStatus: 'ready',
            playMode: song.playMode
        };
    }

    getFile(token) {
        return this.files.get(token) || null;
    }

    cleanupSong(song) {
        if (!song?.mediaToken) return;
        this.deleteToken(song.mediaToken);
        song.mediaToken = null;
        song.mediaUrl = null;
        song.mediaStatus = 'gone';
    }

    deleteToken(token) {
        const meta = this.files.get(token);
        if (meta?.mediaKey) {
            const mapped = this.readyByKey.get(meta.mediaKey);
            if (mapped === token) this.readyByKey.delete(meta.mediaKey);
        }
        const entry = this.files.get(token);
        if (!entry) return;
        this.files.delete(token);
        try {
            if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);
        } catch {
            // ignore
        }
    }

    /** Safety net for abandoned files (>2h). */
    sweepStale(maxAgeMs = 2 * 60 * 60 * 1000) {
        const now = Date.now();
        for (const [token, entry] of this.files.entries()) {
            if (now - entry.createdAt > maxAgeMs) this.deleteToken(token);
        }
    }
}

export const mediaService = new MediaService();

setInterval(() => mediaService.sweepStale(), 15 * 60 * 1000).unref?.();
