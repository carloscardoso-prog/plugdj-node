$(document).ready(function() {

    const panels = {
        music: 'components/music.html',
        playlist: 'components/playlist.html',
        library: 'components/library.html',
        avatar: 'components/avatar.html',
        backgrounds: 'components/backgrounds.html',
        settings: 'components/settings.html?v=normalize1'
    };

    const BG_STORAGE_KEY = 'plugdj-room-bg';
    const AVATAR_STORAGE_KEY = 'plugdj-room-avatar';
    const USERNAME_STORAGE_KEY = 'plugdj-username';
    const ROOM_STORAGE_KEY = 'plugdj-room';

    const roomSlug = (function() {
        const pathPart = String(window.location.pathname || '')
            .replace(/\/+$/, '')
            .split('/')
            .filter(Boolean)[0] || '';
        const queryRoom = new URLSearchParams(window.location.search).get('room') || '';
        const raw = queryRoom || pathPart || localStorage.getItem(ROOM_STORAGE_KEY) || '';
        return (window.PlugDJ && typeof window.PlugDJ.slugify === 'function')
            ? window.PlugDJ.slugify(raw)
            : raw.trim().toLowerCase();
    })();

    if (!roomSlug) {
        window.location.href = '/';
        return;
    }

    // Pretty /slug only on Node (:3000). On Apache keep room.html?room= so refresh works.
    const onNodeServer = String(window.location.port || '') === '3000';
    if (onNodeServer) {
        if (window.location.pathname === '/room.html' || window.location.search.includes('room=')) {
            window.history.replaceState(null, '', `/${roomSlug}`);
        } else if (window.location.pathname !== `/${roomSlug}`) {
            window.history.replaceState(null, '', `/${roomSlug}`);
        }
    }

    localStorage.setItem(ROOM_STORAGE_KEY, roomSlug);

    let CURRENT_USER_NAME = localStorage.getItem(USERNAME_STORAGE_KEY)
        || (window.PlugDJ.getProfile?.()?.displayName || '');

    window.PlugDJ = window.PlugDJ || {};
    window.PlugDJ.setLocalUsername = function(name) {
        CURRENT_USER_NAME = String(name || '').trim().slice(0, 24);
    };

    const avatarSpriteManager = new AvatarSpriteManager();
    const stageSpriteManager = new AvatarSpriteManager();
    const userCardSpriteManager = new AvatarSpriteManager();
    let avatarCatalog = null;
    let backgroundsCatalog = null;
    const USER_CARD_AVATAR_H = 88;
    const USER_CARD_HIDE_DELAY = 80;
    let userCardHideTimer = null;
    let userCardShowToken = 0;

    function applyImageBackground(file, id, sync = true) {
        const img = new Image();
        img.onload = function() {
            document.documentElement.style.setProperty('--room-bg-aspect', img.naturalWidth / img.naturalHeight);
            setRoomBackground(`url('${file}')`, id, 'image', sync);
        };
        img.src = file;
    }

    function setRoomBackground(value, id, type, sync = true) {
        document.documentElement.style.setProperty('--room-bg-image', value);
        document.documentElement.classList.toggle('room-bg--gradient', type === 'gradient');
        if (id) {
            localStorage.setItem(BG_STORAGE_KEY, id);
            if (sync && window.PlugDJ && typeof window.PlugDJ.changeBackground === 'function') {
                window.PlugDJ.changeBackground(id);
            }
        }
        $('.bg-option').removeClass('active');
        if (id) {
            $(`.bg-option[data-bg="${id}"]`).addClass('active');
        }
        updateLayoutFill();
    }

    function restoreRoomBackground() {
        const savedId = localStorage.getItem(BG_STORAGE_KEY);
        const legacyMap = { 'neon-city': 'bg-neon-city' };
        const id = legacyMap[savedId] || savedId;
        if (!id) return;

        function tryApply(list) {
            const bg = list.find(function(item) { return item.id === id; });
            if (bg) applyImageBackground(bg.file, bg.id, false);
        }

        if (backgroundsCatalog) {
            tryApply(backgroundsCatalog);
            return;
        }

        $.getJSON('assets/bg/backgrounds.json').done(function(data) {
            backgroundsCatalog = data.backgrounds || [];
            tryApply(backgroundsCatalog);
        });
    }

    window.PlugDJ = window.PlugDJ || {};
    window.PlugDJ.applyBackgroundById = function(id) {
        function tryApply(list) {
            const bg = list.find(function(item) { return item.id === id; });
            if (bg) applyImageBackground(bg.file, bg.id, false);
        }

        if (backgroundsCatalog) {
            tryApply(backgroundsCatalog);
            return;
        }

        $.getJSON('assets/bg/backgrounds.json').done(function(data) {
            backgroundsCatalog = data.backgrounds || [];
            tryApply(backgroundsCatalog);
        });
    };

    restoreRoomBackground();

    function updateRoomBgFit() {
        const stage = document.querySelector('.stage');
        const fit = document.querySelector('.room-bg__fit');
        if (!stage || !fit) return;

        const rect = stage.getBoundingClientRect();
        fit.style.top = `${rect.top}px`;
        fit.style.left = `${rect.left}px`;
        fit.style.width = `${rect.width}px`;
        fit.style.height = `${rect.height}px`;

        // Same frame as the image resize: no desync between bg and characters
        updateStageGroundLine(rect);
    }

    // Standing line = top surface of the painted DJ table (fraction of image height).
    // Tuned so avatar feet land on the deck; bump up to lower characters on screen.
    // Per-background overrides can move to backgrounds.json if needed.
    const STAGE_TABLE_BASE_RATIO = 0.91;

    function updateStageGroundLine(stageRect) {
        const area = document.querySelector('.stage-area');
        if (!area) return;

        const root = document.documentElement;
        const isGradient = root.classList.contains('room-bg--gradient');
        const imgAR = parseFloat(getComputedStyle(root).getPropertyValue('--room-bg-aspect')) || (16 / 9);

        let groundY;
        if (isGradient) {
            groundY = stageRect.top + stageRect.height * STAGE_TABLE_BASE_RATIO;
        } else {
            const stageAR = stageRect.width / stageRect.height;
            let imgH;
            let imgTop;
            if (stageAR > imgAR) {
                imgH = stageRect.height;
                imgTop = stageRect.top;
            } else {
                imgH = stageRect.width / imgAR;
                imgTop = stageRect.top + (stageRect.height - imgH) / 2;
            }
            groundY = imgTop + imgH * STAGE_TABLE_BASE_RATIO;
        }

        const areaRect = area.getBoundingClientRect();
        root.style.setProperty('--stage-ground-top', `${Math.round(groundY - areaRect.top)}px`);
    }

    function getStageWidth() {
        const stage = document.querySelector('.stage');
        if (stage) {
            return stage.getBoundingClientRect().width;
        }

        const root = getComputedStyle(document.documentElement);
        const sidebarW = parseFloat(root.getPropertyValue('--sidebar-w')) || 0;
        const chatW = parseFloat(root.getPropertyValue('--chat-w')) || 0;
        const chatEl = document.querySelector('.chat');
        const chatVisible = chatEl && getComputedStyle(chatEl).display !== 'none';
        return window.innerWidth - sidebarW - (chatVisible ? chatW : 0);
    }

    function updateLayoutFill() {
        const root = document.documentElement;
        const styles = getComputedStyle(root);
        const headerH = parseFloat(styles.getPropertyValue('--header-h')) || 52;
        const playerMin = parseFloat(styles.getPropertyValue('--player-min-h')) || 84;
        const imgAR = parseFloat(styles.getPropertyValue('--room-bg-aspect')) || (16 / 9);
        const isGradient = root.classList.contains('room-bg--gradient');
        const available = window.innerHeight - headerH;

        let playerH = playerMin;

        if (!isGradient) {
            const stageW = getStageWidth();
            const imgH = stageW / imgAR;
            const stageHAtMin = available - playerMin;

            // Stage height = imgH (image fills width); player absorbs all space below
            if (imgH < stageHAtMin) {
                playerH = Math.max(playerMin, Math.ceil(available - imgH));
            }
        }

        root.style.setProperty('--player-h', `${Math.round(playerH)}px`);
        scheduleStageLayoutSync();
    }

    function scheduleStageLayoutSync() {
        requestAnimationFrame(updateRoomBgFit);
    }

    updateLayoutFill();
    $(window).on('resize', updateLayoutFill);

    const $app = document.querySelector('.app');
    if ($app && window.ResizeObserver) {
        new ResizeObserver(updateLayoutFill).observe($app);
    }

    const $stage = document.querySelector('.stage');
    if ($stage && window.ResizeObserver) {
        // Recalc ground line as soon as the stage box moves/resizes (live resize)
        new ResizeObserver(scheduleStageLayoutSync).observe($stage);
    }

    let activePanel = null;
    const $sidePanel = $('#side-panel');

    function closeSidePanel() {
        if (activePanel === 'avatar') {
            avatarSpriteManager.destroyAll();
        }
        $sidePanel.removeClass('open panel-avatar');
        $('.side-btn').removeClass('active');
        setTimeout(function() {
            if (!$sidePanel.hasClass('open')) {
                $sidePanel.empty();
                activePanel = null;
            }
        }, 420);
    }

    function openSidePanel(name, options) {
        const force = options && options.force === true;

        // Side-nav toggle: clicking the active panel closes it
        if (!force && activePanel === name) {
            closeSidePanel();
            return;
        }

        // Already open on the requested panel — just refresh contents
        if (force && activePanel === name && $sidePanel.hasClass('open')) {
            if (name === 'library' || name === 'playlist' || name === 'music') {
                window.PlugDJ.getLibraryUI?.()?.renderAll();
            }
            return;
        }

        const wasOpen = $sidePanel.hasClass('open');
        $sidePanel.removeClass('panel-avatar');

        $sidePanel.load(panels[name], function() {
            if (name === 'avatar') {
                $sidePanel.addClass('panel-avatar');
                initAvatarPanel();
            }
            if (name === 'backgrounds') {
                initBackgroundsPanel();
            }
            if (name === 'library' || name === 'playlist' || name === 'music') {
                window.PlugDJ.getLibraryUI?.()?.renderAll();
            }
            if (name === 'settings') {
                window.PlugDJ.openSettingsPanel?.();
            }
            if (!wasOpen) {
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                        $sidePanel.addClass('open');
                    });
                });
            } else {
                $sidePanel.addClass('open');
            }
            $('.side-btn').removeClass('active');
            $(`.side-btn[data-panel="${name}"]`).addClass('active');
            activePanel = name;
        });
    }

    window.PlugDJ = window.PlugDJ || {};
    window.PlugDJ.openSidePanel = openSidePanel;
    window.PlugDJ.openLibraryPanel = function() {
        openSidePanel('library', { force: true });
    };
    window.PlugDJ.openPlaylistPanel = function() {
        openSidePanel('playlist', { force: true });
    };

    $('.side-btn[data-panel]').click(function() {
        openSidePanel($(this).data('panel'));
    });

    $(document).on('click', '.panel-close', closeSidePanel);

    $(document).on('click', '.bg-option', function() {
        if (window.PlugDJ?.roomClient && !window.PlugDJ.roomClient.isAdmin()) {
            showToast('Only the room admin can change the background');
            return;
        }
        const $btn = $(this);
        applyImageBackground($btn.data('bgFile'), $btn.data('bg'), true);
    });

    function pickVariant(variants) {
        const hasNormal = variants.normal;
        const hasB = variants.b;
        if (hasNormal && hasB) {
            return Math.random() < 0.5 ? variants.normal : variants.b;
        }
        return hasNormal || hasB;
    }

    function pickVariantWithKey(variants) {
        const hasNormal = variants.normal;
        const hasB = variants.b;
        if (hasNormal && hasB) {
            const key = Math.random() < 0.5 ? 'normal' : 'b';
            return { key: key, variant: variants[key] };
        }
        if (hasNormal) return { key: 'normal', variant: variants.normal };
        if (hasB) return { key: 'b', variant: variants.b };
        return { key: null, variant: null };
    }

    function pickVariantForUser(variants, name) {
        const hasNormal = variants.normal;
        const hasB = variants.b;
        if (hasNormal && hasB) {
            return hashString(name + ':variant') % 2 === 0 ? variants.normal : variants.b;
        }
        return hasNormal || hasB;
    }

    const AVATAR_SHEET_FRAMES = 24;
    const AVATAR_DJ_FRAMES = 20;
    const AVATAR_IDLE_FRAMES = 4;
    const AVATAR_DANCE_START = 4;
    const AVATAR_DANCE_END = 23;
    const AVATAR_IDLE_FPS = 12;
    const AVATAR_IDLE_CYCLE_MS = 5000;
    const AVATAR_IDLE_REPEATS = 2;
    const AVATAR_DANCE_FPS = 12;
    const AVATAR_PREVIEW_MIN_H = 150;
    const STAGE_CHAR_H = 120;
    const STAGE_CHAR_DJ_H = 165;

    const stageUsers = new Map();
    let djCanvasMounted = false;
    let currentDjState = { id: null, avatar: null };

    /** Server assigns stageLeft/stageBottom on join — client never invents positions. */
    function stagePosFromUser(user) {
        if (!Number.isFinite(user?.stageLeft) || !Number.isFinite(user?.stageBottom)) {
            return null;
        }
        return { left: user.stageLeft, bottom: user.stageBottom };
    }

    function getFloorSpecForUser(user) {
        const avatar = findAvatarById(user.avatar || getSavedAvatarId());
        if (!avatar) return null;
        const variant = pickVariantForUser(avatar.variants, user.username);
        if (!variant) return null;
        return buildSpriteSpec(variant);
    }

    function getDjSpecForUser(user) {
        const avatar = findAvatarById(user.avatar || getSavedAvatarId());
        if (!avatar?.variants?.dj) return null;
        return Object.assign({}, buildSpriteSpec(avatar.variants.dj), { initialMode: 'dance' });
    }

    /** Hide crowd sprite (e.g. while user is DJ). Server still owns their position. */
    function hideStageUser(userId) {
        const entry = stageUsers.get(userId);
        if (!entry) return;
        stageSpriteManager.unmount(entry.canvas);
        entry.$el.remove();
        stageUsers.delete(userId);
    }

    function removeStageUser(userId) {
        hideStageUser(userId);
    }

    function setStageUserMode(userId, mode) {
        const entry = stageUsers.get(userId);
        if (!entry) return;
        stageSpriteManager.forceSetMode(entry.canvas, mode);
    }

    function mountFloorUser(user, mode) {
        const pos = stagePosFromUser(user);
        if (!pos) return;

        const spec = getFloorSpecForUser(user);
        if (!spec) return;

        const $crowd = $('.stage-characters-crowd');
        if (!$crowd.length) return;

        const existing = stageUsers.get(user.id);
        if (existing && existing.$el.parent()[0] === $crowd[0]) {
            existing.$el.css({
                left: pos.left + '%',
                bottom: pos.bottom + '%',
                zIndex: stageDepthZIndex(pos.bottom)
            });
            existing.pos = pos;
            setStageUserMode(user.id, mode || 'idle');
            return;
        }

        if (existing) hideStageUser(user.id);

        const size = displaySizeFromSpec(spec, STAGE_CHAR_H);
        const $char = $('<div class="stage-char stage-char--crowd"></div>')
            .attr('data-user-id', user.id)
            .attr('data-avatar', user.avatar)
            .css({
                left: pos.left + '%',
                bottom: pos.bottom + '%',
                zIndex: stageDepthZIndex(pos.bottom)
            });

        const $sprite = $('<div class="stage-char__sprite"></div>')
            .attr('data-display-w', size.width)
            .attr('data-display-h', size.height)
            .css({
                width: size.width + 'px',
                height: size.height + 'px'
            });
        const canvas = $('<canvas></canvas>')[0];
        canvas.style.width = size.width + 'px';
        canvas.style.height = size.height + 'px';
        $sprite.append(canvas);
        $char.append($sprite);
        $crowd.append($char);

        stageSpriteManager.mountImmediate(canvas, Object.assign({}, spec, {
            initialMode: mode || 'idle',
            lockMode: false
        }));

        stageUsers.set(user.id, {
            $el: $char,
            canvas,
            userId: user.id,
            username: user.username,
            pos
        });
    }

    function showDjUser(user) {
        if (currentDjState.id === user.id && currentDjState.avatar === user.avatar && djCanvasMounted) {
            return;
        }

        currentDjState = { id: user.id, avatar: user.avatar };

        const spec = getDjSpecForUser(user);
        if (!spec) return;

        const $djWrap = $('.stage-char--dj').removeAttr('hidden');
        const canvas = $djWrap.find('canvas')[0];
        sizeStageChar($djWrap, spec, STAGE_CHAR_DJ_H);

        if (djCanvasMounted) {
            stageSpriteManager.unmount(canvas);
        }
        stageSpriteManager.mountStage(canvas, spec);
        djCanvasMounted = true;
    }

    function hideDjSlot() {
        currentDjState = { id: null, avatar: null };
        const $djWrap = $('.stage-char--dj');
        const canvas = $djWrap.find('canvas')[0];
        if (djCanvasMounted && canvas) {
            stageSpriteManager.unmount(canvas);
            djCanvasMounted = false;
        }
        $djWrap.attr('hidden', '');
    }

    function syncStage(state) {
        if (!avatarCatalog || !state?.room) return;

        const room = state.room;
        const djId = room.currentDJ?.id || null;
        const usersById = new Map(room.users.map(function(u) { return [u.id, u]; }));

        // Left the room → unmount. Became DJ → hide crowd (server keeps stageLeft/Bottom).
        stageUsers.forEach(function(entry, userId) {
            if (!usersById.has(userId)) {
                removeStageUser(userId);
            } else if (userId === djId) {
                hideStageUser(userId);
            }
        });

        if (djId && usersById.has(djId)) {
            showDjUser(usersById.get(djId));
        } else {
            hideDjSlot();
        }

        room.users.forEach(function(user) {
            if (user.id === djId) return;
            if (!stagePosFromUser(user)) return;

            if (stageUsers.has(user.id)) {
                const entry = stageUsers.get(user.id);
                const pos = stagePosFromUser(user);
                const moved = !entry.pos
                    || entry.pos.left !== pos.left
                    || entry.pos.bottom !== pos.bottom;
                if (entry.$el.attr('data-avatar') !== user.avatar || moved) {
                    hideStageUser(user.id);
                    mountFloorUser(user, user.liked ? 'dance' : 'idle');
                } else {
                    setStageUserMode(user.id, user.liked ? 'dance' : 'idle');
                }
                return;
            }

            mountFloorUser(user, user.liked ? 'dance' : 'idle');
        });
    }

    function initStageSystem() {
        const $crowd = $('.stage-characters-crowd');
        $crowd.empty();
        stageUsers.clear();
        hideDjSlot();
    }

    window.PlugDJ.syncStage = syncStage;

    function stageDepthZIndex(bottomPercent) {
        return Math.round(100 - bottomPercent);
    }

    function buildSpriteSpec(variant) {
        const sheetFrames = Number(variant.frames) > 0
            ? Number(variant.frames)
            : (/_dj\.png$|old-dj-/.test(variant.file) ? AVATAR_DJ_FRAMES : AVATAR_SHEET_FRAMES);
        const frameWidth = Number(variant.frameWidth) > 0
            ? Number(variant.frameWidth)
            : (Number(variant.sheetWidth) / sheetFrames);
        const frameHeight = Number(variant.frameHeight) > 0
            ? Number(variant.frameHeight)
            : Number(variant.sheetHeight);
        const idleFrames = variant.idleFrames != null
            ? Number(variant.idleFrames)
            : (/_dj\.png$|old-dj-/.test(variant.file) ? 0 : AVATAR_IDLE_FRAMES);
        const isDj = idleFrames === 0;

        if (isDj) {
            const danceStart = variant.danceStart != null ? Number(variant.danceStart) : 0;
            const danceEnd = variant.danceEnd != null ? Number(variant.danceEnd) : (sheetFrames - 1);
            const danceFps = Number(variant.danceFps) || AVATAR_DANCE_FPS;
            return {
                src: 'assets/avatars/' + variant.file,
                frames: sheetFrames,
                idleFrames: 0,
                danceStart: danceStart,
                danceEnd: danceEnd,
                danceFps: danceFps,
                frameWidth: frameWidth,
                frameHeight: frameHeight,
                fps: danceFps,
                isDj: true
            };
        }

        const danceStart = variant.danceStart != null ? Number(variant.danceStart) : AVATAR_DANCE_START;
        const danceEnd = variant.danceEnd != null ? Number(variant.danceEnd) : AVATAR_DANCE_END;
        const idleFps = Number(variant.idleFps) || AVATAR_IDLE_FPS;
        const danceFps = Number(variant.danceFps) || AVATAR_DANCE_FPS;
        return {
            src: 'assets/avatars/' + variant.file,
            frames: sheetFrames,
            idleFrames: idleFrames,
            danceStart: danceStart,
            danceEnd: danceEnd,
            idleFps: idleFps,
            idleCycleMs: Number(variant.idleCycleMs) || AVATAR_IDLE_CYCLE_MS,
            idleRepeats: Number(variant.idleRepeats) || AVATAR_IDLE_REPEATS,
            danceFps: danceFps,
            freezeIdle: !!variant.freezeIdle || idleFrames <= 1,
            frameWidth: frameWidth,
            frameHeight: frameHeight,
            fps: danceFps,
            isDj: false
        };
    }

    function getSpriteSpec(avatarId, variant) {
        return buildSpriteSpec(variant);
    }

    function displaySizeFromSpec(spec, targetHeight) {
        const scale = targetHeight / spec.frameHeight;
        return {
            width: Math.round(spec.frameWidth * scale),
            height: targetHeight
        };
    }

    function previewDisplaySize(frameWidth, frameHeight) {
        return displaySizeFromSpec({ frameWidth: frameWidth, frameHeight: frameHeight }, AVATAR_PREVIEW_MIN_H);
    }

    function pickRandom(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    function pickUniqueRandom(list, excludeId) {
        if (list.length <= 1) return list[0];
        let pick = pickRandom(list);
        while (pick.id === excludeId) {
            pick = pickRandom(list);
        }
        return pick;
    }

    function ensureStageSpriteWrap($el) {
        let $sprite = $el.children('.stage-char__sprite');
        if ($sprite.length) return $sprite;

        const $canvas = $el.children('canvas').first();
        if (!$canvas.length) return $();

        $sprite = $('<div class="stage-char__sprite"></div>');
        $canvas.appendTo($sprite);
        $el.append($sprite);
        return $sprite;
    }

    function sizeStageChar($el, spec, height) {
        const size = displaySizeFromSpec(spec, height);
        const $sprite = ensureStageSpriteWrap($el);
        $sprite.attr('data-display-w', size.width);
        $sprite.attr('data-display-h', size.height);
        $sprite.css({ width: size.width + 'px', height: size.height + 'px' });
        $sprite.find('canvas').each(function() {
            this.style.width = size.width + 'px';
            this.style.height = size.height + 'px';
        });
    }

    function getSavedAvatarId() {
        return localStorage.getItem(AVATAR_STORAGE_KEY) || '80s01';
    }

    function findAvatarById(id) {
        if (!avatarCatalog) return null;
        return avatarCatalog.find(function(a) { return a.id === id; }) || null;
    }

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    function avatarIdForUser(name) {
        if (name === CURRENT_USER_NAME) {
            return getSavedAvatarId();
        }

        const frontAvatars = (avatarCatalog || []).filter(function(a) {
            return a.variants.normal || a.variants.b;
        });
        if (!frontAvatars.length) return getSavedAvatarId();
        return frontAvatars[hashString(name) % frontAvatars.length].id;
    }

    function getUserCardSpec(avatarId, userName, variantKey) {
        const avatar = findAvatarById(avatarId);
        if (!avatar) return null;
        let variant;
        if (variantKey && avatar.variants[variantKey]) {
            variant = avatar.variants[variantKey];
        } else if (userName) {
            variant = pickVariantForUser(avatar.variants, userName);
        } else {
            variant = pickVariant(avatar.variants);
        }
        if (!variant) return null;
        return buildSpriteSpec(variant);
    }

    function getUserCardAnchor($el) {
        const $sprite = $el.find('.stage-char__sprite').first();
        if ($sprite.length) return $sprite;
        const $canvas = $el.find('canvas').first();
        return $canvas.length ? $canvas : $el;
    }

    function positionUserCard($anchor) {
        const $card = $('#user-card');
        const rect = getUserCardAnchor($anchor)[0].getBoundingClientRect();
        const cardW = $card.outerWidth();
        const cardH = $card.outerHeight();
        const gap = 10;
        let left = rect.left + (rect.width / 2) - (cardW / 2);
        let top = rect.top - cardH - gap;

        if (top < 8) {
            top = rect.bottom + gap;
        }

        left = Math.max(8, Math.min(left, window.innerWidth - cardW - 8));
        top = Math.max(8, Math.min(top, window.innerHeight - cardH - 8));

        $card.css({ left: left + 'px', top: top + 'px' });
    }

    let userCardTargetUser = null;

    function setCardBtnVisible($btn, visible) {
        if (visible) $btn.removeAttr('hidden');
        else $btn.attr('hidden', '');
    }

    function isTargetOwner(state, name, targetUser) {
        const owner = state?.room?.users.find(function(u) { return u.role === 'owner'; });
        if (targetUser.role === 'owner') return true;
        if (targetUser.clientId && owner?.clientId && targetUser.clientId === owner.clientId) return true;
        const ownerUsername = owner?.username || state?.room?.hostUsername;
        return !!(ownerUsername && ownerUsername === name && !targetUser.clientId);
    }

    function updateUserCardActions(targetUser, name) {
        const $actions = $('#user-card-actions');
        const isOwner = window.PlugDJ?.isRoomOwner?.();
        const state = window.PlugDJ?.getRoomState?.();
        const targetIsOwner = isTargetOwner(state, name, targetUser);
        const selfState = state;
        const selfClientId = selfState?.selfClientId
            || selfState?.room?.users?.find(function(u) { return u.id === selfState?.selfId; })?.clientId;
        const isSelf = (targetUser.clientId && selfClientId && targetUser.clientId === selfClientId)
            || (!targetUser.clientId && name === CURRENT_USER_NAME);
        const canManage = isOwner && !targetIsOwner && !isSelf;

        if (!canManage) {
            $actions.attr('hidden', '');
            return false;
        }

        const mod = state?.room?.moderation || { bans: [], mutes: [] };
        const clientId = targetUser.clientId || null;
        const isMuted = mod.mutes.some(function(m) {
            return (clientId && m.clientId === clientId) || m.username === name;
        });
        const isBanned = mod.bans.some(function(b) {
            return (clientId && b.clientId === clientId) || b.username === name;
        });

        setCardBtnVisible($actions.find('[data-action="make-admin"]'), targetUser.role !== 'admin');
        setCardBtnVisible($actions.find('[data-action="remove-admin"]'), targetUser.role === 'admin');
        setCardBtnVisible($actions.find('[data-action="mute-10"]'), !isMuted && !isBanned);
        setCardBtnVisible($actions.find('[data-action="ban"]'), !isBanned);
        setCardBtnVisible($actions.find('[data-action="unmute"]'), isMuted);
        setCardBtnVisible($actions.find('[data-action="unban"]'), isBanned);

        $actions.find('.user-card__group--role').removeAttr('hidden');
        $actions.find('.user-card__group--moderate').removeAttr('hidden');
        $actions.removeAttr('hidden');
        return true;
    }

    function showUserCard($anchor, userName) {
        const name = userName || $anchor.data('user') || $anchor.find('.msg-user, .list-user').first().text().trim();
        const anchorUserId = $anchor.data('user-id');
        const anchorClientId = $anchor.data('client-id');
        if (!name && !anchorClientId && !anchorUserId) return;

        clearTimeout(userCardHideTimer);
        const token = ++userCardShowToken;
        const avatarId = $anchor.data('avatar') || avatarIdForUser(name);
        const spec = getUserCardSpec(avatarId, name || 'User', $anchor.data('variant'));
        if (!spec) return;

        const state = window.PlugDJ?.getRoomState?.();
        const targetUser = state?.room?.users.find(function(u) {
            if (anchorUserId && u.id === anchorUserId) return true;
            if (anchorClientId && u.clientId === anchorClientId) return true;
            return name && u.username === name;
        });
        userCardTargetUser = targetUser || {
            username: name,
            clientId: anchorClientId || null,
            role: $anchor.data('role') || 'user'
        };

        const size = displaySizeFromSpec(spec, USER_CARD_AVATAR_H);
        const $card = $('#user-card');
        const $preview = $card.find('.user-card__preview');
        const canvas = $card.find('.user-card__canvas')[0];

        $preview.css({ width: size.width + 'px', height: size.height + 'px' });
        $card.find('.user-card__name').text(name);
        $card.find('.user-card__role').text(userCardTargetUser.role || 'user');

        const showActions = updateUserCardActions(userCardTargetUser, name);
        $card.toggleClass('user-card--interactive', !!showActions);

        $card.removeAttr('hidden').attr('aria-hidden', 'false');
        positionUserCard($anchor);

        userCardSpriteManager.mountStatic(canvas, spec).then(function() {
            if (token !== userCardShowToken) return;
            $card.addClass('is-visible');
            positionUserCard($anchor);
        });
    }

    function hideUserCard() {
        clearTimeout(userCardHideTimer);
        userCardHideTimer = setTimeout(function() {
            userCardShowToken++;
            const $card = $('#user-card');
            $card.removeClass('is-visible').attr('hidden', '').attr('aria-hidden', 'true');
            userCardSpriteManager.unmount($card.find('.user-card__canvas')[0]);
        }, USER_CARD_HIDE_DELAY);
    }

    function initUserCardTargets() {
        $('.chat-msg').addClass('user-card-target').each(function() {
            const name = $(this).find('.msg-user').first().text().trim();
            if (name) {
                $(this).attr('data-user', name);
            }
        });
    }

    function bindUserCard() {
        const selector = '.chat-msg, .chat-panel[data-panel="members"] .chat-list li, .chat-panel[data-panel="mod"] .chat-list li, .chat-panel[data-panel="banned"] .chat-list li';

        $(document).on('mouseenter', selector, function() {
            showUserCard($(this));
        });

        $(document).on('mouseleave', selector, function() {
            hideUserCard();
        });

        $(document).on('click', '#user-card-actions .user-card__btn', function() {
            if (!userCardTargetUser) return;
            const action = $(this).data('action');
            const username = userCardTargetUser.username;
            const clientId = userCardTargetUser.clientId || null;

            if (action === 'make-admin') window.PlugDJ.setUserRole?.(username, 'admin', clientId);
            if (action === 'remove-admin') window.PlugDJ.setUserRole?.(username, 'user', clientId);
            if (action === 'mute-10') {
                window.PlugDJ.moderateUser?.({ username, clientId, action: 'mute', durationMinutes: 10 });
            }
            if (action === 'ban') {
                hideUserCard();
                window.PlugDJ.modal.prompt({
                    title: 'Ban user',
                    message: `Ban ${username || 'this user'} from this room?`,
                    confirmLabel: 'Ban',
                    danger: true,
                    fields: [{
                        name: 'reason',
                        label: 'Reason (optional)',
                        type: 'textarea',
                        placeholder: 'Why is this user being banned?',
                        maxlength: 200,
                        rows: 2
                    }],
                    onSubmit(values) {
                        window.PlugDJ.moderateUser?.({
                            username,
                            clientId,
                            action: 'ban',
                            reason: values.reason || ''
                        });
                    }
                });
                return;
            }
            if (action === 'unmute') window.PlugDJ.unpunishUser?.(username, 'mute', clientId);
            if (action === 'unban') window.PlugDJ.unpunishUser?.(username, 'ban', clientId);
            hideUserCard();
        });

        $('#user-card').on('mouseenter', function() {
            clearTimeout(userCardHideTimer);
        }).on('mouseleave', function() {
            hideUserCard();
        });

        $(window).on('scroll resize', function() {
            if ($('#user-card').hasClass('is-visible')) {
                hideUserCard();
            }
        });
    }

    initUserCardTargets();
    bindUserCard();

    loadAvatarCatalog(function() {
        initStageSystem();
    });

    function loadAvatarCatalog(callback, options) {
        const force = options && options.force === true;
        if (avatarCatalog && !force) {
            callback(avatarCatalog);
            return;
        }
        $.getJSON('assets/avatars/avatars.json', { _: Date.now() }).done(function(data) {
            avatarCatalog = data.avatars || [];
            callback(avatarCatalog);
        }).fail(function() {
            console.error('Failed to load avatars.json');
            callback(avatarCatalog || []);
        });
    }

    function buildAvatarGrid(avatars) {
        const groups = {};
        avatars.forEach(function(avatar) {
            if (!avatar.variants.normal && !avatar.variants.b) return;
            const group = avatar.group || 'Other';
            if (!groups[group]) groups[group] = [];
            groups[group].push(avatar);
        });

        const $scroll = $('#avatar-scroll');
        $scroll.empty();

        // Original Models first, then the rest A–Z
        const groupNames = Object.keys(groups).sort(function(a, b) {
            if (a === 'Original Models') return -1;
            if (b === 'Original Models') return 1;
            return a.localeCompare(b);
        });

        groupNames.forEach(function(groupName) {
            const $section = $('<section class="avatar-group"></section>').attr('data-group', groupName);
            $section.append($('<h3 class="avatar-group-title"></h3>').text(groupName));
            const $grid = $('<div class="avatar-grid"></div>');

            groups[groupName].sort(function(a, b) {
                return a.id.localeCompare(b.id, undefined, { numeric: true });
            }).forEach(function(avatar) {
                const displayName = avatar.name || avatar.id;
                const variant = pickVariant(avatar.variants);
                const spec = getSpriteSpec(avatar.id, variant);
                const size = previewDisplaySize(spec.frameWidth, spec.frameHeight);
                const $btn = $('<button class="avatar-option" type="button"></button>')
                    .attr('data-avatar', avatar.id)
                    .attr('data-name', displayName)
                    .attr('data-group', groupName)
                    .attr('title', displayName);
                const $preview = $('<span class="avatar-preview"></span>').css({
                    width: size.width + 'px',
                    height: size.height + 'px'
                });
                const $canvas = $('<canvas></canvas>');
                $preview.append($canvas);
                $btn.append($preview);
                $grid.append($btn);

                avatarSpriteManager.mount($canvas[0], spec);

                $btn.on('mouseenter', function() {
                    avatarSpriteManager.setMode($canvas[0], 'dance');
                });
                $btn.on('mouseleave', function() {
                    avatarSpriteManager.setMode($canvas[0], 'idle');
                });
            });

            $section.append($grid);
            $scroll.append($section);
        });

        const savedId = localStorage.getItem(AVATAR_STORAGE_KEY);
        if (savedId) {
            $(`.avatar-option[data-avatar="${savedId}"]`).addClass('active');
        }
    }

    function initAvatarPanel() {
        avatarSpriteManager.destroyAll();

        function render(list) {
            avatarCatalog = list;
            buildAvatarGrid(list);
        }

        // Always re-fetch so newly added groups (e.g. Original Models) show up
        loadAvatarCatalog(render, { force: true });
    }

    function initBackgroundsPanel() {
        function render(list) {
            const savedId = localStorage.getItem(BG_STORAGE_KEY) || 'bg-neon-city';
            const $list = $('#bg-list');
            $list.empty();

            list.forEach(function(bg) {
                const $item = $('<li></li>');
                const $btn = $('<button class="bg-option" type="button"></button>')
                    .attr('data-bg', bg.id)
                    .attr('data-bg-file', bg.file)
                    .toggleClass('active', bg.id === savedId);
                const $preview = $('<span class="bg-preview"></span>').css('background-image', `url('${bg.file}')`);
                const $label = $('<span class="bg-label"></span>').text(bg.name);
                $btn.append($preview, $label);
                $item.append($btn);
                $list.append($item);
            });
        }

        if (backgroundsCatalog) {
            render(backgroundsCatalog);
            return;
        }

        $.getJSON('assets/bg/backgrounds.json').done(function(data) {
            backgroundsCatalog = data.backgrounds || [];
            render(backgroundsCatalog);
        });
    }

    $(document).on('input', '.avatar-search', function() {
        const query = $(this).val().toLowerCase().trim();

        $('.avatar-group').each(function() {
            let visible = 0;
            const groupName = (($(this).attr('data-group') || '') + '').toLowerCase();
            $(this).find('.avatar-option').each(function() {
                const name = ($(this).data('name') || '').toLowerCase();
                const id = ($(this).data('avatar') || '').toLowerCase();
                const match = !query
                    || name.includes(query)
                    || id.includes(query)
                    || groupName.includes(query);
                $(this).toggle(match);
                if (match) visible++;
            });
            $(this).toggleClass('is-hidden', visible === 0);
        });
    });

    $(document).on('click', '#music-queue-list .btn-skip', function() {
        window.PlugDJ.skipTrack?.();
    });

    $(document).on('click', '.btn-library-remove', function() {
        const trackId = $(this).closest('[data-track-id]').data('track-id');
        if (trackId) window.PlugDJ.libraryRemove?.(String(trackId));
    });

    $(document).on('click', '.btn-playlist-remove', function() {
        const trackId = $(this).closest('[data-track-id]').data('track-id');
        if (trackId) window.PlugDJ.playlistRemove?.(String(trackId));
    });

    $(document).on('click', '.btn-playlist-promote', function() {
        const trackId = $(this).closest('[data-track-id]').data('track-id');
        if (trackId) {
            window.PlugDJ.playlistPromote?.(String(trackId));
            window.PlugDJ.openLibraryPanel?.();
            showToast('Sent to Library');
        }
    });

    $(document).on('click', '#btn-playlist-to-library', function() {
        const ui = window.PlugDJ.getLibraryUI?.();
        const tracks = ui?.playlistTracks || [];
        if (!tracks.length) {
            showToast('Playlist is empty');
            return;
        }
        if (!window.PlugDJ.playlistPromoteAll?.()) {
            showToast('Not connected');
            return;
        }
        window.PlugDJ.openLibraryPanel?.();
        showToast('Sending playlist to Library…');
    });

    $(document).on('change', '#playlist-select', function() {
        const id = String($(this).val() || '');
        if (id) window.PlugDJ.playlistSetActive?.(id);
    });

    $(document).on('click', '#btn-playlist-new', function() {
        const name = window.prompt('Playlist name', 'New playlist');
        if (name == null) return;
        const trimmed = String(name).trim().slice(0, 48);
        if (!trimmed) return;
        if (!window.PlugDJ.playlistCreate?.(trimmed)) showToast('Not connected');
        else showToast('Playlist created');
    });

    $(document).on('click', '#btn-playlist-rename', function() {
        const ui = window.PlugDJ.getLibraryUI?.();
        const active = ui?.activePlaylist;
        if (!active?.id) return;
        const name = window.prompt('Rename playlist', active.name || '');
        if (name == null) return;
        const trimmed = String(name).trim().slice(0, 48);
        if (!trimmed) return;
        if (!window.PlugDJ.playlistRename?.(active.id, trimmed)) showToast('Not connected');
        else showToast('Playlist renamed');
    });

    $(document).on('click', '#btn-playlist-delete', function() {
        const ui = window.PlugDJ.getLibraryUI?.();
        const active = ui?.activePlaylist;
        if (!active?.id) return;
        if ((ui.state.playlists || []).length <= 1) {
            showToast('Keep at least one playlist');
            return;
        }
        if (!window.confirm(`Delete playlist “${active.name}”?`)) return;
        if (!window.PlugDJ.playlistDelete?.(active.id)) showToast('Not connected');
        else showToast('Playlist deleted');
    });

    $(document).on('input', '#playlist-search', function() {
        const ui = window.PlugDJ.getLibraryUI?.();
        if (!ui) return;
        ui.playlistFilter = String($(this).val() || '');
        ui.renderPlaylist();
    });

    $(document).on('click', '.avatar-option', function() {
        $('.avatar-option').removeClass('active');
        $(this).addClass('active');
        const id = $(this).data('avatar');
        if (id) {
            localStorage.setItem(AVATAR_STORAGE_KEY, id);
            if (window.PlugDJ && typeof window.PlugDJ.changeAvatar === 'function') {
                window.PlugDJ.changeAvatar(id);
            }
        }
    });

    $(document).on('click', '.settings-tab', function() {
        const tab = $(this).data('settings');
        $('.settings-tab').removeClass('active');
        $(this).addClass('active');
        $('.settings-section').removeClass('active');
        $(`.settings-section[data-settings="${tab}"]`).addClass('active');
    });

    $(document).on('submit', '.library-add', function(e) {
        e.preventDefault();
        const target = $(this).data('target') || 'library';
        const $input = $(this).find('.library-input');
        const url = String($input.val() || '').trim();
        if (!url) return;

        const $btn = $(this).find('.btn-add-track').prop('disabled', true);
        const ok = target === 'playlist'
            ? window.PlugDJ.playlistAdd?.(url)
            : window.PlugDJ.libraryAdd?.(url);

        if (!ok) {
            showToast('Not connected');
            $btn.prop('disabled', false);
            return;
        }

        showToast(target === 'playlist' ? 'Saved to playlist' : 'Added to library');
        $input.val('');
        setTimeout(function() { $btn.prop('disabled', false); }, 400);
    });

    function showToast(msg) {
        const $toast = $('.toast');
        $toast.text(msg).addClass('show');
        setTimeout(function() {
            $toast.removeClass('show');
        }, 2000);
    }

    window.PlugDJ = window.PlugDJ || {};
    window.PlugDJ.showToast = showToast;

    // ── About modal ──
    function closeModal() {
        $('.modal-backdrop').remove();
    }

    $('.btn-about').click(function() {
        if ($('.modal-backdrop, .plug-modal-backdrop').length) return;
        const state = window.PlugDJ?.getRoomState?.();
        const about = state?.room?.aboutCommunity || 'No community description yet.';
        const backdrop = $('<div class="modal-backdrop"></div>');
        backdrop.load('components/about.html', function() {
            backdrop.find('.about-modal__content').text(about);
            if (window.PlugDJ?.isRoomStaff?.()) {
                backdrop.find('.about-modal').append('<button type="button" class="btn-join btn-edit-about" style="margin-top:12px">Edit About</button>');
            }
            $('body').append(backdrop);
        });
    });

    $(document).on('click', '.btn-edit-about', function() {
        const state = window.PlugDJ?.getRoomState?.();
        closeModal();
        window.PlugDJ.modal.prompt({
            title: 'Edit About Community',
            confirmLabel: 'Save',
            fields: [{
                name: 'aboutCommunity',
                label: 'Description',
                type: 'textarea',
                value: state?.room?.aboutCommunity || '',
                placeholder: 'Describe your community...',
                maxlength: 500,
                rows: 5
            }],
            onSubmit(values) {
                window.PlugDJ.updateRoomMeta?.({ aboutCommunity: values.aboutCommunity || '' });
            }
        });
    });

    $(document).on('click', '.modal-backdrop', function(e) {
        if ($(e.target).is('.modal-backdrop')) {
            closeModal();
        }
    });

    $(document).on('click', '.modal-close', function() {
        closeModal();
    });

    $(document).keyup(function(e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
            if (window.PlugDJ?.modal?.$root) {
                // Prefer cancel() so promptAsync resolves (Back to login) instead of hanging
                if (typeof window.PlugDJ.modal.cancel === 'function') {
                    window.PlugDJ.modal.cancel();
                } else {
                    window.PlugDJ.modal.close();
                }
            } else if ($('.modal-backdrop').length) {
                closeModal();
            } else if (activePanel) {
                closeSidePanel();
            }
        }
    });

    // ── Play a Song / queue ──
    $('.btn-play-song').click(function() {
        const ui = window.PlugDJ.getLibraryUI?.();
        const empty = !ui?.state?.library?.length;
        const state = window.PlugDJ.getRoomState?.();
        const selfUser = state?.room?.users?.find(function(u) { return u.id === state.selfId; });
        // Empty library → open Library so the user can add tracks
        if (empty && !selfUser?.inQueue) {
            window.PlugDJ.openLibraryPanel?.();
            showToast('Add a track to your Library first');
            return;
        }
        if (window.PlugDJ && typeof window.PlugDJ.toggleQueue === 'function') {
            window.PlugDJ.toggleQueue();
        }
    });

    // ── Reactions (all toggle via server) ──
    $('.reaction-btn').click(function() {
        const reaction = $(this).data('reaction');

        // Add to Playlist: open playlist panel; grab works for everyone
        if (reaction === 'playlist') {
            window.PlugDJ.openPlaylistPanel?.();
            window.PlugDJ.grabCurrentToPlaylist?.();
            // Still count the grab vote when the user is allowed to vote
            if (!$(this).prop('disabled') && !$(this).hasClass('is-disabled')) {
                window.PlugDJ.sendVote?.(reaction);
            }
            return;
        }

        if ($(this).prop('disabled') || $(this).hasClass('is-disabled')) return;
        if (window.PlugDJ?.sendVote) window.PlugDJ.sendVote(reaction);
    });

    // ── Room favorite (player-right heart) ──
    $('.player-right .btn-favorite').click(function() {
        if (window.PlugDJ?.toggleFavorite) window.PlugDJ.toggleFavorite();
    });

    // ── Emoji picker ──
    const EMOJIS = ['😀','😂','😍','🔥','🎵','🎧','💃','🕺','👍','👎','❤️','✨','🎉','😎','🤘','💯','🙌','😭','🥳','⚡'];
    const $emojiPicker = $('#emoji-picker');
    EMOJIS.forEach(function(emoji) {
        $emojiPicker.append(`<button type="button" class="emoji-picker__btn">${emoji}</button>`);
    });

    $('.btn-emoji').on('click', function(e) {
        e.stopPropagation();
        if ($emojiPicker.is('[hidden]')) {
            $emojiPicker.removeAttr('hidden');
        } else {
            $emojiPicker.attr('hidden', '');
        }
    });

    $emojiPicker.on('click', '.emoji-picker__btn', function(e) {
        e.stopPropagation();
        const $input = $('.chat-input');
        $input.val(($input.val() || '') + $(this).text());
        $input.focus();
        $emojiPicker.attr('hidden', '');
    });

    $(document).on('click', function() {
        $emojiPicker.attr('hidden', '');
        $('#player-more-menu').attr('hidden', '');
    });

    // ── Player menu (mute for everyone; staff extras) ──
    function refreshPlayerMoreMenu($menu) {
        const isStaff = !!window.PlugDJ?.isRoomStaff?.();
        $menu.find('.player-more-item--staff').prop('hidden', !isStaff);
        const muteLabel = ($('.volume-control').hasClass('muted') || parseInt($('.volume-slider').val(), 10) === 0)
            ? 'Unmute'
            : 'Mute';
        $menu.find('[data-action="toggle-mute"]').text(muteLabel);
    }

    function openPlayerMoreMenu($menu) {
        refreshPlayerMoreMenu($menu);
        $menu.removeAttr('hidden');
    }

    $('.btn-more').on('click', function(e) {
        e.stopPropagation();
        const $menu = $('#player-more-menu');
        if ($menu.is('[hidden]')) {
            openPlayerMoreMenu($menu);
        } else {
            $menu.attr('hidden', '');
        }
    });

    function requireStaffAction() {
        if (window.PlugDJ?.isRoomStaff?.()) return true;
        showToast('Only staff can use this option');
        return false;
    }

    function clearChatAction() {
        $('#player-more-menu').attr('hidden', '');
        if (!requireStaffAction()) return;
        window.PlugDJ.modal.confirm({
            title: 'Clear chat',
            message: 'Remove all chat messages for everyone in this room?',
            confirmLabel: 'Clear chat',
            danger: true,
            onConfirm() {
                if (window.PlugDJ?.clearChat?.()) showToast('Chat cleared');
            }
        });
    }

    function editWelcomeAction() {
        $('#player-more-menu').attr('hidden', '');
        if (!requireStaffAction()) return;
        const state = window.PlugDJ?.getRoomState?.();
        window.PlugDJ.modal.prompt({
            title: 'Edit welcome message',
            confirmLabel: 'Save',
            fields: [
                {
                    name: 'welcomeTitle',
                    label: 'Title',
                    value: state?.room?.welcomeTitle || '',
                    maxlength: 80
                },
                {
                    name: 'welcomeMessage',
                    label: 'Message',
                    type: 'textarea',
                    value: state?.room?.welcomeMessage || '',
                    maxlength: 300,
                    rows: 3
                }
            ],
            onSubmit(values) {
                window.PlugDJ.updateRoomMeta?.({
                    welcomeTitle: values.welcomeTitle || '',
                    welcomeMessage: values.welcomeMessage || ''
                });
            }
        });
    }

    function editChatRateLimitAction() {
        $('#player-more-menu').attr('hidden', '');
        if (!requireStaffAction()) return;
        const state = window.PlugDJ?.getRoomState?.();
        const currentSec = ((state?.room?.chatRateLimitMs || 2000) / 1000).toFixed(1).replace(/\.0$/, '');
        window.PlugDJ.modal.prompt({
            title: 'Chat rate limit',
            message: 'Minimum seconds between messages (staff are exempt). Range: 0.5–30s.',
            confirmLabel: 'Save',
            fields: [{
                name: 'chatRateLimitMs',
                label: 'Seconds',
                type: 'number',
                value: currentSec,
                placeholder: '2'
            }],
            onSubmit(values) {
                const seconds = Number(values.chatRateLimitMs);
                if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 30) {
                    showToast('Rate limit must be between 0.5 and 30 seconds');
                    return false;
                }
                window.PlugDJ.updateRoomMeta?.({ chatRateLimitMs: seconds });
            }
        });
    }

    function skipTrackAction() {
        $('#player-more-menu').attr('hidden', '');
        if (!requireStaffAction()) return;
        const state = window.PlugDJ?.getRoomState?.();
        if (!state?.room?.currentSong) {
            showToast('No track is playing');
            return;
        }
        window.PlugDJ.modal.confirm({
            title: 'Skip track',
            message: 'Skip the current track and move to the next DJ in queue?',
            confirmLabel: 'Skip',
            onConfirm() {
                window.PlugDJ.skipTrack?.();
            }
        });
    }

    $(document).on('click', '[data-action="toggle-mute"]', function(e) {
        e.stopPropagation();
        $('#player-more-menu').attr('hidden', '');
        $('.btn-volume').trigger('click');
    });
    $(document).on('click', '[data-action="skip-track"]', skipTrackAction);
    $(document).on('click', '[data-action="clear-chat"]', clearChatAction);
    $(document).on('click', '[data-action="edit-welcome"]', editWelcomeAction);
    $(document).on('click', '[data-action="chat-rate-limit"]', editChatRateLimitAction);

    $('#btn-blocked-login').on('click', function() {
        if (typeof PlugDJ.setRoomPassword === 'function') {
            PlugDJ.setRoomPassword(roomSlug, '');
        }
        sessionStorage.removeItem('plugdj-room-password');
        window.location.href = '/';
    });

    // ── Chat tabs ──
    $('.chat-tab').click(function() {
        const tab = $(this).data('tab');
        $('.chat-tab').removeClass('active');
        $(this).addClass('active');
        $('.chat-panel').removeClass('active');
        $(`.chat-panel[data-panel="${tab}"]`).addClass('active');
    });

    function sendChatMessage() {
        const text = $('.chat-input').val().trim();
        if (!text) return;

        if (window.PlugDJ && typeof window.PlugDJ.sendChatMessage === 'function' && window.PlugDJ.sendChatMessage(text)) {
            $('.chat-input').val('').focus();
            return;
        }

        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const $msg = $(`
            <li class="chat-msg user-card-target">
                <span class="mini-avatar av-1">G</span>
                <div class="msg-body">
                    <div class="msg-meta"><span class="msg-user u-purple">${CURRENT_USER_NAME}</span><time>${time}</time></div>
                    <p></p>
                </div>
            </li>
        `);
        $msg.attr('data-user', CURRENT_USER_NAME);
        $msg.find('p').text(text);

        const $list = $('.chat-panel[data-panel="chat"] .chat-messages');
        $list.append($msg);
        $list.scrollTop($list[0].scrollHeight);
        $('.chat-input').val('').focus();
    }

    $('.btn-chat-send').click(sendChatMessage);
    $('.chat-input').on('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendChatMessage();
        }
    });

    // ── Progress bar (server-synced, no pause — same clock for everyone) ──
    const $bar = $('.progress-bar');
    const $fill = $('.progress-fill');
    const $current = $('.progress-current');
    const $total = $('.progress-total');
    let trackDuration = parseInt($bar.data('duration'), 10) || 272;
    let syncedSong = null;
    let progressTimer = null;

    function formatTime(secs) {
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function setProgress(ratio) {
        const clamped = Math.max(0, Math.min(1, ratio));
        $fill.css('width', `${clamped * 100}%`);
        $current.text(formatTime(clamped * trackDuration));
    }

    function stopProgressTicker() {
        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    }

    // Offset local: (Date.now() - startedAt do servidor). Quem entra
    // atrasado cai direto no ponto certo da música.
    // startedAt só existe depois do download — enquanto baixa, barra fica em 0.
    function tickProgress() {
        if (!syncedSong?.startedAt || !trackDuration) return;
        const elapsedSec = (Date.now() - syncedSong.startedAt) / 1000;
        setProgress(elapsedSec / trackDuration);
    }

    window.PlugDJ.syncPlayerPosition = function(song) {
        syncedSong = song || null;
        stopProgressTicker();

        if (!syncedSong) {
            trackDuration = 0;
            $fill.css('width', '0%');
            $current.text('0:00');
            $total.text('0:00');
            return;
        }

        trackDuration = syncedSong.duration || 272;
        $total.text(formatTime(trackDuration));

        if (!syncedSong.startedAt
            || syncedSong.mediaStatus === 'pending'
            || syncedSong.mediaStatus === 'downloading') {
            setProgress(0);
            return;
        }

        tickProgress();
        progressTimer = setInterval(tickProgress, 1000);

        // Always push media element to the shared room offset (refresh / late join)
        const offsetSec = typeof window.PlugDJ.getMediaPlayOffset === 'function'
            ? window.PlugDJ.getMediaPlayOffset(syncedSong)
            : Math.max(0, (Date.now() - syncedSong.startedAt) / 1000);
        window.PlugDJ.onPlayerSeek?.(syncedSong, offsetSec);
    };

    setProgress(0);

    // ── Volume (synced with Settings → Master volume, persisted in profile) ──
    const $volControl = $('.volume-control');
    const $volSlider = $('.volume-slider');
    const $volBtn = $('.btn-volume');
    let muted = false;
    let savedVolume = (function() {
        const fromProfile = window.PlugDJ.getProfile?.()?.settings?.masterVolume;
        if (Number.isFinite(Number(fromProfile))) return Math.max(0, Math.min(100, Math.round(Number(fromProfile))));
        return parseInt($volSlider.val(), 10) || 70;
    })();

    function persistVolume(percent) {
        const vol = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        window.PlugDJ.updateProfile?.({ settings: { masterVolume: vol } });
        return vol;
    }

    function applySharedVolume(percent, options) {
        const opts = options || {};
        const vol = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        $volSlider.val(vol);
        if (vol > 0) {
            savedVolume = vol;
            muted = false;
            $volControl.removeClass('muted').attr('data-tooltip', 'Volume');
        } else {
            muted = true;
            $volControl.addClass('muted').attr('data-tooltip', 'Unmute');
        }
        if (opts.applyMedia !== false) {
            window.PlugDJ.setMediaVolume?.(vol / 100);
        }
        if (opts.persist) persistVolume(vol);
        if (opts.syncSettings !== false) {
            window.PlugDJ.getSettingsUI?.()?.syncMasterVolumeUI?.(vol);
        }
        return vol;
    }

    window.PlugDJ.syncPlayerVolumeUI = function(percent) {
        applySharedVolume(percent, { applyMedia: false, persist: false, syncSettings: false });
    };

    $volControl.on('mouseenter', function() {
        $(this).addClass('open');
    });

    $volControl.on('mouseleave', function() {
        $(this).removeClass('open');
    });

    $volBtn.on('click', function(e) {
        e.preventDefault();
        if (muted || parseInt($volSlider.val(), 10) === 0) {
            // Restore last audible level (persisted)
            applySharedVolume(savedVolume || 70, { persist: true, syncSettings: true });
        } else {
            // Soft mute — keep saved/master level; don't push 0 into Settings
            savedVolume = parseInt($volSlider.val(), 10) || savedVolume;
            persistVolume(savedVolume);
            muted = true;
            $volSlider.val(0);
            $volControl.addClass('muted').attr('data-tooltip', 'Unmute');
            window.PlugDJ.setMediaVolume?.(0);
        }
    });

    $volSlider.on('input', function() {
        const val = parseInt($(this).val(), 10) || 0;
        applySharedVolume(val, { persist: true, syncSettings: true });
    });

    applySharedVolume(savedVolume, { persist: false, syncSettings: true });

    // ── Share ──
    $('.btn-share').click(function() {
        navigator.clipboard.writeText(window.location.href).then(function() {
            showToast('Link copied!');
        });
    });

    async function promptRoomLogin({ needNickname, needPassword, roomName, errorMessage }) {
        const fields = [];
        if (needNickname) {
            fields.push({
                name: 'nickname',
                label: 'Nickname',
                type: 'text',
                value: CURRENT_USER_NAME || '',
                placeholder: 'Your nickname',
                maxlength: 24
            });
        }
        if (needPassword) {
            fields.push({
                name: 'password',
                label: 'Room password',
                type: 'password',
                value: '',
                placeholder: 'Enter room password',
                maxlength: 64
            });
        }

        // Loading splash sits at z-index 9998 — hide it while the login modal is open
        $('#room-loading').attr('hidden', '');

        const values = await window.PlugDJ.modal.promptAsync({
            title: needPassword ? 'Room password required' : 'Join room',
            message: errorMessage
                || (needPassword
                    ? `“${roomName || roomSlug}” is password-protected. Enter the password to continue.`
                    : `Enter a nickname to join “${roomName || roomSlug}”.`),
            confirmLabel: 'Enter room',
            cancelLabel: 'Back to login',
            fields,
            // error3 art when asking for password; never close on outside click
            backdropClass: needPassword ? 'plug-modal-backdrop--password' : '',
            closeOnBackdrop: false
        });

        // Only explicit Cancel / Esc / Back to login leaves the room URL
        if (!values) {
            window.location.href = '/';
            return null;
        }
        return values;
    }

    async function ensureRoomCredentials() {
        const api = new window.PlugDJ.ApiService();
        const profile = window.PlugDJ.getProfile?.() || {};

        let roomMeta;
        try {
            roomMeta = await api.getRoom(roomSlug);
        } catch {
            $('#room-loading').attr('hidden', '');
            $('#room-blocked-message').text('Could not reach the room server.');
            $('#room-blocked').removeAttr('hidden');
            $('.app').attr('hidden', '');
            return null;
        }

        if (!roomMeta.ok) {
            $('#room-loading').attr('hidden', '');
            $('#room-blocked-message').text(roomMeta.error || 'Room not found.');
            $('#room-blocked').removeAttr('hidden');
            $('.app').attr('hidden', '');
            return null;
        }

        const roomName = roomMeta.room?.name || roomSlug;
        let username = (CURRENT_USER_NAME || profile.displayName || profile.username || '').trim();
        let password = typeof PlugDJ.getRoomPassword === 'function'
            ? PlugDJ.getRoomPassword(roomSlug)
            : '';
        const hasPassword = !!roomMeta.room?.hasPassword;

        // Ask for missing nickname / password before connecting
        while (!username || (hasPassword && !password)) {
            const values = await promptRoomLogin({
                needNickname: !username,
                needPassword: hasPassword && !password,
                roomName
            });
            if (!values) return null;

            if (values.nickname != null) {
                username = String(values.nickname || '').trim().slice(0, 24);
            }
            if (values.password != null) {
                password = String(values.password || '').trim();
            }

            if (!username) {
                showToast('Nickname is required');
                continue;
            }
            if (hasPassword && !password) {
                showToast('Password is required');
                continue;
            }
        }

        // Validate access (wrong password → show modal again)
        for (;;) {
            const access = await api.checkRoomAccess(roomSlug, {
                username,
                password,
                clientId: profile.userUUID || profile.userId,
                userUUID: profile.userUUID || profile.userId
            });

            if (access.ok) {
                window.PlugDJ.updateProfile?.({ displayName: username, username });
                localStorage.setItem(USERNAME_STORAGE_KEY, username);
                CURRENT_USER_NAME = username;
                if (hasPassword) {
                    window.PlugDJ.setRoomPassword?.(roomSlug, password);
                } else {
                    window.PlugDJ.setRoomPassword?.(roomSlug, '');
                }
                $('#room-loading').removeAttr('hidden');
                return { username, password };
            }

            if (access.code === 'banned') {
                $('#room-loading').attr('hidden', '');
                $('#room-blocked-message').text(access.error || 'You are banned from this room.');
                $('#room-blocked').removeAttr('hidden');
                $('.app').attr('hidden', '');
                return null;
            }

            if (access.code === 'wrong_password' || hasPassword) {
                password = '';
                const values = await promptRoomLogin({
                    needNickname: false,
                    needPassword: true,
                    roomName,
                    errorMessage: access.error || 'Wrong password for this room.'
                });
                if (!values) return null;
                password = String(values.password || '').trim();
                if (!password) {
                    showToast('Password is required');
                }
                continue;
            }

            $('#room-loading').attr('hidden', '');
            $('#room-blocked-message').text(access.error || 'Could not enter this room.');
            $('#room-blocked').removeAttr('hidden');
            $('.app').attr('hidden', '');
            return null;
        }
    }

    (async function bootRoomClient() {
        if (!window.PlugDJ?.RoomClient) return;

        const creds = await ensureRoomCredentials();
        if (!creds) {
            $('#room-loading').attr('hidden', '');
            return;
        }

        const roomClient = new window.PlugDJ.RoomClient({ roomId: roomSlug });
        roomClient.init({
            username: creds.username,
            avatar: localStorage.getItem(AVATAR_STORAGE_KEY)
                || window.PlugDJ.getProfile?.()?.avatar
                || '80s01',
            background: localStorage.getItem(BG_STORAGE_KEY) || 'bg-neon-city',
            password: creds.password
        });
        window.PlugDJ.roomClient = roomClient;
    })();

});
