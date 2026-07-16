(function(global) {
    'use strict';

    function thumbStyle(track) {
        const src = track.artworkUrl || track.thumbnailUrl;
        return src ? ` style="background-image:url('${src}')"` : '';
    }

    function repeatBadge(track) {
        if (!track.isRepeat) return '';
        return `<span class="track-warning" title="Already played in this room">⚠ Repeat</span>`;
    }

    class LibraryUI {
        constructor() {
            this.state = {
                library: [],
                playlists: [],
                activePlaylistId: null,
                recentPlays: []
            };
            this.playlistFilter = '';
            this.dragTrackId = null;
            this.bindLibraryDnD();
        }

        bindLibraryDnD() {
            const self = this;
            const listSel = '#library-list';

            $(document).on('dragstart', `${listSel} .library-item[draggable="true"]`, function(e) {
                if ($(e.target).closest('button, a, input').length) {
                    e.preventDefault();
                    return;
                }
                const id = String($(this).data('track-id') || '');
                if (!id) return;
                self.dragTrackId = id;
                $(this).addClass('is-dragging');
                const dt = e.originalEvent?.dataTransfer;
                if (dt) {
                    dt.effectAllowed = 'move';
                    dt.setData('text/plain', id);
                }
            });

            $(document).on('dragend', `${listSel} .library-item`, function() {
                self.dragTrackId = null;
                $(`${listSel} .library-item`).removeClass('is-dragging is-drop-before is-drop-after');
            });

            $(document).on('dragover', `${listSel} .library-item[draggable="true"]`, function(e) {
                e.preventDefault();
                if (!self.dragTrackId) return;
                const $item = $(this);
                const id = String($item.data('track-id') || '');
                if (!id || id === self.dragTrackId) return;

                const rect = this.getBoundingClientRect();
                const before = (e.originalEvent?.clientY || 0) < rect.top + rect.height / 2;
                $(`${listSel} .library-item`).removeClass('is-drop-before is-drop-after');
                $item.addClass(before ? 'is-drop-before' : 'is-drop-after');
                if (e.originalEvent?.dataTransfer) {
                    e.originalEvent.dataTransfer.dropEffect = 'move';
                }
            });

            $(document).on('drop', `${listSel} .library-item[draggable="true"]`, function(e) {
                e.preventDefault();
                const fromId = self.dragTrackId || String(e.originalEvent?.dataTransfer?.getData('text/plain') || '');
                const toId = String($(this).data('track-id') || '');
                $(`${listSel} .library-item`).removeClass('is-dragging is-drop-before is-drop-after');
                self.dragTrackId = null;
                if (!fromId || !toId || fromId === toId) return;

                const rect = this.getBoundingClientRect();
                const before = (e.originalEvent?.clientY || 0) < rect.top + rect.height / 2;
                self.reorderLibraryLocal(fromId, toId, before);
            });
        }

        reorderLibraryLocal(fromId, toId, placeBefore) {
            const list = this.state.library.slice();
            const fromIndex = list.findIndex((t) => t.id === fromId);
            const toIndex = list.findIndex((t) => t.id === toId);
            if (fromIndex < 0 || toIndex < 0) return;

            const [item] = list.splice(fromIndex, 1);
            let insertAt = list.findIndex((t) => t.id === toId);
            if (insertAt < 0) return;
            if (!placeBefore) insertAt += 1;
            list.splice(insertAt, 0, item);

            this.state.library = list;
            this.persistToProfile();
            this.renderLibrary();
            this.updatePlayButton();

            const orderedIds = list.map((t) => t.id);
            if (!global.PlugDJ.libraryReorder?.(orderedIds)) {
                global.PlugDJ.showToast?.('Not connected');
            }
        }

        get activePlaylist() {
            const list = this.state.playlists || [];
            return list.find((p) => p.id === this.state.activePlaylistId) || list[0] || { id: null, name: 'Playlist', tracks: [] };
        }

        get playlistTracks() {
            return this.activePlaylist.tracks || [];
        }

        apply(payload) {
            if (!payload) return;
            if (Array.isArray(payload.library)) this.state.library = payload.library;
            if (Array.isArray(payload.playlists)) {
                this.state.playlists = payload.playlists;
            } else if (Array.isArray(payload.playlist)) {
                // Legacy single playlist payload
                const id = this.state.activePlaylistId || 'default';
                this.state.playlists = [{ id, name: 'Favorites', tracks: payload.playlist }];
                this.state.activePlaylistId = id;
            }
            if (payload.activePlaylistId) this.state.activePlaylistId = payload.activePlaylistId;
            if (Array.isArray(payload.recentPlays)) this.state.recentPlays = payload.recentPlays;

            if (!this.state.activePlaylistId && this.state.playlists[0]) {
                this.state.activePlaylistId = this.state.playlists[0].id;
            }

            this.persistToProfile();
            this.renderAll();
        }

        persistToProfile() {
            if (typeof global.PlugDJ.updateProfile !== 'function') return;
            global.PlugDJ.updateProfile({
                library: this.state.library,
                playlists: this.state.playlists,
                activePlaylistId: this.state.activePlaylistId
            });
        }

        renderAll() {
            this.renderLibrary();
            this.renderPlaylistSwitcher();
            this.renderPlaylist();
            this.renderMusicQueue();
            this.updatePlayButton();
        }

        updatePlayButton() {
            const state = global.PlugDJ.getRoomState?.();
            const selfUser = state?.room?.users?.find((u) => u.id === state.selfId);
            const $btn = $('.btn-play-song');
            if (!$btn.length) return;

            if (selfUser?.inQueue) {
                $btn.addClass('queued').prop('disabled', false);
                $btn.find('.btn-play-label').text('Leave the queue');
                return;
            }

            const empty = !this.state.library.length;
            $btn.toggleClass('is-disabled', empty).prop('disabled', empty);
            $btn.removeClass('queued');
            $btn.find('.btn-play-label').text(empty ? 'Add tracks to Library' : 'Play a Song');
        }

        renderLibrary() {
            const $list = $('#library-list');
            const $count = $('#library-count');
            if ($count.length) $count.text(String(this.state.library.length));
            if (!$list.length) return;

            if (!this.state.library.length) {
                $list.html(`
                    <li class="library-item library-item--empty">
                        <div class="track-info">
                            <span class="track-title">Library empty</span>
                            <span class="track-artist">Paste a link above to queue something for your DJ turn</span>
                        </div>
                    </li>
                `);
                return;
            }

            $list.empty();
            this.state.library.forEach((track, index) => {
                const cls = [
                    'track-item',
                    'library-item',
                    index === 0 ? 'is-next' : '',
                    track.isRepeat ? 'is-repeat' : ''
                ].filter(Boolean).join(' ');
                $list.append(`
                    <li class="${cls}" data-track-id="${track.id}" draggable="true">
                        <span class="library-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
                        <span class="track-thumb"${thumbStyle(track)}></span>
                        <div class="track-info">
                            <span class="track-title"></span>
                            <span class="track-artist"></span>
                            ${repeatBadge(track)}
                        </div>
                        ${index === 0 ? '<span class="library-badge">Up next</span>' : ''}
                        <button class="btn-track-action btn-remove btn-icon btn-library-remove" type="button" aria-label="Remove">&times;</button>
                    </li>
                `);
                const $item = $list.children().last();
                $item.find('.track-title').text(track.title || 'Untitled');
                $item.find('.track-artist').text(track.artist || '');
            });
        }

        renderPlaylistSwitcher() {
            const $select = $('#playlist-select');
            if (!$select.length) return;

            const playlists = this.state.playlists || [];
            $select.empty();
            playlists.forEach((p) => {
                const selected = p.id === this.state.activePlaylistId ? ' selected' : '';
                $select.append(`<option value="${p.id}"${selected}></option>`);
                $select.children().last().text(`${p.name} (${(p.tracks || []).length})`);
            });
        }

        renderPlaylist() {
            const $list = $('#playlist-list');
            if (!$list.length) return;

            const q = this.playlistFilter.trim().toLowerCase();
            const tracks = this.playlistTracks;
            const rows = !q
                ? tracks
                : tracks.filter((t) =>
                    `${t.title} ${t.artist}`.toLowerCase().includes(q)
                );

            if (!rows.length) {
                $list.html(`
                    <li class="library-item library-item--empty">
                        <div class="track-info">
                            <span class="track-title">${q ? 'No matches' : 'Playlist empty'}</span>
                            <span class="track-artist">${q ? 'Try another search' : 'Save tracks with the form above'}</span>
                        </div>
                    </li>
                `);
                return;
            }

            $list.empty();
            rows.forEach((track) => {
                const cls = ['track-item', track.isRepeat ? 'is-repeat' : ''].filter(Boolean).join(' ');
                $list.append(`
                    <li class="${cls}" data-track-id="${track.id}">
                        <span class="track-thumb"${thumbStyle(track)}></span>
                        <div class="track-info">
                            <span class="track-title"></span>
                            <span class="track-artist"></span>
                            ${repeatBadge(track)}
                        </div>
                        <button class="btn-track-action btn-add-library btn-playlist-promote" type="button">To Library</button>
                        <button class="btn-track-action btn-remove btn-icon btn-playlist-remove" type="button" aria-label="Remove">&times;</button>
                    </li>
                `);
                const $item = $list.children().last();
                $item.find('.track-title').text(track.title || 'Untitled');
                $item.find('.track-artist').text(track.artist || '');
            });
        }

        renderMusicQueue() {
            const $list = $('#music-queue-list');
            if (!$list.length) return;

            const state = global.PlugDJ.getRoomState?.();
            const room = state?.room;
            if (!room) {
                $list.html('<li class="library-item library-item--empty"><div class="track-info"><span class="track-title">No room</span></div></li>');
                return;
            }

            const queue = room.queue || [];
            const currentDJ = room.currentDJ;
            const currentSong = room.currentSong;

            if (!queue.length && !currentSong) {
                $list.html(`
                    <li class="library-item library-item--empty">
                        <div class="track-info">
                            <span class="track-title">Waitlist empty</span>
                            <span class="track-artist">Add tracks to Library, then hit Play a Song</span>
                        </div>
                    </li>
                `);
                return;
            }

            $list.empty();

            if (currentSong && currentDJ) {
                $list.append(`
                    <li class="track-item is-playing" data-user-id="${currentDJ.id}">
                        <span class="track-thumb"${thumbStyle(currentSong)}></span>
                        <div class="track-info">
                            <span class="track-title"></span>
                            <span class="track-artist"></span>
                        </div>
                        <span class="track-badge">Now · ${currentDJ.username}</span>
                        <button class="btn-track-action btn-skip" type="button">Skip</button>
                    </li>
                `);
                const $now = $list.children().last();
                $now.find('.track-title').text(currentSong.title || 'Untitled');
                $now.find('.track-artist').text(currentSong.artist || '');
            }

            queue.forEach((entry, index) => {
                if (currentDJ && entry.userId === currentDJ.id) return;
                const song = entry.song || {};
                $list.append(`
                    <li class="track-item" data-user-id="${entry.userId}">
                        <span class="track-thumb"${thumbStyle(song)}></span>
                        <div class="track-info">
                            <span class="track-title"></span>
                            <span class="track-artist"></span>
                        </div>
                        <span class="track-user">#${index + 1} · ${entry.username}</span>
                    </li>
                `);
                const $item = $list.children().last();
                $item.find('.track-title').text(song.title || `${entry.username}'s turn`);
                $item.find('.track-artist').text(song.artist || 'Waiting');
            });
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.LibraryUI = LibraryUI;
})(window);
