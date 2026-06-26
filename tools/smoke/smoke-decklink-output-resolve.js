const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const {
	matchStandardDecklinkVideoMode,
	resolveDecklinkOutputStatus,
	listDecklinkOutputStatuses,
} = require('../../src/config/decklink-output-resolve')

function clone(cfg) {
	return JSON.parse(JSON.stringify(cfg))
}

test('matchStandardDecklinkVideoMode: standard id passes through', () => {
	const m = matchStandardDecklinkVideoMode({ videoMode: '2160p5000', width: 3840, height: 2160, fps: 50 })
	assert.equal(m.decklinkVideoMode, '2160p5000')
	assert.equal(m.isCustom, false)
})

test('matchStandardDecklinkVideoMode: custom 8192x1080 is invalid', () => {
	const m = matchStandardDecklinkVideoMode({ videoMode: 'custom', width: 8192, height: 1080, fps: 50 })
	assert.equal(m.decklinkVideoMode, null)
	assert.equal(m.isCustom, true)
})

test('matchStandardDecklinkVideoMode: exact WxH maps to standard', () => {
	const m = matchStandardDecklinkVideoMode({ videoMode: 'custom', width: 3840, height: 2160, fps: 50 })
	assert.equal(m.decklinkVideoMode, '2160p5000')
	assert.equal(m.mappedFromCustom, true)
})

test('resolver: MVR destination 2160p5000 cabled to decklink_out is ok', () => {
	const app = clone(defaults)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'mv',
				label: 'Multiview',
				mainScreenIndex: 0,
				mode: 'multiview',
				videoMode: '2160p5000',
				width: 3840,
				height: 2160,
				fps: 50,
			},
		],
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
			{ id: 'caspar_mv_out', kind: 'caspar_mv_out', deviceId: 'caspar_host' },
			{ id: 'dlo_1', kind: 'decklink_out', deviceId: 'caspar_host', externalRef: '2' },
		],
		edges: [
			{ sourceId: 'dst_in_mv', sinkId: 'caspar_mv_out' },
			{ sourceId: 'caspar_mv_out', sinkId: 'dlo_1' },
		],
	}
	app.casparServer = {
		...app.casparServer,
		multiview_mode: '2160p5000',
		multiview_decklink_device: 2,
	}
	const st = resolveDecklinkOutputStatus(app, { id: 'dlo_1', kind: 'decklink_out', externalRef: '2' })
	assert.equal(st.ok, true)
	assert.equal(st.decklinkVideoMode, '2160p5000')
})

test('resolver: custom destination cabled to decklink is invalid without SDI format', () => {
	const app = clone(defaults)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'wide',
				label: 'Wide PGM',
				mainScreenIndex: 0,
				mode: 'pgm_prv',
				videoMode: 'custom',
				width: 8192,
				height: 1080,
				fps: 50,
			},
		],
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_wide', kind: 'destination_in', externalRef: 'wide' },
			{ id: 'caspar_pgm_1', kind: 'gpu_out', deviceId: 'caspar_host' },
			{ id: 'dli_2', kind: 'decklink_io', deviceId: 'caspar_host', externalRef: '2', caspar: { ioDirection: 'out' } },
		],
		edges: [
			{ sourceId: 'dst_in_wide', sinkId: 'caspar_pgm_1' },
			{ sourceId: 'caspar_pgm_1', sinkId: 'dli_2' },
		],
	}
	const statuses = listDecklinkOutputStatuses(app)
	assert.equal(statuses.length, 1)
	assert.equal(statuses[0].ok, false)
	assert.match(String(statuses[0].reason || ''), /SDI output format/i)
})

