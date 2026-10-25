'use strict'
/**
 * WO-709 — Auto home (owner 23.10.26: "after a while with no person detected the fronts should reset to a home
 * position which is lighting the stage evenly"). After after_s with nobody seen, every Auto pool head aims at its own
 * point spread over the grid rectangle (project.previs.tracking.grid, the Godot normalize_grid meaning), assigned so
 * no two beams cross; anyone appearing leaves home at once; POST home {now:true} forces it.
 */
const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { MarkerHub } = require('../../src/tracking/marker-hub')
const { normalizeDetection } = require('../../src/tracking/detect-model')
const { AUTO_MARKER_ID } = require('../../src/tracking/auto-follow')
const { createAutoDirector } = require('../../src/tracking/auto-director')
const { homePoints, homeAssign, normalizeGrid, GRID_DEFAULT } = require('../../src/tracking/auto-split')
const { FollowEngine } = require('../../src/fixtures/follow-engine')

const ROOT = path.join(__dirname, '../..')
const tmpDirs = []
const tmpFile = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo709-'))
	tmpDirs.push(dir)
	return path.join(dir, 'tracking-auto.json')
}
after(() => tmpDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))
const person = (x, y, id) => ({
	key: `w:${id}`,
	camera: 'world',
	tid: id,
	world: [x, y],
	score: 0.9,
	age_s: 0,
	area: 5000,
})
const GRID = { width: 10, depth: 6, spacing: 1, x_offset: 0, y_offset: 3, z_offset: 0.2 }

function rig({ heads = 4, grid = GRID, enabled = true } = {}) {
	let t = 1000
	const hub = new MarkerHub({ now: () => t })
	const dir = createAutoDirector({ file: tmpFile() })
	dir.configure({ previs: { tracking: { grid } } })
	const cfg = normalizeDetection({ enabled, pin_mode: 'assist', smoothing: 1, prediction: 0 })
	const fixtures = Array.from({ length: heads }, (_, i) => ({
		id: `h${i + 1}`,
		follow: AUTO_MARKER_ID,
		pose: { x: -3 + 2 * i, y: -1, z: 6 },
	}))
	const step = (persons, ms = 50) => {
		t += ms
		dir.step({ cfg, available: true, persons, hub, planeZ: 0, now: t, dt: ms / 1000, fixtures })
	}
	const hold = (persons, seconds) => {
		for (let s = 0; s < seconds * 20; s++) step(persons)
	}
	const target = (id) => dir.resolveAuto({ id }, new Map(hub.list(t).map((m) => [m.id, m])))
	return { dir, step, hold, target, fixtures }
}

/** Do segments p1–p2 and q1–q2 properly cross? */
function crosses(p1, p2, q1, q2) {
	const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
	return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0
}

