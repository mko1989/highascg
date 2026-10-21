'use strict'

/**
 * WO-615 T6 — the programmer's server half: gdtf-features.js (what a typed fixture can set: dimmer, colour mixing /
 * wheel slots with sRGB, CTO, pan / tilt / zoom ranges, gobo slots with media) and "point at" (aimValues through
 * follow-ik.js, written as physical Pan / Tilt that the previs decode reads back as the IK angles), plus the
 * /api/fixtures/program/features + /aim routes. Fixture: tools/fixtures/gdtf/test-spot.xml (synthetic).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { features, aimValues } = require('../../src/fixtures/gdtf-features')
const { buildRig } = require('../../src/fixtures/gdtf-rig')
const { compileVisual, decodeVisual } = require('../../src/fixtures/gdtf-visual')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { beam } = require('../../src/fixtures/follow-ik')
const { RouteRegistry } = require('../../src/api/route-registry')
const { register } = require('../../src/api/routes-fixture-dmx')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const TYPE = 'cccccccccccc'
let _type = null
async function type() {
	if (!_type) _type = await parseDescription(XML, ['description.xml'])
	return _type
}
async function engineWith(patch) {
	const t = await type()
	const e = new FollowEngine({ hub: { list: () => [], now: () => 0 }, send: () => {},
		resolveMode: (id, name) => (id === TYPE ? t.modes.find((x) => x.name === name) : null) })
	e.configure({ patch: patch.map((p) => ({ typeId: TYPE, mode: 'Standard', protocol: 'sacn', universe: 3, ...p })) })
	return { t, e }
}

test('features: dimmer, pan / tilt ranges, colour-wheel slots in sRGB; the pixel bar mixes ColorAdd_R', async () => {
	const { t, e } = await engineWith([{ id: 'spot', address: 1 }])
	const f = features(e.fixtures[0], t.wheels)
	assert.strictEqual(f.dimmer, true)
	assert.deepStrictEqual(f.pan, { from: -270, to: 270, at: 0 }, 'default 32768/2 = centre')
	assert.deepStrictEqual(f.tilt, { from: 135, to: -135, at: 0 })
	assert.deepStrictEqual(f.colors.map((c) => [c.attr, c.name]), [['Color1', 'Open'], ['Color1', 'Red'], ['Color1', 'Gobo']])
	assert.deepStrictEqual(f.colors[1].rgb.map((v) => Math.round(v * 10) / 10), [1, 0, 0], 'the Red slot (x .64 y .33) is red')
	assert.deepStrictEqual(f.colors[2].rgb, [1, 1, 1], 'a slot without colour is white')
	assert.deepStrictEqual([f.add, f.sub, f.gobos, f.zoom, f.cto], [[], [], [], undefined, undefined])
	const bar = await engineWith([{ id: 'bar', mode: 'Pixels', address: 1 }])
	const fb = features(bar.e.fixtures[0], bar.t.wheels)
	assert.deepStrictEqual([fb.dimmer, fb.add, fb.pan], [true, ['ColorAdd_R'], undefined])
})

test('features: gobo slots carry their media, CTO / zoom / CMY from a hand-built mode', () => {
	const ch = (attribute, extra = {}) => ({ initial: 0, functions: [{ attribute, physFrom: 0, physTo: 1, from: 0, to: 255, default: 0,
		sets: [], ...extra }] })
	const fx = { gdtf: { channels: [
		ch('Zoom', { physFrom: 5, physTo: 50, default: 127.5 }), ch('CTO', { physFrom: 6500, physTo: 2700 }), ch('ColorSub_C'), ch('ColorSub_M'),
		ch('Gobo1', { wheel: 'G1', sets: [{ name: 'Open', slot: 1 }, { name: 'Dots', slot: 2 }, { name: 'Dots shake', slot: 2 }, { name: '', slot: 3 }] }),
	] } }
	const f = features(fx, { G1: [{ name: 'Open', media: '' }, { name: 'Dots', media: '1234' }, { name: 'X', media: 'x' }] })
	assert.deepStrictEqual(f.zoom, { from: 5, to: 50, at: 27.5 }, 'at = the default DMX value, physical')
	assert.deepStrictEqual(f.cto, { attr: 'CTO', from: 6500, to: 2700, at: 6500 })
	assert.deepStrictEqual(f.sub, ['ColorSub_C', 'ColorSub_M'])
	assert.deepStrictEqual(f.gobos, [{ attr: 'Gobo1', name: 'Open', media: '' }, { attr: 'Gobo1', name: 'Dots', media: '1234' }],
		'one entry per slot, unnamed sets skipped')
})

test('aim: physical Pan / Tilt that the previs decode reads back as the IK angles, nearest the current pan', async () => {
	const { t, e } = await engineWith([{ id: 'spot', address: 1, pose: { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 } }])
	const fx = e.fixtures[0]
	const pt = aimValues(fx, [0, 3, 0], {})
	assert.deepStrictEqual(pt, { Pan: 0, Tilt: 26.57 }, 'hung at 6 m, a point 3 m upstage: positive tilt, no pan')
	const side = aimValues(fx, [3, 0, 0], {})
	const dir = beam(fx.pose, 0, 0)
	assert.deepStrictEqual(dir.map((v) => Math.round(v)), [0, 0, -1], 'tilt 0 hangs straight down')
	// Stage left from a hung head is a ±90° pan (follow-ik's mirrored g); +90 then −tilt is the same beam as −90 +tilt.
	assert.strictEqual(Math.abs(side.Pan), 90)
	const near = aimValues(fx, [3, 0, 0], { Pan: 85, Tilt: -10 })
	assert.ok(Math.abs(near.Pan - 85) < Math.abs(near.Pan + 85), 'the solution nearest the current pan wins')
	e.program(['spot'], pt)
	e.tick()
	const m = t.modes.find((x) => x.name === 'Standard')
	const v = decodeVisual(compileVisual(t, m, buildRig(t, m)), e.frameOf(fx), fx.address)
	assert.ok(Math.abs(v.axes.Head - 26.57) < 0.05, `decoded tilt ${v.axes.Head}`)
	assert.ok(Math.abs(v.axes.Yoke) < 0.05, `decoded pan ${v.axes.Yoke}`)
	const flipped = (await engineWith([{ id: 's2', address: 1, tilt: { invert: true }, pose: { x: 0, y: 0, z: 6 } }])).e.fixtures[0]
	assert.strictEqual(aimValues(flipped, [0, 3, 0], {}).Tilt, -26.57, 'a flipped (reverse-mounted) head gets the mirror value')
	assert.strictEqual(aimValues({ gdtf: { channels: [] } }, [0, 0, 0], {}), null, 'no pan / tilt → null')
})

test('routes: /program/features and /program/aim (validation, service passthrough)', async () => {
	const calls = []
	const svc = { engine: {}, features: (ids) => ({ ids }), aim: (ids, target) => (calls.push([ids, target]), { aimed: ids, unreachable: [] }) }
	const routes = new RouteRegistry()
	register(routes)
	const ctx = { fixtureService: svc }
	const go = (m, p, body, query = {}) => routes.dispatch(m, p, body ? JSON.stringify(body) : '', ctx, undefined, query)
	const f = await go('GET', '/api/fixtures/program/features', null, { ids: 'a,b' })
	assert.deepStrictEqual(JSON.parse(f.body), { fixtures: { ids: ['a', 'b'] } })
	assert.deepStrictEqual(JSON.parse((await go('GET', '/api/fixtures/program/features')).body), { fixtures: { ids: null } })
	assert.strictEqual((await go('POST', '/api/fixtures/program/aim', { ids: ['a'] })).status, 400)
	assert.strictEqual((await go('POST', '/api/fixtures/program/aim', { target: [0, 0, 0] })).status, 400)
	assert.strictEqual((await go('POST', '/api/fixtures/program/aim', { ids: ['a'], target: [0, 'x', 0] })).status, 400)
	const ok = await go('POST', '/api/fixtures/program/aim', { ids: ['a'], target: [1, 2, 0] })
	assert.deepStrictEqual([ok.status, JSON.parse(ok.body).aimed, calls], [200, ['a'], [[['a'], [1, 2, 0]]]])
	assert.strictEqual((await routes.dispatch('GET', '/api/fixtures/program/features', '', {}, undefined, {})).status, 503)
})
