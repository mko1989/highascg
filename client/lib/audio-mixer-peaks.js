import { isLayerStripOnAir } from './audio-mixer-meter-eligibility.js'
import { inputHasAudioData } from './audio-input-meter-map.js'

/** @param {import('./state-store.js').StateStore} stateStore */
function isSoleLiveSceneMediaLayer(stateStore, chNum, layerNum) {
	const live = stateStore?.getState?.()?.scene?.live?.[chNum] ?? stateStore?.getState?.()?.scene?.live?.[String(chNum)]
	const layers = Array.isArray(live?.scene?.layers) ? live.scene.layers : []
	const mediaLayers = layers.filter((l) => {
		const src = l?.source
		if (!src?.value) return false
		const ty = String(src.type || '').toLowerCase()
		return ty === 'media' || ty === 'file'
	})
	return mediaLayers.length === 1 && Number(mediaLayers[0]?.layerNumber) === layerNum
}

/** @param {Record<string, string> | undefined} obj @param {number} chNum @param {number} channelIndex 0-based */
function peakFromVarChannel(obj, chNum, channelIndex) {
	if (!obj || typeof obj !== 'object') return NaN
	const fromStr = (s) => {
		const t = String(s ?? '').trim()
		if (t === '') return NaN
		const n = parseFloat(t)
		return Number.isFinite(n) ? n : NaN
	}
	if (channelIndex === 0) {
		const vL = fromStr(obj[`osc_ch${chNum}_audio_L`])
		if (Number.isFinite(vL)) return vL
	}
	if (channelIndex === 1) {
		const vR = fromStr(obj[`osc_ch${chNum}_audio_R`])
		if (Number.isFinite(vR)) return vR
	}
	return fromStr(obj[`osc_ch${chNum}_audio_c${channelIndex + 1}_dBFS`])
}

/**
 * One program bus channel (0-based index).
 * @param {number} chNum Caspar channel
 * @param {number} channelIndex 0-based bus channel
 */
export function readBusChannelPeakDbfs(chNum, channelIndex, oscClient, stateStore, vars) {
	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const slot = chState?.audio?.levels?.[channelIndex]
	if (slot && Number.isFinite(slot.dBFS)) return slot.dBFS
	const pSt = peakFromVarChannel(stateStore?.getState?.()?.variables, chNum, channelIndex)
	if (Number.isFinite(pSt)) return pSt
	const pVs = vars ? peakFromVarChannel(vars.variables, chNum, channelIndex) : NaN
	if (Number.isFinite(pVs)) return pVs
	return -99
}

/** @param {unknown[]} [levels] */
export function peakDbfsFromLevels(levels) {
	if (!Array.isArray(levels) || levels.length === 0) return NaN
	const L = levels[0]?.dBFS
	const R = levels[1]?.dBFS
	if (!Number.isFinite(L) && !Number.isFinite(R)) return NaN
	return Math.max(Number.isFinite(L) ? L : -99, Number.isFinite(R) ? R : -99)
}

/** @param {Record<string, string> | undefined} obj */
export function peakDbfsFromVarStrings(obj, chNum) {
	if (!obj || typeof obj !== 'object') return NaN
	const l = peakFromVarChannel(obj, chNum, 0)
	const r = peakFromVarChannel(obj, chNum, 1)
	if (!Number.isFinite(l) && !Number.isFinite(r)) return NaN
	return Math.max(Number.isFinite(l) ? l : -99, Number.isFinite(r) ? r : -99)
}

/**
 * Bus peak dBFS: read OSC first (freshest, ~50ms tick), fall back to variables (10Hz throttle).
 * @param {number} chNum
 * @param {import('./variable-state.js').VariableStore | null} vars
 * @param {import('./osc-client.js').OscClient | null} oscClient
 * @param {import('./state-store.js').StateStore} stateStore
 */
export function readBusPeakDbfs(chNum, vars, oscClient, stateStore) {
	return readBusPeakDbfsOrNull(chNum, vars, oscClient, stateStore) ?? -99
}

