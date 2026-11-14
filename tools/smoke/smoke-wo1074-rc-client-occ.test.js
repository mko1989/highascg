'use strict'

/**
 * WO-1074 §3 toy scale — RC client: the occupancy grids of the scene (game/rc/occ.js: "Obstacles at toy height") and
 * tracks of up to 2500 points (game/rc/seg-grid.js). Contract work/notes/rc-game-contract.md §3:
 *  - `occ` RLE (free, blocked, free …; a leading 0 when the first cell is blocked) decodes once; malformed grids drop;
 *  - a car within [floor.y − 0.02·s, floor.y + CAR_H·s] collides with blocked cells like a wall (the client adds the
 *    car radius): bounces off a table-leg cell, passes between two legs wider than the car, never tunnels through a
 *    one-cell leg in a long step; a car on a deck above the band ignores the grid;
 *  - the chase eye is pulled in before a leg behind the car; no deck pillar stands on a blocked cell;
 *  - 2500 points: nearest-ribbon search, physics, lap tracking and the minimap read a few cells, not the whole track
 *    (counted segment reads), and building / previews stay fast.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/rc-client-fixtures.js')

let P, PW, TM, OCC, CAM, ST, DRAW, MESH

function stubCanvasDocument() {
	const calls = { lineTo: 0, arc: 0, drawImage: 0, all: 0 }
	const ctx = new Proxy(
		{},
		{
			get: (t, k) => {
				if (k in t) return t[k]
				if (k === 'measureText') return () => ({ width: 60 })
				if (k === 'createRadialGradient') return () => ({ addColorStop() {} })
				return () => {
					calls.all++
					if (k in calls) calls[k]++
				}
			},
			set: (t, k, v) => {
				t[k] = v
				return true
			},
		}
	)
	const canvas = () => ({ width: 200, height: 130, getContext: () => ctx, ownerDocument: doc })
	const doc = { createElement: canvas }
	return { doc, canvas, calls }
}
const STUB = stubCanvasDocument()

before(async () => {
	if (!globalThis.document) globalThis.document = STUB.doc
	P = await F.load('physics.js')
	PW = await F.load('physics-world.js')
	TM = await F.load('track-math.js')
	OCC = await F.load('occ.js')
	CAM = await F.load('cameras.js')
	ST = await F.load('standings.js')
	DRAW = await F.load('trackdraw.js')
	MESH = await F.load('track-mesh.js')
})

const K = 0.1
/* a 3 × 6 m patch of the hall in 3 cm cells; i ↔ x = −1.5 + 0.03·i, j ↔ z = −6 + 0.03·j */
const GRID = { floor: 'hall', y: 0, x0: -1.5, z0: -6, cell: 0.03, w: 100, h: 200 }
const cellsOf = (i0, i1, j0, j1) => {
	const out = []
	for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push([i, j])
	return out
}
/** Toy straight strip heading −Z from z = 0 (width 0.4 m), the life-size hall, the given blocked cells. */
function legWorld(blocked, floors = F.BIG_FLOORS) {
	const T = TM.prepareTrack(F.scaleTrack(F.straightTrack(80, 4), K), K)
	const occ = [F.occGrid({ ...GRID, blocked })]
	return { T, env: P.createEnv(T, floors, [], { occ }) }
}
/**
 * Full throttle straight ahead from (x, y, −0.3) for `sec` → the min clearance to blocked cells over the whole run (incl.
 * after an auto-unstick nudge), the min z reached before any unstick, a bounce (+Z speed), the unstick count.
 */
function runAt(env, x, sec, y = 0) {
	const car = P.createCar({ x, y, z: -0.3, yaw: 0 })
	let minD = Infinity
	let minZ = Infinity
	let back = false
	let unsticks = 0
	for (let i = 0; i < 60 * sec; i++) {
		P.stepCar(car, { throttle: 1, brake: 0, steer: 0 }, env)
		unsticks += car.ev.filter((e) => e.k === 'unstick').length
		car.ev.length = 0
		const h = OCC.occNearest(env.ground.occ, car.x, car.z, car.y, 1, env.ground.eps, env.P.CAR_H)
		if (h) minD = Math.min(minD, h.d)
		if (!unsticks) minZ = Math.min(minZ, car.z)
		if (car.vz > 0.05) back = true
		assert.ok([car.x, car.y, car.z].every(Number.isFinite))
	}
	return { car, minD, minZ, back, unsticks }
}

