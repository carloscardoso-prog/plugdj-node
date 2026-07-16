const YT_RE = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)/i;
const YT_LIVE_RE = /(youtube\.com\/(live\/|channel\/[^/]+\/live|c\/[^/]+\/live|@[^/]+\/live)|gaming\.youtube\.com\/|youtu\.be\/live\/|[?&]live=1\b)/i;
const SC_RE = /^(https?:\/\/)?((www|m|on)\.)?soundcloud\.com\//i;
const SP_RE = /^(https?:\/\/)?(open\.)?spotify\.com\/(track|album|playlist|episode)\//i;

export function detectProvider(url) {
    const raw = String(url || '').trim();
    if (!raw) return null;
    if (YT_LIVE_RE.test(raw)) return null;
    if (YT_RE.test(raw)) return 'youtube';
    if (SC_RE.test(raw)) return 'soundcloud';
    if (SP_RE.test(raw)) return 'spotify';
    return null;
}

export function isYoutubeLiveUrl(url) {
    return YT_LIVE_RE.test(String(url || '').trim());
}

export function isAllowedMediaUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        if (isYoutubeLiveUrl(u.href)) return false;
        return !!detectProvider(u.href);
    } catch {
        return false;
    }
}
