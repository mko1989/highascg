'use strict'

/**
 * WO-1074 — RC car game, browser client: the three.js builders run headless in node (no WebGL needed) — the track
 * mesh (asphalt, kerbs, lines, chevrons, start line, posts) and the procedural buggy (with a stub 2D canvas for the
 * blob shadow and the name tag). Catches three.js API misuse and NaN geometry; the look itself is not tested here.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const RC = path.join(__dirname, '..', '..', 'game', 'rc')
const load = (f) => import(pathToFileURL(path.join(RC, f)).href)

let TM, MESH, CAR, DRAW

function stubCanvasDocument() {
	const ctx = new Proxy(
		{},
		{
			get: (t, k) => {
				if (k in t) return t[k]
				if (k === 'measureText') return () => ({ width: 60 })
				if (k === 'createRadialGradient') return () => ({ addColorStop() {} })
				return () => {}
			},
			set: (t, k, v) => {
				t[k] = v
				return true
			},
		}
	)
	const canvas = () => ({ width: 0, height: 0, getContext: () => ctx, ownerDocument: doc })
	const doc = { createElement: canvas }
	return { doc, canvas, ctx }
}

before(async () => {
	const { doc } = stubCanvasDocument()
	if (!globalThis.document) globalThis.document = doc
	TM = await load('track-math.js')
	MESH = await load('track-mesh.js')
	CAR = await load('car-model.js')
	DRAW = await load('trackdraw.js')
})

function track(kind) {
	const points = []
	const n = kind === 'eight' ? 160 : 120
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2
		points.push(kind === 'eight' ? [8 * Math.cos(t), 8 * Math.sin(t) * Math.cos(t)] : [8 * Math.cos(t), 5 * Math.sin(t)])
	}
	const cps = kind === 'eight' ? [0, 40, 80, 120] : [0, 30, 60, 90]
	return TM.prepareTrack({ id: kind, y: 1.42, width: 2.2, closed: true, points, checkpoints: cps })
}

function geometryStats(group) {
	let verts = 0
	let nonFinite = 0
	let minY = Infinity
	group.traverse((o) => {
		const p = o.geometry?.attributes?.position
		if (!p) return
		verts += p.count
		for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) nonFinite++
		o.updateMatrixWorld(true)
		for (let i = 0; i < p.count; i++) minY = Math.min(minY, p.getY(i) + o.matrixWorld.elements[13])
	})
	return { verts, nonFinite, minY }
}

describe('WO-1074 three.js builders (headless)', () => {
	it('builds the track mesh on the track floor plane for an oval and a figure-eight', () => {
		for (const kind of ['oval', 'eight']) {
			const T = track(kind)
			const g = MESH.buildTrackMesh(T)
			const s = geometryStats(g)
			assert.equal(s.nonFinite, 0, kind)
			assert.ok(s.verts > T.n * 6 * 3, `${kind}: ribbon + kerbs + lines (${s.verts} vertices)`)
			assert.ok(s.minY >= T.y - 1e-6, `${kind}: nothing below the floor plane (${s.minY})`)
			assert.ok(g.children.length < 30, `${kind}: a handful of draw calls (${g.children.length})`)
			MESH.disposeGroup(g)
		}
	})

	it('builds the buggy: ≈ 0.45 × 0.25 m, wheels steer and spin, tag on demand', () => {
		const car = CAR.createCarModel({ color: '#ff4d3d', name: 'Ola', tag: true })
		car.update({ x: 1, y: 1.42, z: 2, yaw: 0.5 }, 5, 1, 1 / 60)
		assert.deepEqual(car.group.position.toArray(), [1, 1.42, 2])
		assert.equal(car.group.rotation.y, 0.5)
		let sprites = 0
		let pivotsTurned = 0
		car.group.traverse((o) => {
			if (o.isSprite) sprites++
			if (o.isGroup && o !== car.group && o.rotation.y > 0.1) pivotsTurned++
		})
		assert.equal(sprites, 1, 'name tag')
		assert.equal(pivotsTurned, 2, 'two front wheels steer left for st > 0')
		car.setTag(false)
		let after = 0
		car.group.traverse((o) => o.isSprite && after++)
		assert.equal(after, 0)
		car.dispose()
	})

	it('fits a track into a minimap / preview canvas', () => {
		const T = track('oval')
		const tf = DRAW.fitTransform(T, 180, 130, 8)
		for (const p of T.pts) {
			const [x, y] = tf.map(p[0], p[1])
			assert.ok(x >= 0 && x <= 180 && y >= 0 && y <= 130)
		}
		const { canvas } = stubCanvasDocument()
		const c = canvas()
		c.width = 200
		c.height = 130
		DRAW.previewTrack(c, { points: T.pts, width: 2.2, checkpoints: [0] })
		const mm = new DRAW.Minimap(c)
		mm.setTrack(T)
		mm.draw([{ x: 8, z: 0, color: '#ff0000', me: true }])
	})
})
