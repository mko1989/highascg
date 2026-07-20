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

test('default audio routing does not attach channel system-audio consumers', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 2
	app.casparServer = { ...app.casparServer, screen_count: 2, multiview_enabled: false }
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	const channelBlocks = [...xml.matchAll(/<channel>[\s\S]*?<\/channel>/g)].map((m) => m[0])
	assert.ok(channelBlocks.length >= 2)
	for (const block of channelBlocks) {
		const consumers = block.match(/<consumers>([\s\S]*?)<\/consumers>/)?.[1] || block
		assert.doesNotMatch(consumers, /<system-audio/, 'channel consumers must not get system-audio unless cabled in Device View')
	}
})

test('Device View system-audio cabling enables channel consumer (empty device = default sink)', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 1
	app.casparServer = { ...app.casparServer, screen_count: 1, multiview_enabled: false }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
		edidNotes: '',
	}
	app.audioOutputs = [{ id: 'audio_1', label: 'PGM out', enabled: true, type: 'system-audio', deviceName: '' }]
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_d1', kind: 'destination_in', externalRef: 'd1' },
			{ id: 'audio_1', kind: 'audio_out' },
		],
		edges: [{ sourceId: 'dst_in_d1', sinkId: 'audio_1' }],
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_system_audio_enabled, true)
	const xml = buildConfigXml(flat)
	const pgmBlock = xml.match(/Caspar channel 1:[\s\S]*?<channel>([\s\S]*?)<\/channel>/)?.[1] || ''
	assert.match(pgmBlock, /<system-audio\s*\/>/, 'cabled system-audio should appear on program channel')
})

test('Device View PortAudio 8ch cabling sets channel-layout and output channels', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 1
	app.casparServer = { ...app.casparServer, screen_count: 1, caspar_build_profile: 'custom_live', multiview_enabled: false }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50, audioLayout: '8ch' },
		],
		edidNotes: '',
	}
	app.audioOutputs = [{
		id: 'audio_1',
		label: 'PGM out',
		enabled: true,
		type: 'portaudio',
		deviceName: 'hw:1,3',
		channelLayout: '8ch',
		hostApi: 'ALSA',
		bufferFrames: 128,
		latencyMs: 40,
		fifoMs: 50,
	}]
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_d1', kind: 'destination_in', externalRef: 'd1' },
			{ id: 'audio_1', kind: 'audio_out' },
		],
		edges: [{ sourceId: 'dst_in_d1', sinkId: 'audio_1' }],
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_audio_layout, '8ch')
	assert.equal(flat.screen_1_portaudio_enabled, true)
	const consumers = flat.screen_1_portaudio_consumers
	assert.ok(Array.isArray(consumers) && consumers.length === 1)
	assert.equal(consumers[0].outputChannels, 8)
	const xml = buildConfigXml(flat)
	assert.match(xml, /<output-channels>8<\/output-channels>/)
	const pgmBlock = xml.match(/Caspar channel 1:[\s\S]*?<channel>([\s\S]*?)<\/channel>/)?.[1] || ''
	assert.match(pgmBlock, /<channel-layout>discrete-8ch<\/channel-layout>/)
	assert.match(xml, /<channel-order>c0 c1 c2 c3 c4 c5 c6 c7<\/channel-order>/)
})

test('PortAudio 8ch widens PGM channel-layout when destination is still stereo', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 1
	app.casparServer = { ...app.casparServer, screen_count: 1, caspar_build_profile: 'custom_live', multiview_enabled: false }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50, audioLayout: 'stereo' },
		],
		edidNotes: '',
	}
	app.audioOutputs = [{
		id: 'audio_1',
		label: 'PGM out',
		enabled: true,
		type: 'portaudio',
		deviceName: 'hw:1,3',
		channelLayout: '8ch',
	}]
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_d1', kind: 'destination_in', externalRef: 'd1' },
			{ id: 'audio_1', kind: 'audio_out' },
		],
		edges: [{ sourceId: 'dst_in_d1', sinkId: 'audio_1' }],
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_audio_layout, '8ch')
	const xml = buildConfigXml(flat)
	const pgmBlock = xml.match(/Caspar channel 1:[\s\S]*?<channel>([\s\S]*?)<\/channel>/)?.[1] || ''
	assert.match(pgmBlock, /<channel-layout>discrete-8ch<\/channel-layout>/)
	assert.match(xml, /<channel-order>c0 c1 c2 c3 c4 c5 c6 c7<\/channel-order>/)
})

