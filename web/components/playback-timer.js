/**
 * Inline elapsed/total/remaining from OSC layer `file` (Caspar `file/time`). Thin progress bar + traffic-light by remaining seconds.
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

const COLORS = {
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
function truncatePlaybackLabel(s, max = 32) {
	if (s.length <= max) return s
	return s.slice(0, Math.max(0, max - 1)) + '…'
}

let _styleDone = false
function ensureStyle() {
	if (_styleDone) return
	_styleDone = true
	const s = document.createElement('style')
	s.textContent =
		`.playback-timer{font:12px/1.3 ${UI_FONT_FAMILY};min-width:8em}` +
		'.playback-timer__row{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
	document.head.appendChild(s)
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   channel: number,
 *   layer: number,
 *   oscClient: import('../lib/osc-client.js').OscClient,
 *   format?: 'mmss' | 'hmsf',
 *   fpsFallback?: number,
 * }} opts
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountPlaybackTimer(container, opts) {
	const { channel, layer, oscClient, format = 'mmss', fpsFallback = 50 } = opts
	if (!oscClient) throw new Error('mountPlaybackTimer: oscClient required')
	ensureStyle()
	container.className = 'playback-timer playback-timer--muted'
	container.innerHTML =
		'<div class="playback-timer__row"></div>' +
		'<div class="playback-timer__bar" style="height:3px;margin-top:4px;border-radius:2px;overflow:hidden;background:#333">' +
		'<div class="playback-timer__fill" style="height:100%;width:0%;transition:width .12s linear"></div></div>'
	const row = container.querySelector('.playback-timer__row')
	const fill = container.querySelector('.playback-timer__fill')
	const bar = container.querySelector('.playback-timer__bar')

	function paint(layerState) {
		const f = layerState?.file || {}
		const elapsed = f.elapsed
		const dur = f.duration
		const rem = f.remaining
		const fps = Number.isFinite(f.fps) ? f.fps : fpsFallback
		let pct = 0
		if (Number.isFinite(f.progress)) pct = Math.min(100, Math.max(0, f.progress * 100))
		else if (Number.isFinite(dur) && dur > 0 && Number.isFinite(elapsed)) pct = Math.min(100, Math.max(0, (elapsed / dur) * 100))

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
			? `${eStr} / ${tStr}  (−${rStr})`
			: `${eStr} / ${tStr}`
		const tier = tierFromRemaining(Number.isFinite(rem) ? rem : null)
		container.className = 'playback-timer playback-timer--' + tier
		const c = COLORS[tier] || COLORS.muted
		row.style.color = c.text
		bar.style.background = c.bar
		fill.style.background = c.fill
		fill.style.width = pct + '%'
	}

	function refresh() {
		const ch = oscClient.channels[String(channel)] || oscClient.channels[channel]
		const ly = ch?.layers?.[layer] ?? ch?.layers?.[String(layer)]
		paint(ly || { file: {} })
	}

	const unsub = oscClient.onLayerState(channel, layer, paint)
	refresh()
	return {
		destroy() {
			unsub()
			container.textContent = ''
			container.className = ''
		},
		refresh,
	}
}

/**
 * Among all layers on a channel, pick the one with the highest layer number that has
 * meaningful `file` time (Caspar OSC). Used for PGM when several clips are stacked.
 * @param {object} [channelState] - `oscClient.channels[ch]`
 * @returns {{ layerNum: number | null, layerState: object | null }}
 */
function fileHasPlaybackHints(f) {
	if (!f || typeof f !== 'object') return false
	if (Number.isFinite(f.duration) && f.duration > 0) return true
	if (Number.isFinite(f.elapsed) && f.elapsed >= 0) return true
	if (Number.isFinite(f.frameTotal) && f.frameTotal > 0) return true
	if (Number.isFinite(f.frameElapsed) && f.frameElapsed >= 0) return true
	return false
}

/**
 * AMCP INFO foreground layer row (from server state) → synthetic `file` hints when OSC omits `file/time`.
 * @param {object} [infoLayer]
 * @returns {object | null}
 */
