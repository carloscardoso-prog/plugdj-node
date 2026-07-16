(function(global) {
    'use strict';

    function formatDuration(until) {
        if (!until) return 'Permanent';
        const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
        return `${mins}m left`;
    }

    class ModerationUI {
        render(state) {
            if (!state?.room) return;
            const mod = state.room.moderation || { bans: [], mutes: [] };

            const $modList = $('.chat-panel[data-panel="mod"] .chat-list');
            $modList.empty();

            const staff = (state.room.users || []).filter((user) => user.role === 'owner' || user.role === 'admin');
            if (!staff.length) {
                $modList.append('<li class="list-empty">No staff online.</li>');
            } else {
                staff.forEach((user) => {
                    const badge = user.role === 'owner' ? 'Owner' : 'Admin';
                    const badgeClass = user.role === 'owner' ? '' : ' list-badge--admin';
                    $modList.append(`
                        <li class="user-card-target" data-user="${user.username}" data-user-id="${user.id}" data-client-id="${user.clientId || ''}" data-avatar="${user.avatar}" data-role="${user.role}">
                            <span class="mini-avatar av-1">${user.username.charAt(0).toUpperCase()}</span>
                            <span class="list-user">${user.username}</span>
                            <span class="list-badge${badgeClass}">${badge}</span>
                        </li>
                    `);
                });
            }

            const $banList = $('.chat-panel[data-panel="banned"] .chat-list');
            $banList.empty();
            const hasPunishments = mod.bans.length || mod.mutes.length;
            if (!hasPunishments) {
                $banList.append('<li class="list-empty">No active punishments.</li>');
            }
            mod.bans.forEach((ban) => {
                $banList.append(`
                    <li class="user-card-target" data-user="${ban.username || ''}" data-client-id="${ban.clientId || ''}" data-role="user">
                        <span class="list-user">${ban.username || 'Unknown'}</span>
                        <span class="list-badge list-badge--ban">Banned</span>
                        <span class="list-action">${ban.reason || 'No reason'}</span>
                    </li>
                `);
            });
            mod.mutes.forEach((mute) => {
                $banList.append(`
                    <li class="user-card-target" data-user="${mute.username || ''}" data-client-id="${mute.clientId || ''}" data-role="user">
                        <span class="list-user">${mute.username || 'Unknown'}</span>
                        <span class="list-badge list-badge--mute">Muted</span>
                        <span class="list-action">${formatDuration(mute.until)}</span>
                    </li>
                `);
            });
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.ModerationUI = ModerationUI;
})(window);
