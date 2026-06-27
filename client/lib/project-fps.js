/**
 * Project frame rate helpers (client) — mirrors server `src/config/project-fps.js`.
 */

export const STANDARD_PROJECT_FPS = [23.98, 24, 25, 29.97, 30, 50, 59.94, 60]

const DEFAULT_VIDEO_MODE_BY_FPS = {
	23.98: '1080p2398',
	24: '1080p2400',
	25: '1080p2500',
	29.97: '1080p2997',
	30: '1080p3000',
	50: '1080p5000',
	59.94: '1080p5994',
	60: '1080p6000',
}

/**
 * @param {unknown} fps
 * @returns {number}
 */
export function normalizeProjectFps(fps) {
	const n = parseFloat(String(fps))
	if (!Number.isFinite(n) || n <= 0) return 50
	let best = 50
	let bestDiff = Infinity
	for (const s of STANDARD_PROJECT_FPS) {
		const d = Math.abs(s - n)
		if (d < bestDiff) {
			bestDiff = d
			best = s
		}
	}
	return best
}

/**
 * @param {number} fps
 * @returns {string}
 */
export function defaultVideoModeForProjectFps(fps) {
	return DEFAULT_VIDEO_MODE_BY_FPS[normalizeProjectFps(fps)] || '1080p5000'
}

/**
 * @param {object} [settings]
 * @returns {number}
 */
export function resolveProjectFpsFromSettings(settings) {
	const fps = settings?.machineProfile?.defaultProjectFps
	if (fps != null) return normalizeProjectFps(fps)
	const pr = settings?.channelMap?.programResolutions?.[0]
	if (pr?.fps > 0) return normalizeProjectFps(pr.fps)
	return 50
}
