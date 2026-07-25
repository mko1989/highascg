'use strict'

/**
 * Shared fixture builders for the smoke-config-generator-routing*.js split. Not itself a test file
 * (no `.test.` in the name) so tools/ci/collect-offline-tests.js never picks it up.
 */

const assert = require('node:assert/strict')
const defaults = require('../../../src/config/defaults')

/**
 * @param {any} cfg
 * @returns {any}
 */
function clone(cfg) {
	return JSON.parse(JSON.stringify(cfg))
}

function addMockGraph(app) {
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_led1', kind: 'destination_in', externalRef: 'led1' },
			{ id: 'gpu_p0', kind: 'gpu_out' }
		],
		edges: [
			{ sourceId: 'dst_in_led1', sinkId: 'gpu_p0' }
		]
	}
}

/**
 * Give the fixture `n` real PGM/PRV destinations.
 *
 * Needed because an EMPTY destinations list now generates ZERO main channels (a factory-reset box
 * must not emit a Screen 1 PGM+PRV pair that nothing routes to). Fixtures that only set
 * `screen_count` are using the pre-destinations style; tests whose subject is DeckLink, streaming,
 * audio routing or always-on-top still need main channels to exist, so they declare them properly
 * instead of leaning on a floor that no longer applies.
 * @param {object} app
 * @param {number} n
 */
function addMainDestinations(app, n) {
	const destinations = Array.from({ length: n }, (_, i) => ({
		id: `main${i + 1}`,
		label: `PGM ${i + 1}`,
		mode: 'pgm_prv',
		mainScreenIndex: i,
		videoMode: '1080p5000',
		width: 1920,
		height: 1080,
		fps: 50,
	}))
	app.screenDestinations = { version: 1, edidNotes: '', destinations }
	/* Each destination must also be CABLED to a GPU port, or it emits no screen consumer and the
	 * `Screen N program output (PGM)` block the assertions look for never appears. */
	app.deviceGraph = {
		connectors: [
			...destinations.map((d) => ({ id: `dst_in_${d.id}`, kind: 'destination_in', externalRef: d.id })),
			...destinations.map((_, i) => ({ id: `gpu_p${i}`, kind: 'gpu_out' })),
		],
		edges: destinations.map((d, i) => ({ sourceId: `dst_in_${d.id}`, sinkId: `gpu_p${i}` })),
	}
}

/**
 * PGM always-on-top (owner todos19.07.26): PGM screen consumers stack on top by default, and an
 * explicit operator choice must survive the generator in both directions.
 * Caspar element is `<always-on-top>` (binary property path `screen/always_on_top`).
 */
function pgmAlwaysOnTopFixture(alwaysOnTop) {
	const app = clone(defaults)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: '1080p5000',
		multiview_enabled: false,
		streamingChannel: { enabled: false },
	}
	if (alwaysOnTop !== undefined) app.casparServer.screen_1_always_on_top = alwaysOnTop
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	addMockGraph(app)
	addMainDestinations(app, 1)
	return app
}

/** @param {string} xml @returns {string} the PGM `<screen>` inner block */
function pgmScreenBlock(xml) {
	const m = xml.match(/Screen 1 program output \(PGM\)[\s\S]*?<screen>([\s\S]*?)<\/screen>/)
	assert.ok(m, 'PGM screen consumer block present')
	return m[1]
}

/**
 * WO-297 — the stream/record downmix layout MUST agree with the `<channel-layout>` the generator
 * actually writes onto the program channel.
 *
 * Live regression this locks down: `screenDestinations[].audioLayout` said `stereo` while an 8ch
 * PortAudio output was cabled to that destination, so the generator widened the channel to
 * `discrete-8ch` (`applyAudioOutputOverridesToScreens`) but `resolveSourceProgramAudioLayout` still
 * reported `stereo`. The RTMP consumer then built a bare `aformat=channel_layouts=stereo` — a blind
 * remix of a DISCRETE (unnamed c0..c7) bus — so the stream carried no audible audio while the OSC
 * VU meters, which read the channel mixer, kept showing signal.
 */
function appWithCabledAudioOutput(channelLayout) {
	const app = clone(defaults)
	app.screen_count = 1
	app.casparServer = { ...app.casparServer, screen_count: 1, screen_1_mode: '1080p5000' }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'pgm1',
				label: 'PGM 1',
				mainScreenIndex: 0,
				mode: 'pgm_prv',
				audioLayout: 'stereo',
				videoMode: '1080p5000',
				width: 1920,
				height: 1080,
				fps: 50,
			},
		],
		edidNotes: '',
	}
	app.audioOutputs = [
		{
			id: 'audio_1',
			label: 'Audio 1',
			enabled: true,
			type: 'portaudio',
			deviceName: 'hw:2,0',
			channelLayout,
			hostApi: 'auto',
		},
	]
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_pgm1', kind: 'destination_in', externalRef: 'pgm1' },
			{ id: 'audio_1', kind: 'audio_out' },
		],
		edges: [{ sourceId: 'dst_in_pgm1', sinkId: 'audio_1' }],
	}
	return app
}

module.exports = {
	clone,
	addMockGraph,
	addMainDestinations,
	pgmAlwaysOnTopFixture,
	pgmScreenBlock,
	appWithCabledAudioOutput,
}
