'use strict'

const { channelCountFromLayout, normalizeProgramLayout } = require('../config/audio-channel-layouts')
const {
	resolveEffectiveProgramLayout,
	resolveProgramLayoutForMain,
	resolveProgramLayoutForProgramChannel,
} = require('../config/program-audio-layouts')

/** Stereo pair id → 0-based output channel indices on the program master bus. */
const ROUTE_OUTPUT_CHANNELS = {
	'1+2': [0, 1],
	'3+4': [2, 3],
	'5+6': [4, 5],
	'7+8': [6, 7],
	'9+10': [8, 9],
	'11+12': [10, 11],
	'13+14': [12, 13],
	'15+16': [14, 15],
}

/**
 * @param {object | null | undefined} config
 * @returns {string}
 */
function resolveConfigProgramLayout(config, mainIndex) {
	if (config && mainIndex != null && Number.isFinite(Number(mainIndex))) {
		return resolveProgramLayoutForMain(config, Number(mainIndex))
	}
	return resolveEffectiveProgramLayout(config?.audioRouting, config?.audioOutputs, config)
}

/**
 * @param {object | null | undefined} config
 * @param {number} programCh Caspar channel number
 */
function resolveConfigProgramLayoutForChannel(config, programCh) {
	return resolveProgramLayoutForProgramChannel(config, Number(programCh))
}

/**
 * Map layer `audioRoute` (stereo pair within the program mix) to Caspar FFmpeg audio filter string.
 * Output channel count must match the Caspar channel `<channel-layout>` (e.g. pan=8c for 8ch PGM).
 * @param {string} [route]
 * @param {string} [programLayout] - `stereo` | `4ch` | `8ch` | `16ch`
 * @returns {string | null} inner AF string for AMCP, or null for default (1+2)
 */
function audioRouteToAudioFilter(route, programLayout) {
	const r = route || '1+2'
	if (r === '1+2') return null
	const out = ROUTE_OUTPUT_CHANNELS[r]
	if (!out) return null
	const busChannels = channelCountFromLayout(normalizeProgramLayout(programLayout))
	if (busChannels < 2 || out[1] >= busChannels) return null
	return `pan=${busChannels}c|c${out[0]}=c0|c${out[1]}=c1`
}

/**
 * Map route source channel pair selection to Caspar FFmpeg audio filter string.
 * For a multi-channel source (e.g. 8ch program routed into a layer), select which
 * source channels to play and route them to stereo output (c0=source-ch-N, c1=source-ch-M).
 * @param {string} [pairId] - channel pair like '1+2', '3+4', '5+6', '7+8' (1-based); 'all' or falsy = no filter
 * @param {string} [sourceLayout] - source channel layout like 'stereo' | '4ch' | '8ch' | '16ch'
 * @returns {string | null} inner AF string for AMCP, or null for 'all' / identity
 */
function routeSourceChannelsToAudioFilter(pairId, sourceLayout) {
	const pair = pairId && String(pairId).trim()
	if (!pair || pair === 'all') return null
	const sourceChannels = channelCountFromLayout(normalizeProgramLayout(sourceLayout))
	if (sourceChannels < 2) return null
	const match = String(pair).match(/^(\d+)\+(\d+)$/)
	if (!match) return null
	const ch0 = Number(match[1]) - 1
	const ch1 = Number(match[2]) - 1
	if (ch0 < 0 || ch1 < 0 || ch0 >= sourceChannels || ch1 >= sourceChannels) return null
	if (ch0 === ch1) return null
	return `pan=stereo|c0=c${ch0}|c1=c${ch1}`
}

module.exports = {
	ROUTE_OUTPUT_CHANNELS,
	resolveConfigProgramLayout,
	resolveConfigProgramLayoutForChannel,
	audioRouteToAudioFilter,
	routeSourceChannelsToAudioFilter,
}
