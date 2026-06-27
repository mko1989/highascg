'use strict'

const { getChannelMap } = require('./routing')
const { destinationAudioLayoutsByMain, destinationsFromConfig } = require('./screen-destinations')
const { normalizeProgramLayout, maxProgramLayout } = require('./audio-channel-layouts')

/**
 * Widest PortAudio consumer layout cabled to each main destination's PGM feed.
 * @param {Record<string, unknown>} [config]
 * @returns {Record<number, string>}
 */
function cabledPortAudioLayoutsByMain(config) {
	const byMain = /** @type {Record<number, string>} */ ({})
	const audioOutputs = Array.isArray(config?.audioOutputs) ? config.audioOutputs : []
	const destinations = destinationsFromConfig(config || {})
	const edges = Array.isArray(config?.deviceGraph?.edges) ? config.deviceGraph.edges : []

	for (const out of audioOutputs) {
		if (!out || typeof out !== 'object') continue
		if (out.enabled === false || out.enabled === 'false') continue
		const consumerType = String(out.type || 'portaudio').toLowerCase()
		if (consumerType === 'system-audio') continue
		const id = String(out.id || '').trim()
		if (!id) continue

		const edge = edges.find((e) => String(e.sinkId) === id)
		if (!edge) continue

		const srcId = String(edge.sourceId || '')
		let destId = ''
		if (srcId.startsWith('dst_in_')) destId = srcId.slice('dst_in_'.length)
		const dest = destinations.find((d) => String(d.id) === destId)
		if (!dest || String(dest.mode || '') === 'multiview') continue

		const idx = Math.max(0, parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0)
		const layout = normalizeProgramLayout(String(out.channelLayout || 'stereo'))
		byMain[idx] = byMain[idx] != null ? maxProgramLayout(byMain[idx], layout) : layout
	}
	return byMain
}

/**
 * Per-main program bus layout from Device View destination settings.
 * @param {Record<string, unknown>} [config]
 * @param {number} [screenCount]
 * @returns {string[]}
 */
function resolveProgramAudioLayoutsForConfig(config, screenCount) {
	const sc =
		screenCount != null && Number.isFinite(Number(screenCount))
			? Math.max(1, Number(screenCount))
			: getChannelMap(config || {}).screenCount || 1
	const destByMain = destinationAudioLayoutsByMain(config)
	const cabledByMain = cabledPortAudioLayoutsByMain(config)
	const layouts = []
	for (let i = 0; i < sc; i++) {
		const dest = destByMain[i] || 'stereo'
		const cabled = cabledByMain[i]
		layouts.push(cabled != null ? maxProgramLayout(dest, cabled) : dest)
	}
	return layouts
}

/**
 * @param {Record<string, unknown>} [config]
 * @param {number} [mainIndex] 0-based main / screen index
 * @returns {string}
 */
function resolveProgramLayoutForMain(config, mainIndex) {
	const idx = Math.max(0, Number(mainIndex) || 0)
	return resolveProgramAudioLayoutsForConfig(config)[idx] || 'stereo'
}

/**
 * @param {Record<string, unknown>} [config]
 * @param {number} programCh Caspar channel number
 * @returns {string}
 */
function resolveProgramLayoutForProgramChannel(config, programCh) {
	const ch = Number(programCh)
	if (!Number.isFinite(ch) || ch < 1) return 'stereo'
	const map = getChannelMap(config || {})
	const programChannels = map.programChannels || []
	const mainIdx = programChannels.findIndex((c) => Number(c) === ch)
	if (mainIdx < 0) return 'stereo'
	return resolveProgramLayoutForMain(config, mainIdx)
}

/**
 * Widest per-main layout (for fallbacks when no screen context).
 * @param {Record<string, unknown>} [audioRouting]
 * @param {unknown} [_audioOutputs] legacy — ignored
 * @param {Record<string, unknown>} [config]
 * @param {number} [screenCount]
 * @returns {string}
 */
function resolveEffectiveProgramLayout(audioRouting, _audioOutputs, config, screenCount) {
	if (config && typeof config === 'object') {
		const layouts = resolveProgramAudioLayoutsForConfig(config, screenCount)
		return layouts.reduce((acc, layout) => maxProgramLayout(acc, layout), 'stereo')
	}
	return normalizeProgramLayout(String(audioRouting?.programLayout || 'stereo'))
}

/** @deprecated Use {@link cabledPortAudioLayoutsByMain} */
function resolveCabledLayoutsByMain(config) {
	return cabledPortAudioLayoutsByMain(config)
}

module.exports = {
	cabledPortAudioLayoutsByMain,
	resolveCabledLayoutsByMain,
	resolveProgramAudioLayoutsForConfig,
	resolveProgramLayoutForMain,
	resolveProgramLayoutForProgramChannel,
	resolveEffectiveProgramLayout,
	destinationAudioLayoutsByMain,
}
