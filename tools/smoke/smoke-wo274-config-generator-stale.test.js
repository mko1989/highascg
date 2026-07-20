'use strict'

/**
 * WO-274 / WO-275 — the config generator must not carry stale state forward.
 *
 * WO-274: cabling a non-main destination (multiview / stream / operator_gui) must not inflate the
 * PGM/PRV screen count. `resolveMainScreenCount` filters those modes out of `routableDests`, but
 * `inferGraphMainUsage` used to re-admit them through `Math.max(..., graphMainUsage.maxMainCount)`,
 * so merely drawing the cable spawned a phantom PGM+PRV channel pair for a screen index with no
 * PGM/PRV destination behind it.
 *
 * WO-275: the flat config is seeded from the persisted `casparServer` blob and the DeckLink
 * projection is additive, so re-cabling a physical DeckLink to a different destination left the
 * previous `screen_N_decklink_device` in place and the generator emitted two `<decklink>` consumers
 * on the same device.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { resolveMainScreenCount } = require('../../src/config/routing')

/**
 * @param {{ destinations: any[], connectors: any[], edges: any[], caspar?: Record<string, unknown> }} spec
 */
function buildApp(spec) {
	const app = JSON.parse(JSON.stringify(defaults))
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		multiview_enabled: true,
		decklink_input_count: 0,
		live_audio_input_count: 0,
		...(spec.caspar || {}),
	}
	app.streamingChannel = { enabled: false }
	app.rtmp = { enabled: false }
	app.screenDestinations = { version: 1, destinations: spec.destinations, edidNotes: '' }
	app.deviceGraph = { version: 1, devices: [], connectors: spec.connectors, edges: spec.edges }
	return app
}

/** @param {string} id @param {string} mode @param {number} main */
function dest(id, mode, main) {
	return {
		id,
		label: id.toUpperCase(),
		mode,
		mainScreenIndex: main,
		videoMode: '1080p5000',
		width: 1920,
		height: 1080,
		fps: 50,
	}
}

/** Channel role comments the generator emits, e.g. 'Screen 2 preview output (PRV)'. */
function channelRoles(xml) {
	return [...xml.matchAll(/<!-- HighAsCG: Caspar channel \d+: ([^\n]*?) -->/g)].map((m) => m[1])
}

