'use strict'

/**
 * WO-243/255 smoke tests — Operator GUI channel: destination model, routing, generator, layout
 * endpoint, CRUD, and client-gate/UI source checks.
 *
 * Covers: T243.1 (destination model + CRUD single-instance validation + device-view UI source
 * checks), T243.2 (routing exclusion, generator channel emission, layout-endpoint pure logic +
 * router registration grep), T243.3/T255.3 (client operator-GUI-mode hard-gate, three-surface
 * reporting + interaction suppression source checks), WO-243 follow-up regression guards.
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
const { handleAddDestination, handleUpdateDestination } = require('../../src/api/device-view-crud')
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
	it('normalizeDestination fills operator_gui defaults (guiUrl, custom videoMode)', () => {
		const d = normalizeDestination({ id: 'og1', label: 'Operator GUI', mode: 'operator_gui' })
		assert.equal(d.mode, 'operator_gui')
		assert.equal(d.videoMode, 'custom', 'operator_gui defaults to a raster-exact custom mode')
		assert.equal(d.guiUrl, 'http://127.0.0.1:4200/?operatorGui=1', 'WO-255: default guiUrl switched from ?cefOperator to ?operatorGui')
		assert.equal(d.physicalPort, undefined, 'no physicalPort by default -> falls back to resolveOperatorMonitorPort() at runtime')
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

		assert.match(xml, /<id>1280x720<\/id>/, 'custom operator_gui mode id registered in <video-modes>')

		const chBlock = xml.match(/<!-- HighAsCG: Caspar channel \d+: Operator GUI channel[\s\S]*?<\/channel>/)
		assert.ok(chBlock, 'operator_gui channel block present')
		const block = chBlock[0]

		assert.match(block, /<video-mode>1280x720<\/video-mode>/)
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
		assert.ok(routerContent.includes("require('./routes-operator-gui')"), 'router should import routes-operator-gui')
		assert.ok(routerContent.includes("'/api/operator-gui/layout'"), 'router should register the /api/operator-gui/layout path')
		assert.match(routerContent, /routes\.post\('\/api\/operator-gui\/layout'/, 'POST route registered')
		assert.match(routerContent, /routes\.delete\('\/api\/operator-gui\/layout'/, 'DELETE route registered')
		assert.ok(routerContent.includes('routesOperatorGui.handlePost'))
		assert.ok(routerContent.includes('routesOperatorGui.handleDelete'))
	})
})

describe('WO-243 T243.1: device-view CRUD single-instance validation + guiUrl/physicalPort patch merge', () => {
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

	it('handleAddDestination creates an operator_gui destination with default guiUrl', () => {
		const ctx = mockCtx({ screenDestinations: { version: 1, destinations: [] } })
		const res = handleAddDestination({ addDestination: { type: 'operator_gui', mainScreenIndex: 0 } }, ctx)
		assert.equal(res.ok, true)
		const d = res.screenDestinations.destinations.find((x) => x.id === res.addedId)
		assert.equal(d.mode, 'operator_gui')
		assert.equal(d.guiUrl, 'http://127.0.0.1:4200/?operatorGui=1')
	})

	it('handleAddDestination rejects a second operator_gui destination', () => {
		const ctx = mockCtx({
			screenDestinations: { version: 1, destinations: [{ id: 'og1', mainScreenIndex: 0, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?cefOperator=1' }] },
		})
		const res = handleAddDestination({ addDestination: { type: 'operator_gui', mainScreenIndex: 1 } }, ctx)
		assert.ok(res.error, 'second operator_gui destination is rejected')
		assert.equal(ctx.config.screenDestinations.destinations.length, 1)
	})

	it('handleUpdateDestination rejects switching a second destination\'s mode to operator_gui', () => {
		const ctx = mockCtx({
			screenDestinations: {
				version: 1,
				destinations: [
					{ id: 'og1', mainScreenIndex: 0, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?cefOperator=1' },
					{ id: 'scr1', mainScreenIndex: 1, mode: 'pgm_prv' },
				],
			},
		})
		const res = handleUpdateDestination({ updateDestination: { id: 'scr1', mode: 'operator_gui' } }, ctx)
		assert.ok(res.error)
	})

	it('handleUpdateDestination merges a guiUrl/physicalPort patch without clobbering the other field', () => {
		const ctx = mockCtx({
			screenDestinations: {
				version: 1,
				destinations: [{ id: 'og1', mainScreenIndex: 0, mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?cefOperator=1', physicalPort: 2 }],
			},
		})
		const res = handleUpdateDestination({ updateDestination: { id: 'og1', guiUrl: 'http://127.0.0.1:4200/?cefOperator=1&debug=1' } }, ctx)
		assert.equal(res.ok, true)
		const d = res.screenDestinations.destinations[0]
		assert.equal(d.guiUrl, 'http://127.0.0.1:4200/?cefOperator=1&debug=1', 'patched field applied')
		assert.equal(d.physicalPort, 2, 'sibling field preserved, not clobbered')
	})
})

describe('WO-243/255 T243.1/T243.2/T243.3/T255.3: UI + client-gate source checks', () => {
	const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

	it('destination type select + inspector form know about operator_gui', () => {
		assert.match(read('client/lib/device-view-host-channels.js'), /value:\s*'operator_gui'/)
		const form = read('client/components/device-view-destinations-inspector-form.js')
		assert.match(form, /'operator_gui'/)
		assert.match(form, /buildOperatorGuiFields/)
		const fields = read('client/components/device-view-destinations-inspector-operator-gui-fields.js')
		assert.match(fields, /Web-UI URL/)
	})

	it('addDestination() client action normalizes the operator_gui type', () => {
		assert.match(read('client/components/device-view-actions.js'), /o\.type === 'operator_gui'/)
	})

	it('device-view-crud enforces at most one operator_gui destination', () => {
		assert.match(read('src/api/device-view-crud.js'), /At most one Operator GUI destination is allowed/)
	})

	it('operator-gui-mode.js (renamed from cef-operator-mode.js, WO-255) hard-gates on ?operatorGui / legacy ?cefOperator', () => {
		assert.ok(!fs.existsSync(path.join(__dirname, '../../client/lib/cef-operator-mode.js')), 'old file removed')
		const src = read('client/lib/operator-gui-mode.js')
		assert.match(src, /has\('operatorGui'\)/)
		assert.match(src, /has\('cefOperator'\)/, 'legacy query param still accepted')
	})

	it('preview-canvas-panel.js wires the operator-GUI gate (draw skip) without unconditional behavior change', () => {
		const src = read('client/components/preview-canvas-panel.js')
		assert.match(src, /isOperatorGuiModeActive/)
		assert.match(src, /operatorGuiActive/)
	})

	it('app.js applies the operator-gui html class + interaction-suppress detector at bootstrap', () => {
		const src = read('client/app.js')
		assert.match(src, /applyOperatorGuiHtmlClass/)
		assert.match(src, /initOperatorGuiInteractionSuppress/)
	})

	it('WO-255 T255.3: three surfaces report into operator-gui-mode.js (compose/timeline/mv-edit)', () => {
		assert.match(read('client/components/scenes-editor.js'), /reportComposeCellRects/)
		// The timeline wiring MUST live in the LIVE editor (timeline-editor.js). It originally
		// landed only in the orphaned, never-imported timeline-editor-preview.js (deleted), which
		// left the timeline surface silent — no rects, no holes, no video in operator-GUI mode.
		assert.match(read('client/components/timeline-editor.js'), /reportTimelineCellRects/)
		assert.ok(
			!fs.existsSync(path.join(__dirname, '../../client/components/timeline-editor-preview.js')),
			'orphaned timeline-editor-preview.js stays deleted (dead copy that masked the WO-255 wiring regression)',
		)
		assert.match(read('client/components/multiview-editor.js'), /reportMultiviewEditRect/)
	})

	it('WO-255 T255.3: interaction suppression detector wired at bootstrap and hooks modal-overlay + preview surfaces', () => {
		const src = read('client/lib/operator-gui-interaction-suppress.js')
		assert.match(src, /modal-overlay/)
		assert.match(src, /pointerdown/)
		assert.match(src, /setInteractionSuppressed/)
	})

	it('WO-255 T255.3: 10-operator-gui-mode.css replaces the WO-243 transparent-holes CSS with a dark backing', () => {
		assert.ok(!fs.existsSync(path.join(__dirname, '../../client/styles/10-cef-operator-mode.css')), 'old CSS file removed')
		const css = read('client/styles/10-operator-gui-mode.css')
		assert.match(css, /#0a0a0a/)
		assert.match(css, /html\.operator-gui/)
		assert.match(read('client/styles.css'), /10-operator-gui-mode\.css/)
	})
})

// WO-243 follow-up (owner: "gui still displays on the first screen"): an operator_gui-bound GPU
// jack must claim the multiview-style head, never a screen_<mainScreenIndex+1> assignment — the
// screen-branch classification hijacked screen_1's head (program output lost its monitor) and the
// generator emitted x=0,y=0 (window on the program screen). Grep-level wiring guards.
describe('WO-243 follow-up: operator_gui never claims a program-screen layout slot', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
	it('os-layout-calculator-assign classifies operator_gui as a multiview-style head', () => {
		const src = read('src/utils/os-layout-calculator-assign.js')
		assert.match(src, /dMode === 'multiview' \|\| dMode === 'operator_gui'/, 'edge classifier maps operator_gui to the multiview head')
		assert.match(src, /dMode !== 'stream' && dMode !== 'multiview' && dMode !== 'operator_gui'/, 'legacy mainIndex fallback excludes operator_gui')
	})
	it('resolveLayoutRectForOperatorPort resolves operator_gui-bound ports to the multiview rect', () => {
		const src = read('src/utils/x-display-session-layout.js')
		assert.match(src, /mode === 'multiview' \|\| mode === 'operator_gui'/, 'wiring loop treats operator_gui like multiview')
		assert.match(src, /buildGpuPhysicalMap\(/, 'gpu-map xrandr fallback strategy present')
	})
	it('generator pins <device> to the X-screen convention, not the GPU port number', () => {
		const src = read('src/config/config-generator-operator-gui.js')
		assert.match(src, /const device = 1/, 'device is the X-screen index (1), position is x/y-driven')
	})
})


/**
 * 2026-07-19 bug — server-side belt-and-braces for "after highascg restart the operator gui starts
 * with a stale compose preview layout". `ensureOperatorGuiChannel` re-applies the persisted
 * multi-cell layout at boot; the freshly-booted kiosk client used to report a single provisional
 * tile ~0.7s later and clobber it. The client no longer reports pre-state
 * (client/components/operator-compose-tiles.js `stateReady`); this guard makes the server refuse
 * ONE boot-window report that would strictly shrink the restored layout.
 */
