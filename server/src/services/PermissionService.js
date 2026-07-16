import { roomService } from '../rooms/RoomService.js';

export function canManageRoom(user, room) {
    return roomService.isStaff(user);
}

export function canChangeBackground(user, room) {
    return canManageRoom(user, room);
}

export function canEditRoomMeta(user, room) {
    return canManageRoom(user, room);
}

export function canClearChat(user, room) {
    return canManageRoom(user, room);
}

export function canManageRoles(user, room) {
    return roomService.isOwner(user);
}

export function canModerateUsers(user, room) {
    return roomService.isOwner(user);
}

export function canSkipTrack(user, room) {
    return roomService.isStaff(user);
}
