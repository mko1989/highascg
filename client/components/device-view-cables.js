/**
 * SVG Cable Overlay logic for Device View.
 */
import { collectDecklinkKeyFillVirtualEdges } from '../lib/device-view-decklink-keyfill.js'
import { getCableColor, getOrBuild } from './device-view-cables-physics.js'
import {
	anchorKeyFor,
	edgeHalfOf,
	edgeSourceAnchorKey,
	isDestinationConnectorId,
} from '../lib/device-view-output-layer.js'

const DECKLINK_KEY_LINK_COLOR = '#58a6ff'
const DECKLINK_KEY_LINK_GAP = 26

/** Side rail between fill and key ports (not a hanging cable). */
function buildDecklinkKeyFillSideLink(x1, y1, x2, y2, surfaceW = 0, surfaceH = 0) {
	const dy = Math.abs(y2 - y1)
	const dx = Math.abs(x2 - x1)
	if (dy >= dx) {
		const midX = (x1 + x2) / 2
		const railOnLeft = surfaceW > 0 ? midX < surfaceW * 0.5 : true
		const railX = railOnLeft ? Math.min(x1, x2) - DECKLINK_KEY_LINK_GAP : Math.max(x1, x2) + DECKLINK_KEY_LINK_GAP
		return {
			pts: [
				{ x: x1, y: y1 },
				{ x: railX, y: y1 },
				{ x: railX, y: y2 },
				{ x: x2, y: y2 },
			],
			railOnLeft,
		}
	}
	const midY = (y1 + y2) / 2
	const railAbove = surfaceH > 0 ? midY < surfaceH * 0.5 : true
	const railY = railAbove ? Math.min(y1, y2) - DECKLINK_KEY_LINK_GAP : Math.max(y1, y2) + DECKLINK_KEY_LINK_GAP
	return {
		pts: [
			{ x: x1, y: y1 },
			{ x: x1, y: railY },
			{ x: x2, y: railY },
			{ x: x2, y: y2 },
		],
		railOnLeft: railAbove,
	}
}

const DECKLINK_KEY_LABEL_OFFSET = 12

function decklinkKeyFillLabelPlacement(link) {
	const pts = link?.pts
	if (!pts || pts.length < 4) return null
	const verticalRail = Math.abs(pts[1].x - pts[2].x) < 0.5
	if (verticalRail) {
		const railX = pts[1].x
		const cy = (pts[1].y + pts[2].y) / 2
		return { x: railX + DECKLINK_KEY_LABEL_OFFSET, y: cy, anchor: 'start' }
	}
	const railY = pts[1].y
	const cx = (pts[1].x + pts[2].x) / 2
	return { x: cx + DECKLINK_KEY_LABEL_OFFSET, y: railY, anchor: 'start' }
}

function appendDecklinkKeyFillLabel(group, link) {
	const place = decklinkKeyFillLabelPlacement(link)
	if (!place) return

	const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
	g.setAttribute('class', 'device-view__decklink-kf-link-label')

	const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
	text.setAttribute('x', String(place.x))
	text.setAttribute('y', String(place.y))
	text.setAttribute('text-anchor', place.anchor)
	text.setAttribute('dominant-baseline', 'middle')
	text.textContent = 'Key'

	g.append(text)
	group.append(g)
}

/**
 * @param {Element} surfaceEl
 * @param {string} connId
 * @param {'pgm'|'prv'|null} [half] WO-365: a pgm_prv destination's two dots share one connector
 *        id, so the half-qualified `data-connector-anchor` is tried FIRST. Everything else (and
 *        any destination rendered without pair dots) falls through to the plain id lookup.
 */
export function connectorCenter(surfaceEl, connId, half) {
	if (!connId || !surfaceEl) return null
	const anchorKey = half ? anchorKeyFor(connId, half) : ''
	const anchored = anchorKey ? [...surfaceEl.querySelectorAll(`[data-connector-anchor="${anchorKey}"]`)] : []
	const matches = anchored.length ? anchored : [
		...surfaceEl.querySelectorAll(`[data-connector-id="${connId}"]`),
		...surfaceEl.querySelectorAll(`[data-real-ids*="${connId}"]`)
	]
	if (!matches.length) return null
	// Prefer connector dots over container nodes so cable anchors are visually accurate.
	const dot = matches.find((el) =>
		el.classList?.contains('device-view__connector-dot') ||
		el.classList?.contains('device-view__destination-port') ||
		el.classList?.contains('device-view__panel-marker')
	)
	const el = dot || matches[0]
	const br = surfaceEl.getBoundingClientRect()
	const r = el.getBoundingClientRect()
	return {
		x: r.left - br.left + r.width / 2,
		y: r.top - br.top + r.height / 2,
	}
}

