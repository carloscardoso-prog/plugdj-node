import { roomService } from '../rooms/RoomService.js';

export class PlayerService {
    constructor(rooms = roomService) {
        this.rooms = rooms;
    }

    getCurrentSong(roomId) {
        const room = this.rooms.getRoom(roomId);
        return room ? room.currentSong : null;
    }
}

export const playerService = new PlayerService();