test('WO-274: cabling a multiview destination does not spawn a phantom PGM/PRV pair', () => {
	const destinations = [dest('m1', 'pgm_prv', 0), dest('mv', 'multiview', 1)]
	const connectors = [
		{ id: 'dst_in_m1', kind: 'destination_in', externalRef: 'm1' },
		{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
		{ id: 'gpu_p0', kind: 'gpu_out' },
		{ id: 'dl3', kind: 'decklink_io', externalRef: '3', caspar: { ioDirection: 'out' } },
	]
	// Control: multiview destination present but NOT cabled.
	const unwired = buildApp({
		destinations,
		connectors,
		edges: [{ id: 'e1', sourceId: 'dst_in_m1', sinkId: 'gpu_p0' }],
	})
	// Subject: identical, except the multiview destination is cabled to DeckLink 3.
	const wired = buildApp({
		destinations,
		connectors,
		edges: [
			{ id: 'e1', sourceId: 'dst_in_m1', sinkId: 'gpu_p0' },
			{ id: 'e2', sourceId: 'dst_in_mv', sinkId: 'dl3' },
		],
	})

	assert.equal(resolveMainScreenCount(unwired), 1)
	assert.equal(resolveMainScreenCount(wired), 1, 'cabling a multiview dest must not add a PGM/PRV main')

	const wiredRoles = channelRoles(buildConfigXml(buildCasparGeneratorFlatConfig(wired)))
	assert.deepEqual(
		wiredRoles,
		channelRoles(buildConfigXml(buildCasparGeneratorFlatConfig(unwired))),
		'wired and unwired graphs must produce the same channel roles',
	)
	assert.ok(
		!wiredRoles.some((r) => /Screen 2/.test(r)),
		`no Screen 2 channel should exist, got: ${JSON.stringify(wiredRoles)}`,
	)
})

test('WO-274: cabling an operator_gui destination does not spawn a phantom PGM/PRV pair', () => {
	const app = buildApp({
		destinations: [dest('m1', 'pgm_prv', 0), dest('og', 'operator_gui', 1)],
		connectors: [
			{ id: 'dst_in_m1', kind: 'destination_in', externalRef: 'm1' },
			{ id: 'dst_in_og', kind: 'destination_in', externalRef: 'og' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
			{ id: 'gpu_p2', kind: 'gpu_out' },
		],
		edges: [
			{ id: 'e1', sourceId: 'dst_in_m1', sinkId: 'gpu_p0' },
			{ id: 'e2', sourceId: 'dst_in_og', sinkId: 'gpu_p2' },
		],
	})
	assert.equal(resolveMainScreenCount(app), 1)
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_count, 1, 'operator_gui must not inflate merged.screen_count either')
	const roles = channelRoles(buildConfigXml(flat))
	assert.ok(!roles.some((r) => /Screen 2/.test(r)), `got: ${JSON.stringify(roles)}`)
	assert.ok(roles.some((r) => /Operator GUI channel/.test(r)), 'operator GUI channel is still allocated')
})

test('WO-274: a real second pgm_prv destination still gets its PGM/PRV pair', () => {
	const app = buildApp({
		destinations: [dest('m1', 'pgm_prv', 0), dest('m2', 'pgm_prv', 1)],
		connectors: [
			{ id: 'dst_in_m1', kind: 'destination_in', externalRef: 'm1' },
			{ id: 'dst_in_m2', kind: 'destination_in', externalRef: 'm2' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
			{ id: 'gpu_p1', kind: 'gpu_out' },
		],
		edges: [
			{ id: 'e1', sourceId: 'dst_in_m1', sinkId: 'gpu_p0' },
			{ id: 'e2', sourceId: 'dst_in_m2', sinkId: 'gpu_p1' },
		],
	})
	assert.equal(resolveMainScreenCount(app), 2)
	const roles = channelRoles(buildConfigXml(buildCasparGeneratorFlatConfig(app)))
	assert.ok(roles.some((r) => /Screen 2 program output \(PGM\)/.test(r)), `got: ${JSON.stringify(roles)}`)
	assert.ok(roles.some((r) => /Screen 2 preview output \(PRV\)/.test(r)), `got: ${JSON.stringify(roles)}`)
})

test('WO-275: re-cabling a DeckLink to multiview releases the stale screen binding', () => {
	// Persisted state still says "DeckLink 3 belongs to screen 2" (the previous binding), while the
	// device graph now cables DeckLink 3 to the multiview destination.
	const app = buildApp({
		caspar: {
			screen_count: 2,
			screen_2_decklink_device: 3,
			screen_2_decklink_replace_screen: true,
			multiview_decklink_device: 3,
		},
		destinations: [dest('m1', 'pgm_prv', 0), dest('m2', 'pgm_only', 1), dest('mv', 'multiview', 0)],
		connectors: [
			{ id: 'dst_in_m1', kind: 'destination_in', externalRef: 'm1' },
			{ id: 'dst_in_m2', kind: 'destination_in', externalRef: 'm2' },
			{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
			{ id: 'dl3', kind: 'decklink_io', externalRef: '3', caspar: { ioDirection: 'out' } },
		],
		edges: [
			{ id: 'e1', sourceId: 'dst_in_m1', sinkId: 'gpu_p0' },
			{ id: 'e2', sourceId: 'dst_in_mv', sinkId: 'dl3' },
		],
	})

	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.multiview_decklink_device, 3, 'multiview owns DeckLink 3')
	assert.equal(flat.screen_2_decklink_device, 0, 'stale screen_2 binding must be released')
	assert.equal(flat.screen_2_decklink_replace_screen, false, 'and its replace-screen flag cleared')

	// Exactly one <decklink> consumer may reference device 3 across the whole config.
	const xml = buildConfigXml(flat)
	const deckBlocks = [...xml.matchAll(/<decklink>[\s\S]*?<\/decklink>/g)].map((m) => m[0])
	const onDevice3 = deckBlocks.filter((b) => /<device>3<\/device>/.test(b))
	assert.equal(onDevice3.length, 1, `expected 1 DeckLink consumer on device 3, got ${onDevice3.length}`)
})

test('WO-275: re-cabling a DeckLink from multiview to a screen releases the multiview binding', () => {
	const app = buildApp({
		caspar: { screen_count: 2, multiview_decklink_device: 3 },
		destinations: [dest('m1', 'pgm_prv', 0), dest('m2', 'pgm_only', 1), dest('mv', 'multiview', 0)],
		connectors: [
			{ id: 'dst_in_m1', kind: 'destination_in', externalRef: 'm1' },
			{ id: 'dst_in_m2', kind: 'destination_in', externalRef: 'm2' },
			{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
			{ id: 'dl3', kind: 'decklink_io', externalRef: '3', caspar: { ioDirection: 'out' } },
		],
		edges: [
			{ id: 'e1', sourceId: 'dst_in_m1', sinkId: 'gpu_p0' },
			{ id: 'e2', sourceId: 'dst_in_m2', sinkId: 'dl3' },
		],
	})

	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_2_decklink_device, 3, 'screen 2 now owns DeckLink 3')
	assert.equal(flat.multiview_decklink_device, 0, 'stale multiview binding must be released')

	const xml = buildConfigXml(flat)
	const onDevice3 = [...xml.matchAll(/<decklink>[\s\S]*?<\/decklink>/g)]
		.map((m) => m[0])
		.filter((b) => /<device>3<\/device>/.test(b))
	assert.equal(onDevice3.length, 1, `expected 1 DeckLink consumer on device 3, got ${onDevice3.length}`)
})

test('WO-275: an untouched DeckLink binding on another device is left alone', () => {
	const app = buildApp({
		caspar: {
			screen_count: 2,
			screen_1_decklink_device: 5,
			screen_1_decklink_replace_screen: true,
			multiview_decklink_device: 3,
		},
		destinations: [dest('m1', 'pgm_prv', 0), dest('m2', 'pgm_only', 1), dest('mv', 'multiview', 0)],
		connectors: [
			{ id: 'dst_in_m1', kind: 'destination_in', externalRef: 'm1' },
			{ id: 'dst_in_m2', kind: 'destination_in', externalRef: 'm2' },
			{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
			{ id: 'dl3', kind: 'decklink_io', externalRef: '3', caspar: { ioDirection: 'out' } },
		],
		edges: [{ id: 'e2', sourceId: 'dst_in_mv', sinkId: 'dl3' }],
	})
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_decklink_device, 5, 'device 5 is not device 3 — must survive untouched')
	assert.equal(flat.multiview_decklink_device, 3)
})
