const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../config/default')
const { buildConfigXml } = require('../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../src/config/build-caspar-generator-config')
const { getChannelMap } = require('../src/config/routing')

/**
 * @param {any} cfg
 * @returns {any}
 */
function clone(cfg) {
	return JSON.parse(JSON.stringify(cfg))
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
		multiview_x: '',
		streamingChannel: { enabled: false },
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	const m = xml.match(/<video-mode>720p5000<\/video-mode>[\s\S]*?<screen>[\s\S]*?<x>(\d+)<\/x><y>(\d+)<\/y>/)
	assert.ok(m, 'multiview screen block should be present')
	assert.equal(m[1], '5120')
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
	const map = getChannelMap(cfg)
	assert.ok(map.multiviewCh != null, 'multiview channel should exist')
	assert.equal(map.inputsCh, map.multiviewCh, 'inputs should host on multiview when modes match')
	assert.equal(map.inputsOnMvr, true)
})

test('only one dedicated inputs channel when multiview host is not used', () => {
	const app = clone(defaults)
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
	assert.equal(channels, 4, 'expected OUTPUT/PGM + BUS1 + BUS2 + one dedicated inputs channel')
})

/**
 * Multiview off, DeckLink inputs on, dedicated inputs host, streaming channel on.
 * Expected `<channel>` order: PGM → PRV → empty inputs host → streaming channel (no multiview slot).
 */
test('multiview off: inputs host then streaming channel after screen pairs', () => {
	const app = clone(defaults)
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
	assert.equal(channelBlocks.length, 5, 'OUTPUT/PGM + BUS1 + BUS2 + inputs host + streaming (legacy dedicated slot)')
	assert.match(channelBlocks[3], /<consumers\/>/, 'inputs host channel has no consumers')
	assert.match(channelBlocks[4], /<video-mode>720p5000<\/video-mode>/, 'streaming channel is last with its mode')
})

test('streaming without dedicatedOutputChannel encodes the videoSource bus — no extra <channel>', () => {
	const app = clone(defaults)
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
	assert.equal((xml.match(/<channel>/g) || []).length, 3, 'OUTPUT/PGM + BUS1 + BUS2 only')
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
	app.tandemTopology = {
		version: 1,
		destinations: [
			{ id: 'a', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '720p5000', width: 1280, height: 720, fps: 50 },
			{ id: 'b', label: 'Main2', mainScreenIndex: 1, mode: 'pgm_only', videoMode: 'custom', width: 5120, height: 768, fps: 50 },
		],
		signalPaths: [],
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
	app.screen_count = 2
	app.casparServer = {
		...app.casparServer,
		screen_count: 2,
		screen_1_mode: '1080p5000',
		screen_2_mode: '1080p5000',
		multiview_enabled: false,
	}
	app.tandemTopology = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_only', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'd2', label: 'Main2', mainScreenIndex: 1, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		signalPaths: [],
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	const map = getChannelMap(flat)
	assert.deepEqual(map.programChannels, [1, 2], 'pgm_only keeps single channel; main2 starts its own block')
	assert.deepEqual(map.previewChannels, [null, 3], 'pgm_only omits BUS1 for that main; main2 has dedicated bus1')
	const xml = buildConfigXml(flat)
	const channels = (xml.match(/<channel>/g) || []).length
	assert.equal(channels, 4, 'expected OUTPUT(main1) + OUTPUT/BUS1/BUS2(main2)')
})

test('empty tandem destinations ignore stale screen_count (one main bus)', () => {
	const app = clone(defaults)
	app.screen_count = 4
	app.casparServer = {
		...app.casparServer,
		screen_count: 4,
		multiview_enabled: false,
		decklink_input_count: 0,
	}
	app.tandemTopology = { version: 1, destinations: [], signalPaths: [] }
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_count, 1, 'cleared destinations should not keep old screen_count')
	const map = getChannelMap(app)
	assert.equal(map.screenCount, 1)
	const xml = buildConfigXml(flat)
	assert.equal((xml.match(/<channel>/g) || []).length, 3, 'one main: OUTPUT + BUS1 + BUS2 (switcher_bus)')
})
