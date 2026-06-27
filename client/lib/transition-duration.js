/**
 * Transition duration helpers — stored sentinel 12 means "auto: half project fps".
 */

/** Legacy bootstrap value: auto duration (half project fps). */
export const AUTO_TRANSITION_DURATION_SENTINEL = 12

/**
 * @param {number} fps
 * @returns {number}
 */
export function transitionDurationForFps(fps) {
	const n = Number(fps)
	const rate = Number.isFinite(n) && n > 0 ? n : 50
	return Math.max(1, Math.round(rate / 2))
}

/**
 * @param {unknown} duration
 * @returns {boolean}
 */
export function isAutoTransitionDuration(duration) {
	const d = Math.round(Number(duration))
	return !Number.isFinite(d) || d === AUTO_TRANSITION_DURATION_SENTINEL
}

/**
 * @param {unknown} duration
 * @param {number} [fps]
 * @returns {number}
 */
export function resolveTransitionDuration(duration, fps) {
	if (isAutoTransitionDuration(duration)) {
		return transitionDurationForFps(fps)
	}
	return Math.max(0, Math.round(Number(duration)))
}
