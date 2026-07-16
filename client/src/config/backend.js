(function(global) {
    'use strict';

    const STORAGE_API_BASE = 'plugdj-api-base';
    const STORAGE_USE_BRIDGE = 'plugdj-use-bridge';
    /** PHP bridge on Apache :80 → Node :3000 */
    const APACHE_API_BRIDGE = '/plug-dj-bridge/proxy.php';

    function getBackendBase() {
        const params = new URLSearchParams(location.search);
        const override = params.get('api') || localStorage.getItem(STORAGE_API_BASE);
        if (override) {
            return String(override).replace(/\/$/, '');
        }

        // Same-origin by default (local :3000 and ngrok → 3000)
        // Fall back to PHP bridge only after we detect Apache serving HTML for /api
        if (sessionStorage.getItem(STORAGE_USE_BRIDGE) === '1') {
            return `${location.origin}${APACHE_API_BRIDGE}`;
        }

        return '';
    }

    function enableApiBridge() {
        sessionStorage.setItem(STORAGE_USE_BRIDGE, '1');
    }

    function getWebSocketUrl() {
        const params = new URLSearchParams(location.search);
        const wsOverride = params.get('ws') || localStorage.getItem('plugdj-ws-url');
        if (wsOverride) {
            return String(wsOverride);
        }

        // Local Apache page → Node WS on :3000
        const port = String(location.port || '');
        if (port === '80' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
            return `ws://${location.hostname}:3000/ws`;
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${location.host}/ws`;
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.getBackendBase = getBackendBase;
    global.PlugDJ.getWebSocketUrl = getWebSocketUrl;
    global.PlugDJ.enableApiBridge = enableApiBridge;
    global.PlugDJ.STORAGE_API_BASE = STORAGE_API_BASE;
    global.PlugDJ.APACHE_API_BRIDGE = APACHE_API_BRIDGE;
})(window);
