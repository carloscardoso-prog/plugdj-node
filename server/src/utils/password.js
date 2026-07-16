import crypto from 'crypto';

const PREFIX = 'scrypt';

/** Hash a room password for disk (null if empty). */
export function hashPassword(plain) {
    const password = String(plain || '').trim();
    if (!password) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${PREFIX}$${salt}$${derived}`;
}

/**
 * Verify plaintext against stored hash or legacy plaintext.
 * Empty stored value = open room.
 */
export function verifyPasswordHash(plain, stored) {
    if (!stored) return true;
    const attempt = String(plain || '');

    if (typeof stored === 'string' && stored.startsWith(`${PREFIX}$`)) {
        const parts = stored.split('$');
        if (parts.length !== 3) return false;
        const [, salt, expected] = parts;
        try {
            const actual = crypto.scryptSync(attempt, salt, 64).toString('hex');
            const a = Buffer.from(actual, 'hex');
            const b = Buffer.from(expected, 'hex');
            if (a.length !== b.length) return false;
            return crypto.timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }

    // Legacy plaintext migration path
    return stored === attempt;
}

export function isHashedPassword(stored) {
    return typeof stored === 'string' && stored.startsWith(`${PREFIX}$`);
}
