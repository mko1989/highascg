'use strict'

/**
 * WO-1074 — RC car game, browser client: the three.js builders run headless in node (no WebGL needed) — the track
 * mesh (v2: ribbon following heights, ramp skirts to the floor, ledge marker, landing chevrons, gantry with start
 * lights), props (pads, item gems), item effects (slick, rocket, one-shots), the buggy with its effects, the minimap
 * (with a stub 2D canvas). §2.7 on the server generator's furnished-hall tracks: deck mesh (no NaN, nothing under the
 * floor or inside a table), the minimap draws the upper deck of a bridge over the lower, the chase camera stays under a
 * bridge. Catches three.js API misuse and NaN geometry; the look itself is checked by screenshots.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const F = require('./lib/rc-client-fixtures.js')

const load = F.load

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

let GR, PROPS, FXV, IT, PR, DR, THREE, PH, CAM

before(async () => {
	const { doc } = stubCanvasDocument()
	if (!globalThis.document) globalThis.document = doc
	TM = await load('track-math.js')
	MESH = await load('track-mesh.js')
	CAR = await load('car-model.js')
	DRAW = await load('trackdraw.js')
	GR = await load('ground.js')
	PROPS = await load('props.js')
	FXV = await load('fx-view.js')
	IT = await load('items.js')
	PR = await load('protocol.js')
	DR = await load('drive-rules.js')
	THREE = await import('three')
	PH = await load('physics.js')
	CAM = await load('cameras.js')
})

/* v1-shaped tracks on purpose (2D points + track.y): converted on load */
function track(kind) {
	const raw = kind === 'eight' ? F.eightTrack(8, 160) : F.ovalTrackV1(8, 5, 120, 1.42)
	if (kind === 'eight') raw.points = raw.points.map((p) => [p[0], p[2]])
	return TM.prepareTrack({ ...raw, y: 1.42, width: 2.2 })
}

function geometryStats(group) {
	let verts = 0
	let nonFinite = 0
	let minY = Infinity
	group.updateMatrixWorld(true)
	group.traverse((o) => {
		const p = o.geometry?.attributes?.position
		if (!p) return
		verts += p.count
		for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) nonFinite++
		const v = new THREE.Vector3()
		for (let i = 0; i < p.count; i++) minY = Math.min(minY, v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).y)
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
		assert.equal(car.group.scale.x, CAR.VIS_SCALE)
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
		DRAW.previewTrack(c, F.roomTrack())
		const mm = new DRAW.Minimap(c)
		mm.setTrack(TM.prepareTrack(F.roomTrack()))
		mm.draw([{ x: 8, z: 0, color: '#ff0000', me: true }])
	})
})