/**
 * T202.4: Build a Map of anchor-key → center position for all connectors in a render pass.
 * This avoids repeated querySelectorAll calls per edge and improves overlay render performance.
 *
 * WO-365: the key is the ANCHOR key, not the bare connector id — a destination source is keyed
 * `dst_in_x#pgm` / `dst_in_x#prv` so the two halves of a pair get their own positions. Sinks and
 * every non-destination connector keep their plain id.
 *
 * @param {Element} surface
 * @param {Array} edges
 * @param {Array} keyFillEdges
 * @param {string} cableSourceId
 * @param {'pgm'|'prv'|null} [cableSourceHalf]
 * @returns {Map<string, {x: number, y: number}>}
 */
function buildConnectorPositionMap(_surface, edges, keyFillEdges, cableSourceId, cableSourceHalf) {
	const map = new Map()

	if (!_surface) return map

	// Collect every anchor the pass needs: edge ends + ghost cable (if any)
	/** @type {Map<string, {id: string, half: 'pgm'|'prv'|null}>} */
	const wanted = new Map()
	const want = (id, half) => {
		if (!id) return
		wanted.set(anchorKeyFor(id, half), { id, half: half || null })
	}
	for (const list of [edges, keyFillEdges]) {
		for (const e of list) {
			if (e?.sourceId) want(e.sourceId, isDestinationConnectorId(e.sourceId) ? edgeHalfOf(e) : null)
			if (e?.sinkId) want(e.sinkId, null)
		}
	}
	if (cableSourceId) {
		want(cableSourceId, isDestinationConnectorId(cableSourceId) ? (cableSourceHalf || 'pgm') : null)
	}

	// Query all connectors at once per anchor and cache the result
	for (const [key, { id, half }] of wanted) {
		const pos = connectorCenter(_surface, id, half)
		if (pos) map.set(key, pos)
	}

	return map
}

/**
 * Context mapper for Simple View cables.
 * Counts cables per port to calculate radial fanning angles.
 */
function buildSmoothSimpleMap(edges, _surface) {
	const portEdges = new Map()
	
	for (const e of edges) {
		if (e.sourceId) {
			if (!portEdges.has(e.sourceId)) portEdges.set(e.sourceId, [])
			portEdges.get(e.sourceId).push(e.id)
		}
		if (e.sinkId) {
			if (!portEdges.has(e.sinkId)) portEdges.set(e.sinkId, [])
			portEdges.get(e.sinkId).push(e.id)
		}
	}
	
	// Sort edge ids to guarantee deterministic spread order
	portEdges.forEach(arr => arr.sort())
	
	return { portEdges }
}

/**
 * Renders a smooth Cubic Bezier S-Curve with radial "star-shaped" fanning.
 */
