import { createId } from '../utils/ids.js';
import { roomService } from '../rooms/RoomService.js';
import { reassignStagePosition } from '../rooms/stageSlots.js';
import { broadcastService } from '../services/BroadcastService.js';
import { mediaService } from '../media/MediaService.js';
import { libraryService } from '../library/LibraryService.js';
import { ServerEvents } from '../types/events.js';
import { toPublicSong, toPublicUser, toPublicQueueEntry } from '../utils/serialize.js';

const TRACK_END_GRACE_MS = 1000;

function cloneSong(song) {
    return song ? { ...song } : null;
}

export class QueueService {
    constructor(
        rooms = roomService,
        broadcast = broadcastService,
        media = mediaService,
        library = libraryService
    ) {
        this.rooms = rooms;
        this.broadcast = broadcast;
        this.media = media;
        this.library = library;
        this.advanceTimers = new Map();
    }

    getQueue(roomId) {
        const room = this.rooms.getRoom(roomId);
        return room ? room.queue : [];
    }

    isUserInQueue(room, userId) {
        return room.queue.some((entry) => entry.userId === userId);
    }

    songFromLibraryHead(room, user) {
        this.library.ensureUserMedia(room, user);
        const head = this.library.peekLibraryHead(room, user);
        if (!head) return null;
        return {
            ...head,
            id: `track-${createId()}`,
            libraryTrackId: head.id,
            addedBy: user.username,
            mediaToken: null,
            mediaUrl: null,
            mediaStatus: head.playMode === 'artwork' ? 'ready' : 'pending'
        };
    }

    joinQueue(room, user) {
        this.library.ensureUserMedia(room, user);

        if (this.isUserInQueue(room, user.id)) {
            return { ok: false, error: 'Already in queue' };
        }

        if (!user.library.length) {
            return { ok: false, error: 'Add a track to your Library before joining the DJ queue' };
        }

        const song = this.songFromLibraryHead(room, user);
        if (!song) {
            return { ok: false, error: 'Add a track to your Library before joining the DJ queue' };
        }

        const entry = {
            id: createId(),
            userId: user.id,
            username: user.username,
            song
        };

        room.queue.push(entry);
        user.inQueue = true;
        this.prepareEntryMedia(room, entry);

        let promoted = null;
        if (!room.currentDJ) {
            promoted = this.promoteNextDJ(room);
        }

        return { ok: true, data: { entry, promoted } };
    }

    leaveQueue(room, userId) {
        const wasDJ = room.currentDJ?.id === userId;
        const leaving = room.queue.find((entry) => entry.userId === userId);
        if (wasDJ && room.currentSong) {
            this.media.cleanupSong(room.currentSong);
        } else if (leaving?.song) {
            this.media.cleanupSong(leaving.song);
        }

        room.queue = room.queue.filter((entry) => entry.userId !== userId);

        const user = this.rooms.findUser(room, userId);
        if (user) {
            user.inQueue = false;
        }

        let promoted = null;
        if (wasDJ) {
            room.currentDJ = null;
            room.currentSong = null;
            this.rooms.syncRoomVoteState(room);
            // Back on the floor → new crowd spot replaces the old one
            if (user) reassignStagePosition(room, user);
            promoted = this.promoteNextDJ(room);
        }

        return { ok: true, data: { wasDJ, promoted } };
    }

    promoteNextDJ(room) {
        while (room.queue.length > 0) {
            const next = room.queue[0];
            const user = this.rooms.findUser(room, next.userId);
            if (!user) {
                this.media.cleanupSong(next.song);
                room.queue.shift();
                continue;
            }

            this.library.ensureUserMedia(room, user);
            // Booth song must still exist at head of personal library
            const head = this.library.peekLibraryHead(room, user);
            if (!head) {
                room.queue.shift();
                user.inQueue = false;
                continue;
            }

            const prior = next.song || {};
            next.song = {
                ...head,
                id: `track-${createId()}`,
                libraryTrackId: head.id,
                addedBy: user.username,
                mediaToken: prior.mediaToken || null,
                mediaUrl: prior.mediaUrl || null,
                mediaStatus: prior.mediaStatus || (head.playMode === 'artwork' ? 'ready' : 'pending')
            };

            // If a prior waitlist download already finished for this media, reuse it
            if (next.song.mediaStatus !== 'ready' && next.song.playMode !== 'artwork') {
                this.media.ensurePlayback(next.song).catch(() => {});
            }

            const mediaReady = next.song.playMode === 'artwork' || next.song.mediaStatus === 'ready';
            room.currentDJ = user;
            room.currentSong = {
                ...next.song,
                // Clock starts only when playback can actually begin (avoids replaying after long downloads)
                startedAt: mediaReady ? Date.now() : null
            };
            this.rooms.syncRoomVoteState(room);
            if (mediaReady) {
                this.scheduleAutoAdvance(room);
            } else {
                this.cancelAutoAdvance(room.id);
            }
            this.prepareCurrentMedia(room);
            return user;
        }

        room.currentDJ = null;
        room.currentSong = null;
        this.rooms.syncRoomVoteState(room);
        this.cancelAutoAdvance(room.id);
        return null;
    }

