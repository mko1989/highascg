/**
 * Next mainScreenIndex for a newly added screen destination.
 *
 * Mirrors the server's isMainBusDestinationMode (src/config/screen-destinations.js): multiview,
 * stream and operator_gui carry a mainScreenIndex only as a placement hint, never as a claim on a
 * PGM/PRV main slot — so they must NOT be counted when picking the next slot. The old inline
 * computation counted every destination, and the factory default seeds an operator_gui at index 0,
 * so the first REAL screen an operator added landed at index 1 — leaving a permanent gap at 0 that
 * the generator filled with a phantom Screen 1 PGM+PRV pair nothing routed to.
 */

/** @param {unknown} mode */
export function isMainBusDestinationMode(mode) {
	const m = String(mode || 'pgm_prv')
	return m !== 'multiview' && m !== 'stream' && m !== 'operator_gui'
}

/**
 * @param {Array<{ mode?: string, mainScreenIndex?: number|string }>} destinations existing list
 * @param {string} type mode of the destination being added
 * @returns {number} 0-based mainScreenIndex for the new destination
 */
export function nextMainScreenIndex(destinations, type) {
	// Utility channels never occupy a slot — same special-case the add handler always had.
	if (type === 'multiview' || type === 'operator_gui') return 0
	const list = Array.isArray(destinations) ? destinations : []
	const highest = Math.max(
		-1,
		...list
			.filter((d) => isMainBusDestinationMode(d?.mode))
			.map((d) => Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0)),
	)
	return highest + 1
}