describe('WO-1074 §3 occupancy grid: decode', () => {
	it('RLE → bits: free first, a leading 0 for a blocked first cell, runs past the end cut, short list = free', () => {
		assert.deepEqual([...OCC.decodeRle([2, 3, 1], 8)], [0, 0, 1, 1, 1, 0, 0, 0])
		assert.deepEqual([...OCC.decodeRle([0, 2, 1, 1], 5)], [1, 1, 0, 1, 0])
		assert.deepEqual([...OCC.decodeRle([1, 99], 4)], [0, 1, 1, 1])
		assert.deepEqual([...OCC.decodeRle('junk', 3)], [0, 0, 0])
		const g = F.occGrid({ ...GRID, w: 4, h: 3, blocked: [[0, 0], [3, 2], [1, 1]] })
		assert.equal(g.rle[0], 0, 'first cell blocked → leading 0')
		const [o] = OCC.prepareOcc([g])
		assert.equal(o.count, 3)
		assert.ok(OCC.cellBlocked(o, 0, 0) && OCC.cellBlocked(o, 3, 2) && OCC.cellBlocked(o, 1, 1))
		assert.ok(!OCC.cellBlocked(o, 1, 0) && !OCC.cellBlocked(o, -1, 0) && !OCC.cellBlocked(o, 4, 2), 'outside = free')
	})

	it('malformed grids drop; decoded grids pass through (decoded once, shared by every env)', () => {
		const ok = F.occGrid({ ...GRID, w: 2, h: 2, blocked: [[1, 1]] })
		const bad = [{ ...ok, w: 0 }, { ...ok, cell: 0 }, { ...ok, x0: 'a' }, { ...ok, w: 5000, h: 5000 }, null, 7]
		assert.equal(OCC.prepareOcc([...bad, ok]).length, 1)
		assert.deepEqual(OCC.prepareOcc(null), [])
		const dec = OCC.prepareOcc([ok])
		const T = TM.prepareTrack(F.scaleTrack(F.straightTrack(10, 4), K), K)
		const a = P.createEnv(T, F.BIG_FLOORS, [], { occ: dec })
		const b = P.createEnv(T, F.BIG_FLOORS, [], { occ: dec })
		assert.equal(a.ground.occ[0], dec[0])
		assert.equal(b.ground.occ[0].bits, dec[0].bits)
		assert.equal(P.createEnv(T, F.BIG_FLOORS, []).ground.occ.length, 0, 'no grid → none')
	})
})

