'use strict'

/**
 * WO-616 T13b — automatic beam-spot detection for the fixture calibration: a Node reader for one HASCGSHM v1 still
 * (src/tracking/hshm-read.js), the spot finder (src/fixtures/beam-spot.js) and the route half that casts the spot
 * onto the floor and adds it as a calibration point (src/fixtures/calibrate-spot.js).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { readLatestFrame } = require('../../src/tracking/hshm-read')
const { lumaGrid, findBeamSpot } = require('../../src/fixtures/beam-spot')
const { createSpotFinder } = require('../../src/fixtures/calibrate-spot')
const M = require('../../src/tracking/camera-model')

const ROOT = path.join(__dirname, '../..')
const W = 640
const H = 360

/** BGRA picture: grey 50 ± 4 noise, plus discs { x, y, r, v } and rects { x0, y0, x1, y1, v }. */
function picture({ spots = [], rects = [] } = {}) {
	const px = Buffer.alloc(W * H * 4)
	let seed = 7
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff
			let v = 50 + (seed % 9) - 4
			for (const r of rects) if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) v = r.v
			for (const s of spots) {
				const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y)
				if (d < s.r) v = Math.max(v, s.v - (d / s.r) * 40)
			}
			const o = (y * W + x) * 4
			px[o] = px[o + 1] = px[o + 2] = Math.round(v)
			px[o + 3] = 255
		}
	}
	return { state: 'frame', seq: 1, width: W, height: H, stride: W * 4, pixels: px }
}

/** A HASCGSHM v1 segment holding `frame` as published frame `seq` (slot seq word = 2·seq unless `torn`). */
function writeSegment(file, frame, seq, { torn = false } = {}) {
	const slotSize = Math.ceil((4096 + frame.stride * frame.height) / 4096) * 4096
	const buf = Buffer.alloc(4096 + 3 * slotSize)
	buf.write('HASCGSHM', 0, 'latin1')
	buf.writeUInt32LE(1, 8)
	buf.writeUInt32LE(4096, 12)
	buf.writeUInt32LE(frame.width, 16)
	buf.writeUInt32LE(frame.height, 20)
	buf.writeUInt32LE(frame.stride, 24)
	for (let s = 0; s < 3; s++) buf.writeBigUInt64LE(BigInt(4096 + s * slotSize), 48 + 8 * s)
	const slot = seq % 3
	const base = 4096 + slot * slotSize
	buf.writeBigUInt64LE(BigInt(torn ? 2 * seq - 1 : 2 * seq), base)
	frame.pixels.copy(buf, base + 4096)
	buf.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(slot), 96)
	fs.writeFileSync(file, buf)
}

describe('WO-616 T13b hshm-read', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hshm-read-'))
	const file = path.join(dir, 'seg')
	it('reads the latest published frame and reports missing / torn / already-seen', () => {
		assert.equal(readLatestFrame(path.join(dir, 'nope')).state, 'missing')
		const f = picture({ spots: [{ x: 100, y: 80, r: 6, v: 250 }] })
		writeSegment(file, f, 5)
		const r = readLatestFrame(file)
		assert.equal(r.state, 'frame')
		assert.deepEqual([r.seq, r.width, r.height, r.stride], [5, W, H, W * 4])
		assert.ok(r.pixels.equals(f.pixels), 'pixels round-trip')
		assert.equal(readLatestFrame(file, { since: 5 }).state, 'none', 'the same frame again')
		writeSegment(file, f, 6, { torn: true })
		assert.equal(readLatestFrame(file).state, 'lapped')
		fs.writeFileSync(file, Buffer.alloc(256))
		assert.equal(readLatestFrame(file).state, 'invalid')
		fs.rmSync(dir, { recursive: true, force: true })
	})
})

describe('WO-616 T13b findBeamSpot', () => {
	it('finds a spot to sub-pixel accuracy', () => {
		const s = findBeamSpot(lumaGrid([picture({ spots: [{ x: 213.3, y: 141.7, r: 7, v: 250 }] })]))
		assert.equal(s.ok, true)
		assert.ok(Math.hypot(s.px[0] - 213.3, s.px[1] - 141.7) < 1, `px ${s.px}`)
		assert.equal(s.ambiguous, false)
	})
	it('refuses a flat picture and a lit wall; a reference with the beam off takes the wall out', () => {
		assert.equal(findBeamSpot(lumaGrid([picture()])).ok, false, 'nothing stands out')
		const wall = { x0: 0, y0: 0, x1: 320, y1: 200, v: 255 }
		const lit = findBeamSpot(lumaGrid([picture({ rects: [wall], spots: [{ x: 500, y: 300, r: 6, v: 250 }] })]))
		assert.equal(lit.ok, false, 'a wall is too big for a spot')
		assert.match(lit.reason, /reference/)
		const ref = lumaGrid([picture({ rects: [wall] })])
		const s = findBeamSpot(lumaGrid([picture({ rects: [wall], spots: [{ x: 500, y: 300, r: 6, v: 250 }] })]), { ref })
		assert.equal(s.ok, true)
		assert.equal(s.reference, true)
		assert.ok(Math.hypot(s.px[0] - 500, s.px[1] - 300) < 1, `px ${s.px}`)
	})
	it('flags two equally bright spots as ambiguous', () => {
		const s = findBeamSpot(lumaGrid([picture({ spots: [{ x: 100, y: 100, r: 6, v: 250 }, { x: 500, y: 250, r: 6, v: 248 }] })]))
		assert.equal(s.ok, true)
		assert.equal(s.ambiguous, true)
	})
})

