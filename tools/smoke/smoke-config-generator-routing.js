const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { getChannelMap } = require('../../src/config/routing')
const { clone, addMockGraph, addMainDestinations } = require('./lib/config-generator-routing-fixtures')

/*
 * This file was split for line-count hygiene — see also:
 *   tools/smoke/smoke-config-generator-routing-2.js
 *   tools/smoke/smoke-config-generator-routing-3.js
 *   tools/smoke/smoke-config-generator-routing-4.js
 * Shared fixture builders live in tools/smoke/lib/config-generator-routing-fixtures.js.
 */

test('multiview auto x counts only real screen consumers', () => {
	const app = clone(defaults)
	app.screen_count = 2
	app.casparServer = {
		...app.casparServer,
		screen_count: 2,
		screen_1_mode: 'custom',
		screen_1_custom_width: 5120,
		screen_1_custom_height: 768,
		screen_1_custom_fps: 50,
		screen_1_decklink_device: 0,
		screen_1_decklink_replace_screen: false,
		screen_2_mode: '1080p5000',
		screen_2_decklink_device: 4,
		screen_2_decklink_replace_screen: true,
		multiview_enabled: true,
		multiview_output_mode: 'screen_only',
		multiview_mode: '720p5000',
		// Explicit X — cumulative placement may be unset without GPU/OS bindings in this synthetic fixture.
		multiview_x: '5120',
		streamingChannel: { enabled: false },
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_m1', kind: 'destination_in', externalRef: 'm1' },
			{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
		],
		edges: [
			{ sourceId: 'dst_in_m1', sinkId: 'gpu_p0' },
			{ sourceId: 'dst_in_mv', sinkId: 'gpu_p0' },
		],
	}
	// Multiview Caspar channel is allocated only when a multiview destination exists (not from multiview_enabled alone).
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'm1',
				label: 'M1',
				mainScreenIndex: 0,
				mode: 'pgm_prv',
				videoMode: 'custom',
				width: 5120,
				height: 768,
				fps: 50,
			},
			{ id: 'm2', label: 'M2', mainScreenIndex: 1, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'mv', label: 'MV', mainScreenIndex: 0, mode: 'multiview', videoMode: '720p5000', width: 1280, height: 720, fps: 50 },
		],
		edidNotes: '',
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	const m = xml.match(/<video-mode>720p5000<\/video-mode>[\s\S]*?<screen>[\s\S]*?<x>(\d+)<\/x><y>(\d+)<\/y>/)
	assert.ok(m, 'multiview screen block should be present')
	assert.equal(m[1], '5120')
	assert.equal(m[2], '0')
})

test('multiview caspar x follows OS layout when no main emits a screen consumer', () => {
	const app = clone(defaults)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: 'custom',
		screen_1_custom_width: 5120,
		screen_1_custom_height: 768,
		screen_1_custom_fps: 50,
		screen_1_decklink_device: 0,
		screen_1_decklink_replace_screen: false,
		/** PGM/PRV bus exists but no Caspar screen consumer — only multiview uses a screen consumer. */
		screen_1_screen_consumer: false,
		screen_1_system_id: 'GPU-HEAD-A',
		multiview_enabled: true,
		multiview_output_mode: 'screen_only',
		multiview_mode: '720p5000',
		multiview_system_id: 'GPU-HEAD-B',
		streamingChannel: { enabled: false },
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	app.deviceGraph = undefined
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'm1',
				label: 'M1',
				mainScreenIndex: 0,
				mode: 'pgm_prv',
				videoMode: 'custom',
				width: 5120,
				height: 768,
				fps: 50,
			},
			{ id: 'mv', label: 'MV', mainScreenIndex: 0, mode: 'multiview', videoMode: '720p5000', width: 1280, height: 720, fps: 50 },
		],
		edidNotes: '',
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	const m = xml.match(/<video-mode>720p5000<\/video-mode>[\s\S]*?<screen>[\s\S]*?<x>(\d+)<\/x><y>(\d+)<\/y>/)
	assert.ok(m, 'multiview screen block should be present')
	assert.equal(m[1], '5120', 'multiview window x must match OS head position (5120 after 5120-wide screen_1 head)')
	assert.equal(m[2], '0')
})

