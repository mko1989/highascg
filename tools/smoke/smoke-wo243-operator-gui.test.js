'use strict'

/**
 * WO-243/255 smoke tests — Operator GUI channel: destination model, routing, generator, and layout
 * endpoint pure logic.
 *
 * Covers: T243.1 (destination model), T243.2 (routing exclusion, generator channel emission,
 * layout-endpoint pure logic + router registration grep).
 *
 * Line-count refactor split this file (originally 599 lines) into topical siblings, all still
 * registered in tools/ci/run-offline-tests.js's curated FILES array:
 *   - smoke-wo243-operator-gui-crud-ui.test.js: T243.1 device-view CRUD + client-gate/UI source checks
 *   - smoke-wo243-operator-gui-guards.test.js: program-screen-slot regression guard, boot-window
 *     shrink guard, and the never-persist-an-empty-layout guard
 *
 * WO-255 split (line-count target): aspect-fit pure functions (T254.1), the CEF-layer/auto-arm
 * retirement guards, the shape helper (T255.1), the Firefox launcher + routes (T255.2), and the
 * client rect-reporting pure-logic tests (T255.3) all live in
 * tools/smoke/smoke-wo255-shaped-overlay.test.js instead.
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
const {
	computeOperatorGuiCellPlan,
	resolveOperatorGuiChannel,
	resetOperatorGuiStateForTests,
} = require('../../src/system/operator-gui-channel')
const { REPO_ROOT } = require('../../src/repo-paths')

function clone(cfg) {
	return JSON.parse(JSON.stringify(cfg))
}

function baseAppConfig() {
	const app = clone(defaults)
	app.casparServer = { ...app.casparServer, caspar_build_profile: 'custom_live' }
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	app.deviceGraph = { connectors: [], edges: [] }
	return app
}

describe('WO-243/255 T243.1: operator_gui destination model (screen-destinations.js)', () => {
	it('normalizeDestination fills operator_gui defaults (guiUrl, a real video mode)', () => {
		const d = normalizeDestination({ id: 'og1', label: 'Operator GUI', mode: 'operator_gui' })
		assert.equal(d.mode, 'operator_gui')
		/* WO-486 supersedes WO-243 here: an operator GUI is an ordinary monitor, so it defaults to a
		 * mode from the dropdown rather than the word "custom". Only a pixelmap wall — whose raster
		 * comes from its fixtures — is custom by default. An operator monitor no shipped mode
		 * describes (2560x1080) still resolves to custom, covered below. */
		assert.equal(d.videoMode, '1080p5000', 'operator_gui defaults to a standard mode')
		assert.equal(d.guiUrl, 'http://127.0.0.1:4200/?operatorGui=1', 'WO-255: default guiUrl switched from ?cefOperator to ?operatorGui')
		assert.equal(d.physicalPort, undefined, 'no physicalPort by default -> falls back to resolveOperatorMonitorPort() at runtime')
	})

	it('an operator monitor no shipped mode describes still resolves to custom (WO-486)', () => {
		const d = normalizeDestination({ id: 'ogw', mode: 'operator_gui', videoMode: 'custom', width: 2560, height: 1080, fps: 50 })
		assert.equal(d.videoMode, 'custom', 'ultrawide has no shipped mode — custom is correct there')
		assert.equal(d.width, 2560)
		const std = normalizeDestination({ id: 'ogs', mode: 'operator_gui', videoMode: 'custom', width: 1920, height: 1080, fps: 50 })
		assert.equal(std.videoMode, '1080p5000', 'an explicit custom that IS a shipped mode resolves to it')
	})

	it('accepts an explicit guiUrl and a valid physicalPort (1-4)', () => {
		const d = normalizeDestination({ id: 'og2', mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?operatorGui=1&x=2', physicalPort: 3 })
		assert.equal(d.guiUrl, 'http://127.0.0.1:4200/?operatorGui=1&x=2')
		assert.equal(d.physicalPort, 3)
	})

	it('rejects an out-of-range physicalPort (field simply omitted, no throw)', () => {
		const d = normalizeDestination({ id: 'og3', mode: 'operator_gui', physicalPort: 9 })
		assert.equal(d.physicalPort, undefined)
	})

	it('non-operator_gui destinations are unaffected (no guiUrl/physicalPort field)', () => {
		const d = normalizeDestination({ id: 'scr1', mode: 'pgm_prv' })
		assert.equal(d.guiUrl, undefined)
		assert.equal(d.physicalPort, undefined)
		assert.equal(d.videoMode, '1080p5000')
	})
})