    prepareEntryMedia(room, entry) {
        if (!entry?.song || entry.song.playMode === 'artwork' || entry.song.mediaStatus === 'ready') {
            return;
        }
        entry.song.mediaStatus = 'downloading';
        this.media.ensurePlayback(entry.song).then((ready) => {
            Object.assign(entry.song, ready);
            if (room.currentSong?.id === entry.song.id) {
                this.markCurrentSongPlayable(room, ready);
            } else {
                this.broadcast.broadcastRoom(room.id, {
                    type: ServerEvents.QUEUE_UPDATED,
                    queue: room.queue.map(toPublicQueueEntry)
                });
            }
        }).catch(() => {
            entry.song.playMode = 'artwork';
            entry.song.mediaStatus = 'error';
            if (room.currentSong?.id === entry.song.id) {
                room.currentSong.playMode = 'artwork';
                room.currentSong.mediaStatus = 'error';
                if (!room.currentSong.startedAt) room.currentSong.startedAt = Date.now();
                this.broadcastSongReady(room);
                this.scheduleAutoAdvance(room);
            }
        });
    }

    prepareCurrentMedia(room) {
        const song = room.currentSong;
        if (!song) return;
        if (song.playMode === 'artwork') {
            if (!song.startedAt) {
                song.startedAt = Date.now();
                this.broadcastSongReady(room);
                this.scheduleAutoAdvance(room);
            }
            return;
        }
        if (song.mediaStatus === 'ready' && song.mediaUrl) {
            if (!song.startedAt) {
                song.startedAt = Date.now();
                this.broadcastSongReady(room);
                this.scheduleAutoAdvance(room);
            }
            return;
        }

        song.mediaStatus = 'downloading';
        this.broadcastSongReady(room); // clients show download loading

        this.media.ensurePlayback(song).then((ready) => {
            if (room.currentSong?.id !== song.id) return;
            this.markCurrentSongPlayable(room, ready);
        }).catch(() => {
            if (room.currentSong?.id !== song.id) return;
            room.currentSong.playMode = 'artwork';
            room.currentSong.mediaStatus = 'error';
            if (!room.currentSong.startedAt) room.currentSong.startedAt = Date.now();
            this.broadcastSongReady(room);
            this.scheduleAutoAdvance(room);
        });
    }

    /** Apply ready media and start the shared playback clock once. */
    markCurrentSongPlayable(room, ready = {}) {
        const song = room.currentSong;
        if (!song) return;

        Object.assign(song, ready);
        song.mediaStatus = 'ready';

        // Only start the clock the first time media becomes playable
        if (!song.startedAt) {
            song.startedAt = Date.now();
        }

        this.broadcastSongReady(room);
        this.scheduleAutoAdvance(room);
    }

    broadcastSongReady(room) {
        this.broadcast.broadcastRoom(room.id, {
            type: ServerEvents.DJ_UPDATED,
            currentDJ: room.currentDJ ? toPublicUser(room.currentDJ) : null,
            currentSong: this.toPublicCurrentSong(room)
        });
    }

    scheduleAutoAdvance(room) {
        this.cancelAutoAdvance(room.id);
        if (!room.currentSong?.duration || !room.currentSong.startedAt) return;
        // Never auto-advance while still downloading
        if (room.currentSong.mediaStatus === 'pending' || room.currentSong.mediaStatus === 'downloading') {
            return;
        }

        const elapsed = Date.now() - room.currentSong.startedAt;
        const remainingMs = Math.max(0, room.currentSong.duration * 1000 - elapsed) + TRACK_END_GRACE_MS;

        const timer = setTimeout(() => this.handleTrackEnd(room.id), remainingMs);
        this.advanceTimers.set(room.id, timer);
    }

