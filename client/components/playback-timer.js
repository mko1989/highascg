/**
 * Inline elapsed/total/remaining from OSC layer `file` (Caspar `file/time`). Thin progress bar + traffic-light by remaining seconds.
 */

import {
	createPlaybackTimingClock,
	extrapolatePlaybackFile,
	resolvePlaybackTimingFromFile,
	syncPlaybackTimingClock,
} from '../lib/playback-timing-clock.js'
import {
	COLORS,
	createPlaybackTickLoop,
	ensureStyle,
	formatHmsf,
	formatMmSs,
	paintPlaybackDisplay,
	playbackFileLabel,
	truncatePlaybackLabel,
} from './playback-timer-format.js'

export { formatHmsf, formatMmSs, playbackFileLabel }

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
	return pickTopLayerStateBy(channelState, opts, (ly) => fileHasPlaybackHints(ly?.file))
}

/**
 * The single bank/exclusion/staleness scan behind BOTH top-layer picks. Only the "does this layer
 * count" predicate differs — {@link pickTopLayerStateForPlayback} wants a layer with real timing,
 * {@link pickTopLayerContentForIdle} (WO-297) wants a layer with *any* content. Keeping one scan
 * means the idle label can never disagree with the timer about which layer is on top.
 * @param {object} [channelState]
 * @param {{ bank?: 'a' | 'b' | null, nowTs?: number }} [opts]
 * @param {(layerState: object) => boolean} predicate
 * @returns {{ layerNum: number | null, layerState: object | null }}
 */
function pickTopLayerStateBy(channelState, opts, predicate) {
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
		if (n > bestN && predicate(ly)) {
			bestN = n
			bestState = ly
		}
	}
	return bestN >= 0 ? { layerNum: bestN, layerState: bestState } : { layerNum: null, layerState: null }
}

/**
 * WO-297 (todos19.07.26): what a layer is SHOWING, with no timing attached — used to fill the
 * compose-tile footer when nothing is running. `type === 'empty'` (Caspar's own producer name for a
 * cleared layer, `src/osc/osc-state.js:417`) and a layer with no name/path/template resolve to ''
 * so an idle tile shows nothing rather than a stale label.
 * @param {object} [layerState] - one `oscClient.channels[ch].layers[n]` entry
 * @returns {string} display label, or '' when the layer carries no content
 */
export function idleLayerContentLabel(layerState) {
	if (!layerState || typeof layerState !== 'object') return ''
	const type = layerState.type != null ? String(layerState.type).trim() : ''
	if (type === 'empty') return ''
	const fileLabel = playbackFileLabel(layerState.file)
	if (fileLabel) return fileLabel
	const tplPath = layerState.template?.path
	if (tplPath != null && String(tplPath).trim()) {
		const seg = String(tplPath).replace(/\\/g, '/').split('/').filter(Boolean).pop()
		if (seg) return truncatePlaybackLabel(seg)
	}
	// A producer with no file/template still identifies itself ('route', 'decklink', 'html', ...).
	return type ? truncatePlaybackLabel(type) : ''
}

/**
 * Topmost layer with ANY content, for the "no running source" footer line. Same bank range,
 * exclusions and staleness rules as {@link pickTopLayerStateForPlayback} — see
 * {@link pickTopLayerStateBy}.
 * @param {object} [channelState] - `oscClient.channels[ch]`
 * @param {{ bank?: 'a' | 'b' | null, nowTs?: number }} [opts]
 * @returns {{ layerNum: number | null, layerState: object | null, label: string }}
 */
export function pickTopLayerContentForIdle(channelState, opts) {
	const picked = pickTopLayerStateBy(channelState, opts, (ly) => idleLayerContentLabel(ly) !== '')
	return { ...picked, label: picked.layerState ? idleLayerContentLabel(picked.layerState) : '' }
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
	let lastMeta = { layerState: { file: {} }, layerNum: null, resolvedChNum: 1, rawFile: {}, idle: null }
	// WO-297 change guard: the idle footer line is static, but `repaint` runs off a rAF tick loop.
	// `paintedIdleKey` is the last idle string committed to the DOM (null = not currently idle), so a
	// steady idle tile costs one string compare per frame and ZERO DOM writes — the same
	// stored-record + guard discipline the timer path already uses.
	let paintedIdleKey = null

	/** @param {{ label: string, layerNum: number | null } | null} idle */
	function paintIdle(idle) {
		const label = idle?.label || ''
		const key = `${idle?.layerNum ?? ''} ${label}`
		if (paintedIdleKey === key) return
		paintedIdleKey = key
		// Timing chrome OFF (no timer/progress when nothing runs) — display:none only, so the footer
		// keeps the height operator-compose-tiles.js reserves via TILE_CHROME.footerH.
		bar.style.display = 'none'
		fill.style.width = '0%'
		row.textContent = label
		row.style.color = COLORS.muted.text
		const headerExtra = container.classList.contains('header-pgm-timer') ? ' header-pgm-timer' : ''
		container.className = 'playback-timer playback-timer--idle' + headerExtra
		container.title = label
			? `${label} — on the top layer, not running`
			: 'Nothing on any layer of this channel'
	}

	function repaint(now = performance.now()) {
		const { layerState, layerNum, resolvedChNum, rawFile, idle } = lastMeta
		if (layerNum == null) {
			paintIdle(idle)
			return
		}
		if (paintedIdleKey !== null) {
			// Leaving idle: restore the progress bar the idle paint hid, and re-arm the guard.
			paintedIdleKey = null
			bar.style.display = ''
		}
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
		const nowTs = Date.now()
		const { layerNum, layerState } = pickTopLayerStateForPlayback(ch, { bank, nowTs })
		const rawFile = layerState?.file || {}
		// WO-297: no RUNNING source -> fall back to the topmost layer that has ANY content, so the
		// footer still says what is on screen (label only, no timer). Computed HERE (once per OSC
		// ingest, and only when there is nothing to time), never in the per-frame `repaint`.
		const idle = layerNum == null ? pickTopLayerContentForIdle(ch, { bank, nowTs }) : null
		lastMeta = {
			layerState: layerState || { file: {} },
			layerNum,
			resolvedChNum: chNum,
			rawFile,
			idle,
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
