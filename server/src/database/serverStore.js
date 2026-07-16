import fs from 'fs';
import { createId } from '../utils/ids.js';
import { dataFile, ensureDataDir } from '../config/paths.js';

/**
 * Per-host server identity + user bindings.
 *
 * server.json shape:
 * {
 *   serverUUID,
 *   users: {
 *     [userUUID]: { serverIssuedUUID, username, firstSeen, lastSeen }
 *   }
 * }
 */
export class ServerStore {
    constructor(filePath = dataFile('server.json')) {
        this.filePath = filePath;
        this.data = null;
        this.writeTimer = null;
    }

    load() {
        ensureDataDir();
        if (!fs.existsSync(this.filePath)) {
            this.data = {
                serverUUID: createId(),
                users: {},
                createdAt: new Date().toISOString()
            };
            this.saveNow();
            return this.data;
        }

        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            this.data = {
                serverUUID: raw.serverUUID || createId(),
                users: raw.users && typeof raw.users === 'object' ? raw.users : {},
                createdAt: raw.createdAt || new Date().toISOString()
            };
            if (!raw.serverUUID) this.saveNow();
            return this.data;
        } catch (err) {
            console.error('[serverStore] failed to load', err.message);
            this.data = {
                serverUUID: createId(),
                users: {},
                createdAt: new Date().toISOString()
            };
            this.saveNow();
            return this.data;
        }
    }

    ensure() {
        if (!this.data) this.load();
        return this.data;
    }

    getServerUUID() {
        return this.ensure().serverUUID;
    }

    saveSoon() {
        if (this.writeTimer) clearTimeout(this.writeTimer);
        this.writeTimer = setTimeout(() => {
            this.writeTimer = null;
            this.saveNow();
        }, 300);
    }

    saveNow() {
        ensureDataDir();
        const payload = this.ensure();
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
        fs.renameSync(tmp, this.filePath);
    }

    findByUserUUID(userUUID) {
        if (!userUUID) return null;
        return this.ensure().users[userUUID] || null;
    }

    findByServerIssuedUUID(serverIssuedUUID) {
        if (!serverIssuedUUID) return null;
        const users = this.ensure().users;
        for (const [userUUID, entry] of Object.entries(users)) {
            if (entry.serverIssuedUUID === serverIssuedUUID) {
                return { userUUID, ...entry };
            }
        }
        return null;
    }

    /**
     * Resolve or create the durable identity for a client on this server.
     * Prefers an existing binding by userUUID; validates serverIssuedUUID when provided.
     */
    resolveIdentity({ userUUID, serverIssuedUUID = null, username = '' }) {
        const now = new Date().toISOString();
        const users = this.ensure().users;

        let entry = users[userUUID] || null;

        // Client presented a known serverIssuedUUID for a different userUUID → ignore ticket
        if (serverIssuedUUID) {
            const byIssued = this.findByServerIssuedUUID(serverIssuedUUID);
            if (byIssued && byIssued.userUUID !== userUUID) {
                serverIssuedUUID = null;
            } else if (byIssued && byIssued.userUUID === userUUID) {
                entry = users[userUUID];
            } else if (!entry && serverIssuedUUID) {
                // Unknown ticket for this user — treat as new binding with that id only if free
                const taken = this.findByServerIssuedUUID(serverIssuedUUID);
                if (!taken) {
                    entry = {
                        serverIssuedUUID,
                        username: username || '',
                        firstSeen: now,
                        lastSeen: now
                    };
                    users[userUUID] = entry;
                    this.saveSoon();
                    return {
                        userUUID,
                        serverIssuedUUID: entry.serverIssuedUUID,
                        isNew: true
                    };
                }
            }
        }

        if (!entry) {
            entry = {
                serverIssuedUUID: createId(),
                username: username || '',
                firstSeen: now,
                lastSeen: now
            };
            users[userUUID] = entry;
            this.saveSoon();
            return {
                userUUID,
                serverIssuedUUID: entry.serverIssuedUUID,
                isNew: true
            };
        }

        entry.lastSeen = now;
        if (username) entry.username = username;
        this.saveSoon();
        return {
            userUUID,
            serverIssuedUUID: entry.serverIssuedUUID,
            isNew: false
        };
    }

    /** Soft-delete: drop bindings that only belonged to a deleted room is N/A globally;
     * hard-remove a user binding if ever needed. */
    removeUserBinding(userUUID) {
        if (!userUUID || !this.ensure().users[userUUID]) return false;
        delete this.ensure().users[userUUID];
        this.saveSoon();
        return true;
    }
}

export const serverStore = new ServerStore();