test('uncabled second main stays stereo when first main has 8ch PortAudio', () => {
	const app = clone(defaults)
	addMockGraph(app)
	app.screen_count = 2
	app.casparServer = { ...app.casparServer, screen_count: 2, caspar_build_profile: 'custom_live', multiview_enabled: false }
	app.audioRouting = { ...(app.audioRouting || {}), programLayout: '8ch' }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'd1', label: 'Main1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50, audioLayout: '8ch' },
			{ id: 'd2', label: 'Main2', mainScreenIndex: 1, mode: 'pgm_only', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50, audioLayout: 'stereo' },
		],
		edidNotes: '',
	}
	app.audioOutputs = [{
		id: 'audio_1',
		label: 'PGM out',
		enabled: true,
		type: 'portaudio',
		deviceName: 'hw:1,3',
		channelLayout: '8ch',
	}]
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_d1', kind: 'destination_in', externalRef: 'd1' },
			{ id: 'audio_1', kind: 'audio_out' },
		],
		edges: [{ sourceId: 'dst_in_d1', sinkId: 'audio_1' }],
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_audio_layout, '8ch')
	assert.equal(flat.screen_2_audio_layout, 'stereo')
	const xml = buildConfigXml(flat)
	const ch2Block = xml.match(/Caspar channel 2:[\s\S]*?<channel>([\s\S]*?)<\/channel>/)?.[1] || ''
	assert.doesNotMatch(ch2Block, /<channel-layout>discrete-8ch<\/channel-layout>/)
	assert.doesNotMatch(ch2Block, /<output-channels>8<\/output-channels>/)
})

test('screen consumer x/y sync from graph layout without screen_N_system_id', () => {
	/* Fixtures, NOT config/ — this test used to require the LIVE device graph and screen
	 * destinations, so it failed the gate whenever the box was re-cabled or reconfigured
	 * (observed 2026-07-20: live config yielded screen_1_x undefined where the committed one
	 * yields 0). A gate test must not depend on mutable runtime state. */
	const graph = clone(require('./fixtures/device_graph.sample.json'))
	graph.edges = [
		...(Array.isArray(graph.edges) ? graph.edges : []),
		{ id: 'e_mv_gpu', sourceId: 'dst_in_dst_mqtchens_1', sinkId: 'gpu_p2' },
	]
	const app = {
		screen_count: 2,
		screen_2_x: 0,
		screen_2_y: 0,
		casparServer: {
			screen_count: 2,
			screen_1_mode: 'custom',
			screen_1_custom_width: 5120,
			screen_1_custom_height: 1024,
			screen_1_custom_fps: 50,
			screen_2_mode: '1080p5000',
			multiview_enabled: true,
			multiview_mode: '1080p5000',
			multiview_screen_consumer: true,
			preview_screen_consumer: false,
			streamingChannel: { enabled: false },
		},
		screenDestinations: require('./fixtures/screen_destinations.sample.json'),
		deviceGraph: graph,
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.screen_1_x, 0, 'mapping-fed PGM screen consumer aligns to mapping bbox origin')
	assert.ok(Number.isFinite(flat.multiview_x), 'multiview x from layout when GPU cabled')
	const xml = buildConfigXml(flat)
	const pgm = xml.match(/Screen 1 program output \(PGM\)[\s\S]*?<screen>[\s\S]*?<x>(\d+)<\/x>/)
	assert.ok(pgm, 'PGM screen consumer')
	assert.equal(pgm[1], '0')
	const mv = xml.match(/Multiview output #1[\s\S]*?<screen>[\s\S]*?<x>(\d+)<\/x>/)
	assert.ok(mv, 'multiview screen consumer when GPU cabled in Device View')
	assert.equal(mv[1], String(flat.multiview_x))
})

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
	return app
}

/** @param {string} xml @returns {string} the PGM `<screen>` inner block */
function pgmScreenBlock(xml) {
	const m = xml.match(/Screen 1 program output \(PGM\)[\s\S]*?<screen>([\s\S]*?)<\/screen>/)
	assert.ok(m, 'PGM screen consumer block present')
	return m[1]
}

test('PGM screen consumer is always-on-top by default (key unset)', () => {
	const flat = buildCasparGeneratorFlatConfig(pgmAlwaysOnTopFixture(undefined))
	assert.equal(flat.screen_1_always_on_top, true, 'flat config default is on')
	assert.match(
		pgmScreenBlock(buildConfigXml(flat)),
		/<always-on-top>true<\/always-on-top>/,
		'PGM defaults to always-on-top with no explicit setting',
	)
})

test('PGM always-on-top round-trips through the generator (set -> generate -> present)', () => {
	for (const want of [true, false]) {
		const flat = buildCasparGeneratorFlatConfig(pgmAlwaysOnTopFixture(want))
		assert.equal(flat.screen_1_always_on_top, want, `flat config keeps explicit ${want}`)
		const block = pgmScreenBlock(buildConfigXml(flat))
		assert.match(
			block,
			new RegExp(`<always-on-top>${want}</always-on-top>`),
			`explicit always_on_top=${want} survives to the generated XML`,
		)
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
