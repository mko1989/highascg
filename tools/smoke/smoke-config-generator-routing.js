const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { getChannelMap } = require('../../src/config/routing')

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
			{ id: 'dst_in_led1', kind: 'destination_in', externalRef: 'led1' },
			{ id: 'gpu_p0', kind: 'gpu_out' }
		],
		edges: [
			{ sourceId: 'dst_in_led1', sinkId: 'gpu_p0' }
		]
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

test('multiview screen default x is 0 when no main emits a screen consumer (OS tandem may still advance)', () => {
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
	assert.equal(m[1], '0', 'multiview must not use OS tandem X when no main screen consumer exists')
	assert.equal(m[2], '0')
})

test('decklink inputs use multiview host when mode matches', () => {
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
	assert.equal(map.inputsCh, map.multiviewCh, 'inputs should host on multiview when modes match')
	assert.equal(map.inputsOnMvr, true)
})

test('only one dedicated inputs channel when multiview host is not used', () => {
	const app = clone(defaults)
	addMockGraph(app)
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
	assert.equal(channels, 3, 'expected OUTPUT/PGM + PRV + one dedicated inputs channel')
})

/**
 * Multiview off, DeckLink inputs on, dedicated inputs host, streaming channel on.
 * Expected `<channel>` order: PGM → PRV → empty inputs host → streaming channel (no multiview slot).
 */
test('multiview off: inputs host then streaming channel after screen pairs', () => {
	const app = clone(defaults)
	addMockGraph(app)
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
	assert.equal(channelBlocks.length, 4, 'OUTPUT/PGM + PRV + inputs host + streaming (legacy dedicated slot)')
	assert.match(channelBlocks[2], /<consumers\s*\/>/, 'inputs host channel has no consumers')
	assert.match(channelBlocks[3], /<video-mode>720p5000<\/video-mode>/, 'streaming channel is last with its mode')
})

test('streaming without dedicatedOutputChannel encodes the videoSource bus — no extra <channel>', () => {
	const app = clone(defaults)
	addMockGraph(app)
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

test('pgm_only destination omits preview channel for that main', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 2
	app.casparServer = {
		...app.casparServer,
		screen_count: 2,
		screen_1_mode: '1080p5000',
		screen_2_mode: '1080p5000',
		multiview_enabled: false,
	}
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_only', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'd2', label: 'Main2', mainScreenIndex: 1, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	const map = getChannelMap(flat)
	assert.deepEqual(map.programChannels, [1, 2], 'pgm_only keeps single channel; main2 starts its own block')
	assert.deepEqual(map.previewChannels, [null, 3], 'pgm_only omits BUS1 for that main; main2 has dedicated bus1')
	const xml = buildConfigXml(flat)
	const channels = (xml.match(/<channel>/g) || []).length
	assert.equal(channels, 3, 'expected PGM-only main1 + PGM/PRV pair for main2')
})

test('channel plan decklink count tracks routing casparServer fallback (prevents hole placeholders)', () => {
	const { buildChannelPlan } = require('../../src/config/config-generator-channel-plan')
	const app = clone(defaults)
	addMockGraph(app)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'M1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'd2', label: 'M2', mainScreenIndex: 1, mode: 'pgm_only', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	app.decklink_input_count = 0
	app.casparServer = { ...app.casparServer, decklink_input_count: 2 }
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	const map = getChannelMap(flat)
	const plan = buildChannelPlan(flat, map)
	assert.ok(map.decklinkCount >= 2)
	assert.equal(plan.decklinkCount, map.decklinkCount, 'generator must reserve inputs host whenever routing does')
	assert.ok(map.inputsCh != null)
})

test('no multiview destination: defaults.multiview_enabled does not allocate MV channel or screen consumer', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'M1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'd2', label: 'M2', mainScreenIndex: 1, mode: 'pgm_only', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	assert.notEqual(app.casparServer?.multiview_enabled, false, 'defaults keep multiview_enabled true — topology must still omit MV without a destination')
	const flat = buildCasparGeneratorFlatConfig(app)
	const map = getChannelMap(flat)
	assert.equal(map.multiviewCh, null)
	assert.equal(map.multiviewEnabled, false)
	const xml = buildConfigXml(flat)
	assert.equal((xml.match(/<audio-osc>false<\/audio-osc>/g) || []).length, 0, 'multiview channel uses audio-osc false — must not appear')
	const channels = (xml.match(/<channel>/g) || []).length
	assert.equal(channels, 3, 'PGM/PRV main1 + PGM-only main2 → three channels')
})

test('empty screen destinations ignore stale screen_count (one main bus)', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 4
	app.casparServer = {
		...app.casparServer,
		screen_count: 4,
		multiview_enabled: false,
		decklink_input_count: 0,
	}
	app.screenDestinations = { version: 1, destinations: [], edidNotes: '' }
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_count, 1, 'cleared destinations should not keep old screen_count')
	const map = getChannelMap(app)
	assert.equal(map.screenCount, 1)
	const xml = buildConfigXml(flat)
	assert.equal((xml.match(/<channel>/g) || []).length, 2, 'one main: OUTPUT/PGM + PRV')
})