describe('WO-709 Auto home', () => {
	it('nobody for after_s → home; the heads aim at their home points (target.home)', () => {
		const r = rig()
		r.hold([person(0, 3, 1)], 1)
		r.hold([], 9)
		assert.equal(r.dir.snapshot().home.active, false, 'not yet at 9 s')
		assert.equal(r.dir.snapshot().home.idle_s, 9)
		r.hold([], 1.2)
		const s = r.dir.snapshot()
		assert.equal(s.home.active, true)
		assert.equal(s.home.after_s, 10)
		const t1 = r.target('h1')
		assert.equal(t1.home, true)
		assert.equal(t1.status, 1)
		assert.equal(t1.z, 0.2, 'at the grid z_offset')
		assert.ok(t1.x < 0, 'stage right head → a stage right point')
		assert.deepEqual(s.persons, [], 'nobody, no lanes')
	})

	it('a person appearing leaves home at once (no join delay), and the heads follow them', () => {
		const r = rig()
		r.hold([], 11)
		assert.equal(r.dir.snapshot().home.active, true, 'home from boot when nobody is ever seen')
		r.step([person(1, 2, 5)])
		assert.equal(r.dir.snapshot().home.active, false)
		assert.equal(r.target('h1').id, AUTO_MARKER_ID)
		assert.equal(r.dir.snapshot().home.idle_s, 0)
	})

	it('after_s is the operator setting (3…600)', () => {
		const r = rig()
		assert.equal(r.dir.home({ after_s: 3 }).status, 200)
		r.hold([], 3.2)
		assert.equal(r.dir.snapshot().home.active, true)
		assert.equal(r.dir.home({ after_s: 601 }).status, 400)
	})

	it('home now: forced until someone new appears; false cancels', () => {
		const r = rig()
		r.hold([person(0, 3, 1)], 1)
		assert.equal(r.dir.home({ now: true }).body.home.active, true, 'with someone in view too')
		r.hold([person(0, 3, 1)], 1)
		assert.equal(r.target('h2').home, true)
		r.step([person(0, 3, 1), person(3, 3, 2)])
		assert.equal(r.dir.snapshot().home.forced, false, 'a new person ends it')
		assert.equal(r.dir.snapshot().home.active, false)
		r.hold([], 1)
		r.dir.home({ now: true })
		assert.equal(r.dir.home({ now: false }).body.home.active, false)
	})

	it('detection off: no timed home (heads hold as WO-707); a forced home still works', () => {
		const r = rig({ enabled: false })
		r.hold([], 12)
		assert.equal(r.dir.snapshot().home.active, false)
		assert.equal(r.target('h1'), null, 'hold')
		r.dir.home({ now: true })
		r.step([])
		assert.equal(r.target('h1').home, true)
	})

	it('home points: n points spread evenly over the rectangle, inset half a cell', () => {
		for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 12, 16]) {
			const pts = homePoints(GRID, n)
			assert.equal(pts.length, n)
			for (const p of pts) {
				assert.ok(p.x > -5 && p.x < 5 && p.y > 0 && p.y < 6, `inside the grid (${n}: ${p.x}, ${p.y})`)
				assert.equal(p.z, 0.2)
			}
			const rows = [...new Set(pts.map((p) => p.y))].sort((a, b) => a - b)
			const dy = 6 / rows.length
			rows.forEach((y, i) => assert.ok(Math.abs(y - (0.5 + i) * dy) < 1e-9, 'rows centred in their cells'))
			for (const y of rows) {
				const xs = pts.filter((p) => p.y === y).map((p) => p.x)
				const dx = 10 / xs.length
				xs.forEach((x, i) => assert.ok(Math.abs(x - (-5 + (i + 0.5) * dx)) < 1e-9, 'evenly across the width'))
			}
		}
		assert.deepEqual(homePoints(GRID, 1), [{ x: 0, y: 3, z: 0.2 }], 'one head: the centre')
		assert.equal([...new Set(homePoints(GRID, 4).map((p) => p.y))].length, 2, '10 × 6 m, 4 heads: 2 × 2')
		assert.equal(
			[...new Set(homePoints({ ...GRID, width: 20, depth: 2 }, 4).map((p) => p.y))].length,
			1,
			'a wide stage: one row'
		)
		const off = homePoints({ ...GRID, x_offset: 4, y_offset: -2 }, 1)[0]
		assert.deepEqual([off.x, off.y], [4, -2], 'x_offset / y_offset are the centre (Godot grid_corners)')
		assert.deepEqual(homePoints(GRID, 0), [])
	})

	it('home assignment never crosses two beams', () => {
		const layouts = [
			[-4, -2, 0, 2, 4].map((x) => ({ x, y: -1 })),
			[3, -3, 1, -1].map((x) => ({ x, y: -2 })),
			[
				{ x: -6, y: 1 },
				{ x: 6, y: 1 },
				{ x: -2, y: -3 },
				{ x: 2, y: -3 },
				{ x: 0, y: 8 },
				{ x: 5, y: 7 },
			],
		]
		for (const poses of layouts) {
			const pool = poses.map((p, i) => ({ id: `f${i}`, pose: p }))
			const map = homeAssign(pool, GRID)
			assert.equal(map.size, pool.length)
			const segs = pool.map((f) => [
				[f.pose.x, f.pose.y],
				[map.get(f.id).x, map.get(f.id).y],
			])
			const used = new Set([...map.values()].map((p) => `${p.x},${p.y}`))
			assert.equal(used.size, pool.length, 'one point per head')
			for (let i = 0; i < segs.length; i++)
				for (let j = i + 1; j < segs.length; j++) assert.ok(!crosses(...segs[i], ...segs[j]), `beams ${i} and ${j} cross`)
		}
		const line = homeAssign(
			[-3, -1, 1, 3].map((x, i) => ({ id: i, pose: { x, y: -1 } })),
			{ ...GRID, depth: 1, width: 12 }
		)
		assert.deepEqual(
			[0, 1, 2, 3].map((i) => line.get(i).x),
			[-4.5, -1.5, 1.5, 4.5],
			'left to right'
		)
	})

	it('grid: the Godot normalize_grid defaults and limits', () => {
		const gd = fs.readFileSync(path.join(ROOT, 'godot/client/features/previs/tracking/tracking_model.gd'), 'utf8')
		const m = /const GRID_DEFAULT := (\{[^}]*\})/.exec(gd)
		assert.ok(m, 'GRID_DEFAULT in tracking_model.gd')
		assert.deepEqual(JSON.parse(m[1]), { ...GRID_DEFAULT })
		assert.match(gd, /out\["width"\] = clampf\(out\.width, 0\.5, 200\.0\)/)
		assert.match(gd, /var x0: float = g\.x_offset\n/)
		assert.match(gd, /var y0: float = g\.y_offset - g\.depth \/ 2\.0/)
		assert.equal(normalizeGrid({ width: 0.1 }).width, 0.5)
		assert.equal(normalizeGrid({ width: '3' }).width, 10, 'non-numbers fall back like the Godot twin')
		assert.deepEqual(normalizeGrid(null), { ...GRID_DEFAULT })
	})

	it("the engine reports state 'home' and aims at the point", () => {
		const eng = new FollowEngine({ hub: { now: () => 0, list: () => [] }, now: () => 0, send: () => {} })
		eng.configure({
			patch: [{ id: 'a', universe: 3, address: 1, dest: '10.0.0.9', pose: { x: 0, y: -1, z: 6 }, follow: AUTO_MARKER_ID }],
		})
		eng.resolveAuto = () => ({ x: 0, y: 3, z: 0, status: 1, stale: false, home: true })
		eng.tick()
		const f = eng.status().fixtures[0]
		assert.equal(f.state, 'home')
		assert.ok(f.tilt !== 0, 'aimed upstage at the home point')
	})
})