function buildSmoothSimpleCable(e, a, b, mapCtx) {
	const srcCluster = mapCtx.portEdges.get(e.sourceId) || [e.id]
	const sinkCluster = mapCtx.portEdges.get(e.sinkId) || [e.id]
	
	const srcIdx = srcCluster.indexOf(e.id)
	const sinkIdx = sinkCluster.indexOf(e.id)
	
	const x1 = a.x, y1 = a.y
	const x2 = b.x, y2 = b.y
	
	// Tension is based on horizontal distance. 
	const tension = Math.max(80, Math.abs(x2 - x1) * 0.5)
	
	// Fan out radially in a half-star shape. Max spread angle ~60 degrees.
	const spreadStep = Math.PI / 10 // 18 degrees per step
	const srcAngle = srcCluster.length > 1 ? (srcIdx - (srcCluster.length - 1) / 2) * spreadStep : 0
	const sinkAngle = sinkCluster.length > 1 ? (sinkIdx - (sinkCluster.length - 1) / 2) * spreadStep : 0
	
	// Control points angled from the exit/entry
	const cp1x = x1 + tension * Math.cos(srcAngle)
	const cp1y = y1 + tension * Math.sin(srcAngle)
	
	const cp2x = x2 - tension * Math.cos(sinkAngle)
	const cp2y = y2 + tension * Math.sin(sinkAngle)
	
	return {
		d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`
	}
}

export function renderCableOverlay(ctx) {
	const {
		cableOverlay,
		bands,
		surfaceEl,
		lastPayload,
		hoveredEdgeId,
		selectedEdgeId,
		selectedConnectorId,
		selectEdgeById,
		cableSourceId,
		cableSourceHalf,
		cablePointer,
		messiness,
		simpleWiring,
		regrabEdgeId,
	} = ctx

	const group = cableOverlay.querySelector('[data-cable-lines]')
	if (!group) return
	group.innerHTML = ''
	const surface = surfaceEl || bands
	const br = surface.getBoundingClientRect()
	const w = Math.max(1, Math.round(br.width))
	const h = Math.max(1, Math.round(br.height))

	cableOverlay.style.left = '0px'
	cableOverlay.style.top = '0px'
	cableOverlay.style.width = `${w}px`
	cableOverlay.style.height = `${h}px`
	cableOverlay.setAttribute('viewBox', `0 0 ${w} ${h}`)
	cableOverlay.setAttribute('width', String(w))
	cableOverlay.setAttribute('height', String(h))

	const allEdges = lastPayload?.graph?.edges || []
	// WO-278: while one end of a cable is held, that cable is drawn as the ghost (anchor →
	// pointer) instead of as itself. It is only hidden from the overlay — the edge is still in
	// the graph, so cancelling the gesture restores it with no server round trip.
	const heldEdgeId = String(regrabEdgeId || '').trim()
	const edges = heldEdgeId ? allEdges.filter((e) => String(e?.id || '') !== heldEdgeId) : allEdges
	const keyFillEdges = collectDecklinkKeyFillVirtualEdges(lastPayload)
	const numLoops = parseInt(messiness) || 0

	const simpleWiringMap = simpleWiring ? buildSmoothSimpleMap(edges, surface) : null

	// T202.4: Build connector position map once per render pass
	const connectorPositionMap = buildConnectorPositionMap(surface, edges, keyFillEdges, cableSourceId, cableSourceHalf)

	const drawCable = (e, { decklinkKeyFill = false } = {}) => {
		if (!e || !e.sourceId || !e.sinkId) return
		// WO-365: a PRV edge leaves the PRV dot, a PGM edge the PGM dot — same connector id.
		const a = connectorPositionMap.get(edgeSourceAnchorKey(e))
		const b = connectorPositionMap.get(e.sinkId)
		if (!a || !b) return

		const keyFillLink = decklinkKeyFill ? buildDecklinkKeyFillSideLink(a.x, a.y, b.x, b.y, w, h) : null
		const routeData = decklinkKeyFill
			? { pts: keyFillLink.pts }
			: simpleWiring
				? buildSmoothSimpleCable(e, a, b, simpleWiringMap)
				: { pts: getOrBuild(e.id, a.x, a.y, b.x, b.y, numLoops) }
				
		const d = routeData.d || ('M ' + routeData.pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L '))

		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
		path.setAttribute('d', d)

		const activeByEdge = (hoveredEdgeId && e.id === hoveredEdgeId) || (selectedEdgeId && e.id === selectedEdgeId)
		const activeByConnector = selectedConnectorId && (e.sourceId === selectedConnectorId || e.sinkId === selectedConnectorId)
		const active = activeByEdge || activeByConnector

		path.setAttribute(
			'class',
			`device-view__cable-line${decklinkKeyFill ? ' device-view__decklink-kf-link' : ''}${active ? ' device-view__cable-line--active' : ''}`
		)

		const color = decklinkKeyFill ? DECKLINK_KEY_LINK_COLOR : getCableColor(e.id)
		path.style.setProperty('--cable-color', color)
		path.style.stroke = color

		path.setAttribute('data-edge-id', e.id || '')
		if (!decklinkKeyFill) {
			path.addEventListener('click', (ev) => {
				ev.preventDefault()
				ev.stopPropagation()
				selectEdgeById(e.id)
			})
		}
		group.append(path)

		if (decklinkKeyFill && keyFillLink) appendDecklinkKeyFillLabel(group, keyFillLink)
	}

	for (const e of edges) drawCable(e)
	for (const e of keyFillEdges) drawCable(e, { decklinkKeyFill: true })
	if (cableSourceId && cablePointer && Number.isFinite(cablePointer.x) && Number.isFinite(cablePointer.y)) {
		// WO-365: the ghost leaves the half the gesture was armed on (or the grabbed edge's half).
		const a = connectorPositionMap.get(
			isDestinationConnectorId(cableSourceId) ? anchorKeyFor(cableSourceId, cableSourceHalf || 'pgm') : cableSourceId,
		)
		if (a) {
			const b = { x: cablePointer.x, y: cablePointer.y }
			// Ghost cable while dragging: lightweight path only (no physics sim per pointermove).
			const ghostEdge = { id: 'ghost', sourceId: cableSourceId, sinkId: 'ghost-sink' }
			const routeData = simpleWiring
				? buildSmoothSimpleCable(ghostEdge, a, b, simpleWiringMap)
				: { d: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}` }
			const d = routeData.d || ('M ' + routeData.pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L '))
			const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'path')
			ghost.setAttribute('d', d)
			ghost.setAttribute('class', 'device-view__cable-line device-view__cable-line--active device-view__cable-line--ghost')
			ghost.setAttribute('stroke-dasharray', '5 4')
			group.append(ghost)
		}
	}
}
