/**
 * DeckLink SDI port direction — keep in sync with src/config/decklink-io-direction.js
 */

export const DECKLINK_IO_UNASSIGNED = 'unassigned'

/**
 * @param {object|string|null|undefined} casparOrDirection
 * @returns {'out'|'in'|'unassigned'}
 */
export function normalizeDecklinkIoDirection(casparOrDirection) {
	const raw =
		typeof casparOrDirection === 'string'
			? casparOrDirection
			: String(casparOrDirection?.ioDirection || '').trim()
	const d = raw.toLowerCase()
	if (d === 'out') return 'out'
	if (d === 'in') return 'in'
	return DECKLINK_IO_UNASSIGNED
}

export function isDecklinkIoOut(connector) {
	return connector?.kind === 'decklink_io' && normalizeDecklinkIoDirection(connector.caspar) === 'out'
}

export function isDecklinkIoIn(connector) {
	return connector?.kind === 'decklink_io' && normalizeDecklinkIoDirection(connector.caspar) === 'in'
}

export function isDecklinkIoUnassigned(connector) {
	return connector?.kind === 'decklink_io' && normalizeDecklinkIoDirection(connector.caspar) === DECKLINK_IO_UNASSIGNED
}

export function isDecklinkIoOutputSink(connector) {
	if (connector?.kind !== 'decklink_io') return false
	const d = normalizeDecklinkIoDirection(connector.caspar)
	return d === 'out' || d === DECKLINK_IO_UNASSIGNED
}