describe('2026-07-19: server ignores a single boot-window report that would shrink the restored layout', () => {
	const { applyOperatorGuiLayout, ensureOperatorGuiChannel, BOOT_GUARD_MS } = require('../../src/system/operator-gui-channel')

	function bootCtx() {
		const app = clone(defaults)
		app.screenDestinations = {
			version: 1,
			destinations: [
				{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' },
				{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui' },
			],
		}
		const saved = {
			cells: [
				{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0, y: 0, w: 0.3, h: 0.3 } },
				{ id: 'pgm_2', role: 'pgm', mainIndex: 0, rect: { x: 0.35, y: 0, w: 0.3, h: 0.3 } },
				{ id: 'pgm_3', role: 'pgm', mainIndex: 0, rect: { x: 0.7, y: 0, w: 0.3, h: 0.3 } },
			],
		}
		const store = new Map([['operatorGuiLayout', saved]])
		const amcp = {
			play: async () => {}, mixerFill: async () => {}, stop: async () => {},
			mixerClear: async () => {}, mixerCommit: async () => {},
		}
		return {
			ctx: {
				config: app,
				amcp,
				log: () => {},
				persistence: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
			},
			saved,
		}
	}

	const oneCell = [{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }]

	it('the guard window is bounded and non-trivial', () => {
		assert.equal(typeof BOOT_GUARD_MS, 'number')
		assert.ok(BOOT_GUARD_MS > 0 && BOOT_GUARD_MS <= 30000, 'a short boot window, not a permanent latch')
	})

	it('a 1-cell report right after a 3-cell re-apply is ignored ONCE, and the very next one is honoured', async () => {
		resetOperatorGuiStateForTests()
		const { ctx } = bootCtx()
		await ensureOperatorGuiChannel(ctx)

		const first = await applyOperatorGuiLayout(ctx, oneCell)
		assert.equal(first.skipped, true, 'provisional 1-cell boot report does not shrink the restored 3-cell layout')
		assert.equal(first.reason, 'boot-window shrink ignored')

		// One-shot: a real screen-count reduction re-reports on the client's next render and lands.
		const second = await applyOperatorGuiLayout(ctx, oneCell)
		assert.notEqual(second.skipped, true, 'the guard never latches — the second report applies')
		assert.equal(second.plan.length, 1)
	})

	it('an operator tile move (same cell count) is NEVER blocked, even inside the boot window', async () => {
		resetOperatorGuiStateForTests()
		const { ctx, saved } = bootCtx()
		await ensureOperatorGuiChannel(ctx)

		const moved = saved.cells.map((c, i) => ({ ...c, rect: { ...c.rect, y: 0.4 + i * 0.01 } }))
		const res = await applyOperatorGuiLayout(ctx, moved)
		assert.notEqual(res.skipped, true, 'a genuine 3-cell move applies immediately')
		assert.equal(res.plan.length, 3)
	})

	it('a GROWING report inside the boot window is never blocked either', async () => {
		resetOperatorGuiStateForTests()
		const { ctx, saved } = bootCtx()
		await ensureOperatorGuiChannel(ctx)

		const grown = [...saved.cells, { id: 'pgm_4', role: 'pgm', mainIndex: 0, rect: { x: 0, y: 0.5, w: 0.3, h: 0.3 } }]
		const res = await applyOperatorGuiLayout(ctx, grown)
		assert.notEqual(res.skipped, true)
		assert.equal(res.plan.length, 4)
	})

	it('with no persisted layout to protect, nothing is ever guarded', async () => {
		resetOperatorGuiStateForTests()
		const { ctx } = bootCtx()
		ctx.persistence.set('operatorGuiLayout', { cells: [] })
		await ensureOperatorGuiChannel(ctx)

		const res = await applyOperatorGuiLayout(ctx, oneCell)
		assert.notEqual(res.skipped, true, 'no restored layout -> no guard')
	})
})

describe('operator GUI layout persistence: never save an empty cell set', () => {
	const guiChannel = require('../../src/system/operator-gui-channel')

	it('applyOperatorGuiLayout is the real export under test (guards against a vacuous test)', () => {
		assert.equal(typeof guiChannel.applyOperatorGuiLayout, 'function')
	})

	it('the persist call is guarded on a non-empty cell list', () => {
		const src = fs.readFileSync(
			path.join(__dirname, '..', '..', 'src', 'system', 'operator-gui-channel.js'),
			'utf8',
		)
		const setIdx = src.indexOf("persistence.set('operatorGuiLayout'")
		assert.ok(setIdx > 0, "persistence.set('operatorGuiLayout') must exist")
		const before = src.slice(Math.max(0, setIdx - 400), setIdx)
		assert.match(
			before,
			/if \(list\.length > 0\)/,
			'persisting the layout must be gated on a non-empty cell list — an empty apply means the client went away, not that the operator wants no tiles',
		)
	})
})