describe('WO-1074 §3 occupancy grid: collision at toy scale', () => {
	/* the leg: 2 × 2 cells (6 cm square) on the strip at x −0.03 … 0.03, z −1.92 … −1.86 */
	const LEG = cellsOf(49, 50, 136, 137)

	it('bounces off a table-leg cell like a wall and never overlaps it (disc of RADIUS · s)', () => {
		const { env } = legWorld(LEG)
		const r = runAt(env, 0, 6)
		assert.ok(r.minD >= env.P.RADIUS * 0.999, `never inside the car radius (min ${r.minD.toFixed(4)} m)`)
		assert.ok(r.minZ > -1.86, `stopped in front of the leg (min z ${r.minZ.toFixed(3)})`)
		assert.ok(r.back, 'bounced back (restitution, like a wall)')
		assert.ok(r.unsticks >= 1, 'held against the leg, the auto-unstick nudges it on — never into the leg (min clearance)')
		const free = runAt(legWorld([]).env, 0, 4)
		assert.ok(free.minZ < -3, 'without the leg the same run goes on')
	})

	it('passes between two legs wider apart than the car; a gap narrower than the car blocks', () => {
		/* legs at x −0.12 … −0.06 and 0.06 … 0.12: a 12 cm gap for a 6 cm car */
		const wide = legWorld([...cellsOf(46, 47, 136, 137), ...cellsOf(52, 53, 136, 137)])
		const w = runAt(wide.env, 0, 4)
		assert.ok(w.minZ < -3, `through the gap (min z ${w.minZ.toFixed(3)})`)
		assert.ok(w.minD >= wide.env.P.RADIUS * 0.999)
		/* one free cell (3 cm, x 0 … 0.03) between the legs, the car centred on it */
		const narrow = legWorld([...cellsOf(47, 49, 136, 137), ...cellsOf(51, 53, 136, 137)])
		const n = runAt(narrow.env, 0.015, 4)
		assert.ok(n.minZ > -1.86, `blocked by the narrow gap (min z ${n.minZ.toFixed(3)})`)
		assert.ok(n.minD >= narrow.env.P.RADIUS * 0.999)
	})

	it('a long step never tunnels through a one-cell leg', () => {
		const { env } = legWorld(cellsOf(50, 50, 136, 136))
		const car = P.createCar({ x: 0.015, y: 0, z: -1.6, yaw: 0 })
		car.vz = -2
		PW.moveHorizontal(env, car, 0.015, -2.4)
		assert.ok(car.z > -1.89 + 0.029, `stopped before the leg (z ${car.z.toFixed(3)})`)
		assert.ok(car.vz > 0, 'and bounced')
	})

	it('ignores the grid on a deck above the band; collides again just inside the band', () => {
		const deckFloors = [...F.BIG_FLOORS, { id: 'deck', y: 0.2, rect: [-1, -5, 1, 0] }]
		const { env } = legWorld(LEG, deckFloors)
		const up = runAt(env, 0, 4, 0.2)
		assert.ok(up.car.y > 0.19 && up.minZ < -2.3, `on the deck the car drives over the leg cells (min z ${up.minZ.toFixed(3)})`)
		const eps = env.ground.eps
		const carH = env.P.CAR_H
		assert.ok(OCC.occNearest(env.ground.occ, 0, -1.9, carH * 0.99, 0.05, eps, carH), 'inside the band: collides')
		assert.equal(OCC.occNearest(env.ground.occ, 0, -1.9, carH * 1.01, 0.05, eps, carH), null, 'above it: free')
		assert.equal(OCC.occNearest(env.ground.occ, 0, -1.9, -eps * 1.01, 0.05, eps, carH), null, 'below it: free')
	})

	it('the chase eye is pulled in before a leg behind the car (never inside a blocked cell)', () => {
		const { env } = legWorld(LEG)
		const blocked = (x, z, y) => P.eyeBlockedOf(env, x, z, y)
		const car = { x: 0, y: 0, z: -1.7, yaw: Math.PI } // facing +Z: the leg (z −1.92 … −1.86) 16 cm behind
		const free = CAM.chaseTarget(car, 0, null, K)
		assert.equal(blocked(free.eye[0], free.eye[2], 0), true, `unpulled the eye stands in the leg (${free.eye[2].toFixed(3)})`)
		const pulled = CAM.chaseTarget(car, 0, null, K, blocked)
		assert.equal(blocked(pulled.eye[0], pulled.eye[2], 0), false)
		assert.ok(pulled.eye[2] > -1.86 && pulled.eye[2] < car.z, `pulled in between car and leg (${pulled.eye[2].toFixed(3)})`)
		const open = CAM.chaseTarget({ ...car, z: -3.5 }, 0, null, K, blocked)
		assert.deepEqual(open, CAM.chaseTarget({ ...car, z: -3.5 }, 0, null, K), 'nothing behind: untouched')
	})

	it('the director trackside camera never stands in a blocked cell (other side, closer in, else the chase cam)', () => {
		const T = { scale: K, half: 0.2 }
		const car = { x: 0, y: 0, z: 0, yaw: 0, v: 0 }
		const d = new CAM.Director(3)
		const free = d._sideOf(T, car)
		d.blockedAt = (x) => x < 0 // yaw 0 faces −Z: the car's right is −X — all a wall
		const left = d._sideOf(T, car)
		assert.ok(free[0] < 0 && left[0] > 0, `first choice right (${free[0].toFixed(3)}), blocked → left (${left[0].toFixed(3)})`)
		assert.deepEqual(left, [-free[0], free[1], free[2]], 'the mirror pose')
		d.blockedAt = (x) => Math.abs(x) > T.half + 1 * K
		const close = d._sideOf(T, car)
		assert.ok(Math.abs(close[0]) < Math.abs(free[0]) && !d.blockedAt(close[0], close[2]), 'both far poses blocked → closer in')
		d.blockedAt = () => true
		assert.equal(d._sideOf(T, car), null, 'all blocked → no side pose')
		d.shot = 'trackside'
		d.carId = 'a'
		d.side = null
		d.until = 1e9
		const pose = d.update(0, 1 / 60, T, ['a'], () => car)
		assert.ok(pose.eye.every(Number.isFinite), 'a trackside shot without a side pose falls back to the chase camera')
	})

	it('no deck pillar stands on a blocked cell (a hall grid blocked everywhere drops every hall pillar)', () => {
		const D = F.deckTracks()
		const T = TM.prepareTrack(F.scaleTrack(D.over, K), K)
		const floors = F.scaleFloors(D.floors, K)
		const obs = F.scaleObstacles(D.obstacles, K)
		const hall = floors.find((f) => f.id === 'hall')
		const [x0, z0, x1, z1] = hall.rect
		const w = Math.ceil((x1 - x0) / 0.03)
		const h = Math.ceil((z1 - z0) / 0.03)
		const all = { floor: 'hall', y: hall.y, x0, z0, cell: 0.03, w, h, rle: [0, w * h] }
		/* pillar faces: thin (≤ 0.025 m in plan), ≥ 3 cm tall, standing on the hall floor */
		const pillarTops = (env) => {
			const g = MESH.buildTrackMesh(T, env.ground)
			let n = 0
			g.updateMatrixWorld(true)
			g.traverse((o) => {
				const p = o.geometry?.attributes?.position
				if (!p || o.parent?.name === 'track-deco') return
				for (let i = 0; i < p.count; i += 3) {
					const v = [0, 1, 2].map((q) => [p.getX(i + q), p.getY(i + q), p.getZ(i + q)])
					const ext = (a) => Math.max(...v.map((q) => q[a])) - Math.min(...v.map((q) => q[a]))
					const y0 = Math.min(...v.map((q) => q[1]))
					if (ext(0) <= 0.025 && ext(2) <= 0.025 && ext(1) >= 0.03 && Math.abs(y0 - hall.y) < 1e-9) n++
				}
			})
			MESH.disposeGroup(g)
			return n
		}
		const plain = pillarTops(P.createEnv(T, floors, obs))
		assert.ok(plain > 0, `pillars reach the hall floor without a grid (${plain} vertices)`)
		assert.equal(pillarTops(P.createEnv(T, floors, obs, { occ: [all] })), 0, 'none on blocked cells')
	})
})

