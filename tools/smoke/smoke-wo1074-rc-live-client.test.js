'use strict'

/**
 * WO-1074 §2.6 — RC game browser client: the live stage effects (modules/rc-game/client/stage-fx*.js). The pure maths (beam length to
 * the first floor below, pool ellipse, smoothing, the binary frame header, the LED wall strip = godot stage_objects.gd
 * column_edges) and the three.js side headless in node (no WebGL): instance matrices for lit / dark lights, the
 * `video` requests the module sends, a picture decoded through a stand-in createImageBitmap onto its role's texture.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const RC = path.join(__dirname, '..', '..', 'modules', 'rc-game', 'client')
const load = (f) => import(pathToFileURL(path.join(RC, f)).href)

let M, FX, THREE

before(async () => {
	M = await load('stage-fx-math.js')
	FX = await load('stage-fx.js')
	THREE = await import('three')
})

const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) < eps)

describe('stage-fx-math', () => {
	const FLOORS = [
		{ id: 'hall', y: 0, rect: [-20, -20, 20, 20] },
		{ id: 'stage', y: 1.4, rect: [-5, -10, 5, -2] },
	]

	it('a beam ends on the first floor below it inside that floor; misses fall through; up / sideways = 25 m', () => {
		assert.deepEqual(M.floorHit([0, 8, -5], [0, -1, 0], FLOORS), { len: 8 - 1.4, hit: [0, 1.4, -5] })
		assert.deepEqual(
			M.floorHit([0, 8, 5], [0, -1, 0], FLOORS),
			{ len: 8, hit: [0, 0, 5] },
			'outside the stage rect → hall'
		)
		assert.equal(M.floorHit([0, 1, -5], [0, -1, 0], FLOORS).hit[1], 0, 'a head below the stage deck never hits it')
		assert.deepEqual(M.floorHit([0, 8, 0], [0, 1, 0], FLOORS), { len: 25, hit: null })
		const far = M.floorHit([0, 8, 0], [0.999, -0.0447, 0], FLOORS)
		assert.equal(far.hit, null, 'beyond the hall rect')
		assert.equal(far.len, 25)
		assert.equal(M.floorHit([0, 3, 0], [0, -1, 0], []).len, 3, 'no floors → the plane y = 0')
	})

	it('pool: the cone radius at the floor, stretched by 1 / |dy| along the heading (≤ 4×)', () => {
		const p = M.poolShape([0, -1, 0], 10, 20)
		assert.ok(Math.abs(p.r - 10 * Math.tan((10 * Math.PI) / 180)) < 1e-9)
		assert.equal(p.major, p.minor)
		const s = Math.SQRT1_2
		const q = M.poolShape([0, -s, -s], 10, 20)
		assert.ok(Math.abs(q.major - q.r / s) < 1e-9)
		assert.ok(Math.abs(q.yaw - Math.PI / 2) < 1e-9, 'heading −Z: a +X axis turned +90° about Y')
		assert.equal(M.poolShape([0.999, -0.01, 0], 10, 20).major, 4 * M.poolShape([0.999, -0.01, 0], 10, 20).r)
	})

	it('smoothing reaches the target in ≈ 80 ms steps and reports when it settles', () => {
		const cur = { d: [0, -1, 0], c: [1, 1, 1], a: 0, z: 20 }
		const tgt = { d: [1, 0, 0], c: [1, 0, 0], a: 1, z: 40 }
		let moving = true
		let frames = 0
		while (moving && frames < 200) {
			moving = M.stepLight(cur, tgt, M.smoothK(1 / 60))
			frames++
		}
		assert.ok(frames > 20 && frames < 60, `${frames} frames at 60 Hz`)
		assert.ok(near(cur.d, [1, 0, 0], 1e-3) && Math.abs(Math.hypot(...cur.d) - 1) < 1e-9)
		assert.ok(Math.abs(cur.a - 1) < 1e-3)
	})

	it('entries and binary frames are validated', () => {
		assert.deepEqual(M.parseEntry([3, 0, -2, 0, 1, 0.5, 2, 0.4, 25]), {
			i: 3,
			d: [0, -1, 0],
			c: [1, 0.5, 1],
			a: 0.4,
			z: 25,
		})
		assert.equal(M.parseEntry([1, 2, 3]), null)
		assert.equal(M.parseEntry([1, 0, NaN, 0, 1, 1, 1, 1, 1]), null)
		const buf = new Uint8Array([4, ...Buffer.from('pgm1'), 0xff, 0xd8, 9, 0xff, 0xd9])
		const f = M.parseFrame(buf.buffer)
		assert.equal(f.role, 'pgm1')
		assert.deepEqual([...f.jpeg], [0xff, 0xd8, 9, 0xff, 0xd9])
		assert.equal(M.parseFrame(new Uint8Array([4, 1, 2, 3, 4, 0, 0])), null, 'not a JPEG / bad role')
	})

	it('wall strip: the previs column edges (flat and curved), v down, 2 cm in front along each column normal', () => {
		assert.deepEqual(M.columnEdges(2, 1, 0), [
			[-0.5, 0],
			[0, 0],
			[0.5, 0],
		])
		const e = M.columnEdges(4, 2, 10)
		assert.ok(near(e[2], [0, 0]), 'the middle edge is the origin')
		assert.ok(
			e[0][1] > 0 && Math.abs(e[0][1] - e[4][1]) < 1e-12 && Math.abs(e[0][0] + e[4][0]) < 1e-12,
			'ends bent towards +Z, symmetric'
		)
		const s = M.screenStrip({ size: [7, 4], uv: [0.25, 0, 1, 1], curveDeg: 0, cols: 14 })
		assert.equal(s.positions.length, 12, 'flat: one quad')
		assert.deepEqual([...s.positions], [-3.5, 2, 0.02, 3.5, 2, 0.02, 3.5, -2, 0.02, -3.5, -2, 0.02].map(Math.fround))
		assert.deepEqual([...s.uvs], [0.25, 0, 1, 0, 1, 1, 0.25, 1])
		// front face towards +Z (counter-clockwise seen from the audience)
		const p = (k) => [s.positions[k * 3], s.positions[k * 3 + 1]]
		const [a, b, c] = [p(s.indices[0]), p(s.indices[1]), p(s.indices[2])]
		assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0)
		assert.equal(M.screenStrip({ size: [7, 4], curveDeg: 5, cols: 14 }).positions.length, 14 * 12)
	})
})

describe('stage-fx (three.js, headless)', () => {
	const LIGHTS = [
		{ i: 0, id: 'a', name: 'A', p: [0, 8, -5], kind: 'spot' },
		{ i: 1, id: 'b', name: 'B', p: [2, 8, -5], kind: 'wash' },
	]
	const SCENE = {
		floors: [{ id: 'hall', y: 0, rect: [-20, -20, 20, 20] }],
		lights: LIGHTS,
		screens: [
			{
				id: 'w',
				role: 'pgm1',
				p: [2, 3.5, -9],
				rot: [0, 0, 0],
				size: [7, 4],
				curveDeg: 0,
				cols: 14,
				uv: [0.4167, 0, 1, 1],
			},
		],
	}

	function make() {
		const sent = []
		const scene = new THREE.Scene()
		const decoded = []
		const createImageBitmap = async (blob) => {
			decoded.push(blob)
			return { width: 480, height: 160, close() {} }
		}
		const fx = FX.createStageFx({ THREE, scene, send: (m) => (sent.push(m), true), createImageBitmap, Blob })
		return { fx, scene, sent, decoded }
	}

	it('lxfull before the scene, then the scene: lit light → cone, pool on the floor, glow; dark light → nothing', () => {
		const { fx, scene } = make()
		assert.equal(
			fx.onMessage({
				t: 'lxfull',
				ts: 1,
				on: true,
				lights: LIGHTS,
				f: [
					[0, 0, -1, 0, 1, 0, 0, 1, 20],
					[1, 0, -1, 0, 1, 1, 1, 0, 30],
				],
			}),
			true
		)
		fx.load(SCENE)
		for (let k = 0; k < 60; k++) fx.update(1 / 60)
		const group = scene.getObjectByName('stage-fx-lights')
		const [cones, pools, glows] = group.children
		assert.equal(cones.count, 2)
		const m = new THREE.Matrix4()
		const pos = new THREE.Vector3()
		const q = new THREE.Quaternion()
		const s = new THREE.Vector3()
		cones.getMatrixAt(0, m)
		m.decompose(pos, q, s)
		assert.ok(near(pos.toArray(), [0, 8, -5]) && Math.abs(s.y - 8) < 1e-6, `cone length = to the floor: ${s.toArray()}`)
		pools.getMatrixAt(0, m)
		m.decompose(pos, q, s)
		assert.ok(near(pos.toArray(), [0, 0.03, -5]), `pool ${pos.toArray()}`)
		const c = new THREE.Color()
		pools.getColorAt(0, c)
		assert.ok(c.r > 0 && c.g === 0 && c.b === 0, 'red pool')
		for (const mesh of [cones, pools, glows]) {
			mesh.getMatrixAt(1, m)
			assert.ok(
				m.elements.every((x, k) => (k === 15 ? x === 1 : x === 0)),
				`${mesh.geometry.type}: dark light scaled to nothing`
			)
		}
		assert.equal(fx.stats().lit, 1)
		fx.setQuality('low')
		assert.equal(cones.visible, false, 'low: pools and glows only')
		assert.equal(pools.visible, true)
	})

	it('lx deltas move one light smoothly; lights switched off (lxfull on:false) fade to dark', () => {
		const { fx, scene } = make()
		fx.load(SCENE)
		fx.onMessage({ t: 'lxfull', on: true, lights: LIGHTS, f: [[0, 0, -1, 0, 1, 1, 1, 1, 20]] })
		for (let k = 0; k < 60; k++) fx.update(1 / 60)
		assert.equal(fx.onMessage({ t: 'lx', f: [[0, 0.6, -0.8, 0, 0, 0, 1, 1, 20]] }), true)
		fx.update(1 / 60)
		const glows = scene.getObjectByName('stage-fx-lights').children[2]
		const m = new THREE.Matrix4()
		glows.getMatrixAt(0, m)
		const p1 = new THREE.Vector3().setFromMatrixPosition(m)
		assert.ok(p1.x > 0 && p1.x < 0.6 * 0.2 - 1e-3, 'part way after one frame (smoothing)')
		fx.onMessage({ t: 'lxfull', on: false, f: [] })
		for (let k = 0; k < 60; k++) fx.update(1 / 60)
		assert.equal(fx.stats().lit, 0)
		assert.equal(fx.onMessage({ t: 'w', cars: [] }), false, 'other messages are not ours')
	})

	it('asks for pictures once screens exist, again after every welcome; wall off / disabled → off', () => {
		const { fx, sent } = make()
		fx.onMessage({ t: 'welcome', id: 1, state: { lights: true, wall: true } })
		assert.deepEqual(sent, [{ t: 'video', on: false }], 'no screens yet')
		fx.load(SCENE)
		assert.deepEqual(sent.at(-1), { t: 'video', on: true })
		fx.onMessage({ t: 'state', state: { wall: false } })
		assert.deepEqual(sent.at(-1), { t: 'video', on: false })
		fx.onMessage({ t: 'state', state: { wall: true } })
		assert.deepEqual(sent.at(-1), { t: 'video', on: true })
		const n = sent.length
		fx.onMessage({ t: 'welcome', id: 1, state: { wall: true } })
		assert.equal(sent.length, n + 1, 'a reconnect re-subscribes')
		fx.setEnabled(false)
		assert.deepEqual(sent.at(-1), { t: 'video', on: false })
	})

	it('a binary frame becomes its role texture; the screen shows from its first picture; foreign roles are dropped', async () => {
		const { fx, scene, decoded } = make()
		fx.load(SCENE)
		const screen = scene.getObjectByName('screen:w')
		assert.equal(screen.visible, false, 'hidden until a picture (the GLB wall body shows)')
		const frame = new Uint8Array([4, ...Buffer.from('pgm1'), 0xff, 0xd8, 1, 2, 0xff, 0xd9])
		assert.equal(fx.onBinary(frame.buffer), true)
		assert.equal(fx.onBinary(new Uint8Array([4, ...Buffer.from('prv1'), 0xff, 0xd8, 0xff, 0xd9]).buffer), false)
		await new Promise((r) => setTimeout(r, 10))
		assert.equal(decoded.length, 1)
		assert.equal(decoded[0].type, 'image/jpeg')
		assert.equal(decoded[0].size, 6)
		assert.equal(screen.visible, true)
		assert.equal(screen.material.map.image.width, 480)
		const uv = screen.geometry.getAttribute('uv')
		assert.ok(Math.abs(uv.getX(0) - 0.4167) < 1e-6 && uv.getY(0) === 0)
		assert.ok(near(screen.position.toArray(), [2, 3.5, -9]))
		fx.dispose()
		assert.equal(scene.getObjectByName('stage-fx'), undefined)
	})
})
