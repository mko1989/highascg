/**
 * Inline elapsed/total/remaining from OSC layer `file` (Caspar `file/time`). Thin progress bar + traffic-light by remaining seconds.
 */

import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import {
	createPlaybackTimingClock,
	extrapolatePlaybackFile,
	resolvePlaybackTimingFromFile,
	syncPlaybackTimingClock,
} from '../lib/playback-timing-clock.js'

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
		'<div class="playback-timer__fill" style="height:100%;width:0%;transition:width .08s linear"></div></div>'
	const row = container.querySelector('.playback-timer__row')
	const fill = container.querySelector('.playback-timer__fill')
	const bar = container.querySelector('.playback-timer__bar')
	const clock = createPlaybackTimingClock()
	let lastLayerState = { file: {} }
	const paintCtx = { row, fill, bar, container, format, fpsFallback }

	function repaint(now = performance.now()) {
		syncPlaybackTimingClock(clock, lastLayerState?.file || {}, {
			now,
			layerState: lastLayerState,
			fpsFallback,
		})
		const display = extrapolatePlaybackFile(clock, lastLayerState?.file || {}, { now, fpsFallback })
		paintPlaybackDisplay(paintCtx, display, layer)
	}

	function ingest(layerState) {
		lastLayerState = layerState || { file: {} }
		repaint()
	}

	function refresh() {
		const ch = oscClient.channels[String(channel)] || oscClient.channels[channel]
		const ly = ch?.layers?.[layer] ?? ch?.layers?.[String(layer)]
		ingest(ly || { file: {} })
	}

	const tick = createPlaybackTickLoop(repaint)
	const unsub = oscClient.onLayerState(channel, layer, ingest)
	const unsubAll = oscClient.onAfterIngest(refresh)
	refresh()
	tick.start()
	return {
		destroy() {
			tick.stop()
			unsub()
			unsubAll()
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
export function fileHasPlaybackHints(f) {
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
export function getInfoLayerRow(chEntry, layerNum) {
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
export function mergeOscFileWithInfoLayer(rawFile, infoLayer, fpsFallback) {
	const base = rawFile && typeof rawFile === 'object' ? rawFile : {}
	const enriched = enrichFileTimingForDisplay(base, fpsFallback)
	const hints = infoLayerToPlaybackHints(infoLayer)
	if (!hints) return enriched
	if (!fileHasPlaybackHints(enriched)) {
		return enrichFileTimingForDisplay({ ...enriched, ...hints }, fpsFallback)
	}
	const merged = { ...enriched }
	// INFO is a 2s poll — a GAP-FILLER only, never an override of fresh OSC. The old
	// `hEl > oEl + 0.02` override let a stale INFO timeSec leapfrog live OSC elapsed every
	// poll window, re-anchoring the extrapolation clock on each flip (the "bogus running
	// time every half a second" alternation, 2026-07-16). Mirrors the server's own guard
	// (osc-state.js applyInfoTimingSupplement: "OSC elapsed is fresher than a 2s INFO poll").
	if (!Number.isFinite(merged.elapsed) && Number.isFinite(hints.elapsed)) {
		merged.elapsed = hints.elapsed
	}
	if (!(Number.isFinite(merged.duration) && merged.duration > 0) && Number.isFinite(hints.duration) && hints.duration > 0) {
		merged.duration = hints.duration
	}
	if (Number.isFinite(merged.duration) && Number.isFinite(merged.elapsed)) {
		merged.remaining = Math.max(0, merged.duration - merged.elapsed)
	} else if (!Number.isFinite(merged.remaining) && Number.isFinite(hints.remaining)) {
		merged.remaining = hints.remaining
	}
	if (Number.isFinite(merged.duration) && merged.duration > 0 && Number.isFinite(merged.elapsed)) {
		merged.progress = Math.min(1, Math.max(0, merged.elapsed / merged.duration))
	}
	return enrichFileTimingForDisplay(merged, fpsFallback)
}

/**
 * @param {{ row: Element, fill: Element, bar: Element, container: HTMLElement, format: string, fpsFallback: number, labelPrefix?: string, title?: string }} ctx
 * @param {object} displayFile
 * @param {number|null} layerNum
 */
function paintPlaybackDisplay(ctx, displayFile, layerNum) {
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
function createPlaybackTickLoop(onTick) {
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

/**
 * Derive elapsed/duration/remaining when Caspar sends `file/frame` + `file/fps` but sparse `file/time`.
 * @param {object} f
 * @param {number} fpsFallback
 */
export function enrichFileTimingForDisplay(f, fpsFallback = 50) {
	return resolvePlaybackTimingFromFile(f, fpsFallback).file
}

/**
 * Timer band (per-layer countdown overlay, `osc-variables.js`) and the multiview border/chrome
 * layer never carry a real clip's `file` hints, but if a future producer ever puts *something*
 * playback-shaped there, they must not be eligible for "top layer" — cheap insurance (WO-250 T250.1).
 */
const TIMER_BAND_MIN = 980
const TIMER_BAND_MAX = 989
const BORDER_LAYER = 998

function isExcludedPlaybackLayerNum(n) {
	if (n >= TIMER_BAND_MIN && n <= TIMER_BAND_MAX) return true
	if (n === BORDER_LAYER) return true
	return false
}

/** Bank A: physical layers 10-99. Bank B: 110-199 (`src/osc/osc-state.js` layer keys are per-channel, offset by bank). */
function bankLayerRange(bank) {
	return bank === 'b' ? [110, 199] : [10, 99]
}

/**
 * Layer whose OSC stopped flowing recently enough that the server hasn't pruned it yet
 * (`_pruneStaleLayers`, default 10s, `src/osc/osc-config.js:37`) but which is stale relative to
 * `nowTs` — e.g. the losing bank's frozen layer right after a take. Copied client-side from
 * `template/multiview-playback-osc.js:24-29` (`isStaleOscPlaybackLayer`) — templates aren't
 * bundled with the client, so this is a deliberate duplicate, not a divergent implementation;
 * keep both in sync if the staleness window changes.
 * @param {object|null|undefined} layerOsc
 * @param {number|null|undefined} nowTs
 * @param {number} [staleMs]
 */
const STALE_OSC_LAYER_MS = 12000
function isStaleOscPlaybackLayer(layerOsc, nowTs, staleMs = STALE_OSC_LAYER_MS) {
	const last = Number(layerOsc?._lastOscAt || 0)
	const now = Number(nowTs || 0)
	if (!last || !now) return false
	return now - last > (Number(staleMs) > 0 ? Number(staleMs) : STALE_OSC_LAYER_MS)
}

/**
 * @param {object} [channelState] - `oscClient.channels[ch]`
 * @param {{ bank?: 'a' | 'b' | null, nowTs?: number }} [opts] - active program-layer bank for this
 *   channel (`programLayerBankByChannel`, same source the switcher-bus remap reads — see
 *   `mountPgmTopLayerPlaybackTimer.refresh` below) and the clock to test layer staleness against.
 *   PRV/bankless channels (no bank entry) and any value other than `'b'` restrict to 10-99.
 *   Omitting `nowTs` disables the staleness check (no snapshot clock to compare against).
 */
export function pickTopLayerStateForPlayback(channelState, opts) {
	const layers = channelState?.layers
	if (!layers) return { layerNum: null, layerState: null }
	const { bank, nowTs } = opts || {}
	const [lo, hi] = bankLayerRange(bank)
	let bestN = -1
	let bestState = null
	for (const key of Object.keys(layers)) {
		const n = parseInt(key, 10)
		if (!Number.isFinite(n)) continue
		if (isExcludedPlaybackLayerNum(n)) continue
		if (n < lo || n > hi) continue
		const ly = layers[key]
		if (isStaleOscPlaybackLayer(ly, nowTs)) continue
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
		'<div class="playback-timer__fill" style="height:100%;width:0%;transition:width .08s linear"></div></div>'
	const row = container.querySelector('.playback-timer__row')
	const fill = container.querySelector('.playback-timer__fill')
	const bar = container.querySelector('.playback-timer__bar')
	const clock = createPlaybackTimingClock()
	let lastMeta = { layerState: { file: {} }, layerNum: null, resolvedChNum: 1, rawFile: {} }

	function repaint(now = performance.now()) {
		const { layerState, layerNum, resolvedChNum, rawFile } = lastMeta
		let infoLayer = null
		try {
			const st = typeof getState === 'function' ? getState() : null
			const chEntry = Array.isArray(st?.channels) ? st.channels.find((c) => c && c.id === resolvedChNum) : null
			infoLayer = getInfoLayerRow(chEntry, layerNum)
		} catch {
			infoLayer = null
		}
		const merged = mergeOscFileWithInfoLayer(rawFile, infoLayer, fpsFallback)
		syncPlaybackTimingClock(clock, merged, { now, layerState, fpsFallback })
		const display = extrapolatePlaybackFile(clock, merged, { now, fpsFallback })
		const label = playbackFileLabel({
			...rawFile,
			name: display.name != null && display.name !== '' ? display.name : rawFile.name,
		})
		const prefix = label ? `${label} · ` : ''
		const title = label
			? `PGM: ${label} — elapsed / duration`
			: layerNum != null
				? `PGM: layer ${layerNum}`
				: 'PGM: no layer with file/time on this channel'
		paintPlaybackDisplay(
			{ row, fill, bar, container, format, fpsFallback, labelPrefix: prefix, title },
			display,
			layerNum,
		)
		if (!container.className.includes('header-pgm-timer')) {
			container.className += ' header-pgm-timer'
		}
	}

	function refresh() {
		let chNum = getChannel()
		let bank = null
		try {
			const st = typeof getState === 'function' ? getState() : null
			const cm = st?.channelMap
			if (cm && cm.transitionModel === 'switcher_bus') {
				const screenIdx = cm.playbackChannels ? cm.playbackChannels.indexOf(chNum) : -1
				if (screenIdx >= 0) {
					const parentCh = cm.programChannels[screenIdx] || 1
					bank = st?.scene?.programLayerBankByChannel?.[String(parentCh)] || 'a'
					const activeCh = bank === 'b' ? cm.switcherBusChannels?.[screenIdx] : cm.switcherBus1Channels?.[screenIdx]
					if (activeCh) chNum = activeCh
				}
			}
			// T250.1 (WO-250): outside switcher_bus (or no screen match) `chNum` IS the program/logical
			// channel already, so its own bank entry applies directly — same source
			// (`state.scene.programLayerBankByChannel`) the remap above reads, just keyed by the
			// channel we actually have. PRV/bankless channels have no entry → bank stays null →
			// pickTopLayerStateForPlayback defaults that to the 10-99 range.
			if (bank == null) {
				bank = st?.scene?.programLayerBankByChannel?.[String(chNum)] || null
			}
		} catch (e) {
			console.warn('[playback-timer] active ch resolution failed:', e)
		}
		const ch = oscClient.channels[String(chNum)] || oscClient.channels[chNum]
		// T250.1 (WO-250): restrict "topmost layer" to the ACTIVE bank's layer range and skip
		// stale (about-to-be-pruned) layers — otherwise the losing bank's frozen layer briefly
		// outranks the live bank's layer right after a take ("gibberish" jump/latch).
		const { layerNum, layerState } = pickTopLayerStateForPlayback(ch, { bank, nowTs: Date.now() })
		const rawFile = layerState?.file || {}
		lastMeta = {
			layerState: layerState || { file: {} },
			layerNum,
			resolvedChNum: chNum,
			rawFile,
		}
		repaint()
	}

	const tick = createPlaybackTickLoop(repaint)
	const unsub = oscClient.onAfterIngest(refresh)
	refresh()
	tick.start()
	return {
		destroy() {
			tick.stop()
			unsub()
			container.textContent = ''
			container.className = ''
		},
		refresh,
	}
}