describe('WO-243 T243.2: routing-map excludes operator_gui from programChannels (multiview-style utility channel)', () => {
	function twoScreensPlusGui() {
		const app = clone(defaults)
		app.screenDestinations = {
			version: 1,
			destinations: [
				{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
				{ id: 'scr2', mainScreenIndex: 1, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
				{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui', videoMode: 'custom', width: 1280, height: 720, fps: 30 },
			],
		}
		return app
	}

	it('operator_gui destination does not inflate screenCount / programChannels', () => {
		const cm = getChannelMap(twoScreensPlusGui())
		assert.equal(cm.screenCount, 2, 'operator_gui (mainScreenIndex 5) must not drive screen count, like multiview')
		assert.equal(cm.programChannels.length, 2)
	})

	it('allocates a dedicated operatorGuiCh, distinct from any programChannels/previewChannels', () => {
		const cm = getChannelMap(twoScreensPlusGui())
		assert.equal(cm.operatorGuiEnabled, true)
		assert.ok(Number.isFinite(cm.operatorGuiCh))
		assert.ok(!cm.programChannels.includes(cm.operatorGuiCh))
		assert.ok(!cm.previewChannels.filter((c) => c != null).includes(cm.operatorGuiCh))
	})

	it('no operator_gui destination -> operatorGuiEnabled false, operatorGuiCh null', () => {
		const app = clone(defaults)
		app.screenDestinations = {
			version: 1,
			destinations: [{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 }],
		}
		const cm = getChannelMap(app)
		assert.equal(cm.operatorGuiEnabled, false)
		assert.equal(cm.operatorGuiCh, null)
	})
})

describe('WO-243 T243.2: config generator emits the operator_gui channel', () => {
	it('no operator_gui destination -> no operator_gui channel comment, deterministic output', () => {
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

		assert.doesNotMatch(xml1, /Operator GUI channel/, 'no operator_gui destination -> no operator_gui channel emitted')
		assert.equal(xml1, xml2, 'generator output is deterministic/unaffected when no operator_gui destination exists')
		assert.equal((xml1.match(/<channel>/g) || []).length, 2, 'plain pgm_prv screen still yields exactly PGM+PRV channels')
	})

	it('one operator_gui destination -> dedicated channel with a borderless/windowed <screen> consumer, no PRV pair', () => {
		const app = baseAppConfig()
		app.screenDestinations = {
			version: 1,
			destinations: [
				{ id: 'scr1', label: 'Main', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
				{ id: 'og1', label: 'Operator GUI', mainScreenIndex: 5, mode: 'operator_gui', videoMode: 'custom', width: 1280, height: 720, fps: 30, guiUrl: 'http://127.0.0.1:4200/?operatorGui=1' },
			],
		}
		const flat = buildCasparGeneratorFlatConfig(app)
		const xml = buildConfigXml(flat)

		/* WO-484: 1280x720@30 IS 720p3000. `videoMode: 'custom'` records how the operator chose it,
		 * not that Caspar needs a new mode registered. */
		assert.doesNotMatch(xml, /<id>1280x720<\/id>/, '1280x720@30 is 720p3000 — no duplicate mode')

		const chBlock = xml.match(/<!-- HighAsCG: Caspar channel \d+: Operator GUI channel[\s\S]*?<\/channel>/)
		assert.ok(chBlock, 'operator_gui channel block present')
		const block = chBlock[0]

		assert.match(block, /<video-mode>720p3000<\/video-mode>/, 'channel references the shipped mode')
		assert.match(block, /<screen>/, 'operator_gui channel drives a physical monitor via a screen consumer')
		assert.match(block, /<windowed>true<\/windowed>/)
		assert.match(block, /<borderless>true<\/borderless>/)
		assert.match(block, /<always-on-top>false<\/always-on-top>/, 'WO-263: consumer stacks BELOW Firefox (holes are punched in Firefox, not this window)')
		assert.match(block, /<width>1280<\/width><height>720<\/height>/)
		assert.doesNotMatch(block, /<artnet>/)
		assert.doesNotMatch(block, /<decklink>/)

		// Exactly PGM+PRV for screen 1, plus the operator_gui channel = 3 total <channel> blocks.
		assert.equal((xml.match(/<channel>/g) || []).length, 3)
		// operator_gui must not be registered as a takeable PGM screen (no "Screen N program output"
		// comment referencing its mainScreenIndex 5 -> screen "6").
		assert.doesNotMatch(xml, /Screen 6 program output/)
	})

	it('an operator_gui monitor with a genuinely non-standard size still registers its mode (WO-484)', () => {
		const app = baseAppConfig()
		app.screenDestinations = {
			version: 1,
			destinations: [
				{ id: 'scr1', label: 'Main', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
				/* An ultrawide operator monitor — no shipped mode covers 2560x1080, so Caspar does
				 * need a <video-mode> for it. This is the half WO-484 must NOT break. */
				{ id: 'og1', label: 'Operator GUI', mainScreenIndex: 5, mode: 'operator_gui', videoMode: 'custom', width: 2560, height: 1080, fps: 50, guiUrl: 'http://127.0.0.1:4200/?operatorGui=1' },
			],
		}
		const xml = buildConfigXml(buildCasparGeneratorFlatConfig(app))
		assert.match(xml, /<id>2560x1080<\/id>/, 'a non-standard size is still registered')
		assert.match(xml, /<time-scale>50000<\/time-scale>/)
		assert.match(xml, /<cadence>960<\/cadence>/, '48000 / 50 fps')
		const block = xml.match(/<!-- HighAsCG: Caspar channel \d+: Operator GUI channel[\s\S]*?<\/channel>/)[0]
		assert.match(block, /<video-mode>2560x1080<\/video-mode>/)
	})
})

describe('WO-243 T243.2: layout endpoint pure logic (src/system/operator-gui-channel.js)', () => {
	function channelMapFixture() {
		return {
			programChannels: [1, 3],
			previewChannels: [2, null],
		}
	}

	it('computeOperatorGuiCellPlan maps cells to sequential layers starting at 10, route:// per source channel', () => {
		const cells = [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0.5, y: 0, w: 0.5, h: 1 } },
			{ id: 'prv_1', role: 'prv', mainIndex: 0, rect: { x: 0, y: 0, w: 0.5, h: 1 } },
		]
		const plan = computeOperatorGuiCellPlan(cells, channelMapFixture())
		assert.equal(plan.length, 2)
		assert.equal(plan[0].layer, 10)
		assert.equal(plan[0].route, 'route://1')
		assert.deepEqual({ x: plan[0].x, y: plan[0].y, w: plan[0].w, h: plan[0].h }, { x: 0.5, y: 0, w: 0.5, h: 1 })
		assert.equal(plan[1].layer, 11)
		assert.equal(plan[1].route, 'route://2')
	})

	it('skips cells whose channel resolves to null (e.g. a main with no PRV bus)', () => {
		const cells = [
			{ id: 'prv_2', role: 'prv', mainIndex: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
			{ id: 'pgm_2', role: 'pgm', mainIndex: 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
		]
		const plan = computeOperatorGuiCellPlan(cells, channelMapFixture())
		assert.equal(plan.length, 1, 'the null-channel PRV cell is skipped, PGM cell keeps layer 10')
		assert.equal(plan[0].layer, 10)
		assert.equal(plan[0].route, 'route://3')
	})

	it('clamps rect fractions to 0-1', () => {
		const cells = [{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: -0.2, y: 1.4, w: 2, h: -1 } }]
		const plan = computeOperatorGuiCellPlan(cells, channelMapFixture())
		assert.deepEqual({ x: plan[0].x, y: plan[0].y, w: plan[0].w, h: plan[0].h }, { x: 0, y: 1, w: 1, h: 0 })
	})

	it('resolveOperatorGuiChannel returns null when no operator_gui destination or no allocated channel', () => {
		const app = clone(defaults)
		app.screenDestinations = { version: 1, destinations: [{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' }] }
		assert.equal(resolveOperatorGuiChannel(app), null)
	})

	it('resolveOperatorGuiChannel resolves ch + guiUrl when a destination exists', () => {
		const app = clone(defaults)
		app.screenDestinations = {
			version: 1,
			destinations: [
				{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' },
				{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?cefOperator=1' },
			],
		}
		const resolved = resolveOperatorGuiChannel(app)
		assert.ok(resolved)
		assert.ok(Number.isFinite(resolved.ch))
		assert.equal(resolved.guiUrl, 'http://127.0.0.1:4200/?cefOperator=1')
	})

	it('applyOperatorGuiLayout / clearOperatorGuiLayout resolve with {skipped:true} when no destination exists', async () => {
		resetOperatorGuiStateForTests()
		const { applyOperatorGuiLayout, clearOperatorGuiLayout } = require('../../src/system/operator-gui-channel')
		const app = clone(defaults)
		app.screenDestinations = { version: 1, destinations: [] }
		const ctx = { config: app, amcp: {}, log: () => {} }
		const applied = await applyOperatorGuiLayout(ctx, [])
		assert.equal(applied.skipped, true)
		const cleared = await clearOperatorGuiLayout(ctx)
		assert.equal(cleared.skipped, true)
	})

	it('applyOperatorGuiLayout drives ctx.amcp.play/mixerFill/mixerCommit and hygiene-clears stale layers', async () => {
		resetOperatorGuiStateForTests()
		const { applyOperatorGuiLayout } = require('../../src/system/operator-gui-channel')
		const app = clone(defaults)
		app.screenDestinations = {
			version: 1,
			destinations: [
				{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' },
				{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui' },
			],
		}
		const calls = { play: [], mixerFill: [], stop: [], mixerClear: [], mixerCommit: 0 }
		const amcp = {
			play: async (ch, layer, route) => { calls.play.push({ ch, layer, route }) },
			mixerFill: async (ch, layer, x, y, w, h) => { calls.mixerFill.push({ ch, layer, x, y, w, h }) },
			stop: async (ch, layer) => { calls.stop.push({ ch, layer }) },
			mixerClear: async (ch, layer) => { calls.mixerClear.push({ ch, layer }) },
			mixerCommit: async () => { calls.mixerCommit++ },
		}
		const ctx = { config: app, amcp, log: () => {} }

		const cm = getChannelMap(app)
		const pgmCh = cm.programChannels[0]

		// First apply: two cells -> layers 10, 11.
		await applyOperatorGuiLayout(ctx, [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0, y: 0, w: 1, h: 1 } },
			{ id: 'prv_1', role: 'prv', mainIndex: 0, rect: { x: 0, y: 0, w: 1, h: 1 } },
		])
		assert.equal(calls.play.length, cm.previewChannels[0] != null ? 2 : 1, 'PLAY once per resolvable cell')
		assert.equal(calls.play[0].route, `route://${pgmCh}`)
		assert.equal(calls.mixerCommit, 1)

		// Second apply: only one cell -> layer 11 must be hygiene-cleared (STOP + MIXER CLEAR).
		calls.play.length = 0; calls.mixerFill.length = 0
		await applyOperatorGuiLayout(ctx, [
			{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0, y: 0, w: 1, h: 1 } },
		])
		assert.equal(calls.play.length, 0, 'unchanged route on layer 10 is not re-PLAYed')
		if (cm.previewChannels[0] != null) {
			assert.ok(calls.stop.some((s) => s.layer === 11), 'stale layer 11 gets STOP')
			assert.ok(calls.mixerClear.some((s) => s.layer === 11), 'stale layer 11 gets MIXER CLEAR')
		}
	})
})

describe('WO-243 T243.2: router registration (repeat-offender grep)', () => {
	it('operator-gui layout routes are registered in router.js', () => {
		const routerPath = path.join(REPO_ROOT, 'src/api/router.js')
		const routerContent = fs.readFileSync(routerPath, 'utf8')
		assert.ok(routerContent.includes("require(" + "'./routes-operator-gui')"), 'router should import routes-operator-gui')
		assert.ok(routerContent.includes("'/api/operator-gui/layout'"), 'router should register the /api/operator-gui/layout path')
		assert.match(routerContent, /routes\.post\('\/api\/operator-gui\/layout'/, 'POST route registered')
		assert.match(routerContent, /routes\.delete\('\/api\/operator-gui\/layout'/, 'DELETE route registered')
		assert.ok(routerContent.includes('routesOperatorGui.handlePost'))
		assert.ok(routerContent.includes('routesOperatorGui.handleDelete'))
	})
})
