'use strict'

/**
 * WO-1089 Stage Salad — the presenter avatar twin in the browser (modules/stage-salad/client/avatar-spec.js pure, and
 * avatar-model.js built with the repo's three.js in node; the figure = avatar-body.js MESH, itself the twin of
 * godot/client/features/previs/tracking/person_avatar*.gd, WO-1086):
 *  - figureSpec: scale = height / 1.02 (UNIT_TOP); every MESH part present (limbs once per pivot, the smile as a tube
 *    with two round ends); colours from lookFrom (neutral clay without traits; top / bottom / skin / hair from the
 *    traits; shoes = bottom darkened 0.55; blush mixed towards pink), the look materials glow at SELF_LIGHT, the glint
 *    is unlit; raw traits / null are accepted (run through lookFrom);
 *  - motion maths as person_avatar.gd: stride (swing ±0.5, bob ≤ 0.025 at full walk, nothing below 0.35 m/s), the
 *    phase rate, breathing ±0.6 %, limb angles (Basis(RIGHT, swing)·Basis(BACK, out): arm_l / leg_r swing +, arms out
 *    ±0.12 rad);
 *  - the three.js model: a capsule per `cap` part (CapsuleGeometry(r, h − 2r) = Godot's total height), one mesh per
 *    part, the root scaled height / 1.02 at the pose, hair groups by hair_len, a duck sinks the upper body and squats
 *    the legs, alpha fades every material, setLook recolours in place, dispose frees the materials.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const DIR = path.join(__dirname, '..', '..', 'modules', 'stage-salad', 'client')
const load = (f) => import(pathToFileURL(path.join(DIR, f)).href)
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
const nearV = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => near(v, b[i], eps))

let SP, B, M, THREE

before(async () => {
	SP = await load('avatar-spec.js')
	B = await load('avatar-body.js')
	THREE = await import('three')
	// makeTag paints on a canvas: a minimal 2D context is enough in node
	globalThis.document = {
		createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) }) }),
	}
	M = await load('avatar-model.js')
})

const TRAITS = { top: [110, 60, 150], bottom: [200, 40, 44], skin: [128, 86, 58], hair: [25, 22, 22], hair_len: 'long' }

describe('WO-1089 Salad client: avatar figure (pure)', () => {
	it('scale = height / 1.02; every MESH part, limbs per pivot, the smile as a tube + 2 round ends', () => {
		for (const h of [1.2, 1.75, 2.2]) assert.ok(near(SP.figureSpec(B.lookFrom(null), h).scale, h / 1.02))
		const spec = SP.figureSpec(B.lookFrom(TRAITS), 1.75)
		const pivots = Object.keys(B.MESH.pivots)
		const limbParts = pivots.reduce((n, p) => n + B.MESH.limbs[p.startsWith('leg') ? 'leg' : 'arm'].length, 0)
		const bodyParts = B.MESH.body.reduce((n, p) => n + (p.kind === 'smile' ? 3 : 1), 0)
		assert.equal(spec.parts.length, limbParts + bodyParts)
		for (const pv of pivots) {
			const ps = spec.parts.filter((p) => p.pivot === pv)
			assert.ok(ps.length > 0, pv)
			assert.deepEqual(ps[0].pivotAt, B.MESH.pivots[pv])
			assert.equal(ps[0].group, pv.startsWith('leg') ? 'legs' : 'upper')
		}
		const tube = spec.parts.find((p) => p.kind === 'tube')
		assert.equal(tube.path.length, SP.SMILE_SEGS + 1)
		assert.ok(nearV(tube.path[0], B.smilePoint(B.SMILE.from)))
		assert.ok(nearV(tube.path.at(-1), B.smilePoint(B.SMILE.to)))
		assert.equal(tube.r, B.SMILE.tube)
		assert.equal(spec.parts.filter((p) => p.mat === 'mouth' && p.kind === 'ball').length, 2)
		assert.equal(spec.parts.filter((p) => p.group === 'hair_short').length, 2)
		assert.equal(spec.parts.filter((p) => p.group === 'hair_long').length, 1)
		assert.equal(spec.hair, 'long')
		const shoe = spec.parts.find((p) => p.mat === 'shoes')
		assert.deepEqual(shoe.at, B.MESH.limbs.leg.find((p) => p.mat === 'shoes').at, 'shoes where the shared MESH (Godot tree) puts them')
	})

	it('colours from lookFrom; the look materials glow at SELF_LIGHT; the glint is unlit; raw traits accepted', () => {
		const look = B.lookFrom(TRAITS)
		const spec = SP.figureSpec(look, 1.7)
		const col = (mat) => spec.parts.find((p) => p.mat === mat)
		for (const k of ['top', 'bottom', 'skin', 'hair']) assert.ok(nearV(col(k).color, TRAITS[k].map((c) => Math.round(c) / 255)), k)
		assert.ok(nearV(col('shoes').color, look.bottom.map((c) => c * 0.45)))
		assert.ok(nearV(col('blush').color, look.skin.map((c, i) => c + ([1, 0.45, 0.5][i] - c) * 0.45)))
		assert.ok(nearV(col('top').emissive, col('top').color.map((c) => c * B.SELF_LIGHT)))
		assert.deepEqual(col('eye').color, B.MESH.fixed.eye)
		assert.deepEqual(col('eye').emissive, [0, 0, 0])
		assert.equal(col('glint').unlit, true)
		const clay = SP.figureSpec(null, 1.75)
		assert.deepEqual(clay.parts.find((p) => p.mat === 'top').color, B.NEUTRAL.top, 'no traits = neutral clay')
		assert.equal(clay.hair, 'short')
		assert.deepEqual(SP.figureSpec(TRAITS, 1.75).parts.find((p) => p.mat === 'top').color, col('top').color, 'raw traits run through lookFrom')
	})

	it('motion maths as person_avatar.gd: stride, phase, breathing, limb angles', () => {
		assert.deepEqual(SP.stride(1, 0.2), [0, 0])
		const [sw, bob] = SP.stride(Math.PI / 2, 5)
		assert.ok(near(sw, 0.5) && near(bob, 0.025))
		const half = SP.stride(Math.PI / 2, (0.35 + SP.WALK_FULL) / 2)
		assert.ok(near(half[0], 0.25))
		assert.ok(near(SP.advancePhase(0, 1, 1.75 * 0.35, 1.75), Math.PI), 'one step per 0.35·h m')
		assert.ok(near(SP.advancePhase(0, 1, 0.1, 0.1), (0.1 / 0.1) * Math.PI), 'phase rate floor 0.1 m')
		assert.ok(near(SP.breath(Math.PI / 4.4), 1.006))
		assert.deepEqual(SP.limbAngles('arm_l', 0.3), [0.3, B.ARM_OUT])
		assert.deepEqual(SP.limbAngles('arm_r', 0.3), [-0.3, -B.ARM_OUT])
		assert.deepEqual(SP.limbAngles('leg_r', 0.3), [0.3, 0])
		assert.deepEqual(SP.limbAngles('leg_l', 0.3), [-0.3, 0])
		assert.ok(near(SP.blend(0.1, 9), 1 - Math.exp(-0.9)))
	})

	it('surface points sit on the drawn figure', () => {
		const h = SP.surfacePoint('head', [0, B.HEAD_Y, 1])
		assert.ok(near(Math.hypot(h.p[0], h.p[1] - B.HEAD_Y, h.p[2]), B.HEAD_R, 1e-9))
		const l = SP.surfacePoint('legs', [0.2, 0.1, 0])
		assert.ok(l.p[0] > 0.065 && l.p[1] <= B.HIP_Y)
		const pose = { x: 3, y: 0.6, z: -2, yaw: 0.7, height: 1.8 }
		const u = SP.toUnit(pose, [3, 0.6 + 1.8 / 1.02 * 0.5, -2])
		assert.ok(nearV(u, [0, 0.5, 0], 1e-9))
	})
})

describe('WO-1089 Salad client: avatar model (three.js in node)', () => {
	it('one mesh per part; capsules = Godot total height; scale and pose at the root', () => {
		const look = B.lookFrom(TRAITS)
		const spec = SP.figureSpec(look, 1.8)
		const av = M.createAvatarModel(THREE, { look, height: 1.8, label: 'Ann' })
		const meshes = []
		av.group.traverse((o) => o.isMesh && meshes.push(o))
		assert.equal(meshes.length, spec.parts.length)
		const caps = meshes.filter((m) => m.geometry.type === 'CapsuleGeometry')
		assert.equal(caps.length, spec.parts.filter((p) => p.kind === 'cap').length)
		for (const c of caps) {
			const { radius, height } = c.geometry.parameters
			assert.ok(spec.parts.some((p) => p.kind === 'cap' && near(p.r, radius, 1e-9) && near(p.h - 2 * p.r, height, 1e-9)), `capsule r ${radius} len ${height}`)
		}
		av.update({ x: 1, y: 0.639, z: 2, yaw: 0.4, height: 1.8, speed: 0 }, 0.016, 0)
		assert.ok(near(av.group.scale.x, 1.8 / 1.02))
		assert.ok(nearV(av.group.position.toArray(), [1, 0.639, 2]))
		assert.ok(near(av.group.rotation.y, 0.4))
		av.dispose()
	})

	it('hair by hair_len; duck sinks the upper body and squats the legs; alpha fades; setLook recolours in place', () => {
		const av = M.createAvatarModel(THREE, { look: B.lookFrom({ ...TRAITS, hair_len: 'bald' }), height: 1.75 })
		// the hair groups sit at the upper body's origin (the arm pivots at the shoulders)
		const hairGroups = av.upper.children.filter((c) => c.isGroup && c.position.lengthSq() === 0 && c.children.some((m) => m.isMesh))
		assert.equal(hairGroups.length, 2)
		assert.ok(hairGroups.every((g) => !g.visible), 'bald: no hair')
		av.setLook(B.lookFrom({ ...TRAITS, hair_len: 'long' }))
		assert.ok(hairGroups.every((g) => g.visible), 'long: both hair groups')
		av.setLook(B.lookFrom({ ...TRAITS, hair_len: 'short' }))
		assert.equal(hairGroups.filter((g) => g.visible).length, 1, 'short: the short hair only')
		for (let i = 0; i < 30; i++) av.update({ x: 0, y: 0, z: 0, yaw: 0, height: 1.75, duck: 1, alpha: 0.5 }, 0.016, i * 0.016)
		assert.ok(near(av.upper.position.y, -B.DUCK_DROP))
		const legPivots = av.legs.children
		assert.equal(legPivots.length, 2)
		for (const pv of legPivots) assert.ok(near(pv.scale.y, 1 - B.DUCK_DROP / B.HIP_Y))
		const mats = new Set()
		av.group.traverse((o) => o.isMesh && mats.add(o.material))
		for (const m of mats) assert.ok(near(m.opacity, 0.5), 'every material fades')
		const top = [...mats].find((m) => m.color.r > 0.15 && m.color.b > 0.25 && m.color.g < 0.12)
		assert.ok(top, 'the purple top')
		av.setLook(B.lookFrom({ top: [0, 255, 0] }))
		const after = new Set()
		av.group.traverse((o) => o.isMesh && after.add(o.material))
		assert.deepEqual([...after].length, [...mats].length, 'no new materials')
		assert.ok(near(top.color.g, 1, 1e-6), 'recoloured in place')
		let disposed = 0
		for (const m of mats) m.addEventListener('dispose', () => disposed++)
		av.dispose()
		assert.equal(disposed, mats.size)
		assert.equal(av.group.parent, null)
	})

	it('walking swings the limbs; standing settles them', () => {
		const av = M.createAvatarModel(THREE, { look: B.lookFrom(null), height: 1.75 })
		let maxSwing = 0
		for (let i = 0; i < 120; i++) {
			av.update({ x: 0, y: 0, z: 0, yaw: 0, height: 1.75, speed: 1.4 }, 1 / 60, i / 60)
			maxSwing = Math.max(maxSwing, ...av.legs.children.map((p) => Math.abs(p.rotation.x)))
		}
		assert.ok(maxSwing > 0.25 && maxSwing <= 0.5 + 1e-9, `swing ${maxSwing}`)
		for (let i = 0; i < 240; i++) av.update({ x: 0, y: 0, z: 0, yaw: 0, height: 1.75, speed: 0 }, 1 / 60, 2 + i / 60)
		for (const p of av.legs.children) assert.ok(Math.abs(p.rotation.x) < 1e-3)
		av.dispose()
	})
})
