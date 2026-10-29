import { getVariableStore } from './variable-state.js'
import { getAppOsc, getAppWs } from './app-runtime.js'
import {
	readBusPeakDbfs,
	readLayerPeakDbfs,
	readLiveInputHostChannelPeakDbfs,
	readBusChannelPeakDbfs,
	readInputChannelMeterSample,
} from './audio-mixer-peaks.js'
import { parseBusMeterFillKey } from './audio-mixer-bus-meters.js'
import { mapLevelToMeter, METER_STATE } from './audio-input-meter-map.js'
import { readLayerLevel } from './audio-layer-levels.js'

/**
 * @param {{
 *   meterFills: Map<string, HTMLDivElement>,
 *   meterLayerMeta: Map<string, { muted?: boolean, layer?: number, hostChannel?: number, expectAudio?: boolean, sourceType?: string }>,
 *   meterSmooth: Map<string, number>,
 *   stateStore: import('./state-store.js').StateStore,
 *   layerFillAxis?: 'width' | 'height',
 *   peakClipColor?: string,
 *   peakNormalColor?: string,
 *   laneFills?: Map<string, HTMLElement>,
 *   layerLevels?: () => unknown,
 * }} ctx
 * WO-800: `laneFills` (key → the strip's thin lane) shows the layer's own level from `layerLevels()` (the last
 * GET /api/osc/audio-layers); the lane is hidden while the layer is absent there (no audio on it).
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createAudioMeterLoop(ctx) {
	const {
		meterFills,
		meterLayerMeta,
		meterSmooth,
		stateStore,
		layerFillAxis = 'height',
		peakClipColor = 'var(--accent-red)',
		peakNormalColor = 'var(--accent-green)',
		laneFills = new Map(),
		layerLevels = () => null,
	} = ctx

	/**
	 * WO-401 F12: this loop used to free-run at 60 fps rAF against OSC data that refreshes at
	 * 4–20 Hz — measured ~3 % of a kiosk core doing mostly no-op reads. A 50 ms interval (20 Hz)
	 * matches the fastest data rate; SMOOTH_FALL is re-derived so the decay curve per SECOND is
	 * the same as the old 0.18-per-frame at 60 fps ((1-0.18)^60 ≈ (1-0.45)^20).
	 */
	const TICK_MS = 50
	const SMOOTH_FALL = 0.45

	/** @type {ReturnType<typeof setInterval> | null} */
	let timer = null

	/** Smoothed 0…1 for a dBFS level: instant rise, SMOOTH_FALL per tick; −90 and below = 0. */
	const smooth = (prev, level) => {
		const aim = level > -90 ? Math.max(0, Math.min(1, (level + 60) / 60)) : 0
		return aim >= prev ? aim : prev + (aim - prev) * SMOOTH_FALL
	}
	const colourFor = (level) => (level > -90 ? (level > -1 ? peakClipColor : peakNormalColor) : '')

	/** WO-800: one lane tick, same scale / ballistics / colours as the bar. */
	const tickLane = (key, lane, banks, data) => {
		const r = readLayerLevel(data, key, meterLayerMeta.get(key), banks)
		const lk = `${key}:lane`
		if (lane.hidden !== !r.present) lane.hidden = !r.present
		if (!r.present) {
			meterSmooth.delete(lk)
			return
		}
		const s = smooth(meterSmooth.get(lk) ?? 0, r.level)
		meterSmooth.set(lk, s)
		const fill = /** @type {HTMLElement & { _lastPct?: string, _lastBg?: string }} */ (lane.firstElementChild)
		if (!fill) return
		const pct = (s * 100).toFixed(1)
		if (fill._lastPct !== pct) {
			fill.style.height = `${pct}%`
			fill._lastPct = pct
		}
		const bg = colourFor(r.level)
		if (fill._lastBg !== bg) {
			fill.style.background = bg
			fill._lastBg = bg
		}
	}

	function stop() {
		if (timer) {
			clearInterval(timer)
			timer = null
		}
	}

	function start() {
		if (timer) return
		const ws = getAppWs()
		const vars = ws ? getVariableStore(ws) : null
		const tick = () => {
			// WO-284: skip work while the document is hidden (browser throttling also slows the
			// interval down in that state; a mounted-yet-collapsed panel calls stop() itself).
			if (typeof document !== 'undefined' && document.hidden) {
				return
			}
			const oscClient = getAppOsc()
			for (const [key, fill] of meterFills) {
				let level
				let busKey = null
				/** WO-284 — 'no-data' / 'silent' / 'signal', dedicated input strips only. */
				let inputState = null
				if (key.includes(':layer:')) {
					const [, chStr, , lnStr] = key.split(':')
					const chNum = parseInt(chStr, 10)
					const lnNum = parseInt(lnStr, 10)
					const meta = meterLayerMeta.get(key)
					const hostCh = meta?.hostChannel
					if (hostCh != null) {
						level = readLiveInputHostChannelPeakDbfs(hostCh, oscClient, stateStore, meta, vars)
					} else {
						level =
							Number.isFinite(chNum) && Number.isFinite(lnNum)
								? readLayerPeakDbfs(chNum, lnNum, oscClient, stateStore, meta, vars)
								: -99
					}
				} else if ((busKey = parseBusMeterFillKey(key))) {
					level = readBusChannelPeakDbfs(busKey.casparChannel, busKey.channelIndex, oscClient, stateStore, vars)
				} else if (key.startsWith('input:')) {
					const hostCh = parseInt(key.slice(6), 10)
					const meta = meterLayerMeta.get(key)
					const sample = readInputChannelMeterSample(hostCh, oscClient, stateStore, meta, vars)
					const mapped = mapLevelToMeter(sample)
					inputState = mapped.state
					level = mapped.state === METER_STATE.SIGNAL ? Number(mapped.dbfs) : -99
				} else {
					const [, chStr] = key.split(':')
					const chNum = parseInt(chStr, 10)
					level = Number.isFinite(chNum) ? readBusPeakDbfs(chNum, vars, oscClient, stateStore) : -99
				}

				const s = smooth(meterSmooth.get(key) ?? 0, level)
				meterSmooth.set(key, s)
				const pct = (s * 100).toFixed(1)
				if (fill._lastPct !== pct) {
					if (key.includes(':layer:')) {
						fill.style[layerFillAxis] = `${pct}%`
					} else {
						fill.style.height = `${pct}%`
					}
					fill._lastPct = pct
				}

				// WO-284 cheapness: only touch style/dataset when the computed value actually
				// changed — the loop runs every frame for every visible strip.
				const bg = colourFor(level)
				if (fill._lastBg !== bg) {
					if (bg) fill.style.background = bg
					else fill.style.removeProperty('background')
					fill._lastBg = bg
				}

				if (inputState !== null && fill._lastMeterState !== inputState) {
					fill._lastMeterState = inputState
					fill.dataset.meterState = inputState
					const host = fill.parentElement
					if (host) host.dataset.meterState = inputState
					// The "no signal" badge is a sibling of the meter, stamped by the renderer.
					const badge = host?.parentElement?.querySelector?.('[data-input-nosignal]')
					if (badge) badge.hidden = inputState !== METER_STATE.NO_DATA
				}
			}
			if (laneFills.size) {
				const banks = stateStore?.getState?.()?.scene?.programLayerBankByChannel
				const data = layerLevels()
				for (const [key, lane] of laneFills) tickLane(key, lane, banks, data)
			}
		}
		timer = setInterval(tick, TICK_MS)
		tick()
	}

	return { start, stop }
}