    cancelAutoAdvance(roomId) {
        const timer = this.advanceTimers.get(roomId);
        if (timer) {
            clearTimeout(timer);
            this.advanceTimers.delete(roomId);
        }
    }

    handleTrackEnd(roomId) {
        this.advanceTimers.delete(roomId);
        const room = this.rooms.getRoom(roomId);
        if (!room || !room.currentSong) return;
        this.advanceAndBroadcast(room);
    }

    /**
     * After a play finishes / is skipped:
     * - remove that track from the DJ's personal library
     * - if they still have library tracks → go to the back of the waitlist
     * - if library empty → leave the waitlist
     */
    advanceTrack(room) {
        const finished = room.currentSong;
        const currentId = room.currentDJ?.id || null;
        const currentUser = currentId ? this.rooms.findUser(room, currentId) : null;

        if (finished) {
            this.media.cleanupSong(finished);
            if (currentUser) {
                this.library.recordPlay(room, finished, currentUser.username);
                // Remove the played library item (by libraryTrackId or head match)
                if (finished.libraryTrackId) {
                    this.library.removeFromLibrary(room, currentUser, finished.libraryTrackId);
                } else {
                    this.library.shiftLibraryHead(room, currentUser);
                }
                this.library.persistUserMedia(room, currentUser);
            }
        }

        if (currentId) {
            const index = room.queue.findIndex((entry) => entry.userId === currentId);
            if (index !== -1) {
                const [entry] = room.queue.splice(index, 1);
                if (currentUser) {
                    this.library.ensureUserMedia(room, currentUser);
                    if (currentUser.library.length > 0) {
                        entry.song = this.songFromLibraryHead(room, currentUser);
                        room.queue.push(entry);
                        currentUser.inQueue = true;
                        this.prepareEntryMedia(room, entry);
                    } else {
                        currentUser.inQueue = false;
                    }
                }
            }
        }

        // Leaving the booth → new saved floor position
        if (currentUser) {
            reassignStagePosition(room, currentUser);
        }

        room.currentDJ = null;
        room.currentSong = null;
        return this.promoteNextDJ(room);
    }

    advanceAndBroadcast(room) {
        const finishedDjId = room.currentDJ?.id || null;
        const promoted = this.advanceTrack(room);

        this.broadcast.broadcastRoom(room.id, {
            type: ServerEvents.QUEUE_UPDATED,
            queue: room.queue.map(toPublicQueueEntry)
        });

        this.broadcast.broadcastRoom(room.id, {
            type: ServerEvents.DJ_UPDATED,
            currentDJ: promoted ? toPublicUser(promoted) : null,
            currentSong: this.toPublicCurrentSong(room)
        });

        this.broadcast.broadcastRoom(room.id, {
            type: ServerEvents.VOTE_UPDATED,
            votes: room.votes
        });

        room.users.forEach((user) => {
            this.broadcast.broadcastRoom(room.id, {
                type: ServerEvents.USER_UPDATED,
                user: toPublicUser(user)
            });
        });

        // Private library refresh for the DJ who just finished
        if (finishedDjId) {
            const finishedUser = this.rooms.findUser(room, finishedDjId);
            if (finishedUser) {
                const sockets = this.broadcast.findSocketsInRoom(room.id, finishedDjId);
                const state = this.library.toPublicLibraryState(room, finishedUser);
                sockets.forEach(({ socketId }) => {
                    this.broadcast.send(socketId, {
                        type: ServerEvents.LIBRARY_STATE,
                        ...state
                    });
                });
            }
        }

        queueMicrotask(() => {
            import('../users/SessionService.js').then(({ sessionService }) => {
                sessionService.purgeAbsentUsers(room);
            });
        });

        return promoted;
    }

    skipTrack(room) {
        if (!room.currentSong) {
            return { ok: false, error: 'No track is playing' };
        }
        const promoted = this.advanceAndBroadcast(room);
        return { ok: true, data: { promoted } };
    }

    handleUserLeft(room, userId) {
        return this.leaveQueue(room, userId);
    }

    toPublicDJ(room) {
        return room.currentDJ ? toPublicUser(room.currentDJ) : null;
    }

    toPublicCurrentSong(room) {
        return toPublicSong(room.currentSong);
    }
}

export const queueService = new QueueService();
