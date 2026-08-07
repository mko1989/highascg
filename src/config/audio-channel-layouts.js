'use strict'

/** @typedef {'mono' | 'stereo' | '4ch' | '8ch' | '16ch'} AudioChannelLayoutId */

const LAYOUT_CHANNEL_COUNT = {
	mono: 1,
	stereo: 2,
	'4ch': 4,
	'8ch': 8,
	'16ch': 16,
}

const PROGRAM_LAYOUT_IDS = ['stereo', '4ch', '8ch', '16ch']

/**
 * Caspar layout id for linear discrete buses (timeline pairs 1+2 … 7+8).
 * Stock Caspar `8ch` is 7.1 surround (FL FR FC LFE …), not c0–c7.
 */
const DISCRETE_8CH_LAYOUT_ID = 'discrete-8ch'

/**
 * @param {string} [layoutId]
 * @returns {number}
 */
function channelCountFromLayout(layoutId) {
	const key = String(layoutId || 'stereo').toLowerCase()
	return LAYOUT_CHANNEL_COUNT[key] ?? 2
}

/**
 * @param {string} [layoutId]
 * @returns {AudioChannelLayoutId}
 */
function normalizeProgramLayout(layoutId) {
	const key = String(layoutId || 'stereo').toLowerCase()
	return /** @type {AudioChannelLayoutId} */ (PROGRAM_LAYOUT_IDS.includes(key) ? key : 'stereo')
}

/**
 * Wider layout wins (for syncing program master with PortAudio consumers).
 * @param {string} a
 * @param {string} b
 * @returns {AudioChannelLayoutId}
 */
function maxProgramLayout(a, b) {
	const ca = channelCountFromLayout(a)
	const cb = channelCountFromLayout(b)
	return normalizeProgramLayout(ca >= cb ? a : b)
}

/**
 * Program master layout for mixer / inspector routing — widest of explicit programLayout
 * and enabled PortAudio output layouts.
 * @param {Record<string, unknown>} [audioRouting]
 * @param {Array<{ enabled?: boolean, type?: string, channelLayout?: string }>} [audioOutputs]
 * @returns {string}
 */
/**
 * Map UI / routing layout ids to Caspar `<channel-layout>` names in generated config.
 * @param {string} [layoutId]
 * @returns {string}
 */
function casparChannelLayoutId(layoutId) {
	const key = String(layoutId || 'default').toLowerCase()
	if (key === '8ch') return DISCRETE_8CH_LAYOUT_ID
	return key
}

module.exports = {
	LAYOUT_CHANNEL_COUNT,
	PROGRAM_LAYOUT_IDS,
	DISCRETE_8CH_LAYOUT_ID,
	channelCountFromLayout,
	normalizeProgramLayout,
	maxProgramLayout,
	casparChannelLayoutId,
}