/** A closed toy track of n points: a wavy oval ≈ 26 × 12 m (life-size hall), width 0.35 m. */
function longTrack(n = 2500) {
	const points = []
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2
		const r = 1 + 0.04 * Math.sin(t * 24)
		points.push([13 * r * Math.cos(t), 0, 6 * r * Math.sin(t)])
	}
	const cps = [0, 1, 2, 3, 4, 5, 6, 7].map((q) => Math.round((q * n) / 8))
	return { id: 'long', name: 'Long tour', width: 0.35, closed: true, points, checkpoints: cps, grid: [], laps: 1 }
}

/** Count reads of T.segs[i] while fn runs. */
function countSegReads(T, fn) {
	const raw = T.segs
	let reads = 0
	T.segs = new Proxy(raw, {
		get: (t, k) => {
			if (typeof k === 'string' && k.charCodeAt(0) >= 48 && k.charCodeAt(0) <= 57) reads++
			return t[k]
		},
	})
	try {
		fn()
	} finally {
		T.segs = raw
	}
	return reads
}

describe('WO-1074 §3 tracks of 2500 points', () => {
	it('prepare + mesh + minimap layer + preview build fast and draw every point', () => {
		const raw = longTrack()
		let t0 = performance.now()
		const T = TM.prepareTrack(raw, K)
		const tPrep = performance.now() - t0
		assert.equal(T.n, 2500)
		assert.ok(T.sgrid, 'a long track gets the segment grid')
		const env = P.createEnv(T, F.BIG_FLOORS, [])
		t0 = performance.now()
		const g = MESH.buildTrackMesh(T, env.ground)
		const tMesh = performance.now() - t0
		MESH.disposeGroup(g)
		assert.ok(tPrep < 1500 && tMesh < 3000, `prepare ${tPrep.toFixed(0)} ms, mesh ${tMesh.toFixed(0)} ms`)
		STUB.calls.lineTo = 0
		DRAW.previewTrack(STUB.canvas(), raw, K)
		assert.ok(STUB.calls.lineTo >= 2 * 2499 && STUB.calls.lineTo < 4 * 2500, `preview draws the ribbon (${STUB.calls.lineTo})`)
		const mm = new DRAW.Minimap(STUB.canvas())
		mm.setTrack(T)
		const before = STUB.calls.all
		mm.draw([{ x: 0, z: 6, color: '#fff', me: true }, { x: 13, z: 0, color: '#f00' }])
		assert.ok(STUB.calls.all - before < 20, `a minimap frame is the cached layer + dots (${STUB.calls.all - before} calls)`)
	})

	it('nearest-ribbon search without a hint reads a few grid cells, not 2500 segments — same answer as the full scan', () => {
		const T = TM.prepareTrack(longTrack(), K)
		const pts = []
		for (let q = 0; q < 200; q++) pts.push([Math.sin(q * 1.7) * 14, Math.cos(q * 0.9) * 7])
		const full = { ...T, sgrid: null }
		let reads = 0
		for (const [x, z] of pts) {
			let a
			reads += countSegReads(T, () => (a = TM.nearestOnTrack(T, x, z, -1)))
			const b = TM.nearestOnTrack(full, x, z, -1)
			assert.equal(a.seg, b.seg, `(${x.toFixed(2)}, ${z.toFixed(2)})`)
			assert.equal(a.score, b.score)
		}
		assert.ok(reads / pts.length < 400, `${(reads / pts.length).toFixed(0)} segment reads per query`)
	})

	it('a bot lap: physics + lap tracking read a bounded number of segments per step', () => {
		const T = TM.prepareTrack(longTrack(), K)
		const env = P.createEnv(T, F.BIG_FLOORS, [])
		const car = P.createCar(TM.gridPose(T, 0))
		const r = new ST.RaceTracker(T)
		r.reset(0)
		r.move('me', car.x, car.z, 0, true, car.y)
		let hint = -1
		let done = 0
		let worst = 0
		let steps = 0
		const t0 = performance.now()
		for (let i = 0; i < 60 * 120 && done < 1; i++) {
			const reads = countSegReads(T, () => {
				const b = F.botInput(TM, P, T, car, hint)
				hint = b.near.seg
				P.stepCar(car, b.input, env)
				car.ev.length = 0
				const e = r.move('me', car.x, car.z, (i * 1000) / 60, false, car.y)
				if (e?.type === 'lap') done = e.lap
			})
			worst = Math.max(worst, reads)
			steps++
		}
		const ms = performance.now() - t0
		assert.equal(done, 1, 'the bot laps the 2500-point track')
		assert.ok(worst < 600, `worst step read ${worst} segments (a full scan is 2500)`)
		assert.ok(ms / steps < 2, `${(ms / steps).toFixed(3)} ms per step incl. counting`)
	})
})
