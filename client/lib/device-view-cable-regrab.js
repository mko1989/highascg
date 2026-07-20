/**
 * WO-278 — re-grab an existing cable by one end and re-drop that end on another port.
 *
 * Pure decision logic only: no DOM, no network, no state. Everything here is a function of
 * the graph snapshot plus the gesture, so the rules below can be tested offline.
 *
 * The invariant this file exists to enforce: a re-grab NEVER persists an intermediate state.
 * The original edge stays in the server graph untouched for the whole gesture; only a target
 * that passes every check below produces a `retarget` plan. Every other outcome — empty
 * space, the same port it came from, a role/direction mismatch, an occupied sink — resolves
 * to `restore`, which is a no-op precisely because nothing was ever written.
 */

export const EDGE_END_SOURCE = 'source'
export const EDGE_END_SINK = 'sink'

/**
 * Endpoint hit-testing: which cable ends terminate at this connector.
 *
 * `end` is the end the operator would be grabbing; `anchorId` is the end that must stay put.
 *
 * @param {Array<{id?: string, sourceId?: string, sinkId?: string}> | null | undefined} edges
 * @param {string} connectorId
 * @returns {Array<{edgeId: string, end: 'source'|'sink', anchorId: string, movingId: string}>}
 */
export function findEdgeEndpointsAtConnector(edges, connectorId) {
	const cid = String(connectorId || '').trim()
	if (!cid) return []
	const list = Array.isArray(edges) ? edges : []
	const hits = []
	for (const e of list) {
		if (!e) continue
		const edgeId = String(e.id || '').trim()
		if (!edgeId) continue
		const src = String(e.sourceId || '').trim()
		const snk = String(e.sinkId || '').trim()
		// A self-looping edge would match both ends; the sink end is the one an operator means.
		if (snk === cid) hits.push({ edgeId, end: EDGE_END_SINK, anchorId: src, movingId: snk })
		else if (src === cid) hits.push({ edgeId, end: EDGE_END_SOURCE, anchorId: snk, movingId: src })
	}
	return hits
}

/**
 * Pick the one cable end a click on `connectorId` should grab.
 *
 * Deliberately strict: a re-grab only starts when the operator has ALREADY selected the cable
 * they mean. An output legitimately fans out to several sinks, so "click a cabled output dot"
 * must keep meaning "start another cable from here" — silently hijacking that click into a
 * re-grab would re-cable live output on a gesture the operator did not ask for.
 *
 * @param {Array | null | undefined} edges
 * @param {string} connectorId
 * @param {{selectedEdgeId?: string | null}} [opts]
 * @returns {{edgeId: string, end: 'source'|'sink', anchorId: string, movingId: string} | null}
 */
export function pickRegrabCandidate(edges, connectorId, opts = {}) {
	const selected = String(opts?.selectedEdgeId || '').trim()
	if (!selected) return null
	const hits = findEdgeEndpointsAtConnector(edges, connectorId)
	return hits.find((h) => h.edgeId === selected) || null
}

/**
 * Decide what a re-grab drop should do. Never mutates, never persists.
 *
 * @param {object} args
 * @param {{edgeId: string, end: 'source'|'sink', anchorId: string, movingId: string} | null} args.grab
 * @param {string | null | undefined} args.targetId  connector under the drop, or falsy for empty space
 * @param {(a: string, b: string) => ({sourceId: string, sinkId: string} | null)} args.orderEdge
 *        the app's existing role/direction validation (orderEdgeForDeviceView)
 * @param {(sinkId: string) => ({id?: string, sourceId?: string} | null)} [args.findSinkConflict]
 *        existing "this sink already has a cable" check (findGpuSinkCableConflict)
 * @param {(id: string) => string} [args.canonicalize]
 *        UI id → persisted graph id (resolveCableEdgeIds/canonicalCableConnectorId)
 * @returns {{action: 'retarget'|'restore'|'none', reason?: string, removeEdgeId?: string,
 *           sourceId?: string, sinkId?: string, conflictEdgeId?: string}}
 */