export function infoLayerToPlaybackHints(infoLayer) {
	if (!infoLayer || typeof infoLayer !== 'object') return null
	const dur = parseFloat(infoLayer.durationSec)
	const elapsed = parseFloat(infoLayer.timeSec)
	const rem = parseFloat(infoLayer.remainingSec)
	const hasAny =
		(Number.isFinite(dur) && dur > 0) ||
		(Number.isFinite(elapsed) && elapsed >= 0) ||
		(Number.isFinite(rem) && rem >= 0)
	if (!hasAny) return null
	const out = {}
	const clip = infoLayer.fgClip != null ? String(infoLayer.fgClip).trim() : ''
	if (clip) out.name = clip
	if (Number.isFinite(dur) && dur > 0) out.duration = dur
	if (Number.isFinite(elapsed) && elapsed >= 0) out.elapsed = elapsed
	if (Number.isFinite(rem) && rem >= 0) out.remaining = rem
	if (out.remaining == null && Number.isFinite(out.duration) && Number.isFinite(out.elapsed)) {
		out.remaining = Math.max(0, out.duration - out.elapsed)
	}
	if (Number.isFinite(out.duration) && out.duration > 0 && Number.isFinite(out.elapsed)) {
		out.progress = Math.min(1, Math.max(0, out.elapsed / out.duration))
	}
	return Object.keys(out).length ? out : null
}

/**
 * @param {object | undefined} chEntry - `state.channels[]` item for this Caspar channel
 * @param {number | null} layerNum
 */
function getInfoLayerRow(chEntry, layerNum) {
	if (!chEntry || layerNum == null || !Number.isFinite(layerNum)) return null
	const ly = chEntry.layers
	if (!ly) return null
	return ly[layerNum] ?? ly[String(layerNum)] ?? null
}

/**
 * @param {object} rawFile - OSC `file`
 * @param {object | null} infoLayer
 * @param {number} fpsFallback
 */
function mergeOscFileWithInfoLayer(rawFile, infoLayer, fpsFallback) {
	const base = rawFile && typeof rawFile === 'object' ? rawFile : {}
	const enriched = enrichFileTimingForDisplay(base, fpsFallback)
	if (fileHasPlaybackHints(enriched)) return enriched
	const hints = infoLayerToPlaybackHints(infoLayer)
	if (!hints) return enriched
	return enrichFileTimingForDisplay({ ...enriched, ...hints }, fpsFallback)
}

/**
 * Derive elapsed/duration/remaining when Caspar sends `file/frame` + `file/fps` but sparse `file/time`.
 * @param {object} f
 * @param {number} fpsFallback
 */
export function enrichFileTimingForDisplay(f, fpsFallback = 50) {
	const o = f && typeof f === 'object' ? { ...f } : {}
	const fps = Number.isFinite(o.fps) && o.fps > 0 ? o.fps : fpsFallback
	if (!Number.isFinite(o.duration) && Number.isFinite(o.frameTotal) && o.frameTotal > 0 && fps > 0) {
		o.duration = o.frameTotal / fps
	}
	if (!Number.isFinite(o.elapsed) && Number.isFinite(o.frameElapsed) && o.frameElapsed >= 0 && fps > 0) {
		o.elapsed = o.frameElapsed / fps
	}
	if (Number.isFinite(o.duration) && Number.isFinite(o.elapsed) && !Number.isFinite(o.remaining)) {
		o.remaining = Math.max(0, o.duration - o.elapsed)
	}
	if (Number.isFinite(o.duration) && o.duration > 0 && Number.isFinite(o.elapsed) && !Number.isFinite(o.progress)) {
		o.progress = Math.min(1, Math.max(0, o.elapsed / o.duration))
	}
	return o
}

export function pickTopLayerStateForPlayback(channelState) {
	const layers = channelState?.layers
	if (!layers) return { layerNum: null, layerState: null }
	let bestN = -1
	let bestState = null
	for (const key of Object.keys(layers)) {
		const n = parseInt(key, 10)
		if (!Number.isFinite(n)) continue
		const ly = layers[key]
		const f = ly?.file
		if (fileHasPlaybackHints(f) && n > bestN) {
			bestN = n
			bestState = ly
		}
	}
	return bestN >= 0 ? { layerNum: bestN, layerState: bestState } : { layerNum: null, layerState: null }
}

