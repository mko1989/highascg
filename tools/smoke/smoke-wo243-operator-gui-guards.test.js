'use strict'

/**
 * WO-243/255 smoke tests — Operator GUI channel regression guards.
 *
 * Split out of smoke-wo243-operator-gui.test.js (line-count refactor, originally 599 lines) — this
 * file owns the WO-243 follow-up "operator_gui never claims a program-screen layout slot" guard,
 * the 2026-07-19 boot-window shrink guard (server refuses a single boot-window report that would
 * shrink a restored layout), and the never-persist-an-empty-cell-set guard. Destination model,
 * routing, generator, layout-endpoint pure logic and router registration stay in
 * smoke-wo243-operator-gui.test.js; CRUD + UI source checks live in
 * smoke-wo243-operator-gui-crud-ui.test.js.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const defaults = require('../../src/config/defaults')

function clone(cfg) {
	return JSON.parse(JSON.stringify(cfg))
}

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
		const src = read('src/utils/x-display-session-layout.js') + read('src/utils/x-display-session-layout-resolve.js')
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
	const {
		applyOperatorGuiLayout,
		ensureOperatorGuiChannel,
		resetOperatorGuiStateForTests,
		BOOT_GUARD_MS,
	} = require('../../src/system/operator-gui-channel')

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
