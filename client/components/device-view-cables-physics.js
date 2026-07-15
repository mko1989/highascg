/**
 * Cable physics simulation + color helpers for the Device View cable overlay.
 * Extracted from device-view-cables.js (WO-221 Phase A mechanical split).
 */

const CABLE_COLORS = [
	'#FF3333', '#FF6633', '#FF9933', '#FFCC33', '#FFFF33',
	'#CCFF33', '#99FF33', '#66FF33', '#33FF33', '#33FF66',
	'#33FF99', '#33FFCC', '#33FFFF', '#33CCFF', '#3399FF',
	'#3366FF', '#3333FF', '#6633FF', '#9933FF', '#CC33FF',
	'#FF33FF', '#FF33CC', '#FF3399', '#FF3366', '#FF0055',
	'#D2691E', '#FF1493', '#00CED1', '#32CD32', '#9400D3',
	'#1E90FF', '#FF8C00'
]
export function getCableColor(id) {
	if (!id) return '#94a3b8'
	const s = String(id)
	let h = 0
	for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
	// We do a small prime multiplier so adjacent hashes map to widely different colors
	return CABLE_COLORS[(Math.abs(h) * 7) % CABLE_COLORS.length]
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
export function getOrBuild(id, x1, y1, x2, y2, loops) {
	const key = `${x1.toFixed(1)},${y1.toFixed(1)},${x2.toFixed(1)},${y2.toFixed(1)},${loops}`
	const c = cableCache.get(id)
	if (c?.key === key) return c.pts
	const seed = typeof id === 'string' ? id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : Number(id) || 42
	const pts = buildCable(x1, y1, x2, y2, loops, seed)
	cableCache.set(id, { key, pts })
	return pts
}
