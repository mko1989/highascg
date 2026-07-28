/**
 * Formatting, color-tier, and paint/tick-loop helpers for playback-timer.js.
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'

/** @param {number} sec @param {number} fps */
export function formatHmsf(sec, fps) {
	if (!Number.isFinite(sec) || sec < 0) return '--:--:--:--'
	const f = Number.isFinite(fps) && fps > 0 ? fps : 50
	const h = Math.floor(sec / 3600)
	const m = Math.floor((sec % 3600) / 60)
	const s = Math.floor(sec % 60)
	const frac = sec - Math.floor(sec)
	const ff = Math.min(f - 1, Math.floor(frac * f))
	const z = (n, w = 2) => String(n).padStart(w, '0')
	return `${z(h)}:${z(m)}:${z(s)}:${z(ff)}`
}

/** @param {number} sec */
export function formatMmSs(sec) {
	if (!Number.isFinite(sec) || sec < 0) return '--:--'
	const m = Math.floor(sec / 60)
	const s = Math.floor(sec % 60)
	return `${m}:${String(s).padStart(2, '0')}`
}

/** Green &gt;10s left, orange 5–10s, red ≤5s */
function tierFromRemaining(rem) {
	if (rem == null || !Number.isFinite(rem)) return 'muted'
	if (rem > 10) return 'green'
	if (rem > 5) return 'orange'
	return 'red'
}

export const COLORS = {
	muted: { bar: '#666', fill: '#888', text: '#aaa' },
	green: { bar: '#1a3d1a', fill: '#2ecc71', text: '#cfe' },
	orange: { bar: '#4d3319', fill: '#e67e22', text: '#fdebd0' },
	red: { bar: '#3d1a1a', fill: '#e74c3c', text: '#fcc' },
}

/** @param {object} [f] - OSC `file` object */
export function playbackFileLabel(f) {
	if (!f || typeof f !== 'object') return ''
	const name = f.name != null ? String(f.name).trim() : ''
	if (name) return truncatePlaybackLabel(name)
	const p = f.path
	if (p != null && typeof p === 'string') {
		const norm = p.replace(/\\/g, '/')
		const seg = norm.split('/').filter(Boolean).pop()
		if (seg) return truncatePlaybackLabel(seg)
	}
	return ''
}

/** @param {string} s */
export function truncatePlaybackLabel(s, max = 32) {
	if (s.length <= max) return s
	return s.slice(0, Math.max(0, max - 1)) + '…'
}

let _styleDone = false
export function ensureStyle() {
	if (_styleDone) return
	_styleDone = true
	const s = document.createElement('style')
	s.textContent =
		`.playback-timer{font:12px/1.3 ${UI_FONT_FAMILY};min-width:8em}` +
		'.playback-timer__row{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
	document.head.appendChild(s)
}

/**
 * @param {{ row: Element, fill: Element, bar: Element, container: HTMLElement, format: string, fpsFallback: number, labelPrefix?: string, title?: string }} ctx
 * @param {object} displayFile
 * @param {number|null} layerNum
 */
export function paintPlaybackDisplay(ctx, displayFile, _layerNum) {
	const { row, fill, bar, container, format, fpsFallback, labelPrefix = '', title } = ctx
	const f = displayFile
	const elapsed = f.elapsed
	const dur = f.duration
	const rem = f.remaining
	const fps = Number.isFinite(f.fps) ? f.fps : fpsFallback
	let pct = 0
	if (Number.isFinite(f.progress)) pct = Math.min(100, Math.max(0, f.progress * 100))
	else if (Number.isFinite(dur) && dur > 0 && Number.isFinite(elapsed)) {
		pct = Math.min(100, Math.max(0, (elapsed / dur) * 100))
	}

	const eStr =
		format === 'hmsf'
			? formatHmsf(Number.isFinite(elapsed) ? elapsed : NaN, fps)
			: formatMmSs(Number.isFinite(elapsed) ? elapsed : NaN)
	const tStr =
		format === 'hmsf'
			? formatHmsf(Number.isFinite(dur) ? dur : NaN, fps)
			: formatMmSs(Number.isFinite(dur) ? dur : NaN)
	const rStr =
		format === 'hmsf'
			? formatHmsf(Number.isFinite(rem) ? rem : NaN, fps)
			: formatMmSs(Number.isFinite(rem) ? rem : NaN)

	row.textContent = Number.isFinite(rem)
		? `${labelPrefix}${eStr} / ${tStr}  (−${rStr})`
		: `${labelPrefix}${eStr} / ${tStr}`
	const tier = tierFromRemaining(Number.isFinite(rem) ? rem : null)
	const tierClass = 'playback-timer--' + tier
	const headerExtra = container.classList.contains('header-pgm-timer') ? ' header-pgm-timer' : ''
	container.className = 'playback-timer ' + tierClass + headerExtra
	const c = COLORS[tier] || COLORS.muted
	row.style.color = c.text
	bar.style.background = c.bar
	fill.style.background = c.fill
	fill.style.width = pct + '%'
	if (title != null) container.title = title
}

/** @returns {{ start: () => void, stop: () => void }} */
export function createPlaybackTickLoop(onTick) {
	let running = false
	let rafId = 0
	function loop() {
		if (!running) return
		onTick(performance.now())
		rafId = requestAnimationFrame(loop)
	}
	return {
		start() {
			if (running) return
			running = true
			rafId = requestAnimationFrame(loop)
		},
		stop() {
			running = false
			if (rafId) cancelAnimationFrame(rafId)
			rafId = 0
		},
	}
}
