'use strict';

/**
 * lt-tween.js — HighAsCG's own tween / timeline helper for the lower-thirds templates (WO-1096).
 *
 * Original code (AGPL-3.0-or-later like the rest of HighAsCG). It replaced the vendored GreenSock library (3.6.0), whose
 * "standard license" is proprietary and could not ship inside the AGPL project / the ISO.
 * The call shape is deliberately close to what the templates already wrote, so the timing stays the same:
 *
 *   var tl = LTTween.timeline({ onComplete: fn, onUpdate: fn, defaults: { ease: 'power2.in', duration: 0.5 } });
 *   tl.set(targets, vars, position)              // zero-length, applied when the playhead reaches it
 *     .to(targets, vars, position)               // from the current value to vars
 *     .fromTo(targets, fromVars, toVars, position) // fromVars applied immediately, and again at its start
 *     .call(fn, args, position)
 *     .addLabel(name, position);
 *   tl.kill(); tl.duration();
 *   LTTween.to(targets, vars)  — a one-tween timeline (vars.onUpdate / vars.onComplete), .kill() to stop
 *   LTTween.set(targets, vars) — applied now
 *   LTTween.timeScale([speed]) — global speed (the `speed` style field); LTTween.isActive()
 *   LTTween.parseEase(name)    — 'none' | power0-4 | sine | expo | circ | back(o) | elastic(a, p) | bounce
 *                                 with .in / .out / .inOut (no suffix = .out); quad/cubic/quart/quint = power1-4.
 *
 * Positions: seconds; '+=n' / '-=n' from the current end; '<' / '>' start / end of the previous child ('<+=n');
 * 'label', 'label+=n', 'label-=n'. No position = the current end. A timeline `duration` var reserves that much
 * lead-in before the first default-positioned child (the behaviour pre-WO-1096 exports were timed with).
 * Tween defaults: duration 0.5 s, ease 'power1.out'; a timeline-level `ease` is ignored (it never applied in the old
 * library either, so every built-in template animates with power1.out unless a tween names its own ease).
 * vars.stagger (s) offsets each target in turn.
 * Targets: element, array / NodeList, CSS selector string, or a plain object (numeric props).
 * Element props: x, y (px, or a '%' string), xPercent, yPercent, scale, scaleX, scaleY, rotation, skewX, skewY
 * (deg), opacity and any other numeric CSS property (camelCase; px unless a unit is given). Non-numeric values
 * (transformOrigin, colours, …) are set when the tween starts. Transforms are kept per element and written as one
 * `transform` (translate3d while moving); a template must not also put a CSS transform on an animated element.
 * Clock: requestAnimationFrame, with lag smoothing (a gap over 500 ms counts as 33 ms).
 */
