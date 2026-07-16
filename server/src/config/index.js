export const config = {
    /** TCP port — PLUGDJ_PORT or PORT, default 3000 (configurable, not auto-detect). */
    port: Number(process.env.PLUGDJ_PORT || process.env.PORT) || 3000,
    /** Bind address — 0.0.0.0 so LAN clients can connect. */
    host: process.env.HOST || '0.0.0.0',
    defaultRoomId: process.env.DEFAULT_ROOM_ID || 'neon-beats',
    chatHistoryLimit: 100,
    maxMessageLength: 500,
    maxUsernameLength: 24,
    defaultChatRateLimitMs: 2000,
    minChatRateLimitMs: 500,
    maxChatRateLimitMs: 30000
};
