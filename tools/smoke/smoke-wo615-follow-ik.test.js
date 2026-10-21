'use strict'

/**
 * WO-615 T9 — follow / point-at IK on the type's own GDTF Axis chain (gdtf-ik.js): chainOf picks root → beam under
 * a pan and a tilt axis; beamOf is the previs's forward kinematics (hung / floor / yaw); aimFixture's answer puts
 * the beam through the target with the head's real offsets (where the generic pivot-at-pose model misses), keeps the
 * nearest pan copy, honours the patch's flips and returns null out of range; the engine and Point at use it.
 * Fixture: tools/fixtures/gdtf/test-spot.xml (synthetic: yoke +0.2 m, tilt pivot −0.3 m, beam −0.2 m).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { buildRig } = require('../../src/fixtures/gdtf-rig')
const { chainOf, beamOf, aimFixture, axisFn, toPhys, fileAxis } = require('../../src/fixtures/gdtf-ik')
const { aim } = require('../../src/fixtures/follow-ik')
const { aimValues } = require('../../src/fixtures/gdtf-features')
const { FollowEngine } = require('../../src/fixtures/follow-engine')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const TYPE = 'cccccccccccc'

async function load() {
	const t = await parseDescription(XML, ['description.xml'])
	const resolveMode = (id, name) => {
		const m = id === TYPE ? t.modes.find((x) => x.name === name) : null
		return m ? { ...m, chain: chainOf(buildRig(t, m)) } : null
	}
	return { t, resolveMode }
}

async function engineWith(fixtures, marks = []) {
	const { resolveMode } = await load()
	const e = new FollowEngine({ hub: { list: () => marks, now: () => 0 }, send: () => {}, resolveMode })
	e.configure({ patch: fixtures.map((p) => ({ typeId: TYPE, mode: 'Standard', protocol: 'sacn', universe: 3, address: 1, ...p })) })
	return e
}

/** Distance (m) from the target to the beam ray of fx at commanded pt (geometric angles: a patch flip is the real head's). */
function miss(fx, pt, target) {
	const [pf, tf] = [axisFn(fx, 'Pan'), axisFn(fx, 'Tilt')]
	const p = toPhys(pf, fileAxis(pf, fx.pan), pt.pan)
	const t = toPhys(tf, fileAxis(tf, fx.tilt), pt.tilt)
	const { origin, dir } = beamOf(fx.gdtf.chain, fx.pose, p, t)
	const w = target.map((v, i) => v - origin[i])
	const along = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2]
	assert.ok(along > 0, 'the target is in front of the beam')
	return Math.hypot(...w.map((v, i) => v - along * dir[i]))
}

test('chainOf: root → yoke (pan) → head (tilt) → beam; none for the pixel bar', async () => {
	const { t } = await load()
	const c = chainOf(buildRig(t, t.modes.find((m) => m.name === 'Standard')))
	assert.deepStrictEqual(c.map((n) => n.axis), ['', 'pan', 'tilt', ''])
	assert.strictEqual(chainOf(buildRig(t, t.modes.find((m) => m.name === 'Pixels'))), null)
	assert.strictEqual(chainOf(null), null)
})

test('beamOf: the previs pose — hung points down from the beam node, floor points up, yaw turns pan 0', async () => {
	const { t } = await load()
	const c = chainOf(buildRig(t, t.modes.find((m) => m.name === 'Standard')))
	const r = (v) => v.map((x) => Math.round(x * 1000) / 1000 + 0)
	const hung = beamOf(c, { x: 1, y: 2, z: 6, hang: 'truss', yaw: 0 }, 0, 0)
	assert.deepStrictEqual([r(hung.origin), r(hung.dir)], [[1, 2, 5.7], [0, 0, -1]], '6 + 0.2 − 0.3 − 0.2')
	const floor = beamOf(c, { x: 0, y: 0, z: 0, hang: 'floor', yaw: 0 }, 0, 0)
	assert.deepStrictEqual([r(floor.origin), r(floor.dir)], [[0, 0, 0.3], [0, 0, 1]])
	assert.deepStrictEqual(r(beamOf(c, { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 }, 0, 30).dir), [0, 0.5, -0.866], 'tilt + swings upstage')
	assert.deepStrictEqual(r(beamOf(c, { x: 0, y: 0, z: 6, hang: 'truss', yaw: 90 }, 0, 30).dir), [0.5, 0, -0.866], 'yaw 90 → stage left')
})

