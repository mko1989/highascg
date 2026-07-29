'use strict'

/**
 * WO-242 smoke tests — native `pixelmap` screen destinations.
 *
 * Covers: T242.2 (model + defaults), T242.3 (generator XML + universe spill math),
 * T242.4 (routing/channel-map pgm-only classification, WO-160b path; takes' channel
 * classification function), T242.5/T242.6 (UI + deprecation-flag source-grep checks).
 *
 * Schema reference for all assertions: docs/WALKTHROUGH_ARTNET_LED_WALL.md (native <artnet>
 * consumer, cites into artnet_consumer.cpp).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { normalizeDestination } = require('../../src/config/screen-destinations')
const { getChannelMap } = require('../../src/config/routing-map')
const { computeArtnetUniverseSpill } = require('../../src/config/artnet-pixelmap-universe')
const { handleAddDestination, handleUpdateDestination } = require('../../src/api/device-view-crud')

function clone(cfg) {
	return JSON.parse(JSON.stringify(cfg))
}

/** Deterministic base config for generator tests: no live-disk config touched. */
function baseAppConfig() {
	const app = clone(defaults)
	app.casparServer = { ...app.casparServer, caspar_build_profile: 'custom_live' }
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	app.deviceGraph = { connectors: [], edges: [] }
	return app
}

describe('WO-242 T242.2: pixelmap destination model (screen-destinations.js)', () => {
	it('normalizeDestination fills native <artnet> schema defaults for mode=pixelmap', () => {
		const d = normalizeDestination({ id: 'wall1', label: 'Wall', mainScreenIndex: 0, mode: 'pixelmap' })
		assert.equal(d.mode, 'pixelmap')
		assert.equal(d.videoMode, 'custom', 'pixelmap defaults to a raster-exact custom mode, not a standard one')
		assert.deepEqual(d.artnet, {
			ip: '',
			port: 6454,
			startUniverse: 0,
			startAddress: 1,
			colorOrder: 'RGB',
			rows: 1,
			cols: 1,
			refreshRateHz: 10,
		})
	})

	it('clamps/validates artnet fields per the documented schema ranges', () => {
		const d = normalizeDestination({
			id: 'wall2',
			mode: 'pixelmap',
			artnet: {
				ip: 'not-an-ip',
				startAddress: 9999,
				startUniverse: -5,
				colorOrder: 'bogus',
				rows: 0,
				cols: -3,
				refreshRateHz: 0,
				port: 999999,
			},
		})
		assert.equal(d.artnet.ip, '', 'invalid IPv4 literal is rejected, not passed through')
		assert.equal(d.artnet.startAddress, 512, 'start-address clamped to 1-512 (artnet_consumer.cpp:577-583)')
		assert.equal(d.artnet.startUniverse, 0, 'universe clamped to 0-32767 (artnet_consumer.cpp:602-607)')
		assert.equal(d.artnet.colorOrder, 'RGB', 'unknown fixture type falls back to RGB')
		assert.equal(d.artnet.rows, 1)
		assert.equal(d.artnet.cols, 1)
		assert.equal(d.artnet.refreshRateHz, 1, 'refresh-rate >= 1 (artnet_consumer.cpp:748-751)')
		assert.equal(d.artnet.port, 65535, 'port clamped to 1-65535 (artnet_consumer.cpp:595-600)')
	})

	it('a valid IPv4 host round-trips unchanged', () => {
		const d = normalizeDestination({ id: 'wall3', mode: 'pixelmap', artnet: { ip: '192.168.1.50', rows: 4, cols: 8 } })
		assert.equal(d.artnet.ip, '192.168.1.50')
		assert.equal(d.artnet.rows, 4)
		assert.equal(d.artnet.cols, 8)
	})

	it('non-pixelmap destinations are unaffected (no artnet field, default 1080p5000)', () => {
		const d = normalizeDestination({ id: 'scr1', mode: 'pgm_prv' })
		assert.equal(d.artnet, undefined)
		assert.equal(d.videoMode, '1080p5000')
	})
})

