(function(global) {
    'use strict';

    const VS = `
        attribute vec2 a_pos;
        attribute vec2 a_uv;
        varying vec2 v_uv;
        void main() {
            v_uv = a_uv;
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `;

    const FS = `
        precision mediump float;
        varying vec2 v_uv;
        uniform sampler2D u_tex;
        uniform float u_frame;
        uniform float u_frames;
        void main() {
            float u = (u_frame + v_uv.x) / u_frames;
            gl_FragColor = texture2D(u_tex, vec2(u, 1.0 - v_uv.y));
        }
    `;

    function createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    function createProgram(gl, vsSource, fsSource) {
        const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return null;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    class SharedAvatarGL {
        constructor() {
            this.canvas = document.createElement('canvas');
            this.gl = this.canvas.getContext('webgl', {
                alpha: true,
                premultipliedAlpha: false,
                antialias: true,
                preserveDrawingBuffer: true
            });
            if (!this.gl) throw new Error('WebGL not available');

            this.program = createProgram(this.gl, VS, FS);
            this.textures = new Map();
            this.buffer = null;
            this._initBuffer();
        }

        _initBuffer() {
            const gl = this.gl;
            this.buffer = gl.createBuffer();
        }

        _uploadQuad(frameWidth, frameHeight, viewW, viewH) {
            const gl = this.gl;
            const frameAspect = frameWidth / frameHeight;
            const viewAspect = viewW / viewH;
            let sx = 1;
            let sy = 1;

            if (frameAspect > viewAspect) {
                sy = viewAspect / frameAspect;
            } else {
                sx = frameAspect / viewAspect;
            }

            const positions = new Float32Array([
                -sx, -sy, 0, 0,
                 sx, -sy, 1, 0,
                -sx,  sy, 0, 1,
                 sx,  sy, 1, 1
            ]);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
        }

        loadTexture(src) {
            if (this.textures.has(src)) {
                return this.textures.get(src).promise;
            }

            const entry = {
                texture: null,
                promise: new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        const gl = this.gl;
                        const texture = gl.createTexture();
                        gl.bindTexture(gl.TEXTURE_2D, texture);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                        entry.texture = texture;
                        resolve(texture);
                    };
                    img.onerror = () => reject(new Error('Failed to load ' + src));
                    img.src = src;
                })
            };

            this.textures.set(src, entry);
            return entry.promise;
        }

        drawFrame(config, frameIndex, targetCanvas) {
            const gl = this.gl;
            const entry = this.textures.get(config.src);
            if (!entry || !entry.texture) return;

            const sprite = targetCanvas.closest('.stage-char__sprite');
            let cssW = parseInt(sprite?.dataset?.displayW, 10);
            let cssH = parseInt(sprite?.dataset?.displayH, 10);
            if (!cssW || !cssH) {
                cssW = sprite?.offsetWidth || targetCanvas.offsetWidth || 1;
                cssH = sprite?.offsetHeight || targetCanvas.offsetHeight || 1;
            }

            const zoom = window.visualViewport?.scale || 1;
            const layoutW = Math.max(1, Math.round(cssW));
            const layoutH = Math.max(1, Math.round(cssH));
            const dpr = Math.min((window.devicePixelRatio || 1) / zoom, 2);
            const w = Math.max(1, Math.round(layoutW * dpr));
            const h = Math.max(1, Math.round(layoutH * dpr));

            targetCanvas.style.width = layoutW + 'px';
            targetCanvas.style.height = layoutH + 'px';

            if (targetCanvas.width !== w || targetCanvas.height !== h) {
                targetCanvas.width = w;
                targetCanvas.height = h;
            }

            if (this.canvas.width !== w || this.canvas.height !== h) {
                this.canvas.width = w;
                this.canvas.height = h;
            }

            gl.viewport(0, 0, w, h);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

            gl.useProgram(this.program);

            this._uploadQuad(config.frameWidth, config.frameHeight, w, h);

            const posLoc = gl.getAttribLocation(this.program, 'a_pos');
            const uvLoc = gl.getAttribLocation(this.program, 'a_uv');
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(uvLoc);
            gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            gl.uniform1i(gl.getUniformLocation(this.program, 'u_tex'), 0);
            gl.uniform1f(gl.getUniformLocation(this.program, 'u_frame'), frameIndex);
            gl.uniform1f(gl.getUniformLocation(this.program, 'u_frames'), config.frames);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            const ctx = targetCanvas.getContext('2d');
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(this.canvas, 0, 0, w, h);
        }
    }

    let sharedRenderer = null;

    function getSharedRenderer() {
        if (!sharedRenderer) {
            sharedRenderer = new SharedAvatarGL();
        }
        return sharedRenderer;
    }

    class AvatarSpriteGL {
        constructor(canvas, options) {
            this.canvas = canvas;
            this.config = {
                src: options.src,
                frames: options.frames,
                idleFrames: options.idleFrames != null ? options.idleFrames : 4,
                danceStart: options.danceStart != null ? options.danceStart : 4,
                danceEnd: options.danceEnd != null ? options.danceEnd : (options.frames - 1),
                idleFps: options.idleFps || 12,
                danceFps: options.danceFps || options.fps || 12,
                idleCycleMs: options.idleCycleMs || 5000,
                idleRepeats: options.idleRepeats || 2,
                freezeIdle: !!options.freezeIdle,
                initialMode: options.initialMode || 'idle',
                lockMode: !!options.lockMode,
                frameWidth: options.frameWidth,
                frameHeight: options.frameHeight,
                fps: options.fps || 12
            };
            this.mode = this.config.initialMode || 'idle';
            this.lockMode = this.config.lockMode;
            this.localFrame = 0;
            this.idleCycleStart = 0;
            this.running = false;
            this.lastTime = 0;
            this.accum = 0;
            this.loaded = false;
            this._loadPromise = null;
        }

        _sheetFrame() {
            if (this.mode === 'dance') {
                const count = this.config.danceEnd - this.config.danceStart + 1;
                return this.config.danceStart + (this.localFrame % count);
            }
            return this.localFrame % this.config.idleFrames;
        }

        _idleSheetFrame(now) {
            if (!this.config.idleFrames) return 0;
            // Original Models / single-frame idle: stay frozen on frame 0 (no blink)
            if (this.config.freezeIdle || this.config.idleFrames <= 1) return 0;

            const cycleMs = this.config.idleCycleMs;
            const frameDuration = 1000 / this.config.idleFps;
            const singleAnimDuration = this.config.idleFrames * frameDuration;
            const totalAnimDuration = singleAnimDuration * this.config.idleRepeats;
            const cycleElapsed = (now - this.idleCycleStart) % cycleMs;

            if (cycleElapsed < totalAnimDuration) {
                const t = cycleElapsed % singleAnimDuration;
                return Math.min(
                    this.config.idleFrames - 1,
                    Math.floor(t / frameDuration)
                );
            }
            return 0;
        }

        setMode(mode) {
            if (this.lockMode) return;
            this.forceSetMode(mode);
        }

        forceSetMode(mode) {
            if (this.mode === mode) return;
            this.mode = mode;
            this.localFrame = 0;
            this.accum = 0;
            if (mode === 'idle') {
                this.idleCycleStart = performance.now();
            }
            if (this.loaded) {
                this.draw(this.mode === 'dance' ? this._sheetFrame() : this._idleSheetFrame(performance.now()));
            }
        }

        load() {
            if (this._loadPromise) return this._loadPromise;

            this._loadPromise = getSharedRenderer()
                .loadTexture(this.config.src)
                .then(() => {
                    this.loaded = true;
                    this.mode = this.config.initialMode || 'idle';
                    this.localFrame = 0;
                    this.idleCycleStart = performance.now();
                    if (this.mode === 'dance') {
                        this.draw(this._sheetFrame());
                    } else {
                        this.draw(this._idleSheetFrame(this.idleCycleStart));
                    }
                    return this;
                });

            return this._loadPromise;
        }

        draw(frameIndex) {
            if (!this.loaded) return;
            getSharedRenderer().drawFrame(this.config, frameIndex, this.canvas);
        }

        start() {
            if (this.running) return;
            this.running = true;
            this.lastTime = performance.now();
            this._tick(this.lastTime);
        }

        stop() {
            this.running = false;
            if (this._raf) {
                cancelAnimationFrame(this._raf);
                this._raf = null;
            }
        }

        _tick(now) {
            if (!this.running) return;
            const dt = now - this.lastTime;
            this.lastTime = now;

            if (this.mode === 'dance') {
                this.accum += dt;
                const frameDuration = 1000 / this.config.danceFps;
                while (this.accum >= frameDuration) {
                    const danceCount = this.config.danceEnd - this.config.danceStart + 1;
                    this.localFrame = (this.localFrame + 1) % danceCount;
                    this.accum -= frameDuration;
                }
                this.draw(this._sheetFrame());
            } else {
                this.draw(this._idleSheetFrame(now));
            }

            this._raf = requestAnimationFrame((t) => this._tick(t));
        }

        destroy() {
            this.stop();
            this.loaded = false;
            this._loadPromise = null;
        }
    }

    class AvatarSpriteManager {
        constructor() {
            this.instances = new Map();
            this.observer = null;
        }

        mount(canvas, config) {
            if (this.instances.has(canvas)) return;

            const sprite = new AvatarSpriteGL(canvas, config);
            this.instances.set(canvas, { sprite, config, active: false });

            if (!this.observer) {
                this.observer = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        const item = this.instances.get(entry.target);
                        if (!item) return;

                        if (entry.isIntersecting) {
                            if (!item.active) {
                                item.active = true;
                                item.sprite.load().then(() => item.sprite.start()).catch(console.error);
                            }
                        } else if (item.active) {
                            item.active = false;
                            item.sprite.stop();
                        }
                    });
                }, { root: null, threshold: 0.01 });
            }

            this.observer.observe(canvas);
        }

        mountImmediate(canvas, config) {
            const sprite = new AvatarSpriteGL(canvas, config);
            this.instances.set(canvas, { sprite, config, active: true });
            return sprite.load().then(() => {
                sprite.start();
                return sprite;
            });
        }

        mountStage(canvas, config) {
            const stageConfig = Object.assign({}, config, {
                initialMode: config.initialMode || 'idle',
                lockMode: true
            });
            return this.mountImmediate(canvas, stageConfig);
        }

        unmount(canvas) {
            const item = this.instances.get(canvas);
            if (!item) return;

            if (this.observer) {
                this.observer.unobserve(canvas);
            }
            item.sprite.destroy();
            this.instances.delete(canvas);
        }

        mountStatic(canvas, config) {
            this.unmount(canvas);
            const sprite = new AvatarSpriteGL(canvas, config);
            this.instances.set(canvas, { sprite, config, active: false, static: true });
            return sprite.load().then(() => {
                sprite.draw(0);
                return sprite;
            });
        }

        setMode(canvas, mode) {
            const item = this.instances.get(canvas);
            if (item && !item.sprite.lockMode) {
                item.sprite.setMode(mode);
            }
        }

        forceSetMode(canvas, mode) {
            const item = this.instances.get(canvas);
            if (item) {
                item.sprite.forceSetMode(mode);
            }
        }

        destroyAll() {
            this.instances.forEach((item, canvas) => {
                if (this.observer) this.observer.unobserve(canvas);
                item.sprite.destroy();
            });
            this.instances.clear();
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }
        }
    }

    global.AvatarSpriteGL = AvatarSpriteGL;
    global.AvatarSpriteManager = AvatarSpriteManager;
})(window);
