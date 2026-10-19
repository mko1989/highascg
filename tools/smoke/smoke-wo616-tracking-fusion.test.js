'use strict'

/**
 * WO-616 T10a — multi-camera fusion (src/tracking/fusion.js) on a synthetic stage: a FOH camera and a stage-right
 * side camera (90° apart, lens on) see people whose boxes are made by projecting their feet and head top through
 * the same camera model; fusion must place them < 20 cm (P4 acceptance), keep their world ids through an occlusion
 * in one camera and a ByteTrack id switch, and go stale after 1 s.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { Fusion, associate, measure, triangulate, observe, STALE_MS } = require(
	path.join(ROOT, 'src', 'tracking', 'fusion')
)
const { project, applyDistortion, pixelRay, pixelToFloor } = require(path.join(ROOT, 'src', 'tracking', 'camera-model'))

const W = 1920,
	H = 1080
const FOH = {
	id: 'cam_1',
	raster: [W, H],
	cam: { pos_x: 0.3, pos_y: -9, pos_z: 4, pitch: -18, yaw: 0, roll: 0.5, fov: 55, lens_k1: -0.12, lens_k2: 0.02 },
}
const SIDE = {
	id: 'cam_2',
	raster: [W, H],
	cam: { pos_x: -9, pos_y: 3, pos_z: 5, pitch: -24, yaw: 90, roll: 0, fov: 60, lens_k1: -0.05, lens_k2: 0 },
}
const HEIGHT = 1.75
const HALF_W = 0.22

/** A person standing at (x, y) → the sidecar box (normalised x1 y1 x2 y2) camera `e` would report, or null. */
function boxOf(e, x, y) {
	const pts = [
		[x, y, HEIGHT],
		[x, y, 0],
		[x - HALF_W, y, 1],
		[x + HALF_W, y, 1],
		[x, y - HALF_W, 1],
		[x, y + HALF_W, 1],
	]
	const px = project(e.cam, pts, W, H)
	if (px.some((p) => p === null)) return null
	const d = applyDistortion(px, W, H, e.cam.lens_k1, e.cam.lens_k2)
	const xs = d.map((p) => p[0])
	const head = d[0],
		feet = d[1]
	const box = [Math.min(...xs) / W, head[1] / H, Math.max(...xs) / W, feet[1] / H]
	// a real box is centred on the body: put the top-centre on the head and the bottom-centre on the feet
	const cx = (head[0] + feet[0]) / 2 / W
	const half = (box[2] - box[0]) / 2
	return box.every((v) => v >= 0 && v <= 1) ? [cx - half, box[1], cx + half, box[3]] : null
}

/** cams for one fusion step: people [{ tid1, tid2, x, y, hide: Set of camera ids }]. */
function frame(people, n, at, cams = [FOH, SIDE]) {
	return cams.map((e) => ({
		id: e.id,
		entry: e,
		at,
		frame: n,
		persons: people.flatMap((p) => {
			if (p.hide?.has(e.id)) return []
			const box = boxOf(e, p.x, p.y)
			return box ? [{ tid: e === FOH ? p.tid1 : p.tid2, box, score: 0.8, age_s: 0 }] : []
		}),
	}))
}

const err = (wp, p) => Math.hypot(wp.x - p.x, wp.y - p.y)

