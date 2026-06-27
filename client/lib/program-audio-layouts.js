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
 * Widest PortAudio consumer layout cabled to each main destination's PGM feed.
 * @param {object} [settings]
 * @returns {Record<number, string>}
 */
export function cabledPortAudioLayoutsByMain(settings) {
	const byMain = /** @type {Record<number, string>} */ ({})
	const audioOutputs = Array.isArray(settings?.audioOutputs) ? settings.audioOutputs : []
	const destinations = destinationsFromSettings(settings)
	const edges = Array.isArray(settings?.deviceGraph?.edges) ? settings.deviceGraph.edges : []

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
 * @param {object} [settings]
 * @param {object} [channelMap]
 * @param {number} [screenCount]
 * @returns {string[]}
 */
export function resolveProgramAudioLayouts(settings, channelMap, screenCount) {
	const sc =
		screenCount != null && Number.isFinite(Number(screenCount))
			? Math.max(1, Number(screenCount))
			: channelMap?.screenCount || settings?.casparServer?.screen_count || 1
	const destByMain = destinationAudioLayoutsByMain(settings)
	const cabledByMain = cabledPortAudioLayoutsByMain(settings)

	const widen = (layout, i) => {
		const dest = layout || destByMain[i] || 'stereo'
		const cabled = cabledByMain[i]
		return cabled != null ? maxProgramLayout(dest, cabled) : dest
	}

	const fromMap = channelMap?.programAudioLayouts
	if (Array.isArray(fromMap) && fromMap.length >= sc) {
		return fromMap.slice(0, sc).map((l, i) => widen(normalizeProgramLayout(l), i))
	}

	const layouts = []
	for (let i = 0; i < sc; i++) {
		layouts.push(widen(destByMain[i] || 'stereo', i))
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
