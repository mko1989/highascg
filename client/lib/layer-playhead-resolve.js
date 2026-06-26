/**
 * Resolve live media position on a Caspar channel/layer for SEEK on look take.
 * Uses Companion variables (`*current_duration*`), server state INFO, and OSC `file/*`.
 */
import { normalizeProgramLayerBank } from './program-layer-bank.js'
import { getInfoLayerRow, mergeOscFileWithInfoLayer } from '../components/playback-timer.js'
import { resolvePlaybackTimingFromFile } from './playback-timing-clock.js'

/**
 * Active PGM Caspar channel (switcher bus / layer bank aware).
 * @param {object} cm - channelMap
 * @param {object} st - full app state
 * @param {number} mainIdx
 * @param {number} programChannel
 */
export function resolveProgramCasparChannel(cm, st, mainIdx, programChannel) {
	let ch = Number(programChannel)
	if (!Number.isFinite(ch) || ch <= 0) return ch
	const map = cm && typeof cm === 'object' ? cm : {}
	if (map.transitionModel !== 'switcher_bus') return ch
	const screenIdx = Array.isArray(map.playbackChannels)
		? map.playbackChannels.indexOf(ch)
		: -1
	if (screenIdx < 0) return ch
	const parentCh = map.programChannels?.[screenIdx] ?? ch
	const bank = normalizeProgramLayerBank(st?.scene?.programLayerBankByChannel?.[String(parentCh)])
	const active =
		bank === 'b' ? map.switcherBusChannels?.[screenIdx] : map.switcherBus1Channels?.[screenIdx]
	return Number.isFinite(Number(active)) && Number(active) > 0 ? Number(active) : ch
}

/**
 * @param {string} raw
 * @param {number} fps
 * @returns {number | null} frame index (0-based in file)
 */
export function parseCurrentDurationToFrames(raw, fps) {
	if (raw == null || raw === '') return null
	const s = String(raw).trim()
	const n = parseFloat(s.replace(/[^\d.-]/g, ''))
	if (!Number.isFinite(n) || n < 0) return null
	const f = Math.max(1, fps || 25)
	if (/ms$/i.test(s) || (n > f * 3600 * 6 && n < 1e9)) return Math.round((n / 1000) * f)
	if (/^frame/i.test(s) || n > f * 3600 * 6) return Math.round(n)
	return Math.round(n * f)
}

/**
 * @param {Record<string, string>} vars
 * @param {number} channel
 * @param {number} layerNumber
 * @param {'a'|'b'|null} [bank]
 */
export function readCurrentDurationFramesFromVariables(vars, channel, layerNumber, bank, fps) {
	if (!vars || typeof vars !== 'object') return null
	const ch = channel
	const ln = layerNumber
	const exact = [
		`caspar_ch${ch}_layer${ln}_current_duration`,
		`caspar_ch${ch}_l${ln}_current_duration`,
		`caspar_layer_${ln}_ch${ch}_current_duration`,
		`osc_ch${ch}_layer${ln}_current_duration`,
		`layer_${ln}_current_duration`,
		`current_duration`,
	]
	if (bank) {
		exact.unshift(
			`caspar_ch${ch}_bank${bank}_layer${ln}_current_duration`,
			`caspar_ch${ch}_${bank}_layer${ln}_current_duration`,
		)
	}
	for (const k of exact) {
		if (vars[k] != null && vars[k] !== '') {
			const fr = parseCurrentDurationToFrames(vars[k], fps)
			if (fr != null) return fr
		}
	}
	const chs = String(ch)
	const lns = String(ln)
	const bankS = bank ? String(bank) : ''
	let best = null
	let bestScore = -1
	for (const [k, v] of Object.entries(vars)) {
		if (v == null || v === '') continue
		const kl = k.toLowerCase()
		if (!kl.includes('current_duration')) continue
		let score = 0
		if (kl.includes(lns)) score += 4
		if (kl.includes(`layer${lns}`) || kl.includes(`l${lns}`)) score += 2
		if (kl.includes(`ch${chs}`) || kl.includes(`channel${chs}`)) score += 3
		if (bankS && kl.includes(bankS)) score += 2
		if (score > bestScore) {
			const fr = parseCurrentDurationToFrames(v, fps)
			if (fr != null) {
				bestScore = score
				best = fr
			}
		}
	}
	return best
}