describe('WO-242 T242.3: universe/spill math (docs/WALKTHROUGH_ARTNET_LED_WALL.md worked examples)', () => {
	it('8x4 wall, RGB (3ch), start-address 1 -> fits in a single universe', () => {
		const spill = computeArtnetUniverseSpill({ rows: 4, cols: 8, channelsPerFixture: 3, startAddress: 1, startUniverse: 0 })
		assert.equal(spill.totalFixtures, 32)
		assert.equal(spill.universesUsed, 1)
		assert.equal(spill.endUniverse, 0)
	})

	it('48x27 grid, RGB (3ch), start-address 1 -> spans 8 universes (0-7), matching the walkthrough', () => {
		const spill = computeArtnetUniverseSpill({ rows: 27, cols: 48, channelsPerFixture: 3, startAddress: 1, startUniverse: 0 })
		assert.equal(spill.totalFixtures, 1296)
		assert.equal(spill.firstUniverseCapacity, 170, 'floor(512/3) = 170 fixtures/universe, per the walkthrough')
		assert.equal(spill.universesUsed, 8)
		assert.equal(spill.endUniverse, 7)
	})

	it('honors a non-default startUniverse offset', () => {
		const spill = computeArtnetUniverseSpill({ rows: 4, cols: 8, channelsPerFixture: 4, startAddress: 1, startUniverse: 5 })
		assert.equal(spill.startUniverse, 5)
		assert.equal(spill.endUniverse, 5)
	})
})

