'use strict';

/**
 * countdown-engine.js — Countdown / timer CG template engine (WO-169).
 *
 * Feature set ported from `work/references/show_creator/companion-module-highpass-countdown/src/timer.js`
 * (timer core :1168-1229, config fields :511) — that module is a Companion web page with no
 * CasparCG integration; only its FEATURE SET is ported here, not its code. Added on top of the
 * reference: countdown-to-clock-time (the reference explicitly lacked it) and an optional
 * count-up mode (default off).
 *
 * CasparCG HTML template contract (@see docs/wiki/api/cg.md):
 *   - `window.update(json)` — merges config + optional `{ cmd: 'start' | 'pause' | 'reset' }`.
 *   - `window.play()` / `window.stop()` — CG PLAY / STOP control the overlay's VISIBILITY only
 *     (fade in/out), same as `CG ADD ... 1 ...` auto-invoking play() on load. They do NOT start
 *     or stop the timer — that is controlled exclusively via `cmd` in the update payload, per
 *     WO-169 ("Timer state lives IN the template; CG UPDATE carries config + commands").
 *   - `window.next()` — no-op (a countdown has no steps/pages); present so `CG ... NEXT` never
 *     throws in the Caspar HTML producer.
 *   - `window.remove()` — hides the overlay and stops the local tick interval (CG REMOVE).
 *
 * Drift-free ticking: durations and clock targets are stored as absolute epoch milliseconds
 * (`endEpochMs` / `startEpochMs`) and the remaining/elapsed seconds are RE-DERIVED from
 * `Date.now()` on every tick — never decremented as a running counter — so display stays
 * accurate to the wall clock regardless of tick jitter or how long the template has been open.
 */