describe('WO-1074 v2 builders: 3D track, props, item effects, car effects', () => {
	const room = () => {
		const T = TM.prepareTrack(F.roomTrack())
		return { T, G: GR.createGround(F.ROOM_FLOORS, T) }
	}

	it('room track: the ribbon follows heights, ramp skirts reach the hall floor, nothing below it, nothing over the step', () => {
		const { T, G } = room()
		const g = MESH.buildTrackMesh(T, G)
		const s = geometryStats(g)
		assert.equal(s.nonFinite, 0)
		assert.ok(s.minY >= -1e-6 && s.minY < 0.01, `skirts go down to the hall floor (min y ${s.minY})`)
		let maxY = -Infinity
		let stepHits = 0
		const at = T.pts[T.drops[0].at]
		const nx = T.pts[(T.drops[0].at + 1) % T.n]
		const midX = (at[0] + nx[0]) / 2
		g.traverse((o) => {
			const p = o.geometry?.attributes?.position
			if (!p || o.parent?.name === 'track-deco') return
			for (let i = 0; i < p.count; i++) {
				if (o.parent?.name !== 'track-deco') maxY = Math.max(maxY, p.getY(i))
				/* road surface vertices between the ledge point and the next one, at mid height = a drawn step */
				if (Math.abs(p.getX(i) - midX) < 0.05 && Math.abs(p.getZ(i) + 9.5) < 1 && p.getY(i) > 0.3 && p.getY(i) < 1.1)
					stepHits++
			}
		})
		assert.ok(maxY > 1.4 && maxY < 1.5, `ribbon reaches the stage height (${maxY})`)
		assert.equal(stepHits, 0, 'no surface over the ledge step')
		assert.equal(g.userData.lights.length, 5, 'gantry start lights')
		MESH.disposeGroup(g)
	})

	it('props: pads and item gems; taken boxes hide and pop back', () => {
		const { T } = room()
		const P = PROPS.createProps(T)
		let taken = new Set([1])
		P.update(1, (id) => taken.has(id))
		const gems = P.group.children.filter((c) => c.isGroup)
		assert.equal(gems.length, 3)
		assert.deepEqual(
			gems.map((g) => g.visible),
			[true, false, true]
		)
		taken = new Set()
		for (let k = 0; k < 30; k++) P.update(1 + k / 60, (id) => taken.has(id), 1 / 60)
		assert.ok(gems.every((g) => g.visible))
		assert.equal(geometryStats(P.group).nonFinite, 0)
		P.dispose()
	})

	it('item effects: slick puddle at its point, rocket posed on the path, one-shots expire', () => {
		const { T } = room()
		const scene = new THREE.Scene()
		const V = FXV.createFxView(scene)
		const items = new IT.ItemState()
		items.addHaz(PR.decodeHaz({ hid: 1, kind: 'slick', by: 2, p: [14, 0, 0], yaw: 0, ts: 1000 }))
		items.addHaz(PR.decodeHaz({ hid: 2, kind: 'rocket', by: 2, p: [-3, 0, 7], yaw: 0, ts: 1000 }))
		V.sync(items, T, 1500, 1)
		const root = scene.getObjectByName('fx')
		assert.equal(root.children.length, 2)
		const rocket = root.children[1]
		const want = items.rocketOf(T, items.hazards.get(2), 1500)
		assert.ok(Math.abs(rocket.position.z - want.z) < 1e-9 && rocket.visible)
		V.sync(items, T, 7000, 2)
		assert.equal(rocket.visible, false, 'gone after 5 s')
		items.removeHaz(1)
		V.sync(items, T, 7000, 2)
		assert.equal(root.children.length, 1)
		V.oneShot('pulse', [0, 0, 0])
		V.oneShot('spin', [1, 0, 0])
		assert.equal(root.children.length, 1 + 4, 'rings + pop words')
		for (let k = 0; k < 60; k++) V.update(1 / 60)
		assert.equal(root.children.length, 1, 'one-shots removed')
		assert.equal(geometryStats(root).nonFinite, 0)
	})

	it('car effects follow the fx flags; the shadow stays on the ground while airborne', () => {
		const car = CAR.createCarModel({ color: '#3aa0ff' })
		const vis = () => {
			const out = []
			car.group.traverse((o) => o.isMesh && o.visible && o.parent?.visible !== false && out.push(o))
			return out.length
		}
		car.update({ x: 0, y: 0, z: 0, yaw: 0 }, 5, 0, 1 / 60, { fx: 0, groundY: 0 })
		const base = vis()
		car.update({ x: 0, y: 1, z: 0, yaw: 0 }, 5, 0, 1 / 60, {
			fx: DR.FX.BOOST | DR.FX.SHIELD | DR.FX.SPIN | DR.FX.AIR,
			groundY: 0,
		})
		assert.ok(vis() > base + 4, 'flames, bubble, stars')
		let shadow = null
		car.group.traverse((o) => o.isMesh && o.material?.map && o.renderOrder === 1 && (shadow = o))
		car.group.updateMatrixWorld(true)
		assert.ok(
			Math.abs(new THREE.Vector3().setFromMatrixPosition(shadow.matrixWorld).y - 0.006) < 0.01,
			'shadow on the ground'
		)
		car.update({ x: 0, y: 0, z: 0, yaw: 0 }, 5, 0, 1 / 60, { fx: DR.FX.DRIFT, stage: 2, squash: 1 })
		assert.ok(car.group.children[0].scale.y < 0.7, 'squash')
		car.dispose()
	})
})

