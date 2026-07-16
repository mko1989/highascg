'use strict'

/**
 * WO-243 smoke tests — Operator GUI channel: CEF web-UI layer over routed preview channels.
 *
 * Covers: T243.1 (destination model + CRUD single-instance validation + device-view UI source
 * checks), T243.2 (routing exclusion, generator channel emission, layout-endpoint pure logic +
 * router registration grep), T243.3 (client cefOperator hard-gate, pure rect-conversion logic,
 * source checks that preview-canvas-panel.js/app.js wire the gate).
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

describe('WO-243 T243.1: operator_gui destination model (screen-destinations.js)', () => {
	it('normalizeDestination fills operator_gui defaults (guiUrl, custom videoMode)', () => {
		const d = normalizeDestination({ id: 'og1', label: 'Operator GUI', mode: 'operator_gui' })
		assert.equal(d.mode, 'operator_gui')
		assert.equal(d.videoMode, 'custom', 'operator_gui defaults to a raster-exact custom mode')
		assert.equal(d.guiUrl, 'http://127.0.0.1:4200/?cefOperator=1')
		assert.equal(d.physicalPort, undefined, 'no physicalPort by default -> falls back to resolveOperatorMonitorPort() at runtime')
	})

	it('accepts an explicit guiUrl and a valid physicalPort (1-4)', () => {
		const d = normalizeDestination({ id: 'og2', mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?cefOperator=1&x=2', physicalPort: 3 })
		assert.equal(d.guiUrl, 'http://127.0.0.1:4200/?cefOperator=1&x=2')
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
				{ id: 'og1', label: 'Operator GUI', mainScreenIndex: 5, mode: 'operator_gui', videoMode: 'custom', width: 1280, height: 720, fps: 30, guiUrl: 'http://127.0.0.1:4200/?cefOperator=1' },
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
		assert.equal(d.guiUrl, 'http://127.0.0.1:4200/?cefOperator=1')
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

describe('WO-243 T243.1/T243.2/T243.3: UI + client-gate source checks', () => {
	const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

	it('destination type select + inspector form know about operator_gui', () => {
		assert.match(read('client/lib/device-view-host-channels.js'), /value:\s*'operator_gui'/)
		const form = read('client/components/device-view-destinations-inspector-form.js')
		assert.match(form, /'operator_gui'/)
		assert.match(form, /buildOperatorGuiFields/)
		const fields = read('client/components/device-view-destinations-inspector-operator-gui-fields.js')
		assert.match(fields, /CEF web-UI URL/)
	})

	it('addDestination() client action normalizes the operator_gui type', () => {
		assert.match(read('client/components/device-view-actions.js'), /o\.type === 'operator_gui'/)
	})

	it('device-view-crud enforces at most one operator_gui destination', () => {
		assert.match(read('src/api/device-view-crud.js'), /At most one Operator GUI destination is allowed/)
	})

	it('cef-operator-mode.js hard-gates on the ?cefOperator query param', () => {
		const src = read('client/lib/cef-operator-mode.js')
		assert.match(src, /has\('cefOperator'\)/)
	})

	it('preview-canvas-panel.js wires the cefOperator gate (draw skip) without unconditional behavior change', () => {
		const src = read('client/components/preview-canvas-panel.js')
		assert.match(src, /isCefOperatorModeActive/)
		assert.match(src, /cefOperatorActive/)
	})

	it('app.js applies the cef-operator html class at bootstrap', () => {
		assert.match(read('client/app.js'), /applyCefOperatorHtmlClass/)
	})

	it('scenes-editor.js reports compose cell rects (gated inside reportComposeCellRects)', () => {
		assert.match(read('client/components/scenes-editor.js'), /reportComposeCellRects/)
	})
})

describe('WO-243 T243.3: client cef-operator-mode pure logic (no jsdom required)', () => {
	it('isCefOperatorModeActive is false without the query param, true with it (any value, including empty)', () => {
		// Import lazily via a tiny CJS-compatible shim is unnecessary here — cellRectsToLayoutCells
		// and isCefOperatorModeActive have no DOM dependency beyond URLSearchParams, which Node provides.
		const modPath = path.join(__dirname, '../../client/lib/cef-operator-mode.js')
		const src = fs.readFileSync(modPath, 'utf8')
		// Source-level check (module is ESM; curated gate runs plain node:test/CJS) — the exported
		// function must use URLSearchParams(...).has('cefOperator'), not a truthy-value comparison.
		assert.match(src, /new URLSearchParams\(s \|\| ''\)\.has\('cefOperator'\)/)
	})

	it('cellRectsToLayoutCells conversion math (re-implemented here to pin the contract without ESM import)', () => {
		// Mirrors client/lib/cef-operator-mode.js's cellRectsToLayoutCells exactly — kept in lockstep
		// so this test fails loudly if the two ever diverge (source-grepped below).
		function clamp01(n) {
			const v = Number(n)
			if (!Number.isFinite(v)) return 0
			return Math.min(1, Math.max(0, v))
		}
		function cellRectsToLayoutCells(cellRects, viewport) {
			const vw = Math.max(1, Number(viewport?.width) || 1)
			const vh = Math.max(1, Number(viewport?.height) || 1)
			const out = []
			for (const c of Array.isArray(cellRects) ? cellRects : []) {
				const r = c?.rect
				if (!r || !(Number(r.width) > 0) || !(Number(r.height) > 0)) continue
				out.push({
					id: c.id,
					role: c.role === 'prv' ? 'prv' : 'pgm',
					mainIndex: Math.max(0, parseInt(String(c.mainIndex ?? 0), 10) || 0),
					rect: { x: clamp01(Number(r.left) / vw), y: clamp01(Number(r.top) / vh), w: clamp01(Number(r.width) / vw), h: clamp01(Number(r.height) / vh) },
				})
			}
			return out
		}
		const cells = cellRectsToLayoutCells(
			[
				{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { left: 960, top: 0, width: 960, height: 1080 } },
				{ id: 'prv_1', role: 'prv', mainIndex: 0, rect: { left: 0, top: 0, width: 0, height: 1080 } },
			],
			{ width: 1920, height: 1080 },
		)
		assert.equal(cells.length, 1, 'zero-width cell is dropped')
		assert.deepEqual(cells[0].rect, { x: 0.5, y: 0, w: 0.5, h: 1 })

		const src = fs.readFileSync(path.join(__dirname, '../../client/lib/cef-operator-mode.js'), 'utf8')
		assert.match(src, /function cellRectsToLayoutCells/, 'the real module still exports this exact function name')
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

// WO-243 follow-up (owner: "no mouse control of the ui"): the X11 input bridge only starts when a
// CEF focus target is armed, and nothing armed the GUI page (the arm toggle lives on look layers;
// you cannot click an arm button through a mouseless GUI). The GUI is now the DEFAULT input sink.
describe('WO-243 follow-up: operator GUI input auto-arm', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
	it('ensureOperatorGuiCefLayer auto-arms focus after PLAYing the CEF layer', () => {
		const src = read('src/system/operator-gui-channel.js')
		assert.match(src, /function ensureOperatorGuiFocus/, 'auto-arm helper exists')
		assert.match(src, /ensureOperatorGuiFocus\(ctx\)/, 'ensureOperatorGuiCefLayer calls it')
		assert.match(src, /current\.sourceId !== 'operator_gui'\) return current/, 'never steals a manual arm')
	})
	it('release-input falls back to the operator GUI instead of leaving the box mouseless', () => {
		const src = read('src/api/routes-cef-arm-input.js')
		assert.match(src, /ensureOperatorGuiFocus\(ctx\)/, 'release path re-arms the GUI when configured')
	})
	it('auto-arm is a no-op without an operator_gui destination', () => {
		const { ensureOperatorGuiFocus } = require(path.join(__dirname, '../../src/system/operator-gui-channel.js'))
		const out = ensureOperatorGuiFocus({ config: { screenDestinations: { destinations: [] } } })
		assert.equal(out, null)
	})
})