const CountdownEngine = (function () {
	/** @type {ReturnType<typeof setInterval> | null} */
	let tickTimer = null;

	const POSITIONS = [
		'top-left', 'top-middle', 'top-right',
		'bottom-left', 'bottom-middle', 'bottom-right',
		'center',
	];

	const DEFAULT_CONFIG = {
		mode: 'duration',        // 'duration' | 'clock' | 'countup'
		durationSec: 300,        // seed for mode === 'duration'
		targetTime: '18:00:00',  // HH:MM[:SS] local — mode === 'clock'
		format: 'auto',          // 'hms' | 'ms' | 'auto'
		amberThresholdSec: 60,
		redThresholdSec: 15,
		position: 'center',
		hideTimer: false,        // true → show the middle aux line where the timer would sit
		timerFontSize: 15,       // vw
		auxFontSize: 5,          // vw
		timerColor: '#ffffff',
		amberColor: '#ffb300',
		redColor: '#ff3b30',
		auxColor: '#ffffff',
		auxTop: '',
		auxMiddle: '',
		auxBottom: '',
	};

	let config = Object.assign({}, DEFAULT_CONFIG);
	/** @type {'stopped' | 'running' | 'paused'} */
	let state = 'stopped';
	let remainingSec = 0;   // duration / clock modes — last computed/frozen display value
	let elapsedSec = 0;     // countup mode
	let endEpochMs = null;  // duration / clock modes anchor
	let startEpochMs = null; // countup mode anchor
	let visible = false;

	/** @type {{ root: HTMLElement|null, timer: HTMLElement|null, auxTop: HTMLElement|null, auxMiddle: HTMLElement|null, auxBottom: HTMLElement|null }} */
	let dom = { root: null, timer: null, auxTop: null, auxMiddle: null, auxBottom: null };

	/* ── time math (pure — exported for Node smokes) ─────────────────────────── */

	function pad2(n) {
		return String(Math.floor(Math.abs(n))).padStart(2, '0');
	}

	function formatHMS(totalSec) {
		const sign = totalSec < 0 ? '-' : '';
		const abs = Math.abs(Math.trunc(totalSec));
		const h = Math.floor(abs / 3600);
		const m = Math.floor((abs % 3600) / 60);
		const s = abs % 60;
		return sign + pad2(h) + ':' + pad2(m) + ':' + pad2(s);
	}

	function formatMS(totalSec) {
		const sign = totalSec < 0 ? '-' : '';
		const abs = Math.abs(Math.trunc(totalSec));
		const m = Math.floor(abs / 60);
		const s = abs % 60;
		return sign + pad2(m) + ':' + pad2(s);
	}

	/**
	 * @param {number} totalSec
	 * @param {'hms'|'ms'|'auto'} format
	 * @returns {string}
	 */
	function formatTime(totalSec, format) {
		const n = Number(totalSec) || 0;
		// WO-169: negative overflow always renders full -HH:MM:SS, regardless of configured format.
		if (n < 0) return formatHMS(n);
		if (format === 'hms') return formatHMS(n);
		if (format === 'ms') return formatMS(n);
		return Math.abs(n) >= 3600 ? formatHMS(n) : formatMS(n);
	}

	/**
	 * Next occurrence (today, or tomorrow if already passed) of a local HH:MM[:SS] time.
	 * @param {string} targetTime
	 * @param {Date} [now]
	 * @returns {number} epoch ms
	 */
	function parseTargetTimeToNextEpoch(targetTime, now) {
		const nowDate = now instanceof Date ? now : new Date();
		const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(targetTime || '').trim());
		if (!m) return nowDate.getTime();
		const h = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
		const mi = Math.min(59, Math.max(0, parseInt(m[2], 10) || 0));
		const s = m[3] != null ? Math.min(59, Math.max(0, parseInt(m[3], 10) || 0)) : 0;
		const target = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), h, mi, s, 0);
		if (target.getTime() <= nowDate.getTime()) target.setDate(target.getDate() + 1);
		return target.getTime();
	}

	/* ── state machine ─────────────────────────────────────────────────────── */

	function computeDisplaySeconds() {
		if (config.mode === 'countup') {
			if (state === 'running' && startEpochMs != null) {
				elapsedSec = Math.round((Date.now() - startEpochMs) / 1000);
			}
			return elapsedSec;
		}
		if (state === 'running' && endEpochMs != null) {
			remainingSec = Math.round((endEpochMs - Date.now()) / 1000);
		}
		return remainingSec;
	}

	function currentColor(totalSec) {
		if (config.mode === 'countup') return config.timerColor;
		if (totalSec <= 0) return config.redColor;
		if (totalSec <= Number(config.redThresholdSec)) return config.redColor;
		if (totalSec <= Number(config.amberThresholdSec)) return config.amberColor;
		return config.timerColor;
	}

	function applyPositionClass() {
		if (!dom.root) return;
		POSITIONS.forEach((p) => dom.root.classList.remove('countdown-pos-' + p));
		const pos = POSITIONS.indexOf(config.position) >= 0 ? config.position : 'top-left';
		dom.root.classList.add('countdown-pos-' + pos);
	}

	function applyAux(el, text) {
		if (!el) return;
		el.textContent = text || '';
		el.style.color = config.auxColor || DEFAULT_CONFIG.auxColor;
		el.style.fontSize = (Number(config.auxFontSize) || DEFAULT_CONFIG.auxFontSize) + 'vw';
	}

	function render() {
		if (!dom.root) return;
		const totalSec = computeDisplaySeconds();
		if (dom.timer) {
			dom.timer.textContent = formatTime(totalSec, config.format);
			dom.timer.style.color = currentColor(totalSec);
			dom.timer.style.fontSize = (Number(config.timerFontSize) || DEFAULT_CONFIG.timerFontSize) + 'vw';
			dom.timer.style.display = config.hideTimer ? 'none' : '';
		}
		applyAux(dom.auxTop, config.auxTop);
		applyAux(dom.auxMiddle, config.auxMiddle);
		applyAux(dom.auxBottom, config.auxBottom);
	}

	function ensureTicking() {
		if (tickTimer) return;
		tickTimer = setInterval(render, 250);
	}

	function stopTicking() {
		if (tickTimer) {
			clearInterval(tickTimer);
			tickTimer = null;
		}
	}

	function doStart() {
		if (state === 'running') {
			render();
			return;
		}
		if (config.mode === 'countup') {
			startEpochMs = Date.now() - Math.max(0, elapsedSec) * 1000;
		} else if (config.mode === 'clock') {
			// Absolute wall-clock target — recomputed fresh from Date.now() every tick, so it
			// hits zero at the target time regardless of when start was pressed (A169.2).
			endEpochMs = parseTargetTimeToNextEpoch(config.targetTime);
		} else {
			const seed = state === 'paused' ? remainingSec : (Number(config.durationSec) || 0);
			remainingSec = seed;
			endEpochMs = Date.now() + seed * 1000;
		}
		state = 'running';
		ensureTicking();
		render();
	}

	function doPause() {
		if (state !== 'running') return;
		computeDisplaySeconds(); // snapshot into remainingSec / elapsedSec before freezing
		state = 'paused';
		render();
	}

	function doReset() {
		state = 'stopped';
		if (config.mode === 'countup') {
			elapsedSec = 0;
			startEpochMs = null;
		} else if (config.mode === 'clock') {
			endEpochMs = parseTargetTimeToNextEpoch(config.targetTime);
			remainingSec = Math.round((endEpochMs - Date.now()) / 1000);
		} else {
			remainingSec = Number(config.durationSec) || 0;
			endEpochMs = null;
		}
		render();
	}

	/**
	 * @param {object} raw — config fields plus optional `cmd`
	 */
	function applyConfig(raw) {
		if (!raw || typeof raw !== 'object') return;
		const cmd = raw.cmd;
		const rest = {};
		Object.keys(raw).forEach((k) => {
			if (k !== 'cmd') rest[k] = raw[k];
		});
		const prevMode = config.mode;
		Object.assign(config, rest);
		if (config.mode !== prevMode && !cmd) {
			// Mode switch with no explicit command — reset into the new mode so stale
			// duration/clock/countup anchors from the previous mode don't leak through.
			doReset();
			return;
		}
		applyPositionClass();
		if (cmd === 'start') doStart();
		else if (cmd === 'pause') doPause();
		else if (cmd === 'reset') doReset();
		else render();
	}

	function update(raw) {
		let parsed;
		try {
			parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		} catch (e) {
			console.error('[Countdown] bad update payload', e);
			return;
		}
		applyConfig(parsed);
	}

	function play() {
		visible = true;
		if (dom.root) dom.root.style.opacity = '1';
	}

	function stop() {
		visible = false;
		if (dom.root) dom.root.style.opacity = '0';
	}

	function next() {
		/* no-op — a countdown has no steps/pages */
	}

	function remove() {
		stop();
		stopTicking();
	}

	function init(variantConfig) {
		const vc = variantConfig || {};
		dom = {
			root: document.querySelector(vc.containerSel || '.countdown-root'),
			timer: document.querySelector(vc.timerSel || '.countdown-timer'),
			auxTop: document.querySelector(vc.auxTopSel || '.countdown-aux-top'),
			auxMiddle: document.querySelector(vc.auxMiddleSel || '.countdown-aux-middle'),
			auxBottom: document.querySelector(vc.auxBottomSel || '.countdown-aux-bottom'),
		};
		applyPositionClass();
		doReset();

		window['update'] = update;
		window['play'] = play;
		window['stop'] = stop;
		window['next'] = next;
		window['remove'] = remove;
	}

	return {
		init,
		get state() { return state; },
		// Exposed for tools/smoke/*.test.js (pure time math — no DOM required) and for
		// template-side debugging; harmless to expose in the browser too.
		formatTime,
		formatHMS,
		formatMS,
		parseTargetTimeToNextEpoch,
	};
})();

// Dual-environment export: browser (`<script>` load — `module` is undefined, this is a no-op)
// and Node (tools/smoke/*.test.js exercising the pure time math without a DOM).
/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = { CountdownEngine };
}
