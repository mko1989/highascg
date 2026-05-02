/**
 * SVG Cable Overlay logic for Device View.
 */

export function connectorCenter(surfaceEl, connId) {
	if (!connId || !surfaceEl) return null
	const matches = [...surfaceEl.querySelectorAll(`[data-connector-id="${connId}"]`)]
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
	'#3b82f6', // blue
	'#ef4444', // red
	'#10b981', // emerald
	'#f59e0b', // amber
	'#8b5cf6', // violet
	'#ec4899', // pink
	'#06b6d4', // cyan
	'#f97316', // orange
	'#14b8a6', // teal
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
	const straightDist = Math.hypot(x2 - x1, y2 - y1) || 1
	const loopCount = Math.max(0, parseInt(loops, 10) || 0)
	
	// Resolution: higher resolution for longer cables to ensure smoothness.
	// Roughly 1 segment per 12 pixels, but at least 24 segments.
	const N_BASE = Math.max(24, Math.floor(straightDist / 12))
	const STEPS_PER_LOOP = 32
	
	// 1. Generate waypoints for the ideal "intended" path.
	const wp = []
	wp.push({ x: x1, y: y1 })
	
	const loopTs = []
	for (let li = 0; li < loopCount; li++) {
		// Pick random spots between 20% and 80% of the run.
		loopTs.push(0.2 + srand(li + 11, seed) * 0.6)
	}
	loopTs.sort((a, b) => a - b)
	
	const cDx = (x2 - x1) / straightDist
	const cDy = (y2 - y1) / straightDist
	
	let prevT = 0
	for (let li = 0; li < loopTs.length; li++) {
		const t = loopTs[li]
		// Add segments before the loop.
		const segs = Math.max(1, Math.floor((t - prevT) * N_BASE))
		for (let i = 1; i <= segs; i++) {
			const st = prevT + (t - prevT) * (i / segs)
			wp.push({ x: x1 + (x2 - x1) * st, y: y1 + (y2 - y1) * st })
		}
		
		// Generate a "roundish" loop at this spot.
		const loopR = 16 + srand(li + 42, seed) * 14 // Varied radius 16-30px
		const loopSide = srand(li + 101, seed) > 0.5 ? 1 : -1
		
		// The loop center is offset perpendicular to the cable run.
		const cx = x1 + (x2 - x1) * t + (-cDy * loopSide * loopR)
		const cy = y1 + (y2 - y1) * t + (cDx * loopSide * loopR)
		
		// Calculate the angle where the loop connects back to the run.
		const startAngle = Math.atan2(y1 + (y2 - y1) * t - cy, x1 + (x2 - x1) * t - cx)
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
		wp.push({ x: x1 + (x2 - x1) * st, y: y1 + (y2 - y1) * st })
	}
	
	const N = wp.length - 1
	const pts = wp.map((p) => ({ x: p.x, y: p.y, isLoop: !!p.isLoop }))
	
	// 2. Physics Simulation (Verlet Integration) for hanging sag.
	// Calculate geometric length of our waypoint path.
	let geoLen = 0
	for (let i = 0; i < N; i++) {
		geoLen += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
	}
	
	// Slack logic: cables should sag but not "rapidly drop".
	// We add 4-10% extra length depending on straight distance.
	const slackFactor = 1.04 + Math.min(0.06, straightDist / 2000)
	const segLen = (geoLen * slackFactor) / N
	
	const gravity = 0.45 // Reduced gravity for smoother, more elegant curves.
	const ITERS = 300
	const SUBSTEPS = 8 // Higher substeps for constraint stability on long cables.
	
	for (let iter = 0; iter < ITERS; iter++) {
		// Apply gravity to all interior points.
		for (let i = 1; i < N; i++) {
			pts[i].y += gravity
		}
		
		// Constraint resolution passes.
		for (let s = 0; s < SUBSTEPS; s++) {
			for (let i = 0; i < N; i++) {
				const a = pts[i], b = pts[i + 1]
				const dx = b.x - a.x, dy = b.y - a.y
				const d = Math.hypot(dx, dy) || 0.001
				const diff = (d - segLen) / d
				const ox = dx * 0.5 * diff
				const oy = dy * 0.5 * diff
				
				if (i > 0) { a.x += ox; a.y += oy }
				if (i < N - 1) { b.x -= ox; b.y -= oy }
			}
			// Pin the ends.
			pts[0].x = x1; pts[0].y = y1
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
	const numLoops = parseInt(messiness) || 0
	
	for (const e of edges) {
		if (!e || !e.sourceId || !e.sinkId) continue
		const a = connectorCenter(surface, e.sourceId)
		const b = connectorCenter(surface, e.sinkId)
		if (!a || !b) continue

		const pts = getOrBuild(e.id, a.x, a.y, b.x, b.y, numLoops)
		const d = 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')

		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
		path.setAttribute('d', d)

		const activeByEdge = (hoveredEdgeId && e.id === hoveredEdgeId) || (selectedEdgeId && e.id === selectedEdgeId)
		const activeByConnector = selectedConnectorId && (e.sourceId === selectedConnectorId || e.sinkId === selectedConnectorId)

		path.setAttribute(
			'class',
			`device-view__cable-line${activeByEdge || activeByConnector ? ' device-view__cable-line--active' : ''}`
		)
		
		const color = getCableColor(e.id)
		path.style.setProperty('--cable-color', color)
		path.style.stroke = color // Always use the cable's own color

		path.setAttribute('data-edge-id', e.id || '')
		path.addEventListener('click', (ev) => {
			ev.preventDefault()
			ev.stopPropagation()
			selectEdgeById(e.id)
		})
		group.append(path)
	}
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
