'use strict'

/**
 * WO-716 — owner 23.10.26: "vsync should always be off, while nvidia gltexture needs to be enabled per
 * channel". Every Caspar `<screen>` consumer HighAsCG writes (PGM, the WO-364 PRV head, multiview, the
 * operator-GUI channel, both build profiles, the ISO template) carries `<vsync>false</vsync>` and
 * `<gpu-texture>true</gpu-texture>`, whatever `screen_N_vsync` / `multiview_vsync` say. WO-715 measured
 * vsync on at ~78 % of a core per consumer (NVIDIA spin-waits in glXSwapBuffers).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const {
	buildProgramScreenConsumerInnerXml,
	buildMultiviewScreenConsumerInnerXml,
} = require('../../src/config/config-generator-screen-xml')
const { buildScreenPairChannels } = require('../../src/config/config-generator-consumer-attach-screen')
const { buildOperatorGuiChannel } = require('../../src/config/config-generator-operator-gui')
const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const { clone } = require('./lib/config-generator-routing-fixtures')

const ROOT = path.join(__dirname, '..', '..')
const screens = (xml) => [...xml.matchAll(/<screen>([\s\S]*?)<\/screen>/g)].map((m) => m[1])

/** Each `<screen>` block: exactly one vsync line, false; exactly one gpu-texture line, true. */
function assertEveryScreen(xml, what, min = 1) {
	const blocks = screens(xml)
	assert.ok(blocks.length >= min, `${what}: ${blocks.length} <screen> blocks, want ≥ ${min}`)
	blocks.forEach((b, i) => {
		assert.deepEqual(b.match(/<vsync>\w+<\/vsync>/g), ['<vsync>false</vsync>'], `${what} #${i}: vsync`)
		assert.deepEqual(b.match(/<gpu-texture>\w+<\/gpu-texture>/g), ['<gpu-texture>true</gpu-texture>'], `${what} #${i}: gpu-texture`)
	})
}

const CTX = { nextDevice: 1, posX: 0, posY: 0, dims: { width: 1920, height: 1080 }, stretch: 'none', windowed: true,
	vsync: true, alwaysOnTop: false, borderless: true }

test('WO-716: PGM and multiview inner XML, both build profiles, ignore vsync true', () => {
	for (const profile of ['custom_live', 'stock']) {
		const cfg = { caspar_build_profile: profile, screen_1_vsync: true, multiview_vsync: true, multiview_1_vsync: true }
		assertEveryScreen(`<screen>${buildProgramScreenConsumerInnerXml(cfg, 1, CTX)}</screen>`, `${profile} PGM`)
		assertEveryScreen(`<screen>${buildMultiviewScreenConsumerInnerXml(cfg, { ...CTX, n: 1 })}</screen>`, `${profile} MV`)
	}
})

test('WO-716: the screen pair — PGM and the WO-364 PRV head — both carry the two lines', () => {
	const routeMap = { programCh: () => 1, previewCh: () => 2, programChannels: [1], previewChannels: [2] }
	const ctx = { n: 1, dims: { width: 1920, height: 1080 }, cumulativeX: 0, nextDevice: 1 }
	const cfg = { caspar_build_profile: 'custom_live', screen_1_vsync: true, screen_1_prv_screen_consumer: true }
	assertEveryScreen(JSON.stringify(buildScreenPairChannels(cfg, routeMap, ctx)), 'pair', 2)
})

test('WO-716: the operator-GUI channel', () => {
	const dest = normalizeScreenDestinations({
		version: 1,
		destinations: [{ id: 'og', mode: 'operator_gui', physicalPort: 2, label: 'Operator GUI' }],
	}).destinations[0]
	const dims = { width: 1920, height: 1080, fps: 50, modeId: '1080p5000', isCustom: false }
	assertEveryScreen(buildOperatorGuiChannel({}, dest, dims, { cumulativeX: 0, nextDevice: 1, layout: null }, 5), 'operator GUI')
})

test('WO-716: a full generated config with every vsync key on', () => {
	const app = clone(defaults)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_vsync: true,
		multiview_enabled: true,
		multiview_output_mode: 'screen_only',
		multiview_vsync: true,
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
		connectors: [{ id: 'dst_in_mv', kind: 'destination_in', externalRef: 'mv' }, { id: 'gpu_p0', kind: 'gpu_out' }],
		edges: [{ sourceId: 'dst_in_mv', sinkId: 'gpu_p0' }],
	}
	assertEveryScreen(buildConfigXml(buildCasparGeneratorFlatConfig(app)), 'full config (the multiview screen)')
})

test('WO-716: the ISO template (first boot / after a produce)', () => {
	assertEveryScreen(fs.readFileSync(path.join(ROOT, 'config/casparcg.config.iso'), 'utf8'), 'casparcg.config.iso')
})

test('WO-716: no V-sync control in either UI', () => {
	const gd = fs.readFileSync(path.join(ROOT, 'godot/client/features/devices/gpu_output_controls.gd'), 'utf8')
	const base = /const BASE_CHECKS := \[([\s\S]*?)\]\]/.exec(gd)
	assert.ok(base, 'BASE_CHECKS still exists')
	assert.doesNotMatch(base[1], /V-sync/)
	const web = fs.readFileSync(path.join(ROOT, 'client/components/device-view-inspector-gpu.js'), 'utf8')
	assert.doesNotMatch(web, /'V-sync'/)
	assert.doesNotMatch(web, /vsyncIn\.addEventListener/)
})
