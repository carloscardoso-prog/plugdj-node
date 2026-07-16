import { randomUUID, randomInt } from 'crypto';

// Lowercase so codes survive the join payload slugify; no ambiguous chars (0/o, 1/l/i)
const ROOM_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function createId() {
    return randomUUID();
}

export function createRoomCode(length = 6) {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    return code;
}
