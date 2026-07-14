/**
 * WO-156 — route self-loop guard smokes.
 * Validator units, take-path rejection (400), multiview-apply cell skip, and wiring checks
 * for the other PLAY paths (host-operator-fullscreen, routing-setup switcher bus).
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	findSelfRouteViolation,
	findSceneSelfRouteViolation,
	assertSceneHasNoSelfRoutes,
	findCrossChannelRouteCycles,
} = require('../../src/engine/scene-route-deps')

test('validator: whole-channel self-route rejected (route://3 → ch3)', () => {
	const v = findSelfRouteViolation('route://3', 3)
	assert.ok(v)
	assert.equal(v.channel, 3)
	assert.equal(v.layer, null)
	assert.match(v.reason, /into itself/)
})

test('validator: same-channel layer route rejected without exemption (route://3-11 → ch3)', () => {
	const v = findSelfRouteViolation('route://3-11', 3)
	assert.ok(v)
	assert.equal(v.layer, 11)
})

test('validator: cross-channel routes allowed (route://2 → ch3, route://2-5 → ch3)', () => {
	assert.equal(findSelfRouteViolation('route://2', 3), null)
	assert.equal(findSelfRouteViolation('route://2-5', 3), null)
})

test('validator: non-route sources and bad channels never violate', () => {
	assert.equal(findSelfRouteViolation('clip.mp4', 3), null)
	assert.equal(findSelfRouteViolation('', 3), null)
	assert.equal(findSelfRouteViolation('route://3', 0), null)
	assert.equal(findSelfRouteViolation('route://3', NaN), null)
})

test('validator: intra-look same-channel layer routes exempt via allowSameChannelLayers', () => {
	const allow = new Set([10])
	assert.equal(findSelfRouteViolation('route://3-10', 3, { allowSameChannelLayers: allow }), null)
	assert.ok(findSelfRouteViolation('route://3-11', 3, { allowSameChannelLayers: allow }))
	assert.ok(findSelfRouteViolation('route://3', 3, { allowSameChannelLayers: allow }))
})

test('scene validator: intra-look routes pass, whole-channel self-route caught', () => {
	const intraLook = {
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'a.mp4' } },
			{ layerNumber: 20, source: { type: 'route', value: 'route://3-10' } },
		],
	}
	assert.equal(findSceneSelfRouteViolation(intraLook, 3), null)

	const wedge = {
		layers: [
			{ layerNumber: 10, source: { type: 'route', value: 'route://3' } },
		],
	}
	const found = findSceneSelfRouteViolation(wedge, 3)
	assert.ok(found)
	assert.equal(found.layerNumber, 10)
	assert.throws(() => assertSceneHasNoSelfRoutes(wedge, 3), (e) => e.statusCode === 400 && /route:\/\/3/.test(e.message))
	// Same scene onto another channel is fine.
	assert.equal(findSceneSelfRouteViolation(wedge, 4), null)
})

test('cycle detector: 2-hop cross-channel cycle reported (warn-only)', () => {
	const scene = { layers: [{ layerNumber: 10, source: { value: 'route://2' } }] }
	const liveByCh = { 2: { layers: [{ layerNumber: 10, source: { value: 'route://1' } }] } }
	assert.deepEqual(findCrossChannelRouteCycles(scene, 1, (ch) => liveByCh[ch] || null), [2])
	assert.deepEqual(findCrossChannelRouteCycles(scene, 5, (ch) => liveByCh[ch] || null), [])
})

test('take path: self-route take rejected with 400 naming layer + route', async () => {
	const { handleSceneTake } = require('../../src/api/routes-scene-take')
	const logs = []
	const ctx = {
		config: {},
		amcp: {},
		log: (level, msg) => logs.push([level, msg]),
	}
	const res = await handleSceneTake(
		{
			channel: 99,
			forceCut: true,
			incomingScene: {
				id: 'look_selfroute',
				layers: [{ layerNumber: 10, source: { type: 'route', value: 'route://99' } }],
			},
		},
		ctx,
	)
	assert.equal(res.status, 400)
	const body = JSON.parse(res.body)
	assert.match(body.error, /route:\/\/99/)
	assert.match(body.error, /layer 10/i)
	assert.match(body.error, /channel 99/)
})

test('multiview apply: self-route cell skipped with warning, other cells still play', async () => {
	const { applyMultiviewLayout } = require('../../src/engine/multiview-apply')
	// virtual mains: pgm=1 prv=2; one multiview destination → mv channel 3.
	const config = {
		virtual_main_channels: [{ pgm: 1, prv: 2 }],
		screenDestinations: { destinations: [{ id: 'mv1', mode: 'multiview' }] },
	}
	const calls = []
	const stub = (name) => async (...args) => {
		calls.push([name, ...args])
		return { data: '' }
	}
	const logs = []
	const ctx = {
		config,
		_ledTestPatternActive: true,
		log: (level, msg) => logs.push([level, msg]),
		amcp: {
			play: stub('play'),
			mixerFill: stub('mixerFill'),
			mixerCommit: stub('mixerCommit'),
			cgAdd: stub('cgAdd'),
			cgUpdate: stub('cgUpdate'),
			cgClear: stub('cgClear'),
			stop: stub('stop'),
			raw: stub('raw'),
			clear: stub('clear'),
			info: stub('info'),
		},
	}
	const body = {
		n: 1,
		showOverlay: false,
		layout: [
			{ id: 'bad', label: 'MV self', x: 0, y: 0, w: 0.5, h: 0.5, source: 'route://3', aspectLocked: false },
			{ id: 'ok', label: 'PGM 1', x: 0.5, y: 0, w: 0.5, h: 0.5, source: 'route://1', aspectLocked: false },
		],
	}
	const res = await applyMultiviewLayout(body, ctx, { infoXml: '<channel><stage></stage></channel>' })
	assert.equal(res.ok, true)
	assert.equal(res.channel, 3)

	const plays = calls.filter((c) => c[0] === 'play')
	assert.ok(!plays.some((c) => String(c[3]).includes('route://3')), 'self-route must not be played')
	assert.ok(plays.some((c) => c[1] === 3 && c[2] === 12 && c[3] === 'route://1'), 'valid cell keeps its layer slot')
	assert.ok(
		logs.some(([level, msg]) => level === 'warn' && /skipped cell/.test(msg) && /route:\/\/3/.test(msg)),
		'skip must be logged as a warning',
	)
})

test('wiring: remaining PLAY paths call the self-route validator', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8')
	assert.match(read('src/api/host-operator-fullscreen.js'), /findSelfRouteViolation/)
	assert.match(read('src/config/routing-setup.js'), /findSelfRouteViolation/)
	assert.match(read('src/engine/scene-take-lbg.js'), /assertSceneHasNoSelfRoutes/)
	assert.match(read('src/engine/multiview-apply.js'), /findSelfRouteViolation/)
})