test('resolver: custom destination with explicit SDI format is ok', () => {
	const app = clone(defaults)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'wide',
				label: 'Wide PGM',
				mainScreenIndex: 0,
				mode: 'pgm_prv',
				videoMode: 'custom',
				width: 8192,
				height: 1080,
				fps: 50,
			},
		],
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_wide', kind: 'destination_in', externalRef: 'wide' },
			{ id: 'caspar_pgm_1', kind: 'gpu_out', deviceId: 'caspar_host' },
			{
				id: 'dli_2',
				kind: 'decklink_io',
				deviceId: 'caspar_host',
				externalRef: '2',
				caspar: { ioDirection: 'out', decklinkOutputVideoMode: '1080p5000' },
			},
		],
		edges: [
			{ sourceId: 'dst_in_wide', sinkId: 'caspar_pgm_1' },
			{ sourceId: 'caspar_pgm_1', sinkId: 'dli_2' },
		],
	}
	const st = resolveDecklinkOutputStatus(app, app.deviceGraph.connectors[2])
	assert.equal(st.ok, true)
	assert.equal(st.decklinkVideoMode, '1080p5000')
})

test('generator XML: multiview decklink consumer includes inherited 2160p5000 video-mode', () => {
	const app = clone(defaults)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'mv',
				label: 'Multiview',
				mainScreenIndex: 0,
				mode: 'multiview',
				videoMode: '2160p5000',
				width: 3840,
				height: 2160,
				fps: 50,
			},
		],
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' },
			{ id: 'caspar_mv_out', kind: 'caspar_mv_out', deviceId: 'caspar_host' },
			{ id: 'dli_2', kind: 'decklink_io', deviceId: 'caspar_host', externalRef: '2', caspar: { ioDirection: 'out' } },
		],
		edges: [
			{ sourceId: 'dst_in_mv', sinkId: 'caspar_mv_out' },
			{ sourceId: 'caspar_mv_out', sinkId: 'dli_2' },
		],
	}
	app.casparServer = {
		...app.casparServer,
		multiview_enabled: true,
		multiview_mode: '2160p5000',
		multiview_output_mode: 'decklink_only',
		multiview_decklink_device: 2,
		multiview_decklink_replace_screen: true,
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	assert.match(xml, /<video-mode>2160p5000<\/video-mode>[\s\S]*<decklink>[\s\S]*<video-mode>2160p5000<\/video-mode>[\s\S]*<buffer-depth>5<\/buffer-depth>/)
	assert.doesNotMatch(xml, /<decklink>[\s\S]*<pixel-format>yuv<\/pixel-format>/)
	assert.match(xml, /Multiview output #1[\s\S]*<decklink>[\s\S]*<keyer>default<\/keyer>/)
	assert.doesNotMatch(xml, /Multiview output #1[\s\S]*<video-mode>1080p5000<\/video-mode>[\s\S]*<decklink>/)
})

test('generator XML: custom PGM screen emits decklink with 1:1 subregion when SDI format set', () => {
	const app = clone(defaults)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'pgm1',
				label: 'PGM',
				mainScreenIndex: 0,
				mode: 'pgm_prv',
				videoMode: 'custom',
				width: 3072,
				height: 1728,
				fps: 50,
			},
		],
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_pgm1', kind: 'destination_in', externalRef: 'pgm1' },
			{ id: 'gpu_p0', kind: 'gpu_out', deviceId: 'caspar_host' },
			{
				id: 'dlo_4',
				kind: 'decklink_out',
				deviceId: 'caspar_host',
				externalRef: '4',
				caspar: { decklinkOutputVideoMode: '2160p5000' },
			},
		],
		edges: [
			{ sourceId: 'dst_in_pgm1', sinkId: 'gpu_p0' },
			{ sourceId: 'dst_in_pgm1', sinkId: 'dlo_4' },
		],
	}
	app.casparServer = {
		...app.casparServer,
		screen_1_mode: 'custom',
		screen_1_custom_width: 3072,
		screen_1_custom_height: 1728,
		screen_1_custom_fps: 50,
		screen_1_screen_consumer: true,
		screen_1_decklink_device: 4,
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	assert.match(xml, /Screen 1 program[\s\S]*<video-mode>3072x1728<\/video-mode>/)
	assert.match(xml, /Screen 1 program[\s\S]*<decklink>[\s\S]*<video-mode>2160p5000<\/video-mode>/)
	assert.match(xml, /Screen 1 program[\s\S]*<subregion>[\s\S]*<width>3072<\/width>[\s\S]*<height>1728<\/height>/)
	assert.match(xml, /Screen 1 program[\s\S]*<embedded-audio>true<\/embedded-audio>/)
})

