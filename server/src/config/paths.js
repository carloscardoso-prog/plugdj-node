import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

/**
 * Data directory for this host instance (outside the client bundle).
 *
 * Resolution order:
 * 1. PLUGDJ_DATA_DIR env (absolute or relative to cwd)
 * 2. ./data next to the project root (dev / LAN host default)
 *
 * Packaged desktop builds can point PLUGDJ_DATA_DIR at the OS userData folder.
 */
export function getDataDir() {
    const fromEnv = process.env.PLUGDJ_DATA_DIR;
    if (fromEnv && String(fromEnv).trim()) {
        return path.resolve(String(fromEnv).trim());
    }
    return path.join(PROJECT_ROOT, 'data');
}

export function ensureDataDir() {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

export function dataFile(name) {
    return path.join(ensureDataDir(), name);
}

export { PROJECT_ROOT };
