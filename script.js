$(document).ready(function() {
    const lobby = new PlugDJ.LobbyService();
    const $error = $('#login-error');

    function showError(message) {
        $error.text(message).removeAttr('hidden');
    }

    function clearError() {
        $error.text('').attr('hidden', '');
    }

    const session = lobby.getSession();
    const profile = PlugDJ.getProfile?.();
    const nick = session.username || profile?.displayName || profile?.username || '';
    if (nick) {
        $('#join-nickname, #create-nickname').val(nick);
    }

    $('.login-tab').on('click', function() {
        const tab = $(this).data('tab');
        $('.login-tab').removeClass('active').attr('aria-selected', 'false');
        $(this).addClass('active').attr('aria-selected', 'true');
        $('.login-panel').removeClass('active');
        $(`.login-panel[data-panel="${tab}"]`).addClass('active');
        clearError();
        if (tab === 'host') refreshHostRooms();
    });

    $('#create-name').on('input', function() {
        const $slug = $('#create-slug');
        if (!$slug.data('touched')) {
            $slug.val(PlugDJ.slugify($(this).val()));
        }
    });

    $('#create-slug').on('input', function() {
        $(this).data('touched', true);
    });

    async function updateJoinPasswordField() {
        const slug = PlugDJ.slugify($('#join-room').val());
        const $label = $('#join-password-label');
        const $input = $('#join-password');

        if (!slug || slug.length < 3) {
            $label.attr('hidden', '');
            $input.attr('hidden', '').removeAttr('required').val('');
            return;
        }

        try {
            const result = await lobby.api.getRoom(slug);
            if (result.ok && result.room.hasPassword) {
                $label.removeAttr('hidden');
                $input.removeAttr('hidden').attr('required', '');
                if (typeof PlugDJ.getRoomPassword === 'function') {
                    const saved = PlugDJ.getRoomPassword(slug);
                    if (saved) $input.val(saved);
                }
            } else {
                $label.attr('hidden', '');
                $input.attr('hidden', '').removeAttr('required').val('');
            }
        } catch {
            $label.attr('hidden', '');
            $input.attr('hidden', '').removeAttr('required');
        }
    }

    $('#join-room').on('blur change', updateJoinPasswordField);

    async function refreshHostRooms() {
        const $list = $('#host-room-list');
        $list.html('<li class="host-room-list__empty">Loading rooms…</li>');

        try {
            const data = await lobby.listLocalRooms();
            const rooms = data.rooms || [];
            if (data.serverUUID) {
                $('#server-meta')
                    .text(`Server ${String(data.serverUUID).slice(0, 8)}… · local rooms only`)
                    .removeAttr('hidden');
            }

            if (!rooms.length) {
                $list.html('<li class="host-room-list__empty">No rooms yet. Create one to host a party.</li>');
            } else {
                $list.empty();
                rooms
                    .slice()
                    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                    .forEach((room) => {
                        const invite = lobby.inviteUrl(room.slug);
                        const $li = $('<li class="host-room-item"></li>');
                        const $meta = $('<div class="host-room-item__meta"></div>');
                        $meta.append($('<strong></strong>').text(room.name));
                        $meta.append($('<span class="host-room-item__slug"></span>').text(`/${room.slug}`));
                        if (room.hasPassword) {
                            $meta.append($('<span class="host-room-item__lock"></span>').text('password'));
                        }
                        $meta.append(
                            $('<span class="host-room-item__count"></span>').text(`${room.userCount || 0} online`)
                        );

                        const $actions = $('<div class="host-room-item__actions"></div>');
                        const $open = $('<button type="button" class="btn-room-action">Open</button>');
                        const $copy = $('<button type="button" class="btn-room-action btn-room-action--ghost">Copy link</button>');
                        const $del = $('<button type="button" class="btn-room-action btn-room-action--danger">Delete</button>');

                        $open.on('click', async function() {
                            const nickname = $('#join-nickname').val() || nick || 'Host';
                            try {
                                await lobby.joinRoom({
                                    nickname,
                                    room: room.slug,
                                    password: PlugDJ.getRoomPassword?.(room.slug) || ''
                                });
                            } catch (error) {
                                // Password-protected: switch to Join tab
                                $('.login-tab[data-tab="join"]').trigger('click');
                                $('#join-room').val(room.slug);
                                updateJoinPasswordField();
                                showError(error.message || 'Enter the room password to open');
                            }
                        });

                        $copy.on('click', function() {
                            navigator.clipboard.writeText(invite).then(function() {
                                $copy.text('Copied!');
                                setTimeout(() => $copy.text('Copy link'), 1200);
                            });
                        });

                        $del.on('click', async function() {
                            if (!confirm(`Delete room “${room.name}”? Connected users will be kicked.`)) return;
                            const result = await lobby.deleteLocalRoom(room.slug);
                            if (!result.ok) {
                                showError(result.error || 'Could not delete room');
                                return;
                            }
                            refreshHostRooms();
                        });

                        $actions.append($open, $copy, $del);
                        $li.append($meta, $actions);
                        $list.append($li);
                    });
            }
        } catch (err) {
            $list.html(`<li class="host-room-list__empty">Could not load rooms: ${err.message || 'offline'}</li>`);
        }

        renderHistory();
    }

    function renderHistory() {
        const history = PlugDJ.getProfile?.()?.history || [];
        const $wrap = $('#host-history');
        const $list = $('#host-history-list');
        if (!history.length) {
            $wrap.attr('hidden', '');
            return;
        }
        $wrap.removeAttr('hidden');
        $list.empty();
        history.slice(0, 8).forEach((entry) => {
            const $li = $('<li class="host-history__item"></li>');
            const label = entry.roomName || entry.roomSlug || 'Room';
            $li.append($('<strong></strong>').text(label));
            if (entry.roomSlug) {
                $li.append($('<span></span>').text(`/${entry.roomSlug}`));
            }
            const $btn = $('<button type="button" class="btn-room-action">Rejoin</button>');
            $btn.on('click', function() {
                $('.login-tab[data-tab="join"]').trigger('click');
                if (entry.roomSlug) $('#join-room').val(entry.roomSlug);
                updateJoinPasswordField();
            });
            $li.append($btn);
            $list.append($li);
        });
    }

    $('#form-join').on('submit', async function(event) {
        event.preventDefault();
        clearError();

        const nickname = $('#join-nickname').val();
        const room = $('#join-room').val();
        const password = $('#join-password').val();

        try {
            await lobby.joinRoom({ nickname, room, password });
        } catch (error) {
            showError(error.message || 'Could not join room');
        }
    });

    $('#form-create').on('submit', async function(event) {
        event.preventDefault();
        clearError();

        const nickname = $('#create-nickname').val();
        const name = $('#create-name').val();
        const slug = $('#create-slug').val();
        const password = $('#create-password').val();
        const aboutCommunity = $('#create-about').val();
        const welcomeMessage = $('#create-welcome').val();

        try {
            await lobby.createRoom({ nickname, name, slug, password, aboutCommunity, welcomeMessage });
        } catch (error) {
            showError(error.message || 'Could not create room');
        }
    });

    $('#btn-banned-back').on('click', function() {
        $('#login-banned').attr('hidden', '');
        $('#login-banned-reason').attr('hidden', '').text('');
        $('#login-page-content').removeAttr('hidden');
    });

    // Prefill join from URL ?room=
    const params = new URLSearchParams(location.search);
    const prefill = params.get('room');
    if (prefill) {
        $('.login-tab[data-tab="join"]').trigger('click');
        $('#join-room').val(prefill);
        updateJoinPasswordField();
    } else {
        refreshHostRooms();
    }

    lobby.api.health?.().then((h) => {
        if (h?.serverUUID) {
            $('#server-meta')
                .text(`Server ${String(h.serverUUID).slice(0, 8)}… · port ${h.port || location.port || '—'}`)
                .removeAttr('hidden');
        }
    }).catch(() => {});
});