test('generator XML: custom PGM omits decklink without explicit SDI format', () => {
	const app = clone(defaults)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{
				id: 'pgm1',
				label: 'PGM',
				mainScreenIndex: 0,
				mode: 'pgm_prv',
				videoMode: 'custom',
				width: 3072,
				height: 1728,
				fps: 50,
			},
		],
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_pgm1', kind: 'destination_in', externalRef: 'pgm1' },
			{ id: 'gpu_p0', kind: 'gpu_out', deviceId: 'caspar_host' },
			{ id: 'dlo_4', kind: 'decklink_out', deviceId: 'caspar_host', externalRef: '4' },
		],
		edges: [
			{ sourceId: 'dst_in_pgm1', sinkId: 'gpu_p0' },
			{ sourceId: 'dst_in_pgm1', sinkId: 'dlo_4' },
		],
	}
	app.casparServer = {
		...app.casparServer,
		screen_1_mode: 'custom',
		screen_1_custom_width: 3072,
		screen_1_custom_height: 1728,
		screen_1_custom_fps: 50,
		screen_1_screen_consumer: true,
		screen_1_decklink_device: 4,
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	const xml = buildConfigXml(flat)
	assert.doesNotMatch(xml, /Screen 1 program[\s\S]*<decklink>/)
})

test('buildDecklinkKeyFillConsumersXml: fill-only includes consumer defaults', () => {
	const { buildDecklinkKeyFillConsumersXml } = require('../../src/config/decklink-key-fill')
	const xml = buildDecklinkKeyFillConsumersXml({ fillDevice: 4, videoMode: '1080p5000' })
	assert.match(xml, /<keyer>default<\/keyer>/)
	assert.match(xml, /<embedded-audio>true<\/embedded-audio>/)
	assert.match(xml, /<buffer-depth>5<\/buffer-depth>/)
	assert.match(xml, /<color-space>bt709<\/color-space>/)
	assert.doesNotMatch(xml, /<key-device>/)
})

test('buildDecklinkKeyFillConsumersXml: key/fill pair uses configured keyer', () => {
	const { buildDecklinkKeyFillConsumersXml } = require('../../src/config/decklink-key-fill')
	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		keyDevice: 2,
		keyer: 'internal',
		videoMode: '1080p5000',
	})
	assert.match(xml, /<keyer>internal<\/keyer>/)
	assert.match(xml, /<key-device>2<\/key-device>/)
})

test('validateDecklinkOutputResolutions: warns on UHD decklink output', () => {
	const { validateDecklinkOutputResolutions } = require('../../src/config/decklink-output-resolve')
	const app = clone(defaults)
	app.screenDestinations = {
		version: 1,
		destinations: [{ id: 'mv1', mode: 'multiview', videoMode: '2160p5000', width: 3840, height: 2160, fps: 50 }],
	}
	app.deviceGraph = {
		connectors: [
			{ id: 'dst_in_mv1', kind: 'destination_in', externalRef: 'mv1' },
			{ id: 'dlsdi_4', kind: 'decklink_io', deviceId: 'caspar_host', externalRef: '4', caspar: { ioDirection: 'out' } },
		],
		edges: [{ sourceId: 'dst_in_mv1', sinkId: 'dlsdi_4' }],
	}
	const flat = buildCasparGeneratorFlatConfig(app)
	const warnings = validateDecklinkOutputResolutions({ ...app, ...flat })
	assert.ok(warnings.some((w) => w.startsWith('decklink_output_uhd_format:dlsdi_4')))
})