/**
 * PGM playback line: follows the **topmost** layer (highest layer index) that reports file/time over OSC.
 * Optional `getState` merges AMCP INFO timing when OSC `file/time` is sparse (some codecs).
 * @param {HTMLElement} container
 * @param {{
 *   oscClient: import('../lib/osc-client.js').OscClient,
 *   getChannel: () => number,
 *   getState?: () => { channels?: Array<{ id?: number, layers?: unknown[] }> } | null | undefined,
 *   format?: 'mmss' | 'hmsf',
 *   fpsFallback?: number,
 * }} opts
 */
export function mountPgmTopLayerPlaybackTimer(container, opts) {
	const { oscClient, getChannel, getState, format = 'mmss', fpsFallback = 50 } = opts
	if (!oscClient) throw new Error('mountPgmTopLayerPlaybackTimer: oscClient required')
	ensureStyle()
	container.className = 'playback-timer playback-timer--muted header-pgm-timer'
	container.innerHTML =
		'<div class="playback-timer__row"></div>' +
		'<div class="playback-timer__bar" style="height:3px;margin-top:4px;border-radius:2px;overflow:hidden;background:#333">' +
		'<div class="playback-timer__fill" style="height:100%;width:0%;transition:width .12s linear"></div></div>'
	const row = container.querySelector('.playback-timer__row')
	const fill = container.querySelector('.playback-timer__fill')
	const bar = container.querySelector('.playback-timer__bar')

	function paint(layerState, layerNum) {
		const rawFile = layerState?.file || {}
		let infoLayer = null
		try {
			const chNum = getChannel()
			const st = typeof getState === 'function' ? getState() : null
			const chEntry = Array.isArray(st?.channels) ? st.channels.find((c) => c && c.id === chNum) : null
			infoLayer = getInfoLayerRow(chEntry, layerNum)
		} catch {
			infoLayer = null
		}
		const f = mergeOscFileWithInfoLayer(rawFile, infoLayer, fpsFallback)
		const elapsed = f.elapsed
		const dur = f.duration
		const rem = f.remaining
		const fps = Number.isFinite(f.fps) ? f.fps : fpsFallback
		let pct = 0
		if (Number.isFinite(f.progress)) pct = Math.min(100, Math.max(0, f.progress * 100))
		else if (Number.isFinite(dur) && dur > 0 && Number.isFinite(elapsed)) pct = Math.min(100, Math.max(0, (elapsed / dur) * 100))

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

		const label = playbackFileLabel({ ...rawFile, name: f.name != null && f.name !== '' ? f.name : rawFile.name })
		const prefix = label ? `${label} · ` : ''
		row.textContent = Number.isFinite(rem)
			? `${prefix}${eStr} / ${tStr}  (−${rStr})`
			: `${prefix}${eStr} / ${tStr}`
		const tier = tierFromRemaining(Number.isFinite(rem) ? rem : null)
		container.className = 'playback-timer playback-timer--' + tier + ' header-pgm-timer'
		const c = COLORS[tier] || COLORS.muted
		row.style.color = c.text
		bar.style.background = c.bar
		fill.style.background = c.fill
		fill.style.width = pct + '%'
		container.title = label
			? `PGM: ${label} — elapsed / duration from OSC`
			: layerNum != null
				? `PGM: layer ${layerNum} (no file name in OSC)`
				: 'PGM: no layer with file/time on this channel (OSC)'
	}

	function refresh() {
		const chNum = getChannel()
		const ch = oscClient.channels[String(chNum)] || oscClient.channels[chNum]
		const { layerNum, layerState } = pickTopLayerStateForPlayback(ch)
		paint(layerState || { file: {} }, layerNum)
	}

	const unsub = oscClient.onAfterIngest(refresh)
	refresh()
	return {
		destroy() {
			unsub()
			container.textContent = ''
			container.className = ''
		},
		refresh,
	}
}
