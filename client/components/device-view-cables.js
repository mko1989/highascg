/**
 * SVG Cable Overlay logic for Device View.
 */
import { collectDecklinkKeyFillVirtualEdges } from '../lib/device-view-decklink-keyfill.js'

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

export function connectorCenter(surfaceEl, connId) {
	if (!connId || !surfaceEl) return null
	const matches = [
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

const CABLE_COLORS = [
	'#2f3e46', // Charcoal / dark slate
	'#4a5759', // Matte gray-blue
	'#b07d62', // Rust orange
	'#8b5e66', // Matte terracotta / dusty red
	'#586f7c', // Slate blue
	'#cca43d', // Dull mustard gold
	'#556b2f', // Olive green
	'#6c567b', // Muted lavender/plum
	'#4a7c59', // Sage green
	'#385a64', // Deep teal/navy
	'#dcd6cd', // Muted cream/beige
	'#7d4060', // Dusty magenta/plum
]
function getCableColor(id) {
	if (!id) return '#94a3b8'
	const s = String(id)
	let h = 0
	for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
	return CABLE_COLORS[Math.abs(h) % CABLE_COLORS.length]
}

function srand(n, seed) {
	const v = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453
	return v - Math.floor(v)
}

function buildCable(x1, y1, x2, y2, loops, seed) {
	const bootDrop = 16 // 16px straight down plug boot
	
	// Middle start/end points for the hanging run
	const mx1 = x1
	const my1 = y1 + bootDrop
	const mx2 = x2
	const my2 = y2 + bootDrop
	
	const straightDist = Math.hypot(mx2 - mx1, my2 - my1) || 1
	const loopCount = Math.max(0, parseInt(loops, 10) || 0)
	
	// Deterministic slack and loop settings based on loopCount (messiness) and seed
	let slackFactor = 1.0 // Slack factor disabled (cables are tight/straight)
	let actualLoops = 0
	
	if (loopCount === 1) {
		if (straightDist >= 90) {
			actualLoops = 1
		}
	} else if (loopCount === 2) {
		if (straightDist >= 120) {
			actualLoops = 2
		} else if (straightDist >= 70) {
			actualLoops = 1
		}
	}
	
	// Resolution: higher resolution for longer/looped cables to ensure smoothness.
	const N_BASE = Math.max(28, Math.floor(straightDist / 10))
	const STEPS_PER_LOOP = 36 // Slightly higher steps for perfect roundness
	
	// 1. Generate waypoints for the hanging "middle" run.
	const wp = []
	wp.push({ x: mx1, y: my1 })
	
	const loopTs = []
	for (let li = 0; li < actualLoops; li++) {
		// Pick deterministic positions along the cable run (e.g. around 35% and 65%)
		const posBase = actualLoops === 1 ? 0.5 : (li === 0 ? 0.35 : 0.65)
		loopTs.push(posBase - 0.1 + srand(li + 11, seed) * 0.2)
	}
	loopTs.sort((a, b) => a - b)
	
	const cDx = (mx2 - mx1) / straightDist
	const cDy = (my2 - my1) / straightDist
	
	let prevT = 0
	for (let li = 0; li < loopTs.length; li++) {
		const t = loopTs[li]
		// Add segments before the loop.
		const segs = Math.max(1, Math.floor((t - prevT) * N_BASE))
		for (let i = 1; i <= segs; i++) {
			const st = prevT + (t - prevT) * (i / segs)
			wp.push({ x: mx1 + (mx2 - mx1) * st, y: my1 + (my2 - my1) * st })
		}
		
		// Generate an organic spiral/loop coil.
		const loopR = 20 + srand(li + 42, seed) * 12 // radius 20-32px
		const loopSide = srand(li + 101, seed) > 0.5 ? 1 : -1
		
		// Perfect mathematically continuous center offset perpendicular to the run
		const cx = mx1 + (mx2 - mx1) * t + (-cDy * loopSide * loopR)
		const cy = my1 + (my2 - my1) * t + (cDx * loopSide * loopR)
		
		// Start angle connecting back to the run
		const startAngle = Math.atan2(my1 + (my2 - my1) * t - cy, mx1 + (mx2 - mx1) * t - cx)
		for (let i = 1; i <= STEPS_PER_LOOP; i++) {
			const angle = startAngle + loopSide * (i / STEPS_PER_LOOP) * Math.PI * 2
			wp.push({
				x: cx + Math.cos(angle) * loopR,
				y: cy + Math.sin(angle) * loopR,
				isLoop: true
			})
		}
		prevT = t
	}
	
	// Add final segments to reach the destination.
	const finalSegs = Math.max(1, Math.floor((1 - prevT) * N_BASE))
	for (let i = 1; i <= finalSegs; i++) {
		const st = prevT + (1 - prevT) * (i / finalSegs)
		wp.push({ x: mx1 + (mx2 - mx1) * st, y: my1 + (my2 - my1) * st })
	}
	
	// Now prefix with starting port and suffix with ending port to form rigid plug boots
	wp.unshift({ x: x1, y: y1 })
	wp.push({ x: x2, y: y2 })
	
	const N = wp.length - 1
	const pts = wp.map((p) => ({ x: p.x, y: p.y, isLoop: !!p.isLoop }))
	
	// Precalculate the exact initial lengths for distance and bending constraints!
	// Enforcing these exact lengths (instead of a single average) guarantees loops don't distort.
	const targetLen = []
	for (let i = 0; i < N; i++) {
		targetLen[i] = Math.hypot(wp[i+1].x - wp[i].x, wp[i+1].y - wp[i].y) * (i === 0 || i === N - 1 ? 1.0 : slackFactor)
	}
	
	const bendLen2 = []
	for (let i = 0; i < N - 1; i++) {
		bendLen2[i] = Math.hypot(wp[i+2].x - wp[i].x, wp[i+2].y - wp[i].y) * (i === 0 || i === N - 2 ? 1.0 : slackFactor)
	}
	
	const bendLen3 = []
	for (let i = 0; i < N - 2; i++) {
		bendLen3[i] = Math.hypot(wp[i+3].x - wp[i].x, wp[i+3].y - wp[i].y) * (i === 0 || i === N - 3 ? 1.0 : slackFactor)
	}
	
	// 2. Physics Simulation (Verlet Integration) with Multi-Hop Bending Stiffness
	const gravity = 0.85 // Elegant sag gravity
	const ITERS = 200
	const SUBSTEPS = 6
	
	for (let iter = 0; iter < ITERS; iter++) {
		// Apply gravity only to interior hanging points (excluding the rigid boot points)
		for (let i = 1; i < N; i++) {
			if (i > 1 && i < N - 1) {
				pts[i].y += gravity
			}
		}
		
		// Constraint resolution passes.
		for (let s = 0; s < SUBSTEPS; s++) {
			// A. Direct segments (stiffness = 1.0)
			for (let i = 0; i < N; i++) {
				const a = pts[i], b = pts[i + 1]
				const dx = b.x - a.x, dy = b.y - a.y
				const d = Math.hypot(dx, dy) || 0.001
				const target = targetLen[i]
				const diff = (d - target) / d
				const ox = dx * 0.5 * diff
				const oy = dy * 0.5 * diff
				
				if (i > 1) { a.x += ox; a.y += oy }
				if (i + 1 < N - 1) { b.x -= ox; b.y -= oy }
			}
			
			// B. 2-hop bending stiffness constraints (High stiffness on loops, very soft on straight sections to allow beautiful catenary sag)
			for (let i = 0; i < N - 1; i++) {
				const a = pts[i], b = pts[i + 2]
				const dx = b.x - a.x, dy = b.y - a.y
				const d = Math.hypot(dx, dy) || 0.001
				const target = bendLen2[i]
				const diff = (d - target) / d
				
				const isLoopConstraint = a.isLoop || b.isLoop || pts[i+1].isLoop
				const stiffness = isLoopConstraint ? 0.6 : 0.06
				
				const ox = dx * 0.5 * diff * stiffness
				const oy = dy * 0.5 * diff * stiffness
				
				if (i > 1) { a.x += ox; a.y += oy }
				if (i + 2 < N - 1) { b.x -= ox; b.y -= oy }
			}
			
			// C. 3-hop bending stiffness constraints (Reinforces large loops, soft on straight sections)
			for (let i = 0; i < N - 2; i++) {
				const a = pts[i], b = pts[i + 3]
				const dx = b.x - a.x, dy = b.y - a.y
				const d = Math.hypot(dx, dy) || 0.001
				const target = bendLen3[i]
				const diff = (d - target) / d
				
				const isLoopConstraint = a.isLoop || b.isLoop || pts[i+1].isLoop || pts[i+2].isLoop
				const stiffness = isLoopConstraint ? 0.3 : 0.02
				
				const ox = dx * 0.5 * diff * stiffness
				const oy = dy * 0.5 * diff * stiffness
				
				if (i > 1) { a.x += ox; a.y += oy }
				if (i + 3 < N - 1) { b.x -= ox; b.y -= oy }
			}
			
			// Pin the ends and their rigid boot drops perfectly.
			pts[0].x = x1; pts[0].y = y1
			pts[1].x = mx1; pts[1].y = my1
			pts[N-1].x = mx2; pts[N-1].y = my2
			pts[N].x = x2; pts[N].y = y2
		}
	}
	
	return pts
}


const cableCache = new Map()
function getOrBuild(id, x1, y1, x2, y2, loops) {
	const key = `${x1.toFixed(1)},${y1.toFixed(1)},${x2.toFixed(1)},${y2.toFixed(1)},${loops}`
	const c = cableCache.get(id)
	if (c?.key === key) return c.pts
	const seed = typeof id === 'string' ? id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : Number(id) || 42
	const pts = buildCable(x1, y1, x2, y2, loops, seed)
	cableCache.set(id, { key, pts })
	return pts
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
		cablePointer,
		messiness,
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

	const edges = lastPayload?.graph?.edges || []
	const keyFillEdges = collectDecklinkKeyFillVirtualEdges(lastPayload)
	const numLoops = parseInt(messiness) || 0

	const drawCable = (e, { decklinkKeyFill = false } = {}) => {
		if (!e || !e.sourceId || !e.sinkId) return
		const a = connectorCenter(surface, e.sourceId)
		const b = connectorCenter(surface, e.sinkId)
		if (!a || !b) return

		const keyFillLink = decklinkKeyFill ? buildDecklinkKeyFillSideLink(a.x, a.y, b.x, b.y, w, h) : null
		const pts = decklinkKeyFill ? keyFillLink.pts : getOrBuild(e.id, a.x, a.y, b.x, b.y, numLoops)
		const d = 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')

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
		const a = connectorCenter(surface, cableSourceId)
		if (a) {
			const b = { x: cablePointer.x, y: cablePointer.y }
			const pts = buildCable(a.x, a.y, b.x, b.y, numLoops, 99)
			const d = 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')
			const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'path')
			ghost.setAttribute('d', d)
			ghost.setAttribute('class', 'device-view__cable-line device-view__cable-line--active')
			ghost.setAttribute('stroke-dasharray', '5 4')
			group.append(ghost)
		}
	}
}
