(function(global) {
    'use strict';

    function clampVolume(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 70;
        return Math.max(0, Math.min(100, Math.round(n)));
    }

    class SettingsUI {
        constructor() {
            this.bound = false;
            this.lastDisplayName = '';
            this.audioCtx = null;
        }

        ensureBound() {
            if (this.bound) return;
            this.bound = true;
            const self = this;

            $(document).on(
                'change input',
                '#setting-show-online, #setting-master-volume, #setting-normalize, #setting-chat-timestamps, #setting-chat-compact, #setting-chat-font, #setting-desktop-notifications, #setting-sound-alerts, #setting-notify-turn',
                function(e) {
                    const id = e.target?.id;
                    if (id === 'setting-master-volume') {
                        self.saveFromForm({ applyVolume: true, syncPlayer: true });
                        return;
                    }
                    self.saveFromForm({ applyVolume: false });
                }
            );

            $(document).on('input', '#setting-display-name', function() {
                self.saveFromForm({ applyVolume: false });
            });

            $(document).on('change', '#setting-display-name', function() {
                self.saveFromForm({ pushRename: true, applyVolume: false });
            });
        }

        hydrate() {
            this.ensureBound();
            const profile = global.PlugDJ.getProfile?.();
            if (!profile) return;
            const s = profile.settings || {};

            this.lastDisplayName = profile.displayName || 'Guest';
            $('#setting-display-name').val(this.lastDisplayName);
            $('#setting-show-online').prop('checked', s.showOnlineStatus !== false);
            $('#setting-master-volume').val(clampVolume(s.masterVolume ?? 70));
            $('#setting-normalize').prop('checked', s.normalizeVolume !== false);
            $('#setting-chat-timestamps').prop('checked', s.chatTimestamps !== false);
            $('#setting-chat-compact').prop('checked', !!s.chatCompact);
            $('#setting-chat-font').val(s.chatFontSize || 'Medium');
            $('#setting-desktop-notifications').prop('checked', !!s.desktopNotifications);
            $('#setting-sound-alerts').prop('checked', s.soundAlerts !== false);
            $('#setting-notify-turn').prop('checked', s.notifyTurn !== false);

            // Opening settings must not touch playback volume — only mirror UI + chat prefs
            this.applyRuntime(profile, { applyVolume: false });
        }

        saveFromForm(options = {}) {
            const pushRename = options.pushRename === true;
            const applyVolume = options.applyVolume === true;
            const syncPlayer = options.syncPlayer === true;

            const displayName = String($('#setting-display-name').val() || '').trim().slice(0, 24) || 'Guest';
            const masterVolume = clampVolume($('#setting-master-volume').val());
            const settings = {
                showOnlineStatus: $('#setting-show-online').is(':checked'),
                masterVolume,
                normalizeVolume: $('#setting-normalize').is(':checked'),
                chatTimestamps: $('#setting-chat-timestamps').is(':checked'),
                chatCompact: $('#setting-chat-compact').is(':checked'),
                chatFontSize: $('#setting-chat-font').val() || 'Medium',
                desktopNotifications: $('#setting-desktop-notifications').is(':checked'),
                soundAlerts: $('#setting-sound-alerts').is(':checked'),
                notifyTurn: $('#setting-notify-turn').is(':checked')
            };

            const profile = global.PlugDJ.updateProfile?.({
                displayName,
                settings
            });

            if (settings.desktopNotifications && global.Notification?.permission === 'default') {
                Notification.requestPermission().catch(() => {});
            }

            if (pushRename && displayName && displayName !== this.lastDisplayName) {
                this.lastDisplayName = displayName;
                global.PlugDJ.renameUser?.(displayName);
            }

            this.applyRuntime(profile || global.PlugDJ.getProfile?.(), { applyVolume });

            if (syncPlayer || applyVolume) {
                global.PlugDJ.syncPlayerVolumeUI?.(masterVolume);
            }
        }

        applyRuntime(profile, options = {}) {
            if (!profile) return;
            const s = profile.settings || {};
            const applyVolume = options.applyVolume !== false;

            if (applyVolume) {
                const vol = clampVolume(s.masterVolume ?? 70);
                global.PlugDJ.setMediaVolume?.(vol / 100);
                global.PlugDJ.syncPlayerVolumeUI?.(vol);
            }

            global.PlugDJ.setNormalizeVolume?.(s.normalizeVolume !== false);

            const $chat = $('.chat-messages, #chat-list, .chat-panel');
            $chat.toggleClass('chat-compact', !!s.chatCompact);
            $chat.toggleClass('chat-timestamps-off', s.chatTimestamps === false);
            document.documentElement.dataset.chatFont = s.chatFontSize || 'Medium';

            // Live chat headcount only (this client)
            $('.chat-count').toggle(s.showOnlineStatus !== false);
        }

        syncMasterVolumeUI(percent) {
            const vol = clampVolume(percent);
            const $el = $('#setting-master-volume');
            if ($el.length) $el.val(vol);
        }

        playAlertSound() {
            try {
                const Ctx = global.AudioContext || global.webkitAudioContext;
                if (!Ctx) return;
                if (!this.audioCtx) this.audioCtx = new Ctx();
                const ctx = this.audioCtx;
                if (ctx.state === 'suspended') ctx.resume().catch(() => {});
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = 880;
                gain.gain.value = 0.07;
                osc.connect(gain);
                gain.connect(ctx.destination);
                const t = ctx.currentTime;
                osc.start(t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
                osc.stop(t + 0.2);
            } catch {
                // ignore
            }
        }

        notifyDesktop(title, body) {
            const profile = global.PlugDJ.getProfile?.();
            if (!profile?.settings?.desktopNotifications) return;
            if (!global.Notification || Notification.permission !== 'granted') return;
            if (!document.hidden) return;
            try {
                const n = new Notification(title, { body: body || '', silent: true });
                setTimeout(() => n.close(), 5000);
            } catch {
                // ignore
            }
        }

        onChatMessage(message, selfId) {
            const profile = global.PlugDJ.getProfile?.();
            if (!profile?.settings) return;
            if (message?.user?.id && message.user.id === selfId) return;

            if (profile.settings.soundAlerts !== false) {
                this.playAlertSound();
            }
            this.notifyDesktop(
                message?.user?.username || 'Chat',
                String(message?.message || '').slice(0, 120)
            );
        }

        onYourTurn() {
            const profile = global.PlugDJ.getProfile?.();
            if (!profile?.settings || profile.settings.notifyTurn === false) return;

            global.PlugDJ.showToast?.("It's your turn to DJ!");
            if (profile.settings.soundAlerts !== false) {
                this.playAlertSound();
            }
            if (profile.settings.desktopNotifications && global.Notification?.permission === 'granted') {
                try {
                    const n = new Notification("It's your turn!", {
                        body: 'You are up on the decks',
                        silent: true
                    });
                    setTimeout(() => n.close(), 6000);
                } catch {
                    // ignore
                }
            }
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.SettingsUI = SettingsUI;
})(window);
