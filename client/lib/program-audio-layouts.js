/**
 * Per-main program bus layout from Device View destination settings.
 */

import {
	channelCountFromLayout,
	normalizeProgramLayout,
	maxProgramLayout,
} from './audio-channel-layouts.js'

function destinationsFromSettings(settings) {
	const sd = settings?.screenDestinations
	if (!sd || typeof sd !== 'object' || !Array.isArray(sd.destinations)) return []
	return sd.destinations.filter((d) => d && d.id)
}

/**
 * @param {object} [settings]
 * @returns {Record<number, string>}
 */
export function destinationAudioLayoutsByMain(settings) {
	const byMain = /** @type {Record<number, string>} */ ({})
	for (const dest of destinationsFromSettings(settings)) {
		const mode = String(dest.mode || '')
		if (mode === 'multiview' || mode === 'stream') continue
		const idx = Math.max(0, parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0)
		byMain[idx] = normalizeProgramLayout(dest.audioLayout || 'stereo')
	}
	return byMain
}

/**
 * @param {object} [settings]
 * @param {object} [channelMap]
 * @param {number} [screenCount]
 * @returns {string[]}
 */
export function resolveProgramAudioLayouts(settings, channelMap, screenCount) {
	const fromMap = channelMap?.programAudioLayouts
	const sc =
		screenCount != null && Number.isFinite(Number(screenCount))
			? Math.max(1, Number(screenCount))
			: channelMap?.screenCount || settings?.casparServer?.screen_count || 1
	if (Array.isArray(fromMap) && fromMap.length >= sc) {
		return fromMap.slice(0, sc).map((l) => normalizeProgramLayout(l))
	}

	const byMain = destinationAudioLayoutsByMain(settings)
	const layouts = []
	for (let i = 0; i < sc; i++) {
		layouts.push(byMain[i] || 'stereo')
	}
	return layouts
}

/**
 * @param {object} [settings]
 * @param {object} [channelMap]
 * @param {number} [mainIndex] 0-based
 */
export function resolveProgramLayoutForMain(settings, channelMap, mainIndex) {
	const idx = Math.max(0, Number(mainIndex) || 0)
	return resolveProgramAudioLayouts(settings, channelMap)[idx] || 'stereo'
}

/**
 * @param {object} [settings]
 * @param {object} [channelMap]
 * @param {number} programCh
 */
export function resolveProgramLayoutForProgramChannel(settings, channelMap, programCh) {
	const ch = Number(programCh)
	const programChannels = channelMap?.programChannels || []
	const mainIdx = programChannels.findIndex((c) => Number(c) === ch)
	if (mainIdx < 0) return 'stereo'
	return resolveProgramLayoutForMain(settings, channelMap, mainIdx)
}

/**
 * @param {object} [settings]
 * @param {object} [channelMap]
 */
export function resolveEffectiveProgramLayout(settings, channelMap) {
	const layouts = resolveProgramAudioLayouts(settings, channelMap)
	return layouts.reduce((acc, layout) => maxProgramLayout(acc, layout), 'stereo')
}

/**
 * @param {object} [settings]
 * @param {object} [channelMap]
 * @param {number} programCh
 */
export function programBusChannelCountForChannel(settings, channelMap, programCh) {
	return channelCountFromLayout(resolveProgramLayoutForProgramChannel(settings, channelMap, programCh))
}

/**
 * @param {object} [settings]
 * @param {object} [channelMap]
 * @param {number} mainIndex 0-based
 */
export function programBusChannelCountForMain(settings, channelMap, mainIndex) {
	return channelCountFromLayout(resolveProgramLayoutForMain(settings, channelMap, mainIndex))
}
