import { channelCountFromLayout, normalizeProgramLayout } from './audio-channel-layouts.js'

/** Stereo pair id → 0-based output channel indices (mirrors server `src/engine/audio-route.js`). */
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
export const AUDIO_OUTPUT_ROUTES = [
	{ value: '1+2', label: 'ch1+2' },
	{ value: '3+4', label: 'ch3+4' },
	{ value: '5+6', label: 'ch5+6' },
	{ value: '7+8', label: 'ch7+8' },
	{ value: '9+10', label: 'ch9+10' },
	{ value: '11+12', label: 'ch11+12' },
	{ value: '13+14', label: 'ch13+14' },
	{ value: '15+16', label: 'ch15+16' },
]

/** Master layout (from `audioRouting.programLayout`) → number of stereo pairs available for routing. */
const LAYOUT_STEREO_PAIR_COUNT = {
	stereo: 1,
	'4ch': 2,
	'8ch': 4,
	'16ch': 8,
}

/**
 * @param {string} [programLayout] - `stereo` | `4ch` | `8ch` | `16ch`
 * @returns {typeof AUDIO_OUTPUT_ROUTES}
 */
export function audioOutputRoutesForLayout(programLayout) {
	const key = String(programLayout || 'stereo').toLowerCase()
	const pairs = LAYOUT_STEREO_PAIR_COUNT[key] ?? 1
	const n = Math.min(Math.max(1, pairs), AUDIO_OUTPUT_ROUTES.length)
	return AUDIO_OUTPUT_ROUTES.slice(0, n)
}

/**
 * @param {string} [route] - e.g. `7+8`
 * @param {string} [programLayout]
 * @returns {string} same route if allowed, otherwise first pair (`1+2`)
 */
export function normalizeAudioRouteForLayout(route, programLayout) {
	const allowed = audioOutputRoutesForLayout(programLayout)
	const values = new Set(allowed.map((r) => r.value))
	const r = route || '1+2'
	if (values.has(r)) return r
	return allowed[0]?.value || '1+2'
}

/**
 * Map layer `audioRoute` to Caspar FFmpeg audio filter (must match server `src/engine/audio-route.js`).
 * @param {string} [route]
 * @param {string} [programLayout]
 * @returns {string | null} inner AF string for AMCP, or null for default (1+2)
 */
export function audioRouteToAudioFilter(route, programLayout) {
	const r = route || '1+2'
	if (r === '1+2') return null
	const out = ROUTE_OUTPUT_CHANNELS[r]
	if (!out) return null
	const busChannels = channelCountFromLayout(normalizeProgramLayout(programLayout))
	if (busChannels < 2 || out[1] >= busChannels) return null
	return `pan=${busChannels}c|c${out[0]}=c0|c${out[1]}=c1`
}