describe('WO-242 T242.3: config generator emits the channel + native <artnet> consumer', () => {
	it('no pixelmap destinations -> no <artnet> in generated config, deterministic output', () => {
		const app = baseAppConfig()
		app.screenDestinations = {
			version: 1,
			destinations: [
				{ id: 'scr1', label: 'Main', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			],
		}
		const flat1 = buildCasparGeneratorFlatConfig(app)
		const xml1 = buildConfigXml(flat1)
		const flat2 = buildCasparGeneratorFlatConfig(clone(app))
		const xml2 = buildConfigXml(flat2)

		assert.doesNotMatch(xml1, /<artnet>/, 'no pixelmap destination -> no <artnet> consumer emitted')
		assert.equal(xml1, xml2, 'generator output is deterministic/unaffected when no pixelmap destination exists')
		assert.equal((xml1.match(/<channel>/g) || []).length, 2, 'plain pgm_prv screen still yields exactly PGM+PRV channels')
	})

	it('one pixelmap destination (8x4 RGB wall) -> exact expected <artnet> XML', () => {
		const app = baseAppConfig()
		app.screenDestinations = {
			version: 1,
			destinations: [
				{
					id: 'wall1',
					label: 'Stage Wall',
					mainScreenIndex: 0,
					mode: 'pixelmap',
					videoMode: 'custom',
					width: 1920,
					height: 1080,
					fps: 50,
					artnet: {
						ip: '192.168.1.50',
						startUniverse: 0,
						startAddress: 1,
						colorOrder: 'RGB',
						rows: 4,
						cols: 8,
						refreshRateHz: 30,
					},
				},
			],
		}
		const flat = buildCasparGeneratorFlatConfig(app)
		const xml = buildConfigXml(flat)

		// Custom video-mode registered via the existing custom-modes mechanism (bare WxH id; FPS
		// carries into <time-scale>/<cadence>, not the id — config-modes.js:95-110).
		assert.match(xml, /<id>1920x1080<\/id>/, 'custom mode id is registered in <video-modes>')

		const chBlock = xml.match(/<!-- HighAsCG: Caspar channel \d+: Pixel-map screen[\s\S]*?<\/channel>/)
		assert.ok(chBlock, 'pixelmap channel block present')
		const block = chBlock[0]

		assert.match(block, /<video-mode>1920x1080<\/video-mode>/)
		assert.match(block, /<refresh-rate>30<\/refresh-rate>/)
		assert.match(block, /<type>RGB<\/type>/)
		assert.match(block, /<start-address>1<\/start-address>/)
		assert.match(block, /<fixture-count>8x4<\/fixture-count>/, 'cols x rows -> WxH grid per the schema')
		assert.match(block, /<fixture-channels>3<\/fixture-channels>/, 'RGB = 3 channels/fixture')
		assert.match(block, /<host>192\.168\.1\.50<\/host>/)
		assert.match(block, /<port>6454<\/port>/)
		assert.match(block, /<universe>0<\/universe>/)
		assert.match(block, /<x>960<\/x>/, 'samples the full raster, centered (matches the walkthrough example)')
		assert.match(block, /<y>540<\/y>/)
		assert.match(block, /<width>1920<\/width>/)
		assert.match(block, /<height>1080<\/height>/)
		assert.doesNotMatch(block, /<screen>/, 'pixelmap channel is PGM-only: no GPU screen consumer')
		assert.doesNotMatch(block, /<decklink>/)
		assert.doesNotMatch(block, /<ndi>/)

		// Single universe (32 fixtures x 3ch = 96 <= 512) — assert via the comment's universe note too.
		assert.match(block, /universe 0(?!-)/, 'single-universe note, not a spill range')

		// No PRV channel comment/pair should be emitted for this main index (PGM-only).
		assert.doesNotMatch(xml, /Screen 1 preview output \(PRV\)/)
	})

	it('a wide grid that spills universes shows the auto-spill note and fixture-count', () => {
		const app = baseAppConfig()
		app.screenDestinations = {
			version: 1,
			destinations: [
				{
					id: 'wall2',
					label: 'Big Wall',
					mainScreenIndex: 0,
					mode: 'pixelmap',
					videoMode: 'custom',
					width: 1920,
					height: 1080,
					fps: 50,
					artnet: {
						ip: '10.0.0.9',
						startUniverse: 0,
						startAddress: 1,
						colorOrder: 'RGB',
						rows: 27,
						cols: 48,
						refreshRateHz: 10,
					},
				},
			],
		}
		const flat = buildCasparGeneratorFlatConfig(app)
		const xml = buildConfigXml(flat)
		const chBlock = xml.match(/<!-- HighAsCG: Caspar channel \d+: Pixel-map screen[\s\S]*?<\/channel>/)
		assert.ok(chBlock)
		assert.match(chBlock[0], /<fixture-count>48x27<\/fixture-count>/)
		assert.match(
			xml,
			/universes 0-7 \(8 universes, auto-spill\)/,
			'8-universe spill note matches computeArtnetUniverseSpill for this grid',
		)
	})

	it('RGBW fixtures use 4 channels/fixture', () => {
		const app = baseAppConfig()
		app.screenDestinations = {
			version: 1,
			destinations: [
				{
					id: 'wall3',
					mainScreenIndex: 0,
					mode: 'pixelmap',
					videoMode: 'custom',
					width: 640,
					height: 360,
					fps: 30,
					artnet: { ip: '192.168.1.60', colorOrder: 'RGBW', rows: 2, cols: 2 },
				},
			],
		}
		const flat = buildCasparGeneratorFlatConfig(app)
		const xml = buildConfigXml(flat)
		const chBlock = xml.match(/<!-- HighAsCG: Caspar channel \d+: Pixel-map screen[\s\S]*?<\/channel>/)
		assert.match(chBlock[0], /<type>RGBW<\/type>/)
		assert.match(chBlock[0], /<fixture-channels>4<\/fixture-channels>/)
	})
})

describe('WO-242 T242.4: routing/channel-map registers pixelmap as a PGM-only screen (WO-160b path)', () => {
	function twoScreenConfig() {
		const app = clone(defaults)
		app.screenDestinations = {
			version: 1,
			destinations: [
				{
					id: 'wall1',
					mainScreenIndex: 0,
					mode: 'pixelmap',
					videoMode: 'custom',
					width: 1920,
					height: 1080,
					fps: 50,
					artnet: { ip: '192.168.1.50', rows: 4, cols: 8 },
				},
				{ id: 'scr2', mainScreenIndex: 1, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			],
		}
		return app
	}

	it('previewEnabledByMain/previewChannels are null for the pixelmap main (no PRV bus)', () => {
		const cm = getChannelMap(twoScreenConfig())
		assert.equal(cm.screenCount, 2)
		assert.equal(cm.previewEnabledByMain[0], false, 'pixelmap main has no preview bus')
		assert.equal(cm.previewChannels[0], null)
		assert.ok(Number.isFinite(cm.programChannels[0]), 'pixelmap main still gets a dedicated PGM channel')
		// Sibling normal screen is unaffected.
		assert.equal(cm.previewEnabledByMain[1], true)
		assert.ok(Number.isFinite(cm.previewChannels[1]))
	})

	it('screenLabels (WO-222 helper) flow through unchanged for a pixelmap main', async () => {
		// WO-385: a screen's name IS its destination's name — "name and label should be one thing".
		// The legacy `config.screenLabels` array stayed as the fallback for indices no destination
		// owns, so this now checks BOTH halves of that rule on a pixelmap main.
		const { screenLabel } = await import('../../client/lib/screen-label.js')
		const app = twoScreenConfig()
		app.screenLabels = ['LED Wall']
		const cm = getChannelMap(app)
		// This destination has no label of its own (normalizeDestination falls back to its id, a
		// generated string) — so the stored array still wins.
		assert.equal(screenLabel(cm, 0), 'LED Wall', 'a stored label outranks an auto-generated id')
		assert.equal(screenLabel(cm, 1), 'S2', 'fallback label unaffected')

		// A destination the operator actually NAMED is what the screen is called.
		const named = twoScreenConfig()
		named.screenLabels = ['LED Wall']
		named.screenDestinations.destinations[0].label = 'Stage wall'
		assert.equal(
			screenLabel(getChannelMap(named), 0),
			'Stage wall',
			'the destination name is the screen name (WO-385)',
		)
	})

	it("takes' channel classification (isPreviewBusAvailable) reports the pixelmap main as pgm-only", async () => {
		const { isPreviewBusAvailable } = await import('../../client/lib/scenes-preview-look-stack.js')
		const cm = getChannelMap(twoScreenConfig())
		assert.equal(isPreviewBusAvailable(cm, 0), false, 'pixelmap main -> pgm-only take path (WO-160b)')
		assert.equal(isPreviewBusAvailable(cm, 1), true, 'sibling pgm_prv main is unaffected')
	})
})

describe('WO-242 T242.4/T242.5: device-view CRUD accepts and persists pixelmap destinations', () => {
	function mockCtx(initialConfig) {
		const config = initialConfig
		return {
			config,
			configManager: {
				get: () => config,
				save: (next) => Object.assign(config, next),
			},
		}
	}

	it('handleAddDestination creates a pixelmap destination with default artnet fields', () => {
		const ctx = mockCtx({ screenDestinations: { version: 1, destinations: [] } })
		const res = handleAddDestination({ addDestination: { type: 'pixelmap', mainScreenIndex: 0 } }, ctx)
		assert.equal(res.ok, true)
		const d = res.screenDestinations.destinations.find((x) => x.id === res.addedId)
		assert.equal(d.mode, 'pixelmap')
		assert.ok(d.artnet, 'artnet fixture-array object present with defaults')
		assert.equal(d.artnet.colorOrder, 'RGB')
	})

	it('handleUpdateDestination merges partial artnet patches without clobbering sibling fields', () => {
		const ctx = mockCtx({
			screenDestinations: {
				version: 1,
				destinations: [
					{ id: 'wall1', mainScreenIndex: 0, mode: 'pixelmap', videoMode: 'custom', width: 1920, height: 1080, fps: 50, artnet: { ip: '192.168.1.50', rows: 4, cols: 8, colorOrder: 'RGB' } },
				],
			},
		})
		const res = handleUpdateDestination({ updateDestination: { id: 'wall1', artnet: { rows: 6 } } }, ctx)
		assert.equal(res.ok, true)
		const d = res.screenDestinations.destinations[0]
		assert.equal(d.artnet.rows, 6, 'patched field applied')
		assert.equal(d.artnet.cols, 8, 'sibling field preserved, not clobbered')
		assert.equal(d.artnet.ip, '192.168.1.50', 'sibling field preserved')
	})
})

describe('WO-242 T242.5/T242.6: UI wiring + legacy-flag deprecation gate (source checks)', () => {
	const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

	it('destination type select + inspector form know about pixelmap', () => {
		assert.match(read('client/lib/device-view-host-channels.js'), /value:\s*'pixelmap'/)
		const form = read('client/components/device-view-destinations-inspector-form.js')
		assert.match(form, /'pixelmap'/)
		assert.match(form, /Fixture columns/)
		assert.match(form, /Fixture rows/)
		assert.match(form, /Start universe/)
	})

	it('addDestination() client action normalizes the pixelmap type', () => {
		assert.match(read('client/components/device-view-actions.js'), /o\.type === 'pixelmap'/)
	})

	it('legacyJsPixelmap settings flag exists, defaults off, and gates the JS pixel-map UI entry points', () => {
		assert.match(read('src/config/defaults-core.js'), /legacyJsPixelmap:\s*false/)
		// Note: WO-253 removed the gates from pixel-map-editor.js and device-view-mappings-render.js.
		// The flag remains defined but unused; see WO-253 T253.1.
	})

	it('docs badge the JS pipeline deprecated and document the native pixelmap screen flow', () => {
		const docs = read('docs/ARTNET_PIXEL_MAPPING.md')
		assert.match(docs, /DEPRECATED/i)
		assert.match(docs, /legacyJsPixelmap/)
		assert.match(docs, /Pixel-map screen \(native\)/i)
	})
})

describe('WO-253 T253.1/T253.2/T253.4: Un-deprecate mapping nodes + rename + docs scope', () => {
	const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

	it('T253.1 + T253.4: pixel-map-editor.js contains NO legacyJsPixelmap gate', () => {
		const editor = read('client/components/pixel-map-editor.js')
		assert.doesNotMatch(editor, /legacyJsPixelmap/, 'legacyJsPixelmap gate removed from pixel-map-editor.js')
		assert.doesNotMatch(editor, /showScenesToast.*deprecated/, 'deprecation toast removed')
	})

	it('T253.1 + T253.4: device-view-mappings-render.js renders the + button unconditionally', () => {
		const mappings = read('client/components/device-view-mappings-render.js')
		assert.doesNotMatch(mappings, /settingsState/, 'settingsState import removed')
		assert.doesNotMatch(mappings, /legacyJsPixelmapEnabled/, 'legacyJsPixelmapEnabled function removed')
		assert.doesNotMatch(mappings, /!legacyOn && !nodes\.length/, 'deprecation note conditional removed')
		assert.match(mappings, /data-add-mapping/, 'add button present')
		assert.match(mappings, /Mapping nodes/, 'heading text correct')
	})

	it('T253.2: device-view band heading says "Mapping nodes" (not "Pixel Mappings")', () => {
		const mappings = read('client/components/device-view-mappings-render.js')
		assert.match(mappings, /Mapping nodes/, 'heading renamed to "Mapping nodes"')
		assert.doesNotMatch(mappings, /Pixel Mappings/, 'old "Pixel Mappings" heading removed')
	})

	it('T253.2: device-view-inspector-mapping.js section title says "Mapping Node" (not "Pixel Mapping Node")', () => {
		const inspector = read('client/components/device-view-inspector-mapping.js')
		assert.match(inspector, /section\('Mapping Node'\)/, 'section title renamed')
		assert.doesNotMatch(inspector, /section\('Pixel Mapping Node'\)/, 'old title removed')
	})

	it('T253.1 + T253.2: device-view-inspector-mapping.js editor button has no deprecation title', () => {
		const inspector = read('client/components/device-view-inspector-mapping.js')
		assert.doesNotMatch(inspector, /editorBtn\.title = /, 'deprecated title attribute removed')
		assert.match(inspector, /editorBtn\.textContent = 'Show Mapping Preview'/, 'button text preserved')
	})

	it('T253.3: docs corrected: mapping nodes are canvas-splitting, not the deprecated JS pipeline', () => {
		const docs = read('docs/ARTNET_PIXEL_MAPPING.md')
		assert.match(docs, /mapping nodes.*canvas-splitting.*remain.*active/, 'docs clarify mapping nodes are active')
		assert.doesNotMatch(docs, /Pixel Map editor overlay, ".*Add mapping node/, 'old incorrect description removed')
	})

	it('T253.3: walkthroughs clarify mapping nodes are not the JS engine', () => {
		const fixtures = read('docs/WALKTHROUGH_PIXELMAP_FIXTURES.md')
		assert.match(fixtures, /mapping nodes.*separate canvas-splitting/, 'walkthrough clarifies the distinction')
		assert.doesNotMatch(fixtures, /UI entry points.*Pixel Map editor overlay.*Add mapping node/, 'old incorrect JS UI list corrected')
	})
})