export function planCableRegrab({ grab, targetId, orderEdge, findSinkConflict, canonicalize }) {
	if (!grab || !grab.edgeId) return { action: 'none' }

	const idOf = typeof canonicalize === 'function' ? (v) => String(canonicalize(v) || '').trim() : (v) => String(v || '').trim()
	const target = String(targetId || '').trim()

	// Empty space. This app's delete affordance is select-the-cable + Delete (or the edge
	// inspector's remove button) — dropping into space has always meant "cancel cable mode",
	// so it must keep meaning that. WO-278 explicitly forbids inventing a destructive gesture.
	if (!target) return { action: 'restore', reason: 'cancelled' }

	const anchor = idOf(grab.anchorId)
	const moving = idOf(grab.movingId)
	const dropped = idOf(target)

	if (!anchor) return { action: 'restore', reason: 'anchor-missing' }
	// Dropped back on the port it came from: a no-op, not a disconnect.
	if (dropped === moving) return { action: 'restore', reason: 'unchanged' }
	// Dropped on the far end of its own cable: a port cannot patch to itself.
	if (dropped === anchor) return { action: 'restore', reason: 'self' }

	// The app's real validation, run against the NEW target before anything is committed.
	const ordered = typeof orderEdge === 'function' ? orderEdge(anchor, dropped) : null
	if (!ordered) return { action: 'restore', reason: 'invalid-target' }

	const nextSource = idOf(ordered.sourceId)
	const nextSink = idOf(ordered.sinkId)

	// Re-grabbing moves ONE end. The anchor must come back on the side it was already on;
	// if validation only accepts the pair with the anchor flipped, this is a different cable,
	// not a re-target of this one.
	const anchorStaysSource = grab.end === EDGE_END_SINK && nextSource === anchor
	const anchorStaysSink = grab.end === EDGE_END_SOURCE && nextSink === anchor
	if (!anchorStaysSource && !anchorStaysSink) return { action: 'restore', reason: 'direction' }

	// "Sink already cabled" — ignoring the cable we are in the middle of moving, which of
	// course still occupies its own sink.
	if (typeof findSinkConflict === 'function') {
		const conflict = findSinkConflict(nextSink)
		const conflictId = String(conflict?.id || '').trim()
		if (conflict && conflictId !== String(grab.edgeId).trim()) {
			return { action: 'restore', reason: 'sink-occupied', conflictEdgeId: conflictId || null }
		}
	}

	return { action: 'retarget', removeEdgeId: String(grab.edgeId).trim(), sourceId: nextSource, sinkId: nextSink }
}

/**
 * The original edge, to be re-added if the server rejects the new one after the old was
 * removed. A re-target is remove-then-add (moving a source end re-uses the same sink, which
 * the one-cable-per-sink rule would otherwise reject), so the failure path must be able to
 * put the cable back exactly where it was.
 *
 * @param {{edgeId: string, end: 'source'|'sink', anchorId: string, movingId: string} | null} grab
 * @returns {{sourceId: string, sinkId: string} | null}
 */
export function planRegrabRollback(grab) {
	if (!grab || !grab.anchorId || !grab.movingId) return null
	if (grab.end === EDGE_END_SINK) return { sourceId: String(grab.anchorId), sinkId: String(grab.movingId) }
	if (grab.end === EDGE_END_SOURCE) return { sourceId: String(grab.movingId), sinkId: String(grab.anchorId) }
	return null
}

/**
 * Operator-facing message for a restore outcome.
 * @param {{action: string, reason?: string}} plan
 * @returns {string}
 */
export function describeRegrabRestore(plan) {
	switch (plan?.reason) {
		case 'cancelled':
			return 'Cable re-grab cancelled — connection left as it was.'
		case 'unchanged':
			return 'Cable dropped back on the same port — nothing changed.'
		case 'self':
			return 'A cable cannot connect a port to itself — connection restored.'
		case 'sink-occupied':
			return 'That input already has a cable. Remove it first — connection restored.'
		case 'direction':
			return 'That target would reverse the cable direction — connection restored.'
		case 'invalid-target':
			return 'These connectors cannot be cabled together (wrong roles or direction) — connection restored.'
		default:
			return 'Connection restored.'
	}
}
