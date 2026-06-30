/**
 * Human-readable Device View cable edge rejection reasons (matches server `device-graph-edges.js`).
 */
const MAP = {
	sink_already_connected:
		'That output already has a cable. Remove the existing cable first, then connect from the mapping output again.',
	duplicate: 'This cable is already in the graph.',
	self_loop: 'Cannot connect a connector to itself.',
	missing_ids: 'Missing connector id — refresh Device View and try again.',
	unknown_source: 'Unknown source connector — refresh Device View or sync from hardware.',
	unknown_sink: 'Unknown sink connector — refresh Device View or sync from hardware.',
}

/** @param {string} raw */
export function describeCableRejection(raw) {
	const r = String(raw || '').trim()
	if (!r) return 'Cable could not be saved.'
	if (MAP[r]) return MAP[r]
	if (r.includes('sink_already_connected')) return MAP.sink_already_connected
	if (r.includes('allowed:') || r.includes('destination_to_output'))
		return 'This pairing is not allowed — try the other direction (signal flows destination feed → mapping input, mapping output → GPU/DeckLink output).'
	if (r.includes('validate') || r.includes('Invalid')) return `Graph validation failed: ${r}`
	return r
}

/** Extract server reason from api-client HTTP Error message */
export function cableReasonFromError(err) {
	const msg = String(err?.message || err || '')
	const m = msg.match(/HTTP\s+\d+:\s*(.+)/i)
	return describeCableRejection(m ? m[1].trim() : msg)
}