describe('WO-616 T10a fusion', () => {
	it('pixelRay agrees with pixelToFloor through the lens', () => {
		for (const px of [
			[100, 900],
			[960, 540],
			[1800, 300],
		]) {
			const r = pixelRay(FOH.cam, px, W, H)
			const fl = pixelToFloor(FOH.cam, px, W, H, 0)
			const t = -r.o[2] / r.d[2]
			assert.ok(Math.hypot(r.o[0] + t * r.d[0] - fl[0], r.o[1] + t * r.d[1] - fl[1]) < 1e-9)
		}
	})

	it('triangulate: two crossing rays meet at their point, gap 0', () => {
		const p = [1, 2, 1.7]
		const ray = (o) => {
			const d = p.map((v, i) => v - o[i])
			const n = Math.hypot(...d)
			return { o, d: d.map((v) => v / n) }
		}
		const t = triangulate([ray([0, -9, 4]), ray([-9, 3, 5])])
		assert.ok(Math.hypot(t.p[0] - 1, t.p[1] - 2, t.p[2] - 1.7) < 1e-9)
		assert.ok(t.gap < 1e-9)
		assert.equal(triangulate([ray([0, -9, 4]), ray([0, -9, 4])]), null, 'parallel rays are degenerate')
	})

	it('both cameras see every test position (the scene is valid)', () => {
		for (const [x, y] of [
			[-2, 1],
			[2, 1],
			[-2, 5],
			[2, 5],
			[0, 3],
		]) {
			assert.ok(boxOf(FOH, x, y), `FOH sees ${x},${y}`)
			assert.ok(boxOf(SIDE, x, y), `side sees ${x},${y}`)
		}
	})

	it('associate pairs each person across cameras (≤ 1 box per camera per cluster)', () => {
		const people = [
			{ tid1: 1, tid2: 7, x: -1, y: 2 },
			{ tid1: 2, tid2: 8, x: 0.2, y: 2.3 },
			{ tid1: 3, tid2: 9, x: 1.5, y: 4 },
		]
		const obs = frame(people, 1, 0).flatMap((c) => c.persons.map((p) => observe(p, c, 0)))
		const cl = associate(obs)
		assert.equal(cl.length, 3)
		for (const c of cl) {
			assert.equal(c.length, 2)
			assert.deepEqual(
				c.map((o) => o.camera),
				['cam_1', 'cam_2']
			)
		}
		const pairs = cl.map((c) => c.map((o) => o.tid).join('/')).sort()
		assert.deepEqual(pairs, ['1/7', '2/8', '3/9'])
	})

	// Box top / bottom centres sit between the head and feet pixels (a vertical body leans in the picture), so even
	// exact geometry is a few cm off — the same bias a real detector box has. Hence 5 cm, not 1e-9.
	it('measure: a two-camera cluster triangulates the head (< 5 cm, height ≈ 1.75); one camera = its feet', () => {
		const p = { tid1: 1, tid2: 2, x: 1.2, y: 3.4 }
		const obs = frame([p], 1, 0).flatMap((c) => c.persons.map((q) => observe(q, c, 0)))
		const m = measure(obs, 0)
		assert.equal(m.source, 'fused')
		assert.equal(m.triangulated, true)
		assert.ok(err(m, p) < 0.05, `fused error ${err(m, p)}`)
		assert.ok(Math.abs(m.height - HEIGHT) < 0.05, `height ${m.height}`)
		const one = measure([obs[1]], 0)
		assert.equal(one.source, 'cam_2')
		assert.equal(one.height, null)
		assert.ok(err(one, p) < 0.05)
	})

	it('measure: near-parallel rays are not triangulated (feet mean instead)', () => {
		const twin = { id: 'cam_3', raster: [W, H], cam: { ...FOH.cam, pos_x: FOH.cam.pos_x + 0.2 } }
		const p = { tid1: 1, tid2: 2, x: 0, y: 3 }
		const obs = frame([p], 1, 0, [FOH, twin]).map((c) => observe(c.persons[0], c, 0))
		const m = measure(obs, 0)
		assert.equal(m.triangulated, false)
		assert.equal(m.source, 'fused')
		assert.ok(err(m, p) < 0.05)
	})

	it('three walkers over 4 s at 15 fps: every fused position < 20 cm, ids stable', () => {
		const f = new Fusion()
		const ids = new Map()
		let worst = 0
		for (let n = 0; n < 60; n++) {
			const t = n / 15
			const people = [
				{ tid1: 1, tid2: 11, x: -2 + t, y: 1.5 },
				{ tid1: 2, tid2: 12, x: 2 - 0.8 * t, y: 3 + 0.3 * t },
				{ tid1: 3, tid2: 13, x: 0, y: 5 - t },
			]
			assert.equal(f.step({ cams: frame(people, n, n * 67), now: n * 67 }), true)
			const out = f.persons(n * 67)
			assert.equal(out.length, 3, `step ${n}`)
			for (const p of people) {
				const wp = out.find((o) => o.keys.includes(`cam_1:${p.tid1}`))
				assert.ok(wp, `step ${n}: person ${p.tid1} found`)
				if (!ids.has(p.tid1)) ids.set(p.tid1, wp.id)
				assert.equal(wp.id, ids.get(p.tid1), `step ${n}: id of person ${p.tid1} stable`)
				assert.equal(wp.source, 'fused')
				if (n >= 5) worst = Math.max(worst, err(wp, p))
			}
		}
		assert.ok(worst < 0.2, `worst error ${worst.toFixed(3)} m`)
	})

	it('occlusion in one camera: tracked from the other (source cam_2), same id, back to fused after', () => {
		const f = new Fusion()
		const p = { tid1: 4, tid2: 14, x: -1, y: 2 }
		const hidden = new Set(['cam_1'])
		let id = null
		for (let n = 0; n < 45; n++) {
			p.x = -1 + n * 0.04
			const hide = n >= 15 && n < 30 ? hidden : null
			f.step({ cams: frame([{ ...p, hide }], n, n * 67), now: n * 67 })
			const [wp] = f.persons(n * 67)
			id ??= wp.id
			assert.equal(wp.id, id, `step ${n}`)
			assert.equal(wp.source, hide ? 'cam_2' : 'fused', `step ${n} source`)
			assert.ok(err(wp, p) < 0.2, `step ${n} error ${err(wp, p)}`)
		}
	})

	it('a ByteTrack id switch in one camera keeps the world id', () => {
		const f = new Fusion()
		const p = { tid1: 5, tid2: 15, x: 0.5, y: 2.5 }
		let id = null
		for (let n = 0; n < 20; n++) {
			if (n === 10) p.tid1 = 99
			p.y += 0.03
			f.step({ cams: frame([p], n, n * 67), now: n * 67 })
			const [wp] = f.persons(n * 67)
			id ??= wp.id
			assert.equal(wp.id, id)
		}
	})

	it('no support: predicted while it coasts, dropped after STALE_MS; no new frame = no step', () => {
		const f = new Fusion()
		const p = { tid1: 6, tid2: 16, x: 0, y: 3 }
		f.step({ cams: frame([p], 1, 0), now: 0 })
		const cams = frame([], 2, 100)
		assert.equal(f.step({ cams, now: 100 }), true)
		assert.equal(f.persons(100)[0].source, 'predicted')
		assert.equal(f.step({ cams, now: 150 }), false, 'same frames again: nothing new')
		assert.equal(f.persons(STALE_MS - 1).length, 1)
		f.step({ cams: frame([], 3, STALE_MS + 1), now: STALE_MS + 1 })
		assert.equal(f.persons(STALE_MS + 1).length, 0)
	})

	it('single camera: world persons from its feet, source = the camera id', () => {
		const f = new Fusion()
		const p = { tid1: 1, tid2: 2, x: 1, y: 2 }
		f.step({ cams: frame([p], 1, 0, [SIDE]), now: 0 })
		const [wp] = f.persons(0)
		assert.equal(wp.source, 'cam_2')
		assert.ok(err(wp, p) < 0.05, `error ${err(wp, p)}`)
	})

	it('a camera frame older than FRAME_MAX_AGE_MS is ignored; boxes the sidecar only predicts are not measurements', () => {
		const f = new Fusion()
		const p = { tid1: 1, tid2: 2, x: 1, y: 2 }
		const cams = frame([p], 1, 0)
		cams[0].at = -1000
		cams[1].persons[0].age_s = 0.2
		assert.equal(f.step({ cams, now: 0 }), true)
		assert.equal(f.persons(0).length, 0)
	})
})
