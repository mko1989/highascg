'use strict';

/** Data/style/XML helpers for lt-engine (WO-120). */
window.LTEngineStyles = (function () {
    let ctx = {};
    function C() { return ctx; }
    function setContext(c) { ctx = c; }

    const STYLE_KEYS = new Set([
        'primaryColor', 'textColor', 'panelColor', 'gradientMid', 'gradientEnd',
        'position', 'marginX', 'marginY', 'opacity',
        'boxWidth', 'boxHeight', 'boxScale',
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
        const step = C().data[C().activeStep];
        if (!step || typeof step !== 'object') return;
        STYLE_KEYS.forEach((key) => {
            if (step[key] != null && step[key] !== '') {
                C().style[key] = step[key];
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
                C().handleError(error);
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
        const raw = C().style.displayDurationSec;
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
            .catch(C().handleError);
    }

    function addPlayOutCommand(prom) {
        if (animationQueue.length < animationThreshold && prom) {
            animationQueue.push(prom);
            if (animationQueue.length === animationThreshold)
                handleWarning('Animation threshold met');
        }
        if (animationQueue.length === 1) executePlayOutCommand();
    }

    /* ── C().data / C().style ────────────────────────────────────────── */

    function applyData() {
        if (typeof C().cfg.applyData === 'function') {
            C().cfg.applyData(C().data[C().activeStep]);
            return;
        }
        const container = document.querySelector(C().cfg.containerSel);
        const title = container.querySelector(C().cfg.titleSel || 'h1');
        const subtitle = container.querySelector(C().cfg.subtitleSel || 'p');
        
        const stepData = C().data[C().activeStep] || {};
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

    // WO-267: this whole function was corrupted by a past mechanical style->context rename that
    // also rewrote DOM property chains (container margins), the custom-font element id, and the
    // createElement tag — every call threw a TypeError, so lt-engine-core templates never got
    // styles applied. Repaired here; margins now use individual properties (the shorthand
    // stomped the auto margins anchoring center/right).
    function applyStyles() {
        if (C().style.customFont) {
            let styleEl = document.getElementById('lt-custom-font-style');
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'lt-custom-font-style';
                document.head.appendChild(styleEl);
            }
            // Add a timestamp or encode URI to handle paths
            styleEl.innerHTML = `@font-face {
                font-family: 'LTCustomFont';
                src: url('../fonts/${C().style.customFont}');
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
            gsap.globalTimeline.timeScale(C().style.speed ? Number(C().style.speed) : 1);
        }

        // Apply position positioning on the main container
        if (C().cfg.containerSel) {
            const container = document.querySelector(C().cfg.containerSel);
            if (container) {
                // Reset inline margins to prevent accumulation
                container.style.marginLeft = '';
                container.style.marginRight = '';
                container.style.marginTop = '';
                container.style.marginBottom = '';
                container.style.margin = '';

                const pos = (C().style.position || 'left').toLowerCase();
                if (pos === 'center') {
                    container.style.marginLeft = 'auto';
                    container.style.marginRight = 'auto';
                } else if (pos === 'right') {
                    container.style.marginLeft = 'auto';
                } else {
                    // Default to left
                    container.style.marginRight = 'auto';
                }
                if (C().style.marginX != null || C().style.marginY != null) {
                    const mx = C().style.marginX != null && C().style.marginX !== '' ? Number(C().style.marginX) : 77;
                    const my = C().style.marginY != null && C().style.marginY !== '' ? Number(C().style.marginY) : 43;
                    if (Number.isFinite(mx) && Number.isFinite(my)) {
                        container.style.marginBottom = my + 'px';
                        if (pos === 'right') container.style.marginRight = mx + 'px';
                        else if (pos !== 'center') container.style.marginLeft = mx + 'px';
                    }
                }
                if (C().style.opacity != null && C().style.opacity !== '') {
                    const op = Number(C().style.opacity);
                    if (Number.isFinite(op)) container.style.opacity = String(Math.max(0, Math.min(1, op)));
                }
            }
        }

        applyTypographyOverrides();
        applyBoxSizeOverride();
        applyBlurOverride();

        if (typeof C().cfg.applyStyles === 'function') {
            C().cfg.applyStyles(C().style);
            return;
        }
    }

    function applyTypographyOverrides() {
        const titleSel = C().cfg.titleSel || 'h1';
        const subtitleSel = C().cfg.subtitleSel || 'p';
        const rules = [];
        if (C().style.titleFontSize != null && C().style.titleFontSize !== '') {
            rules.push(titleSel + ' { font-size: ' + Number(C().style.titleFontSize) + 'px !important; }');
        }
        if (C().style.subtitleFontSize != null && C().style.subtitleFontSize !== '') {
            rules.push(subtitleSel + ' { font-size: ' + Number(C().style.subtitleFontSize) + 'px !important; }');
        }
        if (C().style.titleFontWeight != null && C().style.titleFontWeight !== '') {
            rules.push(titleSel + ' { font-weight: ' + C().style.titleFontWeight + ' !important; }');
        }
        if (C().style.letterSpacing != null && C().style.letterSpacing !== '') {
            rules.push(titleSel + ' { letter-spacing: ' + C().style.letterSpacing + ' !important; }');
            rules.push(subtitleSel + ' { letter-spacing: ' + C().style.letterSpacing + ' !important; }');
        }
        if (C().style.textTransform) {
            rules.push(titleSel + ' { text-transform: ' + C().style.textTransform + ' !important; }');
            rules.push(subtitleSel + ' { text-transform: ' + C().style.textTransform + ' !important; }');
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

    /**
     * WO-285: the resizable "box" is the inner graphic panel every lower-third variant wraps its
     * content in (`.graphic`), falling back to the positioned container for variants that don't.
     * A variant may name it explicitly via cfg.boxSel.
     */
    function boxElement() {
        if (!C().cfg.containerSel) return null;
        if (C().cfg.boxSel) return document.querySelector(C().cfg.boxSel);
        return document.querySelector(C().cfg.containerSel + ' .graphic')
            || document.querySelector(C().cfg.containerSel);
    }

    function numericOverride(raw, min) {
        if (raw == null || raw === '') return null;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < min) return null;
        return n;
    }

    /**
     * WO-285: opt-in box sizing (width/height/scale). Every write is guarded by a dataset marker
     * so that with the keys unset — the default — this function performs no DOM writes at all and
     * on-air geometry is bit-for-bit what the template's own CSS produces.
     */
    function applyBoxSizeOverride() {
        const box = boxElement();
        if (box) {
            const w = numericOverride(C().style.boxWidth, 1);
            const h = numericOverride(C().style.boxHeight, 1);
            if (w != null || h != null) {
                if (w != null) {
                    // the template .graphic panels carry min-/max-width clamps that would silently
                    // swallow an explicit width — released only while an override is active.
                    box.style.width = w + 'px';
                    box.style.minWidth = '0';
                    box.style.maxWidth = 'none';
                }
                if (h != null) {
                    box.style.height = h + 'px';
                    box.style.maxHeight = 'none';
                }
                box.dataset.ltBoxSized = '1';
            } else if (box.dataset.ltBoxSized) {
                box.style.width = '';
                box.style.minWidth = '';
                box.style.maxWidth = '';
                box.style.height = '';
                box.style.maxHeight = '';
                delete box.dataset.ltBoxSized;
            }
        }

        const container = C().cfg.containerSel ? document.querySelector(C().cfg.containerSel) : null;
        if (!container) return;
        const scale = numericOverride(C().style.boxScale, 0.01);
        if (scale != null && scale !== 1) {
            // Scale about the anchored corner so the marginX/marginY the operator set stays put.
            const pos = (C().style.position || 'left').toLowerCase();
            const originX = pos === 'right' ? 'right' : pos === 'center' ? 'center' : 'left';
            container.style.transformOrigin = originX + ' bottom';
            container.style.transform = 'scale(' + scale + ')';
            container.dataset.ltBoxScaled = '1';
        } else if (container.dataset.ltBoxScaled) {
            container.style.transform = '';
            container.style.transformOrigin = '';
            delete container.dataset.ltBoxScaled;
        }
    }

    function applyBlurOverride() {
        if (C().style.blurAmount == null || C().style.blurAmount === '' || !C().cfg.containerSel) return;
        const panel = document.querySelector(C().cfg.containerSel + ' .glass-panel');
        if (panel) panel.style.backdropFilter = 'blur(' + Number(C().style.blurAmount) + 'px)';
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

    return {
        setContext,
        STYLE_KEYS,
        syncStyleFromActiveData,
        normalizeUpdatePayload,
        getComputedStyle,
        applyData,
        applyStyles,
        applyTypographyOverrides,
        applyBoxSizeOverride,
        applyBlurOverride,
        parseCasparXML,
    };
})();
