import fs from 'fs';
import { mediaService } from '../../media/MediaService.js';
import { isAllowedMediaUrl } from '../../media/detectProvider.js';

export function registerMediaRoutes(app) {
    app.post('/api/media/resolve', async (req, res) => {
        const url = String(req.body?.url || '').trim();
        if (!url || !isAllowedMediaUrl(url)) {
            res.status(400).json({ ok: false, error: 'Only YouTube, SoundCloud, or Spotify URLs are allowed' });
            return;
        }

        const result = await mediaService.resolveUrl(url);
        if (!result.ok) {
            res.status(422).json(result);
            return;
        }
        res.json(result);
    });

    app.get('/api/media/:token', (req, res) => {
        const entry = mediaService.getFile(req.params.token);
        if (!entry || !fs.existsSync(entry.filePath)) {
            res.status(404).json({ ok: false, error: 'Media not found' });
            return;
        }

        const stat = fs.statSync(entry.filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        res.setHeader('Content-Type', entry.mime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store');

        if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match) {
                res.status(416).end();
                return;
            }
            const start = match[1] ? parseInt(match[1], 10) : 0;
            const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
            if (start >= fileSize || end >= fileSize || start > end) {
                res.status(416).end();
                return;
            }
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Content-Length', end - start + 1);
            fs.createReadStream(entry.filePath, { start, end }).pipe(res);
            return;
        }

        res.setHeader('Content-Length', fileSize);
        fs.createReadStream(entry.filePath).pipe(res);
    });
}
