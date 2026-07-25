'use strict';

const LTEngine = (function () {
    const CORE = window.__LTEngineCore;

    function studioHoldIn() {
        ensurePlayableDefaults();
        CORE.syncStyleFromActiveData();
        CORE.applyData();
        CORE.applyStyles();
        const prevScale = window.gsap && gsap.globalTimeline ? gsap.globalTimeline.timeScale() : 1;
        if (window.gsap && gsap.globalTimeline) gsap.globalTimeline.timeScale(1000);
        return Promise.resolve(CORE.cfg.animateIn(CORE.data[CORE.activeStep], CORE.style)).then(function () {
            if (window.gsap && gsap.globalTimeline) gsap.globalTimeline.timeScale(prevScale);
            CORE.state = 2;
            CORE.clearDisplayTimer();
        }).catch(CORE.handleError);
    }

    /* ── WO-267 studio-only helpers (never exported outside ?studio=1) ── */

    /** Replay the intro at normal speed. `play()` no-ops at state 2 (by design for CG), so the
     * studio Play button uses this: animateIn's opening .set() calls make it self-resetting. */
    function studioReplay() {
        try {
            ensurePlayableDefaults();
        } catch (error) {
            CORE.handleError(error);
            return Promise.resolve();
        }
        CORE.syncStyleFromActiveData();
        CORE.applyData();
        CORE.applyStyles();
        return Promise.resolve(CORE.cfg.animateIn(CORE.data[CORE.activeStep], CORE.style)).then(function () {
            CORE.state = 2;
            CORE.clearDisplayTimer();
        }).catch(CORE.handleError);
    }

    /** Current graphic placement for the studio drag overlay. */
    function studioGetPlacement() {
        const container = CORE.cfg.containerSel ? document.querySelector(CORE.cfg.containerSel) : null;
        if (!container) return null;
        return {
            rect: container.getBoundingClientRect(),
            position: (CORE.style.position || 'left').toLowerCase(),
            marginX: CORE.style.marginX != null && CORE.style.marginX !== '' ? Number(CORE.style.marginX) : 77,
            marginY: CORE.style.marginY != null && CORE.style.marginY !== '' ? Number(CORE.style.marginY) : 43,
        };
    }

    /** Live-apply a placement from the studio drag overlay (merged into style). */
    function studioSetPlacement(p) {
        if (!p || typeof p !== 'object') return;
        if (p.position) CORE.style.position = String(p.position);
        if (p.marginX != null) CORE.style.marginX = Number(p.marginX);
        if (p.marginY != null) CORE.style.marginY = Number(p.marginY);
        CORE.applyStyles();
    }

    /** Computed font sizes for the studio wheel-resize. */
    function studioGetFontSizes() {
        const out = { titleFontSize: null, subtitleFontSize: null };
        try {
            const t = document.querySelector(CORE.cfg.titleSel || 'h1');
            if (t) out.titleFontSize = parseFloat(window.getComputedStyle(t).fontSize);
            const s = document.querySelector(CORE.cfg.subtitleSel || 'p');
            if (s) out.subtitleFontSize = parseFloat(window.getComputedStyle(s).fontSize);
        } catch (_) { /* fall through with nulls */ }
        return out;
    }

    /* ── CasparCG interface ──────────────────────────────────── */

    const DEFAULT_DATA = { title: 'Name', subtitle: 'Title' };

    function ensurePlayableDefaults() {
        if (!CORE.data.length) {
            CORE.data = [{ ...DEFAULT_DATA }];
            CORE.activeStep = 0;
            CORE.currentStep = 0;
        }
        CORE.applyData();
        CORE.applyStyles();
        if (CORE.state === 0) CORE.state = 1;
    }

    function update(raw) {
        const parsed = CORE.normalizeUpdatePayload(raw);
        if (!parsed) return;

        const hasStyle = parsed.style && Object.keys(parsed.style).length > 0;
        if (!parsed.data && !hasStyle) {
            if (CORE.state === 0) {
                try {
                    ensurePlayableDefaults();
                } catch (error) {
                    CORE.handleError(error);
                }
            }
            return;
        }

        if (parsed.data) {
            CORE.data = parsed.data;
            CORE.activeStep = Math.min(CORE.activeStep, CORE.data.length - 1);
            CORE.currentStep = CORE.activeStep;
        }
        if (hasStyle) {
            CORE.style = { ...CORE.style, ...parsed.style };
        }
        CORE.syncStyleFromActiveData();

        try {
            CORE.applyData();
            CORE.applyStyles();
            if (CORE.state === 0) {
                CORE.state = 1;
            }
            if (CORE.state === 2) {
                CORE.scheduleDisplayStop();
            }
        } catch (error) {
            CORE.handleError(error);
        }
    }

    function play() {
        if (CORE.state === 0) {
            try {
                ensurePlayableDefaults();
            } catch (error) {
                CORE.handleError(error);
                return;
            }
        }
        if (CORE.state === 1) {
            CORE.syncStyleFromActiveData();
            CORE.addPlayOutCommand(() =>
                Promise.resolve(CORE.cfg.animateIn(CORE.data[CORE.activeStep], CORE.style)).then(() => {
                    CORE.scheduleDisplayStop();
                })
            );
            CORE.state = 2;
        }
    }

    function next() {
        if (CORE.state === 1) {
            play();
        } else if (CORE.state === 2) {
            if (CORE.data.length > CORE.currentStep + 1) {
                CORE.clearDisplayTimer();
                CORE.currentStep++;
                const animation = () =>
                    CORE.cfg.animateOut(CORE.data[CORE.activeStep], CORE.style).then(() => {
                        CORE.activeStep++;
                        CORE.syncStyleFromActiveData();
                        CORE.applyData();
                        CORE.applyStyles();
                    }).then(() => CORE.cfg.animateIn(CORE.data[CORE.activeStep], CORE.style)).then(() => {
                        CORE.scheduleDisplayStop();
                    });
                CORE.addPlayOutCommand(animation);
            } else {
                CORE.handleError('Graphic is out of titles to display');
            }
        } else {
            CORE.handleError('Graphic cannot be advanced while in state ' + CORE.state);
        }
    }

    function stop() {
        if (CORE.state === 2) {
            CORE.clearDisplayTimer();
            CORE.addPlayOutCommand(() => CORE.cfg.animateOut(CORE.data[CORE.activeStep], CORE.style));
            CORE.state = 1;
        }
    }
    CORE.stop = stop;

    function reset() {
        if (CORE.currentStep === 0) {
            CORE.handleError('The graphic is already on its first item.');
            return;
        }
        let animation;
        if (CORE.state === 1) {
            CORE.currentStep = 0;
            animation = () => new Promise(resolve => { CORE.activeStep = 0; CORE.applyData(); resolve(); });
        } else if (CORE.state === 2) {
            CORE.currentStep = -1;
            animation = () => new Promise(resolve => { CORE.activeStep = -1; resolve(); }).then(next);
        } else {
            CORE.handleError('Cannot reset a graphic that has not been loaded.');
            return;
        }
        CORE.addPlayOutCommand(animation);
    }

    function previous() {
        if (CORE.currentStep > 0) {
            let animation;
            if (CORE.state === 2) {
                CORE.currentStep -= 2;
                animation = () => new Promise(resolve => { CORE.activeStep -= 2; resolve(); }).then(next);
            } else if (CORE.state === 1) {
                CORE.currentStep -= 1;
                animation = () => new Promise(resolve => { CORE.activeStep -= 1; CORE.applyData(); resolve(); });
            } else {
                CORE.handleError('Graphic can not go back one title in the current state.');
                return;
            }
            CORE.addPlayOutCommand(animation);
        } else {
            CORE.handleError('There is no graphic to go backwards to.');
        }
    }

    async function remove() {
        CORE.clearDisplayTimer();
        if (CORE.state === 2) await CORE.cfg.animateOut(CORE.data[CORE.activeStep], CORE.style);
    }

    /* ── HTTP polling for API-driven updates ──────────────────── */

    let pollTimer = null;

    function startPolling(baseUrl, intervalMs) {
        if (pollTimer) clearInterval(pollTimer);
        const url = baseUrl || '';
        const ms = intervalMs || 1000;

        async function tick() {
            try {
                const res = await fetch(url);
                if (!res.ok) return;
                const payload = await res.json();
                if (payload && payload.data) {
                    CORE.data = Array.isArray(payload.data) ? payload.data : [payload.data];
                    if (payload.style) CORE.style = payload.style;
                    if (CORE.data.length) {
                        CORE.activeStep = Math.min(CORE.activeStep, CORE.data.length - 1);
                        CORE.currentStep = CORE.activeStep;
                        CORE.applyData();
                        CORE.applyStyles();
                    }
                }
            } catch (_) { /* silent */ }
        }

        tick();
        pollTimer = setInterval(tick, ms);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    /* ── init ─────────────────────────────────────────────────── */

    function init(variantConfig) {
        CORE.cfg = variantConfig;
        // WO-321: CG-studio exports bake their full configured style into window.__LT_INITIAL_STYLE__
        // so the exported template renders the studio look — typography/layout/box/timing, not just
        // colors. Seed the style store before first render. GUARDED: absent on hand-written templates,
        // so this is a complete no-op for them. Colors still come from the CSS vars baked in the export
        // (the engine's applyStyles never touches color).
        try {
            var seed = (typeof window !== 'undefined') ? window.__LT_INITIAL_STYLE__ : null;
            if (seed && typeof seed === 'object') {
                CORE.STYLE_KEYS.forEach(function (k) {
                    if (seed[k] != null && seed[k] !== '') CORE.style[k] = seed[k];
                });
            }
        } catch (_) { /* seed is best-effort; a bad global must not break init */ }
        window['update'] = raw => update(raw);
        window['play'] = play;
        window['next'] = next;
        window['stop'] = stop;
        window['reset'] = reset;
        window['previous'] = previous;
        window['remove'] = remove;

        // Check for API poll params in URL  ?poll=<url>&interval=<ms>
        const params = new URLSearchParams(window.location.search);
        if (params.get('poll')) {
            startPolling(params.get('poll'), parseInt(params.get('interval') || '1000', 10));
        }
        if (CORE.isStudioMode()) {
            window['studioHoldIn'] = studioHoldIn;
            window['studioReplay'] = studioReplay;
            window['studioGetPlacement'] = studioGetPlacement;
            window['studioSetPlacement'] = studioSetPlacement;
            window['studioGetFontSizes'] = studioGetFontSizes;
        }
    }

    return {
        init,
        getComputedStyle: CORE.getComputedStyle,
        startPolling,
        stopPolling,
        get state() { return CORE.state; },
        set state(v) { CORE.state = v; },
    };
})();