describe('WO-616 T13b calibrate/spot', () => {
	const cam = { pos_x: 0, pos_y: -8, pos_z: 4, pitch: -25, yaw: 5, roll: 0, fov: 60 }
	const target = [1.5, 2, 0]
	const [sx, sy] = M.project(cam, [target], 1920, 1080)[0]
	const frame = picture({ spots: [{ x: (sx * W) / 1920, y: (sy * H) / 1080, r: 5, v: 250 }] })
	const dark = picture()

	function rig({ frames = () => frame, calibrated = true } = {}) {
		const t = { ms: 0, seq: 0, leases: [], points: [] }
		const project = { previs: { tracking: { grid: { z_offset: 0 }, cameras: [{ id: 'cam1', role: 'in1', raster: [1920, 1080], cam: calibrated ? cam : null }] } } }
		const calib = { handle: (d) => (t.points.push(d), { status: 200, body: { id: d.id, points: t.points.length } }) }
		const read = (file, { since }) => {
			assert.equal(file, '/dev/shm/highascg-in1')
			return t.seq === since ? { state: 'none' } : { ...frames(), seq: t.seq }
		}
		const finder = createSpotFinder({
			calib,
			project: () => project,
			lease: async (roles) => t.leases.push(roles),
			read,
			now: () => t.ms,
			sleep: async (ms) => ((t.ms += ms), t.seq++),
		})
		return { t, finder }
	}

	it('leases the camera surface, finds the spot and casts it onto the floor', async () => {
		const { t, finder } = rig()
		t.seq = 1
		const r = await finder.handle({ camera: 'cam1' })
		assert.equal(r.status, 200, JSON.stringify(r.body))
		assert.deepEqual(t.leases[0], ['in1'])
		assert.ok(Math.hypot(r.body.spot.at[0] - target[0], r.body.spot.at[1] - target[1]) < 0.05, `at ${r.body.spot.at}`)
		assert.equal(t.points.length, 0, 'no fixture id → nothing added')
	})
	it('adds the spot as a calibration point for the fixture; ambiguous spots are not added', async () => {
		const { t, finder } = rig()
		t.seq = 1
		const r = await finder.handle({ camera: 'cam1', id: 'fx1' })
		assert.equal(r.status, 200)
		assert.equal(t.points[0].action, 'point')
		assert.equal(t.points[0].id, 'fx1')
		assert.ok(r.body.spot && r.body.points === 1)
		const two = picture({ spots: [{ x: 100, y: 100, r: 6, v: 250 }, { x: 500, y: 250, r: 6, v: 250 }] })
		const amb = rig({ frames: () => two })
		amb.t.seq = 1
		assert.equal((await amb.finder.handle({ camera: 'cam1', id: 'fx1' })).status, 409)
		assert.equal(amb.t.points.length, 0)
	})
	it('reference / clear, and the refusals', async () => {
		let cur = dark
		const { t, finder } = rig({ frames: () => cur })
		t.seq = 1
		assert.deepEqual((await finder.handle({ camera: 'cam1', action: 'reference' })).body, { camera: 'cam1', reference: true })
		cur = frame
		assert.equal((await finder.handle({ camera: 'cam1' })).body.spot.reference, true)
		assert.equal((await finder.handle({ camera: 'cam1', action: 'clear' })).body.reference, false)
		cur = dark
		assert.equal((await finder.handle({ camera: 'cam1' })).status, 422, 'no spot')
		assert.equal((await finder.handle({ camera: 'nope' })).status, 404)
		assert.equal((await finder.handle({ camera: 'cam1', action: 'x' })).status, 400)
		assert.equal((await rig({ calibrated: false }).finder.handle({ camera: 'cam1' })).status, 409, 'unsolved camera')
		const silent = rig({ frames: () => ({ state: 'missing' }) })
		const r = await silent.finder.handle({ camera: 'cam1' })
		assert.equal(r.status, 503)
		assert.match(r.body.error, /no picture from in1/)
	})
	it('is routed by the tracking module', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8')
		assert.match(src, /path === '\/api\/tracking\/follow\/calibrate\/spot'/)
		assert.match(src, /await _spot\.handle\(data\)/)
	})
})