test('aimFixture: the beam passes through the target (hung, floor, yaw, flipped tilt) — closer than the generic model', async () => {
	const poses = [
		{ x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 },
		{ x: -3, y: 4, z: 5, hang: 'truss', yaw: 30 },
		{ x: 2, y: -1, z: 0, hang: 'floor', yaw: 90 },
	]
	const targets = [[0, 3, 0], [2, 1, 1.5], [-1, 6, 0.5], [0.5, 0.3, 4]]
	let generic = 0
	for (const [i, pose] of poses.entries()) {
		const e = await engineWith([{ id: 'h', pose, tilt: { invert: i === 1 } }])
		const fx = e.fixtures[0]
		assert.ok(fx.gdtf.chain, 'the resolver attached the chain')
		for (const target of targets) {
			const pt = aimFixture(fx, target, { pan: 0, tilt: 0 })
			if (!pt) continue
			assert.ok(miss(fx, pt, target) < 0.01, `pose ${i} → ${target}: ${miss(fx, pt, target)} m`)
			const g = aim(fx, target, { pan: 0, tilt: 0 })
			if (g) generic = Math.max(generic, miss(fx, g, target))
		}
	}
	assert.ok(generic > 0.05, `the pivot-at-pose model misses by up to ${generic.toFixed(3)} m here`)
})

test('aimFixture: nearest pan copy to the previous aim; out of the tilt range → null', async () => {
	const e = await engineWith([{ id: 'h', pose: { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 } }])
	const fx = e.fixtures[0]
	const target = [2.6, -1.5, 0] // downstage right of a hung head: pan ≈ −120 with tilt +, or ≈ 60 with tilt −
	const a = aimFixture(fx, target, { pan: -110, tilt: 30 })
	assert.ok(a.pan < -90, `a pan with a +360 copy inside ±270 (${a.pan})`)
	const b = aimFixture(fx, target, { pan: a.pan + 350, tilt: a.tilt })
	assert.ok(Math.abs(b.pan - (a.pan + 360)) < 0.05 && Math.abs(b.tilt - a.tilt) < 0.05, 'the +360 copy')
	assert.ok(miss(fx, b, target) < 0.01)
	const c = aimFixture(fx, target, { pan: a.pan + 180, tilt: -a.tilt })
	assert.ok(Math.abs(c.pan - (a.pan + 180)) < 3 && Math.abs(c.tilt + a.tilt) < 3, 'from the flipped side: the flipped branch')
	assert.ok(miss(fx, c, target) < 0.01)
	assert.strictEqual(aimFixture(fx, [0, 0.1, 9], { pan: 0, tilt: 0 }), null, 'straight up from a hung head (tilt ±135)')
})

test('engine follow and Point at both solve on the chain', async () => {
	const pose = { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 }
	const e = await engineWith([{ id: 'h', pose, follow: 7, aim_z: 0 }], [{ id: 7, x: 1, y: 1.5, z: 0, status: 1 }])
	e.tick()
	const fx = e.fixtures[0]
	const a = e.aimOf('h')
	assert.strictEqual(a.state, 'following')
	assert.ok(miss(fx, a, [1, 1.5, 0]) < 0.01, 'following lands on the marker')
	const v = aimValues(fx, [1, 1.5, 0], {})
	const { origin, dir } = beamOf(fx.gdtf.chain, pose, v.Pan, v.Tilt)
	const k = -origin[2] / dir[2]
	assert.ok(Math.hypot(origin[0] + k * dir[0] - 1, origin[1] + k * dir[1] - 1.5) < 0.02, 'Point at lands on the floor point')
})