test('multiview caspar x is 0 when only multiview has a screen consumer on shared GPU', () => {
	const app = clone(defaults)
	app.screen_count = 2
	app.casparServer = {
		...app.casparServer,
		screen_count: 2,
		screen_1_mode: '1080p5000',
		screen_2_mode: '2160p5000',
		multiview_enabled: true,
		multiview_output_mode: 'screen_only',
		multiview_mode: '1080p5000',
		streamingChannel: { enabled: false },
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'pgm1', label: 'PGM 1', mainScreenIndex: 0, mode: 'pgm_only', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'pgm2', label: 'PGM 2', mainScreenIndex: 1, mode: 'pgm_only', videoMode: '2160p5000', width: 3840, height: 2160, fps: 50 },
			{ id: 'mv1', label: 'Multiview 1', mainScreenIndex: 0, mode: 'multiview', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_pgm1', kind: 'destination_in', externalRef: 'pgm1' },
			{ id: 'dst_in_pgm2', kind: 'destination_in', externalRef: 'pgm2' },
			{ id: 'dst_in_mv1', kind: 'destination_in', externalRef: 'mv1' },
			{ id: 'rec_1', kind: 'record_out' },
			{ id: 'rec_2', kind: 'record_out' },
			{ id: 'gpu_p2', kind: 'gpu_out', externalRef: 'DP-4' },
		],
		edges: [
			{ sourceId: 'dst_in_pgm1', sinkId: 'rec_1' },
			{ sourceId: 'dst_in_pgm2', sinkId: 'rec_2' },
			{ sourceId: 'dst_in_mv1', sinkId: 'gpu_p2' },
		],
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_screen_consumer, false)
	assert.equal(flat.screen_2_screen_consumer, false)
	const xml = buildConfigXml(flat)
	const mv = xml.match(/Multiview output #1[\s\S]*?<screen>[\s\S]*?<x>(\d+)<\/x>/)
	assert.ok(mv, 'multiview screen consumer')
	assert.equal(mv[1], '0', 'record-only PGMs must not push multiview off the GPU origin')
})

test('WO-53: each DeckLink input gets its own dedicated channel (never bundled onto MVR)', () => {
	const cfg = clone(defaults)
	cfg.screen_count = 2
	cfg.casparServer = {
		...cfg.casparServer,
		screen_count: 2,
		decklink_input_count: 3,
		multiview_enabled: true,
		multiview_mode: '1080p5000',
		inputs_channel_mode: '1080p5000',
		decklink_inputs_host: 'dedicated',
	}
	cfg.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'm1', label: 'M1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'm2', label: 'M2', mainScreenIndex: 1, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'mv', label: 'MV', mainScreenIndex: 0, mode: 'multiview', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	const map = getChannelMap(cfg)
	assert.ok(map.multiviewCh != null, 'multiview channel should exist')
	assert.equal(map.inputsOnMvr, false, 'WO-53: inputs are never bundled onto the multiview channel')
	assert.equal(map.decklinkInputChannels.length, 3, 'one dedicated channel per DeckLink input')
	assert.equal(map.inputsCh, map.decklinkInputChannels[0], 'inputsCh aliases the first DeckLink channel')
	for (const ch of map.decklinkInputChannels) {
		assert.notEqual(ch, map.multiviewCh, 'DeckLink channels are separate from the multiview channel')
	}
	for (const entry of map.inputChannels) {
		assert.equal(entry.mode, '1080p5000', 'DeckLink channels use full inputs_channel_mode')
	}
})

test('WO-53: one dedicated channel per DeckLink input', () => {
	const app = clone(defaults)
	addMockGraph(app)
	addMainDestinations(app, 1)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		decklink_input_count: 3,
		multiview_enabled: false,
		inputs_channel_mode: '1080p5000',
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	const channels = (xml.match(/<channel>/g) || []).length
	assert.equal(channels, 5, 'expected OUTPUT/PGM + PRV + 3 dedicated DeckLink channels')
})

/**
 * Multiview off, DeckLink inputs on, dedicated inputs host, streaming channel on.
 * Expected `<channel>` order: PGM → PRV → empty inputs host → streaming channel (no multiview slot).
 */
test('multiview off: per-DeckLink channels then streaming channel after screen pairs', () => {
	const app = clone(defaults)
	addMockGraph(app)
	addMainDestinations(app, 1)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: '1080p5000',
		multiview_enabled: false,
		decklink_input_count: 2,
		decklink_inputs_host: 'dedicated',
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: true, videoMode: '720p5000', dedicatedOutputChannel: true }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	const channelBlocks = [...xml.matchAll(/<channel>[\s\S]*?<\/channel>/g)].map((m) => m[0])
	assert.equal(channelBlocks.length, 5, 'OUTPUT/PGM + PRV + 2 DeckLink channels + streaming')
	/* Empty consumers may serialize self-closing or expanded — both mean "no consumers". */
	assert.match(channelBlocks[2], /<consumers\s*\/>|<consumers>\s*<\/consumers>/, 'DeckLink channel has no consumers')
	assert.match(channelBlocks[2], /<audio-osc>true<\/audio-osc>/, 'DeckLink channel exposes audio OSC')
	assert.match(channelBlocks[4], /<video-mode>720p5000<\/video-mode>/, 'streaming channel is last with its mode')
})

