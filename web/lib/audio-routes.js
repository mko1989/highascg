/**
 * Stereo pair destinations within the program master bus (Caspar pan filter).
 * How many pairs are valid follows Settings → Audio → Master → channel layout.
 */
export const AUDIO_OUTPUT_ROUTES = [
	{ value: '1+2', label: 'Master (ch 1+2)' },
	{ value: '3+4', label: 'Ch 3+4' },
	{ value: '5+6', label: 'Ch 5+6' },
	{ value: '7+8', label: 'Ch 7+8' },
	{ value: '9+10', label: 'Ch 9+10' },
	{ value: '11+12', label: 'Ch 11+12' },
	{ value: '13+14', label: 'Ch 13+14' },
	{ value: '15+16', label: 'Ch 15+16' },
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
 * @returns {string | null} inner AF string for AMCP, or null for default (1+2)
 */
export function audioRouteToAudioFilter(route) {
	const r = route || '1+2'
	if (r === '1+2') return null
	let cLeft = 0
	let cRight = 1
	if (r === '3+4') {
		cLeft = 2
		cRight = 3
	} else if (r === '5+6') {
		cLeft = 4
		cRight = 5
	} else if (r === '7+8') {
		cLeft = 6
		cRight = 7
	} else if (r === '9+10') {
		cLeft = 8
		cRight = 9
	} else if (r === '11+12') {
		cLeft = 10
		cRight = 11
	} else if (r === '13+14') {
		cLeft = 12
		cRight = 13
	} else if (r === '15+16') {
		cLeft = 14
		cRight = 15
	} else return null
	if (cLeft <= 0) return null
	return `pan=16c|c${cLeft}=c0|c${cRight}=c1`
}
