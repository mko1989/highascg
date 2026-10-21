'use strict'

/**
 * WO-615 T8 — looks carry fixture states: fixture-looks.js (normalize, DMX-space crossfade: continuous channels
 * fade, wheels / discrete channels snap), the engine's fade(), recall (programmer becomes the stored state, unlisted
 * typed fixtures released), the PGM-take hook (scene-take-program-start.js: fade = look transition frames / channel
 * fps, cut snaps, a re-take of the on-air look or a PRV take leaves the rig alone) and /api/fixtures/looks[/recall].
 * Fixture: tools/fixtures/gdtf/test-spot.xml (synthetic).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { parseDescription } = require('../../src/fixtures/gdtf-parse')
const { FollowEngine } = require('../../src/fixtures/follow-engine')
const { cleanValue } = require('../../src/fixtures/gdtf-patch')
const { normalizeLooks, recallInto, fades } = require('../../src/fixtures/fixture-looks')
const { recallFixtureLook } = require('../../src/engine/scene-take-program-start')
const { RouteRegistry } = require('../../src/api/route-registry')
const { register, handleRecallLook } = require('../../src/api/routes-fixture-dmx')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const TYPE = 'cccccccccccc'

async function rig() {
	const t = await parseDescription(XML, ['description.xml'])
	let now = 1000
	const e = new FollowEngine({ hub: { list: () => [], now: () => 0 }, send: () => {}, now: () => now,
		resolveMode: (id, name) => (id === TYPE ? t.modes.find((x) => x.name === name) : null) })
	e.configure({ patch: ['a', 'b'].map((id, i) => ({ id, typeId: TYPE, mode: 'Standard', protocol: 'sacn', universe: 3, address: 1 + 20 * i })) })
	return { e, at: (ms) => (now = 1000 + ms), byte: (fx, off) => e.frameOf(e.fixtures[fx])[e.fixtures[fx].address - 2 + off] }
}

test('normalizeLooks: keeps cleaned values per look and fixture, drops junk', () => {
	const n = normalizeLooks({ L1: { values: { a: { Dimmer: 1, Pan: 'x', Color1: { set: 'Red' }, Tilt: null } } }, L2: { values: [] },
		L3: 'junk', L4: { values: { a: { Dimmer: { norm: 0.5 } }, b: 7 } } }, cleanValue)
	assert.deepStrictEqual(n, { L1: { values: { a: { Dimmer: 1, Color1: { set: 'Red' } } } }, L4: { values: { a: { Dimmer: { norm: 0.5 } } } } })
	assert.deepStrictEqual([normalizeLooks(null, cleanValue), normalizeLooks([1], cleanValue)], [{}, {}])
})

test('engine fade: dimmer and pan crossfade in DMX space, the colour wheel snaps, then the fade ends on target', async () => {
	const { e, at, byte } = await rig()
	e.program(['a'], { Dimmer: 0, Pan: 0 })
	e.tick()
	assert.deepStrictEqual([byte(0, 6), byte(0, 1), byte(0, 7)], [0, 128, 0], 'dark, pan centre, wheel open')
	const r = recallInto(e, { values: { a: { Dimmer: 1, Pan: 270, Color1: { set: 'Red' } } } }, 1000)
	assert.deepStrictEqual(r, { fixtures: 1, fade_ms: 1000 })
	at(500)
	e.tick()
	assert.ok(Math.abs(byte(0, 6) - 128) <= 1, `dimmer halfway (${byte(0, 6)})`)
	assert.ok(Math.abs(byte(0, 1) - 192) <= 1, `pan halfway centre → +270 (${byte(0, 1)})`)
	const red = e.fixtures[0].gdtf.channels.find((c) => c.attribute === 'Color1').functions[0].sets.find((s) => s.name === 'Red').from
	assert.strictEqual(byte(0, 7), red, 'wheel slot snapped at the start')
	at(1000)
	e.tick()
	assert.deepStrictEqual([byte(0, 6), byte(0, 1), e._fades.size], [255, 255, 0], 'on target, fade done')
	assert.deepStrictEqual(e.values(), { a: { Dimmer: 1, Pan: 270, Color1: { set: 'Red' } } }, 'the programmer holds the look')
})

test('recall: typed fixtures the look does not list are released (fade to their defaults); ms 0 snaps', async () => {
	const { e, byte } = await rig()
	e.program(['b'], { Dimmer: 1 })
	e.tick()
	assert.strictEqual(byte(1, 6), 255)
	recallInto(e, { values: { a: { Dimmer: 1 } } }, 0)
	e.tick()
	assert.deepStrictEqual([byte(0, 6), byte(1, 6), Object.keys(e.values())], [255, 0, ['a']])
})

test('fades(): same function and not a wheel / discrete family', async () => {
	const fn = (attribute, from, to, wheel = '') => ({ attribute, from, to, wheel })
	assert.strictEqual(fades({ functions: [fn('Dimmer', 0, 255)] }, 0, 255), true)
	assert.strictEqual(fades({ functions: [fn('Color1', 0, 255, 'C1')] }, 0, 40), false, 'wheel')
	assert.strictEqual(fades({ functions: [fn('Shutter1', 0, 31), fn('Shutter1Strobe', 32, 255)] }, 0, 10), false, 'discrete')
	assert.strictEqual(fades({ functions: [fn('Zoom', 0, 99), fn('ZoomMode', 100, 255)] }, 50, 150), false, 'crosses functions')
})

test('take hook: look transition frames / channel fps, cut snaps, re-take of the on-air look and PRV takes skip', () => {
	const calls = []
	const logs = []
	const ctx = { variables: { channel_1_framerate: '50' }, log: (lvl, m) => logs.push([lvl, m]),
		fixtureService: { recallLook: (id, ms) => (calls.push([id, ms]), id === 'none' ? null : { fixtures: 2, fade_ms: ms }) } }
	const inc = (id, duration = 25) => ({ id, defaultTransition: { type: 'MIX', duration, tween: 'linear' } })
	assert.deepStrictEqual(recallFixtureLook(ctx, { mainIdx: 0, inc: inc('L1'), channel: 1, previousId: 'L0' }), { fixtures: 2, fade_ms: 500 })
	recallFixtureLook(ctx, { mainIdx: 0, inc: inc('L2'), channel: 1, forceCut: true })
	recallFixtureLook(ctx, { mainIdx: 0, inc: { id: 'L3', defaultTransition: { type: 'CUT', duration: 0 } }, channel: 1 })
	recallFixtureLook(ctx, { mainIdx: 0, inc: inc('L4', 30), channel: 2, framerate: 25 })
	assert.deepStrictEqual(calls, [['L1', 500], ['L2', 0], ['L3', 0], ['L4', 1200]], '25 f @ 50 fps; cut; CUT; 30 f @ the 25 fps hint')
	assert.strictEqual(recallFixtureLook(ctx, { mainIdx: 0, inc: inc('L1'), channel: 1, previousId: 'L1' }), null, 're-take')
	assert.strictEqual(recallFixtureLook(ctx, { mainIdx: -1, inc: inc('L9'), channel: 2 }), null, 'not a program channel')
	assert.strictEqual(calls.length, 4)
	assert.strictEqual(recallFixtureLook({ log: () => {} }, { mainIdx: 0, inc: inc('L1'), channel: 1 }), null, 'no engine')
	const bad = { log: (l, m) => logs.push([l, m]), fixtureService: { recallLook: () => { throw new Error('boom') } } }
	assert.strictEqual(recallFixtureLook(bad, { mainIdx: 0, inc: inc('L1'), channel: 1 }), null, 'never fails a take')
	assert.ok(logs.some(([l, m]) => l === 'warn' && /boom/.test(m)))
	const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-scene-take.js'), 'utf8')
	assert.strictEqual((src.match(/programTakeStarted\(ctx, \{/g) || []).length, 2, 'both program paths call the hook')
})

test('routes: GET /api/fixtures/looks, POST /api/fixtures/looks/recall (400 / 404 / 200 / 503)', async () => {
	const seen = []
	const svc = { looks: () => ({ L1: { fixtures: 2 } }), recallLook: (id, ms) => (seen.push([id, ms]), id === 'L1' ? { fixtures: 2, fade_ms: ms } : null) }
	assert.strictEqual(handleRecallLook('{}', svc).status, 400)
	assert.strictEqual(handleRecallLook(JSON.stringify({ lookId: 'L9' }), svc).status, 404)
	const ok = handleRecallLook(JSON.stringify({ lookId: 'L1', fade_ms: 9e9 }), svc)
	assert.deepStrictEqual([ok.status, JSON.parse(ok.body)], [200, { fixtures: 2, fade_ms: 600000 }])
	const routes = new RouteRegistry()
	register(routes)
	const g = await routes.dispatch('GET', '/api/fixtures/looks', '', { fixtureService: svc }, null, {})
	assert.deepStrictEqual(JSON.parse(g.body), { looks: { L1: { fixtures: 2 } } })
	const p = await routes.dispatch('POST', '/api/fixtures/looks/recall', JSON.stringify({ lookId: 'L1' }), {}, null, {})
	assert.strictEqual(p.status, 503)
})
