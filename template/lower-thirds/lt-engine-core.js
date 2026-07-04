'use strict';

/**
 * lt-engine.js — Shared lower-thirds engine.
 *
 * Each template variant calls `LTEngine.init(variantConfig)` where
 * variantConfig supplies element selectors + custom animateIn / animateOut
 * functions.  The engine handles:
 *   - CasparCG window.update / play / stop / next / previous / reset / remove
 *   - Animation queue with threshold
 *   - Dynamic data + style application
 *   - Auto animate-out after `style.displayDurationSec` (default 10s; 0 = hold until stop)
 *   - Optional HTTP polling for API-driven content updates
 */

const LTEngine = (function () {
    let state = 0;           // 0 = empty, 1 = loaded/playable, 2 = playing
    let activeStep = 0;
    let currentStep = 0;
    let data = [];
    let style = {};
    const animationQueue = [];
    const animationThreshold = 3;
    let displayTimer = null;

    /** Variant-supplied config — selectors + animate callbacks */
    let cfg = {};

    const S = window.LTEngineStyles;
    function syncStyleFromActiveData() { S.syncStyleFromActiveData(); }



    function studioHoldIn() {
        ensurePlayableDefaults();
        syncStyleFromActiveData();
        S.applyData();
        S.applyStyles();
        const prevScale = window.gsap && gsap.globalTimeline ? gsap.globalTimeline.timeScale() : 1;
        if (window.gsap && gsap.globalTimeline) gsap.globalTimeline.timeScale(1000);
        return Promise.resolve(cfg.animateIn(data[activeStep], style)).then(function () {
            if (window.gsap && gsap.globalTimeline) gsap.globalTimeline.timeScale(prevScale);
            state = 2;
            clearDisplayTimer();
        }).catch(handleError);
    }

    /* ── CasparCG interface ──────────────────────────────────── */

    const DEFAULT_DATA = { title: 'Name', subtitle: 'Title' };

    function ensurePlayableDefaults() {
        if (!data.length) {
            data = [{ ...DEFAULT_DATA }];
            activeStep = 0;
            currentStep = 0;
        }
        S.applyData();
        S.applyStyles();
        if (state === 0) state = 1;
    }

    function update(raw) {
        const parsed = S.normalizeUpdatePayload(raw);
        if (!parsed) return;

        const hasStyle = parsed.style && Object.keys(parsed.style).length > 0;
        if (!parsed.data && !hasStyle) {
            if (state === 0) {
                try {
                    ensurePlayableDefaults();
                } catch (error) {
                    handleError(error);
                }
            }
            return;
        }

        if (parsed.data) {
            data = parsed.data;
            activeStep = Math.min(activeStep, data.length - 1);
            currentStep = activeStep;
        }
        if (hasStyle) {
            style = { ...style, ...parsed.style };
        }
        syncStyleFromActiveData();

        try {
            S.applyData();
            S.applyStyles();
            if (state === 0) {
                state = 1;
            }
            if (state === 2) {
                scheduleDisplayStop();
            }
        } catch (error) {
            handleError(error);
        }
    }

    function play() {
        if (state === 0) {
            try {
                ensurePlayableDefaults();
            } catch (error) {
                handleError(error);
                return;
            }
        }
        if (state === 1) {
            syncStyleFromActiveData();
            addPlayOutCommand(() =>
                Promise.resolve(cfg.animateIn(data[activeStep], style)).then(() => {
                    scheduleDisplayStop();
                })
            );
            state = 2;
        }
    }

    function next() {
        if (state === 1) {
            play();
        } else if (state === 2) {
            if (data.length > currentStep + 1) {
                clearDisplayTimer();
                currentStep++;
                const animation = () =>
                    cfg.animateOut(data[activeStep], style).then(() => {
                        activeStep++;
                        syncStyleFromActiveData();
                        S.applyData();
                        S.applyStyles();
                    }).then(() => cfg.animateIn(data[activeStep], style)).then(() => {
                        scheduleDisplayStop();
                    });
                addPlayOutCommand(animation);
            } else {
                handleError('Graphic is out of titles to display');
            }
        } else {
            handleError('Graphic cannot be advanced while in state ' + state);
        }
    }

    function stop() {
        if (state === 2) {
            clearDisplayTimer();
            addPlayOutCommand(() => cfg.animateOut(data[activeStep], style));
            state = 1;
        }
    }

    function reset() {
        if (currentStep === 0) {
            handleError('The graphic is already on its first item.');
            return;
        }
        let animation;
        if (state === 1) {
            currentStep = 0;
            animation = () => new Promise(resolve => { activeStep = 0; S.applyData(); resolve(); });
        } else if (state === 2) {
            currentStep = -1;
            animation = () => new Promise(resolve => { activeStep = -1; resolve(); }).then(next);
        } else {
            handleError('Cannot reset a graphic that has not been loaded.');
            return;
        }
        addPlayOutCommand(animation);
    }

    function previous() {
        if (currentStep > 0) {
            let animation;
            if (state === 2) {
                currentStep -= 2;
                animation = () => new Promise(resolve => { activeStep -= 2; resolve(); }).then(next);
            } else if (state === 1) {
                currentStep -= 1;
                animation = () => new Promise(resolve => { activeStep -= 1; S.applyData(); resolve(); });
            } else {
                handleError('Graphic can not go back one title in the current state.');
                return;
            }
            addPlayOutCommand(animation);
        } else {
            handleError('There is no graphic to go backwards to.');
        }
    }

    async function remove() {
        clearDisplayTimer();
        if (state === 2) await cfg.animateOut(data[activeStep], style);
    }

    function handleError(e) { console.error('[LT]', e); }
    function handleWarning(w) { console.warn('[LT]', w); }

    /* ── HTTP polling for API-driven updates ──────────────────── */

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
                    data = Array.isArray(payload.data) ? payload.data : [payload.data];
                    if (payload.style) style = payload.style;
                    if (data.length) {
                        activeStep = Math.min(activeStep, data.length - 1);
                        currentStep = activeStep;
                        S.applyData();
                        S.applyStyles();
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
        cfg = variantConfig;
        S.setContext({ cfg, data, style, activeStep, handleError });
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
        if (isStudioMode()) {
            window['studioHoldIn'] = studioHoldIn;
        }
    }

    return {
        init,
        getComputedStyle: S.getComputedStyle,
        startPolling,
        stopPolling,
        get state() { return state; },
        set state(v) { state = v; },
    };
})();
