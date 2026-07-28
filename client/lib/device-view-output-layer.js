/**
 * device-view-output-layer.js — WO-365: ONE reader for the `{outputLayer}` note WO-364 put on
 * destination edges (1 = PGM, 2 = PRV), plus the anchor identity the cable renderer needs.
 *
 * There were two copies of this parser (device-view-destinations-inspector-modes.js and a
 * private one in device-view-matrix.js) before the cable renderer needed a third. It lives
 * here now; both components import it.
 *
 * A `pgm_prv` destination is ONE graph connector (`dst_in_<id>`) with TWO output halves, so
 * every consumer that wants to tell the halves apart — matrix rows, cable anchors — needs the
 * same `id#half` key. That key is `anchorKeyFor()`.
 */

/** @param {{note?: unknown} | null | undefined} edge @returns {number} 1-based output layer */
export function edgeOutputLayer(edge) {
	const raw = edge?.note
	if (raw == null || raw === '') return 1
	if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(1, Math.round(raw))
	const s = String(raw || '').trim()
	if (!s) return 1
	try {
		const j = JSON.parse(s)
		const n = Number(j?.outputLayer)
		return Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1
	} catch {
		const m = s.match(/outputLayer\s*[:=]\s*(\d+)/i)
		return m ? Math.max(1, parseInt(m[1], 10) || 1) : 1
	}
}

/** Which half of a pgm_prv pair an edge leaves from. @returns {'pgm' | 'prv'} */
export function edgeHalfOf(edge) {
	return edgeOutputLayer(edge) >= 2 ? 'prv' : 'pgm'
}

/** True for the destination-input connectors that can be split into PGM/PRV halves. */
export function isDestinationConnectorId(connId) {
	return String(connId || '').startsWith('dst_in_')
}

/** Anchor identity for a connector, half-qualified when it has one. @returns {string} */
export function anchorKeyFor(connId, half) {
	const id = String(connId || '')
	if (!id) return ''
	return half === 'pgm' || half === 'prv' ? `${id}#${half}` : id
}

/**
 * The anchor key a cable should LEAVE from: destination sources carry their half (read from the
 * edge note), everything else anchors on its plain connector id.
 * @param {{sourceId?: string, note?: unknown} | null | undefined} edge
 */
export function edgeSourceAnchorKey(edge) {
	const id = String(edge?.sourceId || '')
	if (!id) return ''
	return isDestinationConnectorId(id) ? anchorKeyFor(id, edgeHalfOf(edge)) : id
}