/**
 * Same read as {@link readBusPeakDbfs}, but returns `null` instead of the -99 sentinel when no
 * source has ever reported a level for this channel. WO-284 needs that difference: -99 means
 * "quiet", null means "nothing has been heard from this channel at all".
 * @param {number} chNum
 * @param {import('./variable-state.js').VariableStore | null} vars
 * @param {import('./osc-client.js').OscClient | null} oscClient
 * @param {import('./state-store.js').StateStore} stateStore
 * @returns {number | null}
 */
export function readBusPeakDbfsOrNull(chNum, vars, oscClient, stateStore) {
	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const pOsc = peakDbfsFromLevels(chState?.audio?.levels)
	if (Number.isFinite(pOsc)) return pOsc
	const pSt = peakDbfsFromVarStrings(stateStore?.getState?.()?.variables, chNum)
	if (Number.isFinite(pSt)) return pSt
	const pVs = vars ? peakDbfsFromVarStrings(vars.variables, chNum) : NaN
	if (Number.isFinite(pVs)) return pVs
	return null
}

/**
 * WO-284 — one metering sample for a dedicated input channel strip, carrying the
 * silence-vs-no-data distinction the meter styles on.
 * @param {number} hostCh
 * @param {import('./osc-client.js').OscClient | null} oscClient
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {{ muted?: boolean, inputLayer?: number | null } | undefined} layerMeta
 * @param {import('./variable-state.js').VariableStore | null} vars
 * @returns {{ dbfs: number | null, hasData: boolean, muted: boolean }}
 */
export function readInputChannelMeterSample(hostCh, oscClient, stateStore, layerMeta, vars) {
	const chNum = parseInt(String(hostCh), 10)
	if (!Number.isFinite(chNum) || chNum < 1) return { dbfs: null, hasData: false, muted: false }
	const key = String(chNum)
	const channelState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum] ?? null
	const dbfs = readBusPeakDbfsOrNull(chNum, vars, oscClient, stateStore)
	const hasData = inputHasAudioData({
		channelState,
		inputLayer: layerMeta?.inputLayer ?? null,
		dbfs,
	})
	return { dbfs, hasData, muted: !!layerMeta?.muted }
}

/**
 * Layer strip dBFS: per-layer OSC when available; channel bus when this layer is on-air.
 * @param {import('./variable-state.js').VariableStore | null} [vars]
 */
export function readLayerPeakDbfs(chNum, layerNum, oscClient, stateStore, layerMeta, vars) {
	if (layerMeta?.muted) return -99

	const busLevel = readBusPeakDbfs(chNum, vars, oscClient, stateStore)
	const onAir = isLayerStripOnAir(chNum, layerNum, oscClient, stateStore, layerMeta)
	const soleLiveMedia = isSoleLiveSceneMediaLayer(stateStore, chNum, layerNum)
	if (!onAir && !(soleLiveMedia && busLevel > -90)) return -99

	const key = String(chNum)
	const chState = oscClient?.channels?.[key] ?? oscClient?.channels?.[chNum]
	const oscLayer = chState?.layers?.[layerNum] ?? chState?.layers?.[String(layerNum)]
	const layerPeak = peakDbfsFromLevels(oscLayer?.audio?.levels)
	if (Number.isFinite(layerPeak)) return layerPeak
	return busLevel
}

/**
 * Live audio strip — always meter the dedicated host channel bus (e.g. ch 5 alsa capture),
 * not the PGM route layer that carries route:// into program.
 * @param {import('./variable-state.js').VariableStore | null} vars
 */
export function readLiveInputHostChannelPeakDbfs(hostCh, oscClient, stateStore, layerMeta, vars) {
	if (layerMeta?.muted) return -99
	const chNum = parseInt(String(hostCh), 10)
	if (!Number.isFinite(chNum) || chNum < 1) return -99
	return readBusPeakDbfs(chNum, vars, oscClient, stateStore)
}