(function (root) {
    /* ── eases (pure) ──────────────────────────────────────── */

    var HALF_PI = Math.PI / 2;
    function powIn(n) { return function (p) { return Math.pow(p, n); }; }
    function bounceOut(p) {
        var n = 7.5625, d = 2.75;
        if (p < 1 / d) return n * p * p;
        if (p < 2 / d) { p -= 1.5 / d; return n * p * p + 0.75; }
        if (p < 2.5 / d) { p -= 2.25 / d; return n * p * p + 0.9375; }
        p -= 2.625 / d;
        return n * p * p + 0.984375;
    }
    /** ease-in builders; each takes the numbers in the parentheses of e.g. 'back.out(1.7)'. */
    var EASE_IN = {
        power0: function () { return function (p) { return p; }; },
        power1: function () { return powIn(2); },
        power2: function () { return powIn(3); },
        power3: function () { return powIn(4); },
        power4: function () { return powIn(5); },
        sine: function () { return function (p) { return 1 - Math.cos(p * HALF_PI); }; },
        expo: function () { return function (p) { return p <= 0 ? 0 : Math.pow(2, 10 * (p - 1)); }; },
        circ: function () { return function (p) { return 1 - Math.sqrt(Math.max(0, 1 - p * p)); }; },
        bounce: function () { return function (p) { return 1 - bounceOut(1 - p); }; },
        back: function (args) {
            var o = args.length ? args[0] : 1.70158;
            return function (p) { return p * p * ((o + 1) * p - o); };
        },
        elastic: function (args) {
            var amp = Math.max(1, args.length ? args[0] : 1);
            var period = args.length > 1 ? args[1] : 0.3;
            var shift = (period / (2 * Math.PI)) * Math.asin(1 / amp);
            var out = function (p) {
                if (p <= 0 || p >= 1) return p <= 0 ? 0 : 1;
                return amp * Math.pow(2, -10 * p) * Math.sin(((p - shift) * 2 * Math.PI) / period) + 1;
            };
            return function (p) { return 1 - out(1 - p); };
        },
    };
    var ALIAS = { quad: 'power1', cubic: 'power2', quart: 'power3', quint: 'power4', strong: 'power4', linear: 'none' };
    var DEFAULT_EASE = 'power1.out';
    var easeCache = {};

    function linear(p) { return p; }

    /** @param {string|Function} spec @returns {(p: number) => number} */
    function parseEase(spec) {
        if (typeof spec === 'function') return spec;
        var key = String(spec == null || spec === '' ? DEFAULT_EASE : spec).replace(/\s+/g, '');
        if (easeCache[key]) return easeCache[key];
        var m = /^([a-z0-9]+)(?:\.(in|out|inOut))?(?:\(([^)]*)\))?$/i.exec(key);
        var name = m ? (ALIAS[m[1].toLowerCase()] || m[1].toLowerCase()) : '';
        var fn;
        if (name === 'none') {
            fn = linear;
        } else if (m && EASE_IN[name]) {
            var args = m[3] ? m[3].split(',').map(Number).filter(function (n) { return !isNaN(n); }) : [];
            var easeIn = EASE_IN[name](args);
            var type = m[2] || 'out';
            if (type === 'in') fn = easeIn;
            else if (type === 'out') fn = function (p) { return 1 - easeIn(1 - p); };
            else fn = function (p) { return p < 0.5 ? easeIn(p * 2) / 2 : 1 - easeIn((1 - p) * 2) / 2; };
        } else {
            if (typeof console !== 'undefined') console.warn('[LTTween] unknown ease "' + key + '", using ' + DEFAULT_EASE);
            return parseEase(DEFAULT_EASE);
        }
        easeCache[key] = fn;
        return fn;
    }

    /* ── values + targets ──────────────────────────────────── */

    var RESERVED = { duration: 1, ease: 1, delay: 1, stagger: 1, onComplete: 1, onUpdate: 1, immediateRender: 1, defaults: 1 };
    var TF = { x: 1, y: 1, xPercent: 1, yPercent: 1, scaleX: 1, scaleY: 1, rotation: 1, skewX: 1, skewY: 1 };
    var UNITLESS = { opacity: 1, zIndex: 1, fontWeight: 1, lineHeight: 1, flexGrow: 1, flexShrink: 1, order: 1, fillOpacity: 1, strokeOpacity: 1 };
    var tfState = typeof WeakMap === 'function' ? new WeakMap() : null;

    function round(v) { return Math.round(v * 10000) / 10000; }
    function round9(v) { return Math.round(v * 1e9) / 1e9; }
    function isEl(t) { return !!(t && t.nodeType === 1 && t.style); }
    function toTargets(t) {
        if (t == null) return [];
        if (typeof t === 'string') return typeof document === 'undefined' ? [] : Array.prototype.slice.call(document.querySelectorAll(t));
        if (Array.isArray(t)) return t.reduce(function (a, x) { return a.concat(toTargets(x)); }, []);
        if (typeof t.length === 'number' && typeof t.item === 'function') return Array.prototype.slice.call(t);
        return [t];
    }
    /** '12px' → { n: 12, u: 'px' }; 5 → { n: 5, u: null }; '+=10' → { n: 10, u: null, rel: 1 }; 'left' → null */
    function parseVal(v) {
        if (typeof v === 'number') return { n: v, u: null, rel: 0 };
        var m = /^\s*([+-]=)?\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(String(v));
        if (!m) return null;
        var n = parseFloat(m[2]);
        return { n: m[1] === '-=' ? -n : n, u: m[3] || null, rel: m[1] ? 1 : 0 };
    }
    function getTf(el) {
        var s = tfState && tfState.get(el);
        if (!s) {
            s = { x: 0, xu: 'px', y: 0, yu: 'px', xPercent: 0, yPercent: 0, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0 };
            if (tfState) tfState.set(el, s);
        }
        return s;
    }
    function writeTf(el, s, moving) {
        var out = '';
        if (s.xPercent || s.yPercent) out += 'translate(' + round(s.xPercent) + '%, ' + round(s.yPercent) + '%) ';
        var xs = round(s.x) + s.xu, ys = round(s.y) + s.yu;
        if (moving) out += 'translate3d(' + xs + ', ' + ys + ', 0px) ';
        else if (xs !== '0px' || ys !== '0px') out += 'translate(' + xs + ', ' + ys + ') ';
        var rot = round(s.rotation), kx = round(s.skewX), ky = round(s.skewY), sx = round(s.scaleX), sy = round(s.scaleY);
        if (rot) out += 'rotate(' + rot + 'deg) ';
        if (kx || ky) out += 'skew(' + kx + 'deg, ' + ky + 'deg) ';
        if (sx !== 1 || sy !== 1) out += 'scale(' + sx + ', ' + sy + ') ';
        el.style.transform = out.trim() || 'translate(0px, 0px)';
    }
    /** One target's property plan, read when the tween starts (so it continues from where the last one left). */
    function planFor(target, vars) {
        var props = [], sets = [], el = isEl(target), tf = el ? getTf(target) : null, cs = null;
        Object.keys(vars).forEach(function (k) {
            if (RESERVED[k]) return;
            var keys = el && k === 'scale' ? ['scaleX', 'scaleY'] : [k];
            keys.forEach(function (key) {
                var to = parseVal(vars[k]);
                if (!to) { sets.push([key, vars[k]]); return; }
                if (el && TF[key]) {
                    var unitKey = key === 'x' ? 'xu' : key === 'y' ? 'yu' : null;
                    var fromU = unitKey ? tf[unitKey] : null;
                    var u = unitKey ? (to.u || (to.n === 0 || to.rel ? fromU : 'px')) : null;
                    var from = tf[key];
                    if (unitKey && u !== fromU && from !== 0) {
                        var size = key === 'x' ? target.offsetWidth : target.offsetHeight;
                        from = size ? (u === '%' ? (from / size) * 100 : (from * size) / 100) : 0;
                    }
                    props.push({ tf: key, unitKey: unitKey, u: u, from: from, to: to.rel ? from + to.n : to.n });
                } else if (el) {
                    if (!cs) cs = window.getComputedStyle(target);
                    var cur = parseFloat(target.style[key] || cs[key]) || 0;
                    var unit = to.u || (UNITLESS[key] ? '' : 'px');
                    props.push({ css: key, u: unit, from: cur, to: to.rel ? cur + to.n : to.n });
                } else {
                    var o = Number(target[key]) || 0;
                    props.push({ key: key, from: o, to: to.rel ? o + to.n : to.n });
                }
            });
        });
        return { target: target, el: el, tf: tf, props: props, sets: sets };
    }
    function applyPlan(plan, ratio, moving) {
        var t = plan.target, touchedTf = false;
        for (var i = 0; i < plan.props.length; i++) {
            var p = plan.props[i], v = p.from + (p.to - p.from) * ratio;
            if (p.tf) { plan.tf[p.tf] = v; if (p.unitKey) plan.tf[p.unitKey] = p.u; touchedTf = true; }
            else if (p.css) t.style[p.css] = (p.u === 'px' ? Math.round(v) : round(v)) + p.u; // whole px, like before
            else t[p.key] = v;
        }
        if (touchedTf) writeTf(t, plan.tf, moving);
    }
    function applyNow(targets, vars) {
        toTargets(targets).forEach(function (t) {
            var plan = planFor(t, vars);
            applySets(plan);
            applyPlan(plan, 1, false);
        });
    }
    function applySets(plan) {
        plan.sets.forEach(function (s) { if (plan.el) plan.target.style[s[0]] = s[1]; else plan.target[s[0]] = s[1]; });
    }

    /* ── clock ─────────────────────────────────────────────── */

    var engine = { roots: [], scale: 1, last: 0, raf: 0, inTick: false };
    function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
    function step(dtMs) {
        // live length: a timeline created by a callback during this tick (the confetti burst) counts from the last
        // tick too, so it also gets this dt — at the studio hold-in's 1000x it lands on its end frame at once.
        var dt = (dtMs / 1000) * engine.scale, list = engine.roots;
        for (var i = 0; i < list.length; i++) if (!list[i].dead) list[i].advance(dt);
        engine.roots = engine.roots.filter(function (a) { return !a.dead; });
    }
    function tick() {
        engine.raf = 0;
        var t = now(), dt = t - engine.last;
        engine.last = t;
        if (dt > 500) dt = 33; // lag smoothing: a stalled page resumes instead of jumping
        engine.inTick = true;
        try { step(dt); } finally { engine.inTick = false; }
        if (engine.roots.length) wake();
    }
    function wake() {
        if (engine.raf || typeof requestAnimationFrame !== 'function') return;
        if (!engine.roots.length) return;
        engine.raf = requestAnimationFrame(tick);
    }
    function addRoot(tl) {
        if (!engine.raf && !engine.inTick) engine.last = now(); // idle: count from now
        engine.roots.push(tl);
        wake();
    }

    /* ── timeline ──────────────────────────────────────────── */

    function Timeline(vars) {
        this.vars = vars || {};
        this.defaults = this.vars.defaults || {};
        this.children = [];
        this.labels = {};
        this.end = Number(this.vars.duration) > 0 ? Number(this.vars.duration) : 0;
        this.prev = null;
        this.time = 0;
        this.dead = false;
        addRoot(this);
    }
    Timeline.prototype.position = function (pos) {
        if (pos == null || pos === '') return this.end;
        if (typeof pos === 'number') return pos;
        var s = String(pos).replace(/\s+/g, ''), off = 0, m = /([+-])=(-?[\d.]+)$/.exec(s);
        if (m) { off = (m[1] === '-' ? -1 : 1) * parseFloat(m[2]); s = s.slice(0, m.index); }
        if (s === '') return this.end + off;
        if (s === '<') return (this.prev ? this.prev.start : 0) + off;
        if (s === '>') return (this.prev ? this.prev.start + this.prev.dur : this.end) + off;
        if (!isNaN(Number(s))) return Number(s) + off;
        if (!(s in this.labels)) this.labels[s] = this.end;
        return this.labels[s] + off;
    };
    Timeline.prototype.add = function (child, start) {
        child.start = start = round9(start);
        var i = this.children.length;
        while (i > 0 && this.children[i - 1].start > start) i--;
        this.children.splice(i, 0, child);
        this.end = Math.max(this.end, start + child.dur);
        this.prev = child;
        return child;
    };
    Timeline.prototype.tween = function (targets, fromVars, vars, pos, isSet) {
        var d = this.defaults, list = toTargets(targets);
        var dur = isSet ? 0 : Number(vars.duration != null ? vars.duration : d.duration != null ? d.duration : 0.5);
        var ease = parseEase(vars.ease != null ? vars.ease : d.ease);
        var stagger = Number(vars.stagger) || 0, start = this.position(pos) + (Number(vars.delay) || 0);
        var group = { dur: dur + stagger * Math.max(0, list.length - 1), start: start };
        if (fromVars && fromVars.immediateRender !== false) applyNow(list, fromVars);
        for (var i = 0; i < list.length; i++) {
            var c = this.add({ target: list[i], from: fromVars, vars: vars, dur: dur, ease: ease, plan: null, done: false }, start + i * stagger);
            this.end = Math.max(this.end, c.start + dur);
        }
        this.prev = group;
        return this;
    };
    Timeline.prototype.set = function (targets, vars, pos) { return this.tween(targets, null, vars, pos, true); };
    Timeline.prototype.to = function (targets, vars, pos) { return this.tween(targets, null, vars, pos, false); };
    Timeline.prototype.fromTo = function (targets, fromVars, toVars, pos) { return this.tween(targets, fromVars, toVars, pos, false); };
    Timeline.prototype.call = function (fn, args, pos) {
        this.add({ fn: fn, args: args || [], dur: 0, done: false }, this.position(pos));
        return this;
    };
    Timeline.prototype.addLabel = function (name, pos) { this.labels[name] = this.position(pos); return this; };
    Timeline.prototype.duration = function () { return this.end; };
    Timeline.prototype.kill = function () { this.dead = true; return this; };
    Timeline.prototype.advance = function (dt) {
        this.time = round9(this.time + dt); // float dust would start tweens a hair early
        var t = this.time, all = true;
        for (var i = 0; i < this.children.length && !this.dead; i++) {
            var c = this.children[i];
            if (c.done) continue;
            if (t < c.start) { all = false; continue; }
            if (c.fn) { c.done = true; c.fn.apply(null, c.args); continue; }
            if (!c.plan) {
                if (c.from) applyNow([c.target], c.from);
                c.plan = planFor(c.target, c.vars);
                applySets(c.plan);
            }
            var p = c.dur > 0 ? Math.min(1, (t - c.start) / c.dur) : 1;
            var ratio = p >= 1 ? 1 : c.ease(p);
            applyPlan(c.plan, ratio, ratio !== 0 && ratio !== 1);
            if (p >= 1) c.done = true; else all = false;
        }
        if (this.dead) return;
        if (typeof this.vars.onUpdate === 'function') this.vars.onUpdate();
        if (all && t >= this.end) {
            this.dead = true;
            if (typeof this.vars.onComplete === 'function') this.vars.onComplete();
        }
    };

    /* ── api ───────────────────────────────────────────────── */

    var api = {
        timeline: function (vars) { return new Timeline(vars); },
        to: function (targets, vars) {
            var tl = new Timeline({ onUpdate: vars.onUpdate, onComplete: vars.onComplete });
            return tl.to(targets, vars, 0);
        },
        set: function (targets, vars) { applyNow(targets, vars); },
        timeScale: function (v) {
            if (v === undefined) return engine.scale;
            var n = Number(v);
            engine.scale = isFinite(n) && n > 0 ? n : 1;
            return engine.scale;
        },
        isActive: function () { return engine.roots.some(function (a) { return !a.dead; }); },
        parseEase: parseEase,
        /** Advance every running timeline by `ms` now (tests / offline renders; the rAF clock keeps running). */
        step: function (ms) { step(Number(ms) || 0); },
    };

    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.LTTween = api;
})(typeof window !== 'undefined' ? window : null);
