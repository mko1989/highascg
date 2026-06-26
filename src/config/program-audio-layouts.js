'use strict'

const { getChannelMap } = require('./routing')
const { destinationAudioLayoutsByMain } = require('./screen-destinations')
const { normalizeProgramLayout, maxProgramLayout } = require('./audio-channel-layouts')

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
	const byMain = destinationAudioLayoutsByMain(config)
	const layouts = []
	for (let i = 0; i < sc; i++) {
		layouts.push(byMain[i] || 'stereo')
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

/** @deprecated Use destination `audioLayout` instead of cabled PortAudio width. */
function resolveCabledLayoutsByMain(_config) {
	return {}
}

module.exports = {
	resolveCabledLayoutsByMain,
	resolveProgramAudioLayoutsForConfig,
	resolveProgramLayoutForMain,
	resolveProgramLayoutForProgramChannel,
	resolveEffectiveProgramLayout,
	destinationAudioLayoutsByMain,
}
