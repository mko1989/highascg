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

    const STYLE_KEYS = new Set([
        'primaryColor', 'textColor', 'panelColor', 'gradientMid', 'gradientEnd',
        'position', 'marginX', 'marginY', 'opacity',
        'titleFontSize', 'subtitleFontSize', 'titleFontWeight', 'letterSpacing', 'textTransform',
        'blurAmount', 'displayDurationSec', 'speed', 'customFont',
    ]);

    function isStudioMode() {
        try {
            return new URLSearchParams(window.location.search).get('studio') === '1';
        } catch (_) {
            return false;
        }
    }

    function clearDisplayTimer() {
        if (displayTimer) {
            clearTimeout(displayTimer);
            displayTimer = null;
        }
    }

    function syncStyleFromActiveData() {
        const step = data[activeStep];
        if (!step || typeof step !== 'object') return;
        STYLE_KEYS.forEach((key) => {
            if (step[key] != null && step[key] !== '') {
                style[key] = step[key];
            }
        });
    }

    function normalizeUpdatePayload(raw) {
        let parsed;
        if (typeof raw === 'string' && raw.trim().startsWith('<')) {
            parsed = parseCasparXML(raw);
        } else {
            try {
                parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch (error) {
                handleError(error);
                return null;
            }
        }
        if (!parsed || typeof parsed !== 'object') return null;

        if (parsed.data != null || parsed.style != null) {
            return {
                data: parsed.data != null
                    ? (Array.isArray(parsed.data) ? parsed.data : [parsed.data])
                    : null,
                style: parsed.style && typeof parsed.style === 'object' ? { ...parsed.style } : {},
            };
        }

        const dataObj = {};
        const styleObj = {};
        Object.entries(parsed).forEach(([key, value]) => {
            if (STYLE_KEYS.has(key)) styleObj[key] = value;
            else dataObj[key] = value;
        });
        return {
            data: Object.keys(dataObj).length ? [dataObj] : null,
            style: styleObj,
        };
    }

    function readDisplayDurationSec() {
        syncStyleFromActiveData();
        const raw = style.displayDurationSec;
        if (raw === 0 || raw === '0') return 0;
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) return 10;
        return Math.max(0, n);
    }

    function scheduleDisplayStop() {
        if (isStudioMode()) return;
        clearDisplayTimer();
        const durationSec = readDisplayDurationSec();
        if (durationSec <= 0) return;
        displayTimer = setTimeout(() => {
            displayTimer = null;
            if (state === 2) stop();
        }, durationSec * 1000);
    }

    /* ── helpers ─────────────────────────────────────────────── */

    function getComputedStyle(elem, styles) {
        const cs = window.getComputedStyle(elem);
        const arr = Array.isArray(styles) ? styles : [styles];
        return arr.map(s => {
            let v = cs.getPropertyValue(s);
            if (typeof v === 'string' && v.includes('px'))
                v = Number(v.replace('px', ''));
            return v;
        });
    }

    function executePlayOutCommand() {
        animationQueue[0]()
            .then(() => {
                animationQueue.splice(0, 1);
                if (animationQueue.length) executePlayOutCommand();
            })
            .catch(handleError);
    }

    function addPlayOutCommand(prom) {
        if (animationQueue.length < animationThreshold && prom) {
            animationQueue.push(prom);
            if (animationQueue.length === animationThreshold)
                handleWarning('Animation threshold met');
        }
        if (animationQueue.length === 1) executePlayOutCommand();
    }

    /* ── data / style ────────────────────────────────────────── */

    function applyData() {
        if (typeof cfg.applyData === 'function') {
            cfg.applyData(data[activeStep]);
            return;
        }
        const container = document.querySelector(cfg.containerSel);
        const title = container.querySelector(cfg.titleSel || 'h1');
        const subtitle = container.querySelector(cfg.subtitleSel || 'p');
        
        const stepData = data[activeStep] || {};
        let primaryText = '';
        let secondaryText = '';
        
        if (stepData.f0 !== undefined) {
            primaryText = stepData.f0;
        } else if (stepData.name !== undefined) {
            primaryText = stepData.name;
        } else if (stepData.title !== undefined && stepData.name === undefined) {
            primaryText = stepData.title;
        } else {
            primaryText = stepData.title || '';
        }
        
        if (stepData.f1 !== undefined) {
            secondaryText = stepData.f1;
        } else if (stepData.subtitle !== undefined) {
            secondaryText = stepData.subtitle;
        } else if (stepData.name !== undefined && stepData.title !== undefined) {
            secondaryText = stepData.title;
        } else if (stepData.role !== undefined) {
            secondaryText = stepData.role;
        } else if (stepData.description !== undefined) {
            secondaryText = stepData.description;
        }
        
        if (title) title.textContent = primaryText || '';
        if (subtitle) subtitle.textContent = secondaryText || '';
    }

    function applyStyles() {
        if (style.customFont) {
            let styleEl = document.getElementById('lt-custom-font-style');
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'lt-custom-font-style';
                document.head.appendChild(styleEl);
            }
            // Add a timestamp or encode URI to handle paths
            styleEl.innerHTML = `@font-face {
                font-family: 'LTCustomFont';
                src: url('../fonts/${style.customFont}');
            }`;
            // Apply it to the body or container
            document.body.style.fontFamily = "'LTCustomFont', 'Arial', sans-serif";
        } else {
            // Revert to original if removed
            const styleEl = document.getElementById('lt-custom-font-style');
            if (styleEl) styleEl.innerHTML = '';
            document.body.style.fontFamily = "'Arial', 'Helvetica Neue', sans-serif";
        }

        // Apply global animation speed if gsap is available
        if (window.gsap && window.gsap.globalTimeline) {
            gsap.globalTimeline.timeScale(style.speed ? Number(style.speed) : 1);
        }

        // Apply position positioning on the main container
        if (cfg.containerSel) {
            const container = document.querySelector(cfg.containerSel);
            if (container) {
                // Reset inline margins to prevent accumulation
                container.style.marginLeft = '';
                container.style.marginRight = '';
                container.style.margin = '';
                
                const pos = (style.position || 'left').toLowerCase();
                if (pos === 'center') {
                    container.style.marginLeft = 'auto';
                    container.style.marginRight = 'auto';
                } else if (pos === 'right') {
                    container.style.marginLeft = 'auto';
                } else {
                    // Default to left
                    container.style.marginRight = 'auto';
                }
                if (style.marginX != null || style.marginY != null) {
                    const mx = style.marginX != null && style.marginX !== '' ? Number(style.marginX) : 77;
                    const my = style.marginY != null && style.marginY !== '' ? Number(style.marginY) : 43;
                    if (Number.isFinite(mx) && Number.isFinite(my)) {
                        container.style.margin = my + 'px ' + mx + 'px';
                    }
                }
                if (style.opacity != null && style.opacity !== '') {
                    const op = Number(style.opacity);
                    if (Number.isFinite(op)) container.style.opacity = String(Math.max(0, Math.min(1, op)));
                }
            }
        }

        applyTypographyOverrides();
        applyBlurOverride();

        if (typeof cfg.applyStyles === 'function') {
            cfg.applyStyles(style);
            return;
        }
    }

    function applyTypographyOverrides() {
        const titleSel = cfg.titleSel || 'h1';
        const subtitleSel = cfg.subtitleSel || 'p';
        const rules = [];
        if (style.titleFontSize != null && style.titleFontSize !== '') {
            rules.push(titleSel + ' { font-size: ' + Number(style.titleFontSize) + 'px !important; }');
        }
        if (style.subtitleFontSize != null && style.subtitleFontSize !== '') {
            rules.push(subtitleSel + ' { font-size: ' + Number(style.subtitleFontSize) + 'px !important; }');
        }
        if (style.titleFontWeight != null && style.titleFontWeight !== '') {
            rules.push(titleSel + ' { font-weight: ' + style.titleFontWeight + ' !important; }');
        }
        if (style.letterSpacing != null && style.letterSpacing !== '') {
            rules.push(titleSel + ' { letter-spacing: ' + style.letterSpacing + ' !important; }');
            rules.push(subtitleSel + ' { letter-spacing: ' + style.letterSpacing + ' !important; }');
        }
        if (style.textTransform) {
            rules.push(titleSel + ' { text-transform: ' + style.textTransform + ' !important; }');
            rules.push(subtitleSel + ' { text-transform: ' + style.textTransform + ' !important; }');
        }
        let el = document.getElementById('lt-studio-typography');
        if (!rules.length) {
            if (el) el.textContent = '';
            return;
        }
        if (!el) {
            el = document.createElement('style');
            el.id = 'lt-studio-typography';
            document.head.appendChild(el);
        }
        el.textContent = rules.join('\n');
    }

    function applyBlurOverride() {
        if (style.blurAmount == null || style.blurAmount === '' || !cfg.containerSel) return;
        const panel = document.querySelector(cfg.containerSel + ' .glass-panel');
        if (panel) panel.style.backdropFilter = 'blur(' + Number(style.blurAmount) + 'px)';
    }

    function parseCasparXML(xml) {
        const dataObj = {};
        const parser = /<componentData\s+id=["']([^"']+)["']>\s*<value>([\s\S]*?)<\/value>/gi;
        let match;
        while ((match = parser.exec(xml)) !== null) {
            dataObj[match[1]] = match[2].trim();
        }
        
        let title = '';
        let subtitle = '';
        
        if (dataObj.f0 !== undefined) {
            title = dataObj.f0;
        } else if (dataObj.name !== undefined) {
            title = dataObj.name;
        } else if (dataObj.title !== undefined && dataObj.name === undefined) {
            title = dataObj.title;
        } else {
            title = dataObj.title || '';
        }
        
        if (dataObj.f1 !== undefined) {
            subtitle = dataObj.f1;
        } else if (dataObj.subtitle !== undefined) {
            subtitle = dataObj.subtitle;
        } else if (dataObj.name !== undefined && dataObj.title !== undefined) {
            subtitle = dataObj.title;
        } else if (dataObj.role !== undefined) {
            subtitle = dataObj.role;
        } else if (dataObj.description !== undefined) {
            subtitle = dataObj.description;
        }
        
        const styleObj = {};
        if (dataObj.primaryColor) styleObj.primaryColor = dataObj.primaryColor;
        if (dataObj.textColor) styleObj.textColor = dataObj.textColor;
        if (dataObj.position) styleObj.position = dataObj.position;
        if (dataObj.speed) styleObj.speed = dataObj.speed;
        if (dataObj.customFont) styleObj.customFont = dataObj.customFont;
        if (dataObj.displayDurationSec != null) styleObj.displayDurationSec = dataObj.displayDurationSec;
        
        return {
            data: { ...dataObj, title, subtitle },
            style: styleObj
        };
    }


    function studioHoldIn() {
        ensurePlayableDefaults();
        syncStyleFromActiveData();
        applyData();
        applyStyles();
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
        applyData();
        applyStyles();
        if (state === 0) state = 1;
    }

    function update(raw) {
        const parsed = normalizeUpdatePayload(raw);
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
            applyData();
            applyStyles();
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
                        applyData();
                        applyStyles();
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
            animation = () => new Promise(resolve => { activeStep = 0; applyData(); resolve(); });
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
                animation = () => new Promise(resolve => { activeStep -= 1; applyData(); resolve(); });
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
                    data = Array.isArray(payload.data) ? payload.data : [payload.data];
                    if (payload.style) style = payload.style;
                    if (data.length) {
                        activeStep = Math.min(activeStep, data.length - 1);
                        currentStep = activeStep;
                        applyData();
                        applyStyles();
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
        getComputedStyle,
        startPolling,
        stopPolling,
        get state() { return state; },
        set state(v) { state = v; },
    };
})();