/* §2.7: the server generator's whole-room tracks over the furnished hall (tools/smoke/lib/rc-client-fixtures.js) */
describe('WO-1074 §2.7 decks: mesh, minimap, chase camera', () => {
	const deck = (key) => {
		const D = F.deckTracks()
		const T = TM.prepareTrack(D[key])
		return { D, T, env: PH.createEnv(T, D.floors, D.obstacles) }
	}
	const bridgeOf = (T) => {
		for (let i = 0; i < T.n; i++)
			for (let j = 0; j < T.n; j++)
				if (Math.abs(i - j) > 10 && Math.hypot(T.pts[i][0] - T.pts[j][0], T.pts[i][1] - T.pts[j][1]) < 0.5 && T.ys[i] - T.ys[j] > 1)
					return { up: i, lo: j, x: T.pts[i][0], z: T.pts[i][1] }
		return null
	}

	it('deck mesh headless: slab, pillars, rails — no NaN, nothing under the floor, nothing inside a table', () => {
		for (const key of ['over', 'sky']) {
			const { D, T, env } = deck(key)
			assert.ok(T.decks.length >= 2 && T.segDeck.some(Boolean), `${key}: decks prepared`)
			const g = MESH.buildTrackMesh(T, env.ground)
			const s = geometryStats(g)
			assert.equal(s.nonFinite, 0, key)
			assert.ok(s.minY >= -1e-6 && s.minY < 0.01, `${key}: pillars stand on the hall floor (min y ${s.minY})`)
			const plain = MESH.buildTrackMesh(TM.prepareTrack({ ...D[key], decks: [] }), env.ground)
			assert.ok(s.verts > geometryStats(plain).verts + T.n * 12, `${key}: slab + rails + pillars added (${s.verts})`)
			/* pillar faces: thin (≤ 0.25 m in plan) and tall triangles — none may stand in a table or the backline */
			let pillarTris = 0
			let inside = 0
			let top = -Infinity
			g.traverse((o) => {
				const p = o.geometry?.attributes?.position
				if (!p || o.parent?.name === 'track-deco') return
				for (let i = 0; i < p.count; i += 3) {
					const v = [0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)])
					const ext = (a) => Math.max(...v.map((q) => q[a])) - Math.min(...v.map((q) => q[a]))
					top = Math.max(top, ...v.map((q) => q[1]))
					if (ext(0) > 0.25 || ext(2) > 0.25 || ext(1) < 0.3) continue
					pillarTris++
					const x = v.reduce((a, q) => a + q[0], 0) / 3
					const z = v.reduce((a, q) => a + q[2], 0) / 3
					const y0 = Math.min(...v.map((q) => q[1]))
					const y1 = Math.max(...v.map((q) => q[1]))
					for (const b of env.boxes) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y1 > b.y0 + 0.05 && y0 < b.y1 - 0.05) inside++
				}
			})
			assert.ok(pillarTris >= 8 * 4 * 2, `${key}: pillars drawn (${pillarTris} faces)`)
			assert.equal(inside, 0, `${key}: no pillar inside a table / the backline`)
			assert.ok(top <= Math.max(...T.ys) + 0.3, `${key}: rails are low (top ${top})`)
			MESH.disposeGroup(g)
			MESH.disposeGroup(plain)
		}
	})

	it('minimap: decks in the deck colour, the upper ribbon of the bridge drawn after the lower one', () => {
		const { T } = deck('over')
		const b = bridgeOf(T)
		const strokes = []
		let from = null
		const ctx = new Proxy(
			{},
			{
				get: (t, k) => {
					if (k in t) return t[k]
					if (k === 'moveTo') return (x, y) => (from = [x, y])
					if (k === 'stroke') return () => strokes.push({ style: t.strokeStyle, from })
					return () => {}
				},
				set: (t, k, v) => ((t[k] = v), true),
			}
		)
		const tf = DRAW.drawTrack(ctx, T, 300, 400)
		const at = (i) => strokes.findLastIndex((st) => st.style === DRAW.DECK_COLOR && st.from && Math.hypot(st.from[0] - tf.map(...T.pts[i])[0], st.from[1] - tf.map(...T.pts[i])[1]) < 1e-6)
		assert.ok(strokes.filter((st) => st.style === DRAW.DECK_COLOR).length > 20, 'deck segments in the deck colour')
		assert.ok(at(b.lo) >= 0 && at(b.up) > at(b.lo), `upper over lower (${at(b.up)} > ${at(b.lo)})`)
		assert.equal(DRAW.segKind(T, b.up), 'deck')
	})

	it('chase + spectator cameras under the bridge stay under the slab; on the bridge they are free', () => {
		const { T, env } = deck('over')
		const b = bridgeOf(T)
		const ceil = (x, z, y) => PH.ceilingOf(env, x, z, y)
		const under = T.ys[b.up] - GR.DECK_SLAB
		for (const [k, y] of [
			[b.lo, T.ys[b.lo]],
			[b.up, T.ys[b.up]],
		]) {
			const t = T.tangents[k]
			const car = { x: T.pts[k][0], y, z: T.pts[k][1], yaw: Math.atan2(-t[0], -t[1]) }
			const w = CAM.chaseTarget(car, 18, ceil)
			assert.ok(w.eye.every(Number.isFinite))
			if (k === b.lo) {
				assert.ok(w.eye[1] <= under - CAM.CEIL_GAP + 1e-9 && w.eye[1] >= y + 0.35 - 1e-9, `under: eye ${w.eye[1]} vs slab ${under}`)
				/* lagging from a high eye (coming off a ramp): smoothCam never lifts it into the slab */
				const cur = { eye: [w.eye[0], y + 3, w.eye[2]], target: w.target }
				assert.ok(CAM.smoothCam(cur, w, 1 / 60).eye[1] <= w.eyeMax + 1e-9)
				/* the spectator's TV angle (higher than the chase cam) stays under it too */
				const d = new CAM.Director()
				d.ceilAt = ceil
				Object.assign(d, { shot: 'leader', carId: 'a', until: 1e9 })
				const tv = d.update(1, 1 / 60, T, ['a'], () => ({ ...car, v: 18 }))
				assert.ok(tv.eye[1] <= under - CAM.CEIL_GAP + 1e-9, `director eye ${tv.eye[1]} under the slab ${under}`)
			} else {
				assert.equal(w.eyeMax, Infinity, 'nothing over the upper deck')
				assert.ok(w.eye[1] > y + 1.2)
			}
		}
	})
})
