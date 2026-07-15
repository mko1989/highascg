/**
 * Screen label helper (WO-222).
 * Returns custom label if set, otherwise fallback to S + (idx + 1).
 */

/**
 * Get the display label for a screen.
 * @param {object} channelMap - From stateStore.channelMap (with .screenLabels array)
 * @param {number} idx - Screen index (0-based)
 * @returns {string} Display label (e.g., "S1", "Main", etc.)
 */
export function screenLabel(channelMap, idx) {
	const labels = channelMap?.screenLabels
	if (Array.isArray(labels) && idx >= 0 && idx < labels.length && labels[idx]) {
		return labels[idx]
	}
	return 'S' + (idx + 1)
}