test('WO-53: DeckLink inputs use full mode; ALSA inputs use the cheap lowest standard mode', () => {
	const { getLowestStandardVideoModeId } = require('../../src/config/config-modes')
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: '1080p5000',
		multiview_enabled: false,
		decklink_input_count: 2,
		live_audio_input_count: 1,
		live_audio_input_1_device: 'hw:1,0',
		inputs_channel_mode: '1080p5000',
		live_audio_inputs_channel_mode: '',
		live_audio_input_channel_mode: '',
		decklink_inputs_host: 'dedicated',
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	const map = getChannelMap(flat)
	const lowest = getLowestStandardVideoModeId()
	// One dedicated channel per input (2 decklink + 1 live audio).
	assert.equal(map.inputChannels.length, 3, 'one dedicated channel per input slot')
	assert.deepEqual(
		map.inputChannels.map((m) => m.kind),
		['decklink', 'decklink', 'live_audio'],
	)
	assert.equal(map.inputChannels[0].mode, '1080p5000', 'DeckLink uses full inputs_channel_mode')
	assert.equal(map.inputChannels[2].mode, lowest, 'ALSA uses the cheap lowest standard mode')
	assert.equal(map.inputChannels[0].route, `route://${map.decklinkInputChannels[0]}-1`)
	assert.equal(map.inputChannels[2].route, `route://${map.liveAudioInputChannels[0]}`)
	const xml = buildConfigXml(flat)
	assert.match(xml, /DeckLink input 1/, 'DeckLink input channel comment present')
	assert.match(xml, /Live audio input 1/, 'live audio input channel comment present')
	assert.match(xml, new RegExp(`<video-mode>${lowest}</video-mode>`), 'cheap ALSA channel uses lowest standard mode')
	// UI saves live_audio_inputs_channel_mode (with trailing "s"); routing must honour it.
	const hi = clone(app)
	hi.casparServer = { ...hi.casparServer, live_audio_inputs_channel_mode: '1080p5000' }
	const mapHi = getChannelMap(buildCasparGeneratorFlatConfig(hi))
	assert.equal(mapHi.inputChannels[2].mode, '1080p5000', 'live_audio_inputs_channel_mode overrides PAL default')
	// No inputs configured → no input channels.
	const off = clone(flat)
	off.decklink_input_count = 0
	off.live_audio_input_count = 0
	off.casparServer = { ...off.casparServer, decklink_input_count: 0, live_audio_input_count: 0 }
	const mapOff = getChannelMap(off)
	assert.equal(mapOff.inputChannels.length, 0, 'no inputs → no dedicated input channels')
})

test('streaming without dedicatedOutputChannel encodes the videoSource bus — no extra <channel>', () => {
	const app = clone(defaults)
	addMockGraph(app)
	addMainDestinations(app, 1)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: '1080p5000',
		multiview_enabled: false,
		decklink_input_count: 0,
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: true, videoMode: '1080p5000', videoSource: 'program_1', dedicatedOutputChannel: false }
	const map = getChannelMap(app)
	assert.equal(map.streamingCh, 1, 'ADD STREAM should target pgm 1, not a synthetic next ch')
	assert.equal(map.streamingAttachToChannel, 1)
	assert.equal(map.streamingDedicatedChannelSlot, false)
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	assert.equal((xml.match(/<channel>/g) || []).length, 2, 'OUTPUT/PGM + PRV only (streaming attaches to program)')
})

test('device-view destinations override screen count and mode mapping', () => {
	const app = clone(defaults)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: '1080p5000',
		screen_2_mode: '1080p5000',
		multiview_enabled: false,
	}
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'a', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '720p5000', width: 1280, height: 720, fps: 50 },
			{ id: 'b', label: 'Main2', mainScreenIndex: 1, mode: 'pgm_only', videoMode: 'custom', width: 5120, height: 768, fps: 50 },
		],
		edidNotes: '',
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_count, 2, 'destination mains should set screen count')
	assert.equal(flat.screen_1_mode, '720p5000', 'standard destination mode should map directly')
	assert.equal(flat.screen_2_mode, 'custom', 'non-standard destination should map to custom mode')
	assert.equal(flat.screen_2_custom_width, 5120)
	assert.equal(flat.screen_2_custom_height, 768)
	assert.equal(flat.screen_2_custom_fps, 50)
	const xml = buildConfigXml(flat)
	assert.match(xml, /<video-mode>720p5000<\/video-mode>/, 'screen 1 channel uses destination mode')
	assert.match(xml, /<id>5120x768<\/id>/, 'custom destination mode appears in video-modes')
})
