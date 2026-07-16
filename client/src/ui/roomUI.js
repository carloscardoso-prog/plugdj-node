(function(global) {
    'use strict';

    class RoomUI {
        constructor(options = {}) {
            this.onBackgroundChange = options.onBackgroundChange || function() {};
            this.moderationUI = new global.PlugDJ.ModerationUI();
        }

        applyRoomState(state) {
            if (!state?.room) return;
            const room = state.room;
            const selfUser = room.users.find((user) => user.id === state.selfId);

            $('.room-name').text(room.name);
            document.title = `plug.dj - ${room.name}`;
            $('.topbar-center .stat').eq(0).find('span').text(this.formatCount(room.totalFavorites || 0));
            $('.topbar-center .stat').eq(1).find('span').text(this.formatCount(room.totalVisitors || 0));
            const showOnline = global.PlugDJ.getProfile?.()?.settings?.showOnlineStatus !== false;
            $('.chat-count')
                .text(String(Math.max(room.users.length, 1)))
                .toggle(showOnline);

            const trackCount = (room.queue?.length || 0) + (room.currentSong ? 1 : 0);
            $('.playlist-name').text(room.name || 'Community Server');
            $('.playlist-sub').text(`Community Server · ${trackCount} track${trackCount === 1 ? '' : 's'}`);

            const $badge = $('#room-admin-badge');
            if (state.selfRole === 'owner') {
                $badge.text('Owner').removeAttr('hidden');
            } else if (state.selfRole === 'admin') {
                $badge.text('Admin').removeAttr('hidden');
            } else {
                $badge.attr('hidden', '');
            }

            $('.chat-welcome h3').text(room.welcomeTitle || `Welcome to ${room.name}!`);
            $('.chat-welcome p').text(room.welcomeMessage || '');

            this.renderMembers(room.users, room.currentDJ);
            this.renderVotes(room.votes, selfUser, room, state.selfId);
            this.renderQueue(room.queue || []);
            this.renderPlayButton(state);
            this.renderFavorite(state);
            this.moderationUI.render(state);

            if (room.currentSong) {
                const title = room.currentSong.title || 'Unknown';
                const artist = room.currentSong.artist || '';
                $('.track-name').text(title).attr('title', title);
                $('.track-artist').text(artist).attr('title', artist);
                if (room.currentSong.duration) {
                    $('.progress-bar').attr('data-duration', room.currentSong.duration);
                    const totalMin = Math.floor(room.currentSong.duration / 60);
                    const totalSec = String(room.currentSong.duration % 60).padStart(2, '0');
                    $('.progress-total').text(`${totalMin}:${totalSec}`);
                }
                const art = room.currentSong.artworkUrl || room.currentSong.thumbnailUrl;
                if (art) {
                    $('.playlist-thumb').css('background-image', `url(${art})`).addClass('has-art');
                } else {
                    $('.playlist-thumb').css('background-image', '').removeClass('has-art');
                }
            } else {
                $('.track-name').text('No track playing').attr('title', 'No track playing');
                $('.track-artist').text('Join the queue to DJ').attr('title', '');
                $('.playlist-thumb').css('background-image', '').removeClass('has-art');
                $('.progress-bar').attr('data-duration', 0);
                $('.progress-fill').css('width', '0%');
                $('.progress-current').text('0:00');
                $('.progress-total').text('0:00');
            }

            this.onBackgroundChange(room.background);
        }

        formatCount(value) {
            return value >= 1000 ? `${(value / 1000).toFixed(1).replace('.0', '')}k` : String(value);
        }

        renderFavorite(state) {
            const $btn = $('.player-right .btn-favorite');
            $btn.prop('disabled', false)
                .removeClass('is-disabled')
                .attr('aria-disabled', 'false')
                .toggleClass('active', !!state.favorited)
                .attr('aria-pressed', state.favorited ? 'true' : 'false');
        }

        renderPlayButton(state) {
            const selfUser = state.room?.users.find((user) => user.id === state.selfId);
            const $btn = $('.btn-play-song');
            if (selfUser?.inQueue) {
                $btn.addClass('queued');
                $btn.find('.btn-play-label').text('Leave the queue');
            } else {
                $btn.removeClass('queued');
                $btn.find('.btn-play-label').text('Play a Song');
            }
        }

        renderQueue(queue) {
            const $wrap = $('#queue-avatars');
            $wrap.empty();
            const maxVisible = 5;
            queue.slice(0, maxVisible).forEach((entry, index) => {
                const initial = (entry.username || '?').charAt(0).toUpperCase();
                $wrap.append(`<span class="mini-avatar av-${(index % 4) + 1}" title="${entry.username}">${initial}</span>`);
            });
            if (queue.length > maxVisible) {
                $wrap.append(`<span class="mini-avatar av-more">+${queue.length - maxVisible}</span>`);
            }
        }

        renderMembers(users, currentDJ) {
            const $list = $('.chat-panel[data-panel="members"] .chat-list');
            $list.empty();

            users.forEach((user) => {
                const colorClass = global.PlugDJ.colorForUser(user.id);
                const initial = user.username.charAt(0).toUpperCase();
                const badges = [];
                if (user.role === 'owner') badges.push('<span class="list-badge">Owner</span>');
                else if (user.role === 'admin') badges.push('<span class="list-badge">Admin</span>');
                if (currentDJ?.id === user.id) badges.push('<span class="list-badge list-badge--dj">DJ</span>');
                if (user.inQueue) badges.push('<span class="list-badge list-badge--queue">Queue</span>');
                $list.append(`
                    <li class="user-card-target" data-user="${user.username}" data-user-id="${user.id}" data-client-id="${user.clientId || ''}" data-avatar="${user.avatar}" data-role="${user.role}">
                        <span class="mini-avatar av-1">${initial}</span>
                        <span class="list-user ${colorClass}">${user.username}</span>
                        ${badges.join('')}
                    </li>
                `);
            });
        }

        renderVotes(votes, selfUser, room, selfId) {
            if (!votes) return;
            const hasTrack = !!(room?.currentSong && room?.currentDJ);
            const isDj = room?.currentDJ?.id === selfId;
            const canVote = hasTrack && !isDj;

            $('.reaction-btn').each(function() {
                const $btn = $(this);
                const reaction = $btn.data('reaction');
                // Add to Playlist stays clickable for everyone (including the DJ)
                const enabled = reaction === 'playlist' ? hasTrack : canVote;
                $btn.prop('disabled', !enabled);
                $btn.toggleClass('is-disabled', !enabled);
                $btn.attr('aria-disabled', enabled ? 'false' : 'true');
            });

            $('.reaction-btn[data-reaction="like"]').toggleClass('active', !!selfUser?.liked);
            $('.reaction-btn[data-reaction="dislike"]').toggleClass('active', !!selfUser?.disliked);
            $('.reaction-btn[data-reaction="playlist"]').toggleClass('active', !!selfUser?.playlisted);
            $('.reaction-btn[data-reaction="like"] span').text(String(votes.woot ?? 0));
            $('.reaction-btn[data-reaction="dislike"] span').text(String(votes.meh ?? 0));
            $('.reaction-btn[data-reaction="playlist"] span').text(String(votes.grab ?? 0));
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.RoomUI = RoomUI;
})(window);
