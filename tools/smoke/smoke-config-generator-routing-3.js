const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { clone, addMockGraph, pgmAlwaysOnTopFixture, pgmScreenBlock } = require('./lib/config-generator-routing-fixtures')

/*
 * Split out of tools/smoke/smoke-config-generator-routing.js for line-count hygiene — see also:
 *   tools/smoke/smoke-config-generator-routing-2.js
 *   tools/smoke/smoke-config-generator-routing-4.js
 * Shared fixture builders live in tools/smoke/lib/config-generator-routing-fixtures.js.
 */

test('multiview window chrome inherits PGM screen_1; other flags stay multiview-only', () => {
	const app = clone(defaults)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: '1080p5000',
		screen_1_windowed: true,
		screen_1_vsync: false,
		screen_1_borderless: true,
		screen_1_always_on_top: true,
		screen_1_force_linear_filter: true,
		multiview_enabled: true,
		multiview_output_mode: 'screen_only',
		multiview_mode: '1080p5000',
		multiview_windowed: true,
		multiview_vsync: false,
		multiview_borderless: false,
		multiview_always_on_top: false,
		multiview_force_linear_filter: false,
		streamingChannel: { enabled: false },
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'mv', label: 'MV', mainScreenIndex: 0, mode: 'multiview', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
		],
		edges: [{ sourceId: 'dst_in_mv', sinkId: 'gpu_p0' }],
	}
	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(app))
	const mv = xml.match(/Multiview output #1[\s\S]*?<screen>([\s\S]*?)<\/screen>/)
	assert.ok(mv, 'multiview screen consumer block')
	const block = mv[1]
	assert.match(block, /<windowed>true<\/windowed>/)
	assert.match(block, /<vsync>false<\/vsync>/)
	assert.match(block, /<borderless>true<\/borderless>/)
	assert.match(block, /<always-on-top>false<\/always-on-top>/)
	assert.match(block, /<force-linear-filter>false<\/force-linear-filter>/)
})

test('multiview screen consumer omitted when Device View has no GPU cable to multiview destination', () => {
	const app = clone(defaults)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: '1080p5000',
		multiview_enabled: true,
		multiview_mode: '1080p5000',
		multiview_screen_consumer: true,
		streamingChannel: { enabled: false },
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'pgm1', label: 'PGM', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'mv1', label: 'MV', mainScreenIndex: 0, mode: 'multiview', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_pgm1', kind: 'destination_in', externalRef: 'pgm1' },
			{ id: 'dst_in_mv1', kind: 'destination_in', externalRef: 'mv1' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
		],
		edges: [{ sourceId: 'dst_in_pgm1', sinkId: 'gpu_p0' }],
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.multiview_screen_consumer, false)
	assert.equal(flat.multiview_output_mode, 'disabled')
	const xml = buildConfigXml(flat)
	const mvBlock = xml.match(/Multiview output #1[\s\S]*?<channel>([\s\S]*?)<\/channel>/)
	assert.ok(mvBlock, 'multiview channel block')
	assert.doesNotMatch(mvBlock[1], /<screen>/)
})

test('WO-288: standard mode aliases (e.g. 1080p50) emit no custom video-mode block', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: '1080p50',
		multiview_enabled: false,
	}
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p50', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_mode, '1080p5000', 'mode alias 1080p50 normalized to canonical 1080p5000')
	const xml = buildConfigXml(flat)
	assert.match(xml, /<video-mode>1080p5000<\/video-mode>/, 'channel uses canonical mode')
	assert.doesNotMatch(xml, /<video-modes>[\s\S]*?<id>1920x1080<\/id>/, 'no custom video-mode block for standard mode alias')
})

test('WO-288: non-standard screen destination resolution still emits custom video-mode block', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		multiview_enabled: false,
	}
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 5120, height: 768, fps: 50 },
		],
		edidNotes: '',
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_mode, 'custom')
	assert.equal(flat.screen_1_custom_width, 5120)
	assert.equal(flat.screen_1_custom_height, 768)
	const xml = buildConfigXml(flat)
	assert.match(xml, /<id>5120x768<\/id>/, 'custom destination resolution emits custom video-mode block')
})

test('PGM screen consumer is always-on-top by default (key unset)', () => {
	const flat = buildCasparGeneratorFlatConfig(pgmAlwaysOnTopFixture(undefined))
	assert.equal(flat.screen_1_always_on_top, true, 'flat config default is on')
	assert.match(
		pgmScreenBlock(buildConfigXml(flat)),
		/<always-on-top>true<\/always-on-top>/,
		'PGM defaults to always-on-top with no explicit setting',
	)
})

test('a CABLED PGM port is always-on-top regardless of an explicit false (cable wins)', () => {
	/* Owner rule, todos21.07.26: "any pgm port should have always on top true". Port role is derived
	 * from the cable in screen-consumer-port-resolve.js, so on a port carrying a PGM destination the
	 * derived value overrides a hand-set false.
	 *
	 * This deliberately REPLACES an older round-trip assertion that explicit false survived to the
	 * XML. The two rules cannot both hold. The old test only kept passing because its fixture had no
	 * destinations at all, so nothing identified the port as PGM and the rule never engaged — worth
	 * recording, because it means the override was never actually exercised before. */
	for (const want of [true, false]) {
		const flat = buildCasparGeneratorFlatConfig(pgmAlwaysOnTopFixture(want))
		assert.equal(flat.screen_1_always_on_top, true, `cabled PGM port forces true (asked for ${want})`)
		assert.match(pgmScreenBlock(buildConfigXml(flat)), /<always-on-top>true<\/always-on-top>/)
	}
})

test('an UNCABLED screen still round-trips an explicit always_on_top', () => {
	/* Where no destination claims the port, nothing derives a role and the operator's setting is the
	 * only source of truth — so it must still survive verbatim. */
	for (const want of [true, false]) {
		const app = pgmAlwaysOnTopFixture(want)
		app.deviceGraph = { connectors: [], edges: [] } // same destinations, nothing cabled
		const flat = buildCasparGeneratorFlatConfig(app)
		assert.equal(flat.screen_1_always_on_top, want, `uncabled screen keeps explicit ${want}`)
	}
})

test('PGM always-on-top default does not leak to multiview or the operator-GUI consumer', () => {
	// Multiview reads multiview_* only (never PGM screen_1) — an explicit false must stay false.
	const app = pgmAlwaysOnTopFixture(true)
	app.casparServer = {
		...app.casparServer,
		multiview_enabled: true,
		multiview_output_mode: 'screen_only',
		multiview_mode: '1080p5000',
		multiview_always_on_top: false,
	}
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'mv', label: 'MV', mainScreenIndex: 0, mode: 'multiview', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
		],
		edges: [{ sourceId: 'dst_in_mv', sinkId: 'gpu_p0' }],
	}
	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(app))
	const mv = xml.match(/Multiview output #1[\s\S]*?<screen>([\s\S]*?)<\/screen>/)
	assert.ok(mv, 'multiview screen consumer block')
	assert.match(
		mv[1],
		/<always-on-top>false<\/always-on-top>/,
		'multiview keeps its own always_on_top — PGM default must not bleed across',
	)
	// The operator-GUI consumer is hardcoded false (WO-263: it must stack BELOW the Firefox kiosk).
	const src = require('node:fs').readFileSync(
		require('node:path').join(__dirname, '../../src/config/config-generator-operator-gui.js'),
		'utf8',
	)
	assert.match(
		src,
		/<always-on-top>false<\/always-on-top>/,
		'WO-263: operator-GUI consumer stays below Firefox regardless of the PGM default',
	)
})
