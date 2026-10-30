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

/**
 * A program bus's name in the audio mixer (owner 30.10: "show pgm1 instead of its label"): the screen's own label + PGM /
 * PRV ("Dioda PGM", "Proj PRV"); an unlabelled screen keeps "PGM 1 Master" / "PRV 1 Master".
 * @param {object} channelMap
 * @param {number} idx - program index (0-based)
 * @param {boolean} [preview]
 */
export function programBusLabel(channelMap, idx, preview = false) {
	const labels = channelMap?.screenLabels
	const own = Array.isArray(labels) && labels[idx] ? String(labels[idx]) : ''
	const kind = preview ? 'PRV' : 'PGM'
	return own ? `${own} ${kind}` : `${kind} ${idx + 1} Master`
}

/** The program's input group title: "Dioda PGM (ch 1) Inputs", unlabelled "PGM 1 (ch 1) Inputs". */
export function programInputsTitle(channelMap, idx, ch) {
	const labels = channelMap?.screenLabels
	const own = Array.isArray(labels) && labels[idx] ? String(labels[idx]) : ''
	return `${own ? `${own} PGM` : `PGM ${idx + 1}`} (ch ${ch}) Inputs`
}
