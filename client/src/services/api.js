(function(global) {
    'use strict';

    function looksLikeHtml(text) {
        const trimmed = String(text || '').trim();
        return trimmed.startsWith('<') || /<!doctype html/i.test(trimmed);
    }

    function bridgeUrl(path) {
        const bridge = global.PlugDJ.APACHE_API_BRIDGE || '/plug-dj-bridge/proxy.php';
        return `${location.origin}${bridge}${path}`;
    }

    async function readJson(response) {
        const text = await response.text();
        const trimmed = String(text || '').trim();
        if (!trimmed) {
            throw new Error('Empty response from server');
        }
        if (looksLikeHtml(trimmed)) {
            throw new Error('HTML_RESPONSE');
        }
        try {
            return JSON.parse(trimmed);
        } catch {
            throw new Error('Invalid JSON from server');
        }
    }

    class ApiService {
        constructor(baseUrl) {
            const resolved = baseUrl != null
                ? baseUrl
                : (typeof global.PlugDJ.getBackendBase === 'function' ? global.PlugDJ.getBackendBase() : '');
            this.baseUrl = String(resolved).replace(/\/$/, '');
        }

        buildUrl(path) {
            return `${this.baseUrl}${path}`;
        }

        async request(path, options = {}) {
            const url = this.buildUrl(path);
            let response = await fetch(url, options);
            let data;
            try {
                data = await readJson(response);
            } catch (err) {
                // Apache :80 returns HTML for /api — retry via PHP bridge → Node :3000
                if (err.message === 'HTML_RESPONSE' && !url.includes('plug-dj-bridge')) {
                    global.PlugDJ.enableApiBridge?.();
                    this.baseUrl = `${location.origin}${global.PlugDJ.APACHE_API_BRIDGE || '/plug-dj-bridge/proxy.php'}`;
                    response = await fetch(this.buildUrl(path), options);
                    data = await readJson(response);
                } else if (err.message === 'HTML_RESPONSE') {
                    throw new Error(
                        'API returned HTML instead of JSON. Point ngrok at Node: ngrok http 3000'
                    );
                } else {
                    throw err;
                }
            }
            return { response, data };
        }

        async health() {
            const { response, data } = await this.request('/api/health');
            if (!response.ok) throw new Error('Health check failed');
            return data;
        }

        async getRoom(slug) {
            try {
                const { response, data } = await this.request(`/api/rooms/${encodeURIComponent(slug)}`);
                if (!response.ok) {
                    return { ok: false, error: data.error || 'Room not found' };
                }
                return { ok: true, room: data.room };
            } catch (err) {
                return { ok: false, error: err.message || 'Could not reach API' };
            }
        }

        async verifyRoomPassword(slug, password) {
            try {
                const { response, data } = await this.request(`/api/rooms/${encodeURIComponent(slug)}/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                if (!response.ok) {
                    return { ok: false, error: data.error || 'Wrong password', code: data.code };
                }
                return { ok: true };
            } catch (err) {
                return { ok: false, error: err.message || 'Could not reach API' };
            }
        }

        async checkRoomAccess(slug, { username, password, clientId, userUUID }) {
            try {
                const { response, data } = await this.request(`/api/rooms/${encodeURIComponent(slug)}/check-access`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username,
                        password,
                        clientId: userUUID || clientId,
                        userUUID: userUUID || clientId
                    })
                });
                if (!response.ok) {
                    return { ok: false, error: data.error || 'Access denied', code: data.code, reason: data.reason };
                }
                return { ok: true, room: data.room, serverUUID: data.serverUUID || data.room?.serverUUID };
            } catch (err) {
                return { ok: false, error: err.message || 'Could not reach API' };
            }
        }

        async listRooms() {
            const { response, data } = await this.request('/api/rooms');
            if (!response.ok) throw new Error('Could not list rooms');
            return data;
        }

        async deleteRoom(slug) {
            try {
                const { response, data } = await this.request(`/api/rooms/${encodeURIComponent(slug)}`, {
                    method: 'DELETE'
                });
                if (!response.ok) {
                    return { ok: false, error: data.error || 'Could not delete room' };
                }
                return { ok: true, deleted: data.deleted };
            } catch (err) {
                return { ok: false, error: err.message || 'Could not reach API' };
            }
        }

        async createRoom({ username, clientId, userUUID, name, slug, background, password, aboutCommunity, welcomeTitle, welcomeMessage }) {
            try {
                const { response, data } = await this.request('/api/rooms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username,
                        clientId: userUUID || clientId,
                        name,
                        slug,
                        background,
                        password,
                        aboutCommunity,
                        welcomeTitle,
                        welcomeMessage
                    })
                });
                if (!response.ok) {
                    return { ok: false, error: data.error || 'Could not create room' };
                }
                return { ok: true, room: data.room, serverUUID: data.serverUUID || data.room?.serverUUID };
            } catch (err) {
                return { ok: false, error: err.message || 'Could not reach API' };
            }
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.ApiService = ApiService;
})(window);
