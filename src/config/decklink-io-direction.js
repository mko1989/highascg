'use strict'

const DECKLINK_IO_UNASSIGNED = 'unassigned'

/**
 * @param {object|string|null|undefined} casparOrDirection
 * @returns {'out'|'in'|'unassigned'}
 */
function normalizeDecklinkIoDirection(casparOrDirection) {
	const raw =
		typeof casparOrDirection === 'string'
			? casparOrDirection
			: String(casparOrDirection?.ioDirection || '').trim()
	const d = raw.toLowerCase()
	if (d === 'out') return 'out'
	if (d === 'in') return 'in'
	return DECKLINK_IO_UNASSIGNED
}

/**
 * @param {object|null|undefined} connector
 */
function isDecklinkIoOut(connector) {
	return connector?.kind === 'decklink_io' && normalizeDecklinkIoDirection(connector.caspar) === 'out'
}

/**
 * @param {object|null|undefined} connector
 */
function isDecklinkIoIn(connector) {
	return connector?.kind === 'decklink_io' && normalizeDecklinkIoDirection(connector.caspar) === 'in'
}

/**
 * @param {object|null|undefined} connector
 */
function isDecklinkIoUnassigned(connector) {
	return connector?.kind === 'decklink_io' && normalizeDecklinkIoDirection(connector.caspar) === DECKLINK_IO_UNASSIGNED
}

/** Destination may cable to an unassigned or configured SDI output port. */
function isDecklinkIoOutputSink(connector) {
	if (connector?.kind !== 'decklink_io') return false
	const d = normalizeDecklinkIoDirection(connector.caspar)
	return d === 'out' || d === DECKLINK_IO_UNASSIGNED
}

module.exports = {
	DECKLINK_IO_UNASSIGNED,
	normalizeDecklinkIoDirection,
	isDecklinkIoOut,
	isDecklinkIoIn,
	isDecklinkIoUnassigned,
	isDecklinkIoOutputSink,
}