/**
 * @param {object} layerState - OSC layer
 * @param {object | null} infoLayer - AMCP INFO row
 * @param {number} fps
 */
export function readCurrentDurationFramesFromOscLayer(layerState, infoLayer, fps) {
	const rawFile = layerState?.file && typeof layerState.file === 'object' ? layerState.file : {}
	const merged = mergeOscFileWithInfoLayer(rawFile, infoLayer, fps)
	const timing = resolvePlaybackTimingFromFile(merged, fps)
	if (timing.frameElapsed != null && timing.frameElapsed >= 0) {
		return Math.round(timing.frameElapsed)
	}
	if (timing.elapsed != null && timing.elapsed >= 0) {
		return Math.round(timing.elapsed * timing.fps)
	}
	const hints = infoLayer && typeof infoLayer === 'object' ? parseFloat(infoLayer.timeSec) : NaN
	if (Number.isFinite(hints) && hints >= 0) return Math.round(hints * timing.fps)
	return null
}

/**
 * Live playhead on program output for a look layer (Caspar layer number).
 * @param {{
 *   programChannel: number,
 *   layerNumber: number,
 *   fps?: number,
 *   mainIdx?: number,
 *   stateStore?: { getState?: () => object },
 *   variableStore?: { getAll?: () => Record<string, string> },
 *   oscClient?: { channels?: Record<string, object> },
 * }} ctx
 * @returns {number | null} frame index in current file (before in-point trim)
 */
export function getLiveLayerPlayheadFrames(ctx) {
	const fps = Math.max(1, ctx.fps || 25)
	const layerNumber = Number(ctx.layerNumber)
	const programChannel = Number(ctx.programChannel)
	if (!Number.isFinite(layerNumber) || !Number.isFinite(programChannel) || programChannel <= 0) {
		return null
	}

	const st = ctx.stateStore?.getState?.() || {}
	const cm = st.channelMap || {}
	const mainIdx = ctx.mainIdx != null ? ctx.mainIdx : sceneStateMainFallback(st, programChannel, cm)
	const casparCh = resolveProgramCasparChannel(cm, st, mainIdx, programChannel)

	const bank = normalizeProgramLayerBank(
		st?.scene?.programLayerBankByChannel?.[String(cm.programChannels?.[mainIdx] ?? programChannel)],
	)

	const vars = ctx.variableStore?.getAll?.() || st.variables || {}
	const fromVar = readCurrentDurationFramesFromVariables(vars, casparCh, layerNumber, bank, fps)
	if (fromVar != null) return fromVar

	const chEntry = Array.isArray(st.channels)
		? st.channels.find((c) => c && Number(c.id) === casparCh)
		: null
	const infoLayer = getInfoLayerRow(chEntry, layerNumber)

	const oscCh = ctx.oscClient?.channels?.[String(casparCh)] ?? ctx.oscClient?.channels?.[casparCh]
	const oscLayer = oscCh?.layers?.[layerNumber] ?? oscCh?.layers?.[String(layerNumber)]
	if (oscLayer) {
		const fr = readCurrentDurationFramesFromOscLayer(oscLayer, infoLayer, fps)
		if (fr != null) return fr
	}

	if (infoLayer) {
		const fr = readCurrentDurationFramesFromOscLayer({ file: {} }, infoLayer, fps)
		if (fr != null) return fr
	}

	return null
}

/** @param {object} st @param {number} programChannel @param {object} cm */
function sceneStateMainFallback(st, programChannel, cm) {
	const pcs = cm.programChannels || []
	const i = pcs.indexOf(programChannel)
	return i >= 0 ? i : 0
}

/**
 * SEEK frame for take: trim in-point + live playhead when continuing from previous.
 * @param {number} inPointFrames
 * @param {object} ctx - same as getLiveLayerPlayheadFrames
 */
export function playSeekFramesForRelativeToPrevious(inPointFrames, ctx) {
	const live = getLiveLayerPlayheadFrames(ctx)
	const inPt = Math.max(0, Math.round(Number(inPointFrames) || 0))
	if (live != null) return inPt + live
	return inPt
}
