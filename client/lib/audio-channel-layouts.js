/**
 * Channel layout ids for PortAudio outputs and program master bus.
 */

export const PORTAUDIO_LAYOUT_OPTIONS = [
	{ value: 'mono', label: 'Mono (1ch)', channels: 1 },
	{ value: 'stereo', label: 'Stereo (2ch)', channels: 2 },
	{ value: '4ch', label: '4-Channel', channels: 4 },
	{ value: '8ch', label: '8-Channel', channels: 8 },
	{ value: '16ch', label: '16-Channel', channels: 16 },
]

export const PROGRAM_LAYOUT_OPTIONS = [
	{ value: 'stereo', label: 'Stereo (2ch)', channels: 2 },
	{ value: '4ch', label: '4-Channel', channels: 4 },
	{ value: '8ch', label: '8-Channel', channels: 8 },
	{ value: '16ch', label: '16-Channel', channels: 16 },
]

/**
 * @param {string} [layoutId]
 * @returns {number}
 */
export function channelCountFromLayout(layoutId) {
	const key = String(layoutId || 'stereo').toLowerCase()
	const hit = PORTAUDIO_LAYOUT_OPTIONS.find((o) => o.value === key)
	return hit?.channels ?? 2
}

/**
 * @param {number} [maxOutputChannels] - from PortAudio enumeration; 0 = unknown
 * @returns {typeof PORTAUDIO_LAYOUT_OPTIONS}
 */
export function portAudioLayoutOptionsForDevice(maxOutputChannels) {
	const cap = maxOutputChannels > 0 ? Math.min(16, maxOutputChannels) : 16
	return PORTAUDIO_LAYOUT_OPTIONS.filter((o) => o.channels <= cap)
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function maxProgramLayout(a, b) {
	return channelCountFromLayout(a) >= channelCountFromLayout(b) ? String(a || 'stereo') : String(b || 'stereo')
}

/**
 * @param {string} [layoutId]
 * @returns {string}
 */
export function normalizeProgramLayout(layoutId) {
	const key = String(layoutId || 'stereo').toLowerCase()
	if (PROGRAM_LAYOUT_OPTIONS.some((o) => o.value === key)) return key
	if (key === 'mono') return 'stereo'
	return 'stereo'
}

export {
	resolveEffectiveProgramLayout,
	resolveProgramLayoutForMain,
	resolveProgramLayoutForProgramChannel,
	resolveProgramAudioLayouts,
	programBusChannelCountForChannel,
	programBusChannelCountForMain,
} from './program-audio-layouts.js'
