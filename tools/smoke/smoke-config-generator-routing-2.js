const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { getChannelMap } = require('../../src/config/routing')
const { clone, addMockGraph, addMainDestinations } = require('./lib/config-generator-routing-fixtures')

/*
 * Split out of tools/smoke/smoke-config-generator-routing.js for line-count hygiene — see also:
 *   tools/smoke/smoke-config-generator-routing-3.js
 *   tools/smoke/smoke-config-generator-routing-4.js
 * Shared fixture builders live in tools/smoke/lib/config-generator-routing-fixtures.js.
 */

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
	/* Original point of this test — a stale screen_count of 4 must not spawn four PGM/PRV pairs —
	 * still holds. What changed is the floor: it used to bottom out at ONE main bus, so a
	 * factory-reset box emitted a Screen 1 PGM+PRV pair with no destination behind it. The owner
	 * reads that as a leftover, and it is. No destinations now means no channels. */
	assert.notEqual(flat.screen_count, 4, 'cleared destinations must not keep old screen_count')
	const map = getChannelMap(app)
	assert.equal(map.screenCount, 0, 'no destinations → no main bus')
	const xml = buildConfigXml(flat)
	assert.equal((xml.match(/<channel>/g) || []).length, 0, 'a blank slate generates no channels')
	assert.match(xml, /<channels>\s*<\/channels>/, 'channels element is present but empty')
})

test('default audio routing does not attach channel system-audio consumers', () => {
	const app = clone(defaults)
	addMockGraph(app)
	addMainDestinations(app, 2)
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
