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

/**
 * @param {{
 *   meterFills: Map<string, HTMLDivElement>,
 *   meterLayerMeta: Map<string, { muted?: boolean, layer?: number, hostChannel?: number, expectAudio?: boolean, sourceType?: string }>,
 *   meterSmooth: Map<string, number>,
 *   stateStore: import('./state-store.js').StateStore,
 *   layerFillAxis?: 'width' | 'height',
 *   peakClipColor?: string,
 *   peakNormalColor?: string,
 * }} ctx
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
	} = ctx

	/** @type {ReturnType<typeof requestAnimationFrame> | null} */
	let raf = null

	function stop() {
		if (raf) {
			cancelAnimationFrame(raf)
			raf = null
		}
	}

	function start() {
		if (raf) return
		const ws = getAppWs()
		const vars = ws ? getVariableStore(ws) : null
		const tick = () => {
			// WO-284: a hidden document already parks rAF, but a mounted-yet-collapsed panel calls
			// stop(); this guard covers the frame already in flight when that happens.
			if (typeof document !== 'undefined' && document.hidden) {
				raf = requestAnimationFrame(tick)
				return
			}
			const oscClient = getAppOsc()
			for (const [key, fill] of meterFills) {
				let level = -99
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
				} else if (parseBusMeterFillKey(key)) {
					const bus = parseBusMeterFillKey(key)
					level = readBusChannelPeakDbfs(bus.casparChannel, bus.channelIndex, oscClient, stateStore, vars)
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

				let s = meterSmooth.get(key) ?? 0
				let aim = 0
				if (level > -90) {
					aim = Math.max(0, Math.min(1, (level + 60) / 60))
				}
				if (aim >= s) s = aim
				else s += (aim - s) * 0.18
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
				const bg = level > -90 ? (level > -1 ? peakClipColor : peakNormalColor) : ''
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
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
	}

	return { start, stop }
}
