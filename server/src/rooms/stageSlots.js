/** Crowd plane bounds (% of .stage-characters-crowd). Must match client render space. */
const DJ_ZONE = { leftMin: 40, leftMax: 60, bottomMax: 14 };
const CROWD_BOUNDS = { leftMin: 6, leftMax: 94, bottomMin: 0, bottomMax: 16 };
const CROWD_MIN_DIST = 5.5;

function isInDjZone(pos) {
    return pos.bottom <= DJ_ZONE.bottomMax
        && pos.left >= DJ_ZONE.leftMin
        && pos.left <= DJ_ZONE.leftMax;
}

function hasStagePosition(user) {
    return Number.isFinite(user?.stageLeft) && Number.isFinite(user?.stageBottom);
}

function collectOthers(room, excludeUserId) {
    return room.users
        .filter((u) => u.id !== excludeUserId && hasStagePosition(u))
        .map((u) => ({ left: u.stageLeft, bottom: u.stageBottom }));
}

function pickCrowdPosition(room, excludeUserId) {
    const others = collectOthers(room, excludeUserId);

    for (let attempt = 0; attempt < 48; attempt++) {
        const left = CROWD_BOUNDS.leftMin
            + Math.random() * (CROWD_BOUNDS.leftMax - CROWD_BOUNDS.leftMin);
        const bottom = CROWD_BOUNDS.bottomMin
            + Math.random() * (CROWD_BOUNDS.bottomMax - CROWD_BOUNDS.bottomMin);
        const pos = { left, bottom };
        if (isInDjZone(pos)) continue;
        const tooClose = others.some((other) => {
            const dx = other.left - pos.left;
            const dy = (other.bottom - pos.bottom) * 1.8;
            return Math.hypot(dx, dy) < CROWD_MIN_DIST;
        });
        if (!tooClose) return pos;
    }

    return {
        left: CROWD_BOUNDS.leftMin + Math.random() * (CROWD_BOUNDS.leftMax - CROWD_BOUNDS.leftMin),
        bottom: Math.random() * CROWD_BOUNDS.bottomMax
    };
}

function applyPosition(user, pos) {
    user.stageLeft = Math.round(pos.left * 100) / 100;
    user.stageBottom = Math.round(pos.bottom * 100) / 100;
    return { left: user.stageLeft, bottom: user.stageBottom };
}

/**
 * Assign a stable stage position on first join.
 * Soft reconnects keep the existing stageLeft/stageBottom.
 */
export function assignStagePosition(room, user) {
    if (hasStagePosition(user)) {
        return { left: user.stageLeft, bottom: user.stageBottom };
    }
    return applyPosition(user, pickCrowdPosition(room, user.id));
}

/**
 * Force a new crowd position (replaces the previous one).
 * Used when a user leaves the DJ booth and returns to the floor.
 */
export function reassignStagePosition(room, user) {
    if (!user) return null;
    // Clear first so the old spot is free for others / for the new pick
    user.stageLeft = null;
    user.stageBottom = null;
    return applyPosition(user, pickCrowdPosition(room, user.id));
}

/** @deprecated use assignStagePosition */
export function assignStageSlot(room, user) {
    return assignStagePosition(room, user);
}
