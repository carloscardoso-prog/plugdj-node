(function(global) {
    'use strict';

    let activeKey = null;
    let playingUrl = null;
    let activeSong = null;
    let videoEl = null;
    let audioEl = null;
    let artEl = null;
    let loadingEl = null;
    let driftTimer = null;
    let playRetryTimer = null;
    /** When true, pause events are allowed (teardown / switching tracks). */
    let allowPause = false;
    /** While seeking to the room position, never start audible playback from 0. */
    let syncGate = false;
    let desiredVolume = 0.7;
    /** Headroom so normalize + dual volume UI stay comfortable. */
    const OUTPUT_GAIN = 0.42;
    let forceBound = false;
    let normalizeEnabled = true;
    let audioCtx = null;
    /** @type {WeakMap<HTMLMediaElement, {wet: GainNode, dry: GainNode}>} */
    const audioGraphs = new WeakMap();

    function ensureAudioContext() {
        if (audioCtx) return audioCtx;
        const Ctx = global.AudioContext || global.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
        return audioCtx;
    }

    function applyNormalizeRouting(graph) {
        if (!graph) return;
        graph.wet.gain.value = normalizeEnabled ? 1 : 0;
        graph.dry.gain.value = normalizeEnabled ? 0 : 1;
    }

    /** Route media through a compressor when normalize is on (once per element). */
    function ensureNormalizeGraph(el) {
        if (!el || !(el instanceof HTMLMediaElement)) return;
        if (audioGraphs.has(el)) {
            applyNormalizeRouting(audioGraphs.get(el));
            return;
        }
        const ctx = ensureAudioContext();
        if (!ctx) return;
        try {
            const source = ctx.createMediaElementSource(el);
            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = -28;
            compressor.knee.value = 24;
            compressor.ratio.value = 8;
            compressor.attack.value = 0.01;
            compressor.release.value = 0.25;

            const makeup = ctx.createGain();
            makeup.gain.value = 0.55;

            const wet = ctx.createGain();
            const dry = ctx.createGain();

            source.connect(compressor);
            compressor.connect(makeup);
            makeup.connect(wet);
            source.connect(dry);
            wet.connect(ctx.destination);
            dry.connect(ctx.destination);

            const graph = { wet, dry };
            audioGraphs.set(el, graph);
            applyNormalizeRouting(graph);

            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }
        } catch {
            // Already connected / unsupported — leave element volume path alone
        }
    }

    function setNormalizeVolume(enabled) {
        normalizeEnabled = enabled !== false;
        if (videoEl && audioGraphs.has(videoEl)) applyNormalizeRouting(audioGraphs.get(videoEl));
        if (audioEl && audioGraphs.has(audioEl)) applyNormalizeRouting(audioGraphs.get(audioEl));
        // Wire graphs lazily on next play if not yet created
        if (normalizeEnabled) {
            if (videoEl) ensureNormalizeGraph(videoEl);
            if (audioEl) ensureNormalizeGraph(audioEl);
        }
    }

    function ensureShell() {
        const host = document.querySelector('.video-placeholder');
        if (!host) return null;

        if (!host.dataset.mediaReady) {
            host.innerHTML = `
                <video class="stage-media stage-media--video" playsinline webkit-playsinline disablepictureinpicture></video>
                <audio class="stage-media stage-media--audio"></audio>
                <img class="stage-media stage-media--art" alt="" />
                <div class="stage-media__loading" hidden>
                    <div class="stage-media__spinner" aria-hidden="true"></div>
                    <div class="stage-media__loading-text">
                        <strong class="stage-media__loading-title">Preparing media…</strong>
                        <span class="stage-media__loading-sub">This can take a while for long videos</span>
                    </div>
                </div>
            `;
            host.dataset.mediaReady = '1';
        }

        videoEl = host.querySelector('.stage-media--video');
        audioEl = host.querySelector('.stage-media--audio');
        artEl = host.querySelector('.stage-media--art');
        loadingEl = host.querySelector('.stage-media__loading');

        // No native controls — user must not pause. Never autoplay until seeked.
        [videoEl, audioEl].forEach((el) => {
            if (!el) return;
            el.removeAttribute('controls');
            el.controls = false;
            el.autoplay = false;
            el.setAttribute('playsinline', '');
            el.setAttribute('webkit-playsinline', '');
            if (normalizeEnabled) ensureNormalizeGraph(el);
        });

        bindForcePlay();
        return host;
    }

    function bindForcePlay() {
        if (forceBound) return;
        forceBound = true;

        const onPause = (e) => {
            if (allowPause || syncGate) return;
            if (!activeSong?.mediaUrl || !activeSong.startedAt) return;
            const el = e.target;
            // Immediately resume — room playback is always live
            forcePlay(el, activeSong);
        };

        document.addEventListener('pause', onPause, true);

        // Keep kicking play while a track is active
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || !activeSong?.startedAt) return;
            if (syncGate) return;
            const el = activeElement(activeSong);
            if (!el) return;
            seekMedia(el, playOffset(activeSong)).then(() => forcePlay(el, activeSong));
        });

        window.addEventListener('pageshow', () => {
            if (!activeSong) return;
            forceSeekToServer(activeSong);
            forcePlay(activeElement(activeSong), activeSong);
        });

        // First user gesture unlocks unmuted autoplay + AudioContext resume
        const unlock = () => {
            const ctx = ensureAudioContext();
            if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
            if (videoEl) ensureNormalizeGraph(videoEl);
            if (audioEl) ensureNormalizeGraph(audioEl);
            if (!activeSong) return;
            forcePlay(activeElement(activeSong), activeSong, { preferUnmuted: true });
        };
        document.addEventListener('pointerdown', unlock, { once: true, capture: true });
        document.addEventListener('keydown', unlock, { once: true, capture: true });
    }

    function setLoadingText(title, sub) {
        if (!loadingEl) return;
        const $title = loadingEl.querySelector('.stage-media__loading-title');
        const $sub = loadingEl.querySelector('.stage-media__loading-sub');
        if ($title) $title.textContent = title || 'Preparing media…';
        if ($sub) $sub.textContent = sub || '';
    }

    function stopDriftWatch() {
        if (driftTimer) {
            clearInterval(driftTimer);
            driftTimer = null;
        }
        if (playRetryTimer) {
            clearInterval(playRetryTimer);
            playRetryTimer = null;
        }
    }

    function pauseForTeardown(el) {
        if (!el) return;
        allowPause = true;
        try {
            el.pause();
        } catch {
            // ignore
        }
        allowPause = false;
    }

    function hideAll() {
        const host = ensureShell();
        if (!host) return;
        stopDriftWatch();
        host.classList.remove('has-media', 'is-loading', 'mode-video', 'mode-audio', 'mode-artwork');
        playingUrl = null;
        activeSong = null;
        if (loadingEl) loadingEl.hidden = true;
        if (videoEl) {
            pauseForTeardown(videoEl);
            videoEl.removeAttribute('src');
            videoEl.load();
            videoEl.hidden = true;
        }
        if (audioEl) {
            pauseForTeardown(audioEl);
            audioEl.removeAttribute('src');
            audioEl.load();
        }
        if (artEl) {
            artEl.removeAttribute('src');
            artEl.hidden = true;
        }
    }

    function playOffset(song) {
        if (!song?.startedAt) return 0;
        const elapsed = (Date.now() - Number(song.startedAt)) / 1000;
        if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
        const duration = Number(song.duration);
        if (Number.isFinite(duration) && duration > 0) {
            return Math.min(elapsed, Math.max(0, duration - 0.25));
        }
        return elapsed;
    }

    function seekMedia(el, offsetSec) {
        if (!el || !Number.isFinite(offsetSec)) return Promise.resolve();

        const apply = () => {
            try {
                const max = Number.isFinite(el.duration) && el.duration > 0
                    ? Math.max(0, el.duration - 0.25)
                    : offsetSec;
                el.currentTime = Math.min(Math.max(0, offsetSec), max);
            } catch {
                // ignore seek errors before metadata
            }
        };

        if (el.readyState >= 1) {
            apply();
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const done = () => {
                apply();
                resolve();
            };
            el.addEventListener('loadedmetadata', done, { once: true });
            setTimeout(done, 2500);
        });
    }

    function activeElement(song) {
        if (!song) return null;
        if (song.playMode === 'audio') return audioEl;
        return videoEl;
    }

    function applyVolume(el, level01) {
        if (!el) return;
        const desired = Math.max(0, Math.min(1, Number(level01) || 0));
        el.volume = Math.min(1, desired * OUTPUT_GAIN);
        el.muted = desired <= 0;
    }

    /**
     * Never leave media paused while a room track is active.
     * Falls back to muted autoplay if the browser blocks unmuted play (then restores volume).
     */
    async function forcePlay(el, song, options = {}) {
        if (!el || !song?.mediaUrl || !song.startedAt) return false;
        if (allowPause || syncGate) return false;

        ensureNormalizeGraph(el);
        const ctx = ensureAudioContext();
        if (ctx?.state === 'suspended') ctx.resume().catch(() => {});

        const preferUnmuted = options.preferUnmuted !== false;
        const targetVol = desiredVolume;

        const tryPlay = async (muted) => {
            el.muted = !!muted;
            if (!muted) applyVolume(el, targetVol);
            try {
                await el.play();
                return true;
            } catch {
                return false;
            }
        };

        if (preferUnmuted) {
            if (await tryPlay(false)) {
                applyVolume(el, targetVol);
                return true;
            }
        }

        // Autoplay policy: start muted, then unmute as soon as possible
        if (await tryPlay(true)) {
            // Restore audible volume shortly after (and on next gesture via unlock)
            setTimeout(() => {
                if (!activeSong || activeSong.id !== song.id) return;
                applyVolume(el, targetVol);
                el.play().catch(() => {});
            }, 250);
            return true;
        }

        return false;
    }

    function forceSeekToServer(song) {
        const el = activeElement(song);
        if (!el || !song?.startedAt || !song.mediaUrl) return Promise.resolve();
        const target = playOffset(song);
        if (Math.abs((el.currentTime || 0) - target) < 0.75) return Promise.resolve();
        return seekMedia(el, target);
    }

    function startKeepAlive(song) {
        stopDriftWatch();
        if (!song?.mediaUrl || !song.startedAt) return;

        driftTimer = setInterval(() => {
            if (!activeSong || activeSong.id !== song.id || syncGate) return;
            const el = activeElement(activeSong);
            if (!el || !activeSong.startedAt) return;

            const target = playOffset(activeSong);
            const drift = Math.abs((el.currentTime || 0) - target);
            if (drift > 1.5) {
                seekMedia(el, target).then(() => {
                    if (el.paused) forcePlay(el, activeSong);
                });
                return;
            }

            // Never stay paused once synced
            if (el.paused) {
                forcePlay(el, activeSong);
            }
        }, 1000);

        // Extra aggressive retries right after load/refresh
        let tries = 0;
        playRetryTimer = setInterval(() => {
            tries += 1;
            if (!activeSong || activeSong.id !== song.id || tries > 12 || syncGate) {
                if (playRetryTimer) {
                    clearInterval(playRetryTimer);
                    playRetryTimer = null;
                }
                return;
            }
            const el = activeElement(activeSong);
            if (el && el.paused && activeSong.startedAt) {
                forcePlay(el, activeSong);
            }
        }, 400);
    }

    function showArtwork(host, song) {
        stopDriftWatch();
        host.classList.add('has-media', 'mode-artwork');
        host.classList.remove('is-loading', 'mode-video', 'mode-audio');
        if (loadingEl) loadingEl.hidden = true;
        if (videoEl) videoEl.hidden = true;
        if (artEl) {
            const src = song.artworkUrl || song.thumbnailUrl || '';
            if (src) {
                artEl.src = src;
                artEl.hidden = false;
            } else {
                artEl.hidden = true;
            }
        }
    }

    function showDownloadLoading(host, song) {
        stopDriftWatch();
        host.classList.add('has-media', 'is-loading', 'mode-artwork');
        host.classList.remove('mode-video', 'mode-audio');
        if (loadingEl) loadingEl.hidden = false;

        const hours = (Number(song.duration) || 0) / 3600;
        if (hours >= 1) {
            setLoadingText(
                'Downloading large video…',
                `~${hours.toFixed(1)}h track — playback starts when the download finishes`
            );
        } else if ((Number(song.duration) || 0) >= 20 * 60) {
            setLoadingText(
                'Downloading media…',
                'Long track — hang tight, it will start automatically'
            );
        } else {
            setLoadingText('Downloading media…', 'Playback starts when ready');
        }

        if (artEl) {
            const src = song.artworkUrl || song.thumbnailUrl || '';
            if (src) {
                artEl.src = src;
                artEl.hidden = false;
            } else {
                artEl.hidden = true;
            }
        }
        if (videoEl) {
            pauseForTeardown(videoEl);
            videoEl.hidden = true;
        }
        if (audioEl) pauseForTeardown(audioEl);
        playingUrl = null;
    }

    async function startAtServerTime(el, song, host) {
        if (!el || !song?.mediaUrl || !song.startedAt) {
            syncGate = false;
            return;
        }

        syncGate = true;
        allowPause = true;
        try {
            try { el.pause(); } catch { /* ignore */ }
            el.muted = true;
            el.volume = 0;

            let target = playOffset(song);
            await seekMedia(el, target);

            // Retry seek once — browsers sometimes ignore the first currentTime set
            target = playOffset(song);
            if (Math.abs((el.currentTime || 0) - target) > 0.8) {
                await seekMedia(el, target);
            }
        } finally {
            allowPause = false;
            syncGate = false;
        }

        // Only become audible after we are near the room position
        applyVolume(el, desiredVolume);
        await forcePlay(el, song);

        const again = playOffset(song);
        if (Math.abs((el.currentTime || 0) - again) > 0.8) {
            await seekMedia(el, again);
            await forcePlay(el, song);
        }

        requestAnimationFrame(() => {
            if (playingUrl !== song.mediaUrl || activeSong?.id !== song.id) return;
            const finalTarget = playOffset(song);
            if (Math.abs((el.currentTime || 0) - finalTarget) > 0.8) {
                seekMedia(el, finalTarget);
            }
            forcePlay(el, song);
            host.classList.remove('is-loading');
            if (loadingEl) loadingEl.hidden = true;
            startKeepAlive(song);
        });
    }

    function playFile(host, song, mode) {
        const el = mode === 'audio' ? audioEl : videoEl;
        if (!el || !song.mediaUrl) {
            showArtwork(host, song);
            return;
        }

        // Wait for server clock before any playback (avoids hearing 0:00 then seek)
        if (!song.startedAt) {
            showDownloadLoading(host, song);
            setLoadingText('Waiting for playback…', 'Syncing room position');
            return;
        }

        activeSong = song;
        el.autoplay = false;

        const sameSrc = playingUrl === song.mediaUrl
            && el.src
            && el.src.includes(song.mediaUrl);

        if (sameSrc) {
            host.classList.add('is-loading');
            if (loadingEl) loadingEl.hidden = false;
            setLoadingText('Syncing playback…', 'Joining at the room position');
            startAtServerTime(el, song, host);
            return;
        }

        host.classList.add('has-media', 'is-loading');
        host.classList.remove('mode-artwork');
        host.classList.toggle('mode-video', mode === 'video');
        host.classList.toggle('mode-audio', mode === 'audio');
        if (loadingEl) loadingEl.hidden = false;
        setLoadingText('Syncing playback…', 'Joining at the room position');

        if (mode === 'video' && videoEl) {
            videoEl.hidden = false;
            if (artEl) artEl.hidden = true;
        } else {
            if (videoEl) videoEl.hidden = true;
            if (artEl) {
                const src = song.artworkUrl || song.thumbnailUrl || '';
                if (src) {
                    artEl.src = src;
                    artEl.hidden = false;
                }
            }
        }

        // Hold silent until seek completes — never autoplay from 0
        allowPause = true;
        try { el.pause(); } catch { /* ignore */ }
        el.muted = true;
        el.volume = 0;
        playingUrl = song.mediaUrl;
        el.src = song.mediaUrl;
        el.preload = 'auto';
        allowPause = false;
        syncGate = true;

        let started = false;
        const onReady = () => {
            if (started || playingUrl !== song.mediaUrl) return;
            started = true;
            startAtServerTime(el, song, host);
        };

        // Safety: don't leave syncGate stuck if media never becomes ready
        setTimeout(() => {
            if (!started && playingUrl === song.mediaUrl) onReady();
        }, 4000);

        if (el.readyState >= 2) {
            onReady();
        } else {
            el.addEventListener('canplay', onReady, { once: true });
            el.addEventListener('loadeddata', onReady, { once: true });
            el.load();
            // Keep paused if the browser tries to start before seek
            const earlyGuard = () => {
                if (!syncGate) {
                    el.removeEventListener('playing', earlyGuard);
                    return;
                }
                if (!el.paused) {
                    try { el.pause(); } catch { /* ignore */ }
                }
            };
            el.addEventListener('playing', earlyGuard);
            requestAnimationFrame(() => {
                if (el.readyState >= 2) onReady();
            });
        }
    }

    function syncMedia(song, options = {}) {
        const host = ensureShell();
        if (!host) return;

        if (!song) {
            activeKey = null;
            hideAll();
            return;
        }

        activeSong = song;
        const key = `${song.id}:${song.startedAt || 'wait'}:${song.mediaUrl || ''}:${song.mediaStatus || ''}:${song.playMode || ''}`;
        const force = options.force === true;

        if (!force && key === activeKey) {
            if (!song.startedAt || syncGate) return;
            const el = activeElement(song);
            if (!el) return;
            forceSeekToServer(song).then(() => forcePlay(el, song));
            return;
        }
        activeKey = key;

        if (song.playMode === 'artwork' || song.provider === 'spotify') {
            showArtwork(host, song);
            return;
        }

        const mediaPending = !song.mediaUrl
            || song.mediaStatus === 'pending'
            || song.mediaStatus === 'downloading';

        if (mediaPending && song.mediaStatus !== 'ready') {
            showDownloadLoading(host, song);
            return;
        }

        if (song.mediaStatus === 'ready' && song.mediaUrl) {
            // playFile itself waits when startedAt is missing
            playFile(host, song, song.playMode === 'audio' ? 'audio' : 'video');
            return;
        }

        showDownloadLoading(host, song);
    }

    function onPlayerSeek(song, offsetSec) {
        if (!song?.startedAt || syncGate) return;
        const el = activeElement(song);
        if (!el) return;
        const target = Number.isFinite(offsetSec) ? offsetSec : playOffset(song);
        seekMedia(el, target).then(() => forcePlay(el, song));
    }

    function setMediaVolume(level01) {
        desiredVolume = Math.max(0, Math.min(1, Number(level01) || 0));
        applyVolume(videoEl, desiredVolume);
        applyVolume(audioEl, desiredVolume);
    }

    function getMediaVolume() {
        return desiredVolume;
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.syncMedia = syncMedia;
    global.PlugDJ.forceSyncMedia = (song) => syncMedia(song, { force: true });
    global.PlugDJ.forcePlayMedia = () => {
        if (!activeSong) return;
        forcePlay(activeElement(activeSong), activeSong, { preferUnmuted: true });
    };
    global.PlugDJ.onPlayerSeek = onPlayerSeek;
    global.PlugDJ.setMediaVolume = setMediaVolume;
    global.PlugDJ.getMediaVolume = getMediaVolume;
    global.PlugDJ.setNormalizeVolume = setNormalizeVolume;
    global.PlugDJ.getMediaPlayOffset = playOffset;
})(window);
