'use strict'

/**
 * 2026-07-20 smoke tests (todos19.07.26) — "when caspar is reloaded it comes back trying to display
 * the compose preview even though im on devices tab. only going to looks and back clears the
 * windows."
 *
 * The re-asserting side is the SERVER: `ensureOperatorGuiChannel` re-applied the persisted cell
 * layout on every Caspar connect/reconnect regardless of what the client had on screen, while the
 * client (compose panel unmounted on the Devices tab) never contradicts it — `resendMergedNow`
 * returns early while its surface map is empty, by design, so a boot-time empty send cannot wipe
 * the layout the server just restored.
 *
 * These tests pin the DECISION LOGIC only — pure/offline, no Caspar, no X, no kiosk:
 *  - a reconnect while no surface is reporting must NOT light the holes up;
 *  - the persisted record must survive that skip, and returning to the tab must restore it;
 *  - the verified boot restore ("Operator GUI re-apply: 3 cell(s) applied") must NOT regress;
 *  - the server's own re-apply must never be mistaken for a client report.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const {
	ensureOperatorGuiChannel,
	noteClientLayoutReport,
	shouldReapplyPersistedLayout,
	resolveOperatorGuiChannel,
	resetOperatorGuiStateForTests,
} = require('../../src/system/operator-gui-channel')
const routesOperatorGui = require('../../src/api/routes-operator-gui')

const LAYOUT_PATH = '/api/operator-gui/layout'

function clone(cfg) {
	return JSON.parse(JSON.stringify(cfg))
}

const THREE_CELLS = [
	{ id: 'pgm_1', role: 'pgm', mainIndex: 0, rect: { x: 0, y: 0, w: 0.3, h: 0.3 } },
	{ id: 'pgm_2', role: 'pgm', mainIndex: 0, rect: { x: 0.35, y: 0, w: 0.3, h: 0.3 } },
	{ id: 'pgm_3', role: 'pgm', mainIndex: 0, rect: { x: 0.7, y: 0, w: 0.3, h: 0.3 } },
]

/** A ctx with an operator_gui destination, a fake AMCP that records every call, a captured log and
 * an in-memory persistence store seeded with a 3-cell operator arrangement. */
function makeCtx() {
	const app = clone(defaults)
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' },
			{ id: 'og1', mainScreenIndex: 5, mode: 'operator_gui' },
		],
	}
	const calls = []
	const logs = []
	const store = new Map([['operatorGuiLayout', { cells: clone(THREE_CELLS), savedAt: 1 }]])
	const amcp = {
		play: async (ch, layer, src) => calls.push(`play ${ch}-${layer} ${src}`),
		mixerFill: async (ch, layer) => calls.push(`fill ${ch}-${layer}`),
		stop: async (ch, layer) => calls.push(`stop ${ch}-${layer}`),
		mixerClear: async (ch, layer) => calls.push(`clear ${ch}-${layer}`),
		mixerCommit: async (ch) => calls.push(`commit ${ch}`),
	}
	const ctx = {
		config: app,
		amcp,
		log: (level, msg) => logs.push(String(msg)),
		persistence: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
	}
	return { ctx, calls, logs, store }
}

/** `ensureOperatorGuiChannel` deliberately does not await its re-apply (boot must not block), and
 * the apply itself is debounced — settle past both before asserting. */
function settle(ms = 260) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Did anything actually route video into a hole? PLAY of a route:// is the only way holes light up. */
function litHoles(calls) {
	return calls.filter((c) => c.startsWith('play ') && c.includes('route://'))
}

describe('2026-07-20: a Caspar reconnect must not re-assert the compose preview onto a tab that has none', () => {
	it('the decision helper is a real export (guards against a vacuous test)', () => {
		assert.equal(typeof shouldReapplyPersistedLayout, 'function')
		assert.equal(typeof noteClientLayoutReport, 'function')
	})

	it('reconnect while NO surface is reporting: the persisted layout is NOT applied and no hole lights up', async () => {
		resetOperatorGuiStateForTests()
		const { ctx, calls, logs, store } = makeCtx()

		// Operator was on Looks (3 cells reported), then switched to Devices — the compose panel
		// unmounts and the client DELETEs the layout. That is the authoritative withdrawal.
		await routesOperatorGui.handlePost(LAYOUT_PATH, { cells: clone(THREE_CELLS) }, ctx)
		await settle()
		await routesOperatorGui.handleDelete(LAYOUT_PATH, ctx)
		calls.length = 0
		logs.length = 0

		// Now Caspar reloads and reconnects.
		await ensureOperatorGuiChannel(ctx)
		await settle()

		assert.deepEqual(litHoles(calls), [], 'no route may be PLAYed onto the GUI channel while the operator is on a tab with no preview')
		assert.ok(
			logs.some((m) => m.includes('re-apply skipped') && m.includes('withdrew')),
			`the skip must be logged for the operator's benefit; got: ${JSON.stringify(logs)}`,
		)
		assert.equal(store.get('operatorGuiLayout').cells.length, 3, 'the saved arrangement must survive the skip untouched')
	})

	it('...and returning to the tab restores exactly that layout', async () => {
		resetOperatorGuiStateForTests()
		const { ctx, calls, store } = makeCtx()

		await routesOperatorGui.handlePost(LAYOUT_PATH, { cells: clone(THREE_CELLS) }, ctx)
		await settle()
		await routesOperatorGui.handleDelete(LAYOUT_PATH, ctx)
		await ensureOperatorGuiChannel(ctx)
		await settle()
		calls.length = 0

		// Operator goes back to Looks: the compose panel mounts and reports its rects again.
		const res = await routesOperatorGui.handlePost(LAYOUT_PATH, { cells: clone(store.get('operatorGuiLayout').cells) }, ctx)
		await settle()

		assert.equal(JSON.parse(res.body).plan.length, 3, 'the returning report applies all three cells')
		assert.equal(litHoles(calls).length, 3, 'all three holes light up again on return')
	})

	it('NO REGRESSION — a fresh boot with no client report yet still re-applies the persisted layout', async () => {
		resetOperatorGuiStateForTests()
		const { ctx, calls, logs } = makeCtx()

		// Nothing has reported: the kiosk is still starting. This is the verified
		// "Operator GUI re-apply: 3 cell(s) applied (ch 5)" path and must be untouched.
		await ensureOperatorGuiChannel(ctx)
		await settle()

		assert.equal(litHoles(calls).length, 3, 'the boot restore must still apply all three cells')
		assert.ok(
			logs.some((m) => m.includes('Operator GUI re-apply: 3 cell(s) applied')),
			`the boot re-apply log must be unchanged; got: ${JSON.stringify(logs)}`,
		)
	})

	it('NO REGRESSION — a reconnect while the operator IS on Looks still repaints the holes', async () => {
		resetOperatorGuiStateForTests()
		const { ctx, calls } = makeCtx()

		await routesOperatorGui.handlePost(LAYOUT_PATH, { cells: clone(THREE_CELLS) }, ctx)
		await settle()
		calls.length = 0

		await ensureOperatorGuiChannel(ctx)
		await settle()

		// The routes are already live from the client's own report, so the re-apply skips the
		// redundant PLAY ("PLAY only when the route changed") and re-issues MIXER FILL only —
		// the holes stay lit either way. Asserting on FILL is what proves the apply ran at all.
		assert.equal(
			calls.filter((c) => c.startsWith('fill ')).length,
			3,
			'a live reporting client must not be punished for the Devices-tab fix',
		)
	})

	it("the server's own re-apply is not mistaken for a client report", async () => {
		resetOperatorGuiStateForTests()
		const { ctx, calls } = makeCtx()
		const ch = resolveOperatorGuiChannel(ctx.config).ch

		// Boot re-apply (no client intent recorded) — then the client withdraws.
		await ensureOperatorGuiChannel(ctx)
		await settle()
		await routesOperatorGui.handleDelete(LAYOUT_PATH, ctx)
		calls.length = 0

		assert.equal(
			shouldReapplyPersistedLayout(ch, THREE_CELLS).reapply,
			false,
			'a boot re-apply must not license every later reconnect to re-assert over a withdrawn client',
		)
		await ensureOperatorGuiChannel(ctx)
		await settle()
		assert.deepEqual(litHoles(calls), [], 'the second reconnect stays dark')
	})
})

describe('2026-07-20: shouldReapplyPersistedLayout decision table', () => {
	const CH = 5

	it('no client report this run -> re-apply (fresh boot, kiosk not up yet)', () => {
		resetOperatorGuiStateForTests()
		const d = shouldReapplyPersistedLayout(CH, THREE_CELLS)
		assert.equal(d.reapply, true)
		assert.match(d.reason, /no client report yet/)
	})

	it('client reporting cells -> re-apply', () => {
		resetOperatorGuiStateForTests()
		const { ctx } = makeCtx()
		noteClientLayoutReport(ctx, THREE_CELLS)
		const ch = resolveOperatorGuiChannel(ctx.config).ch
		assert.equal(shouldReapplyPersistedLayout(ch, THREE_CELLS).reapply, true)
	})

	it('client withdrew -> do NOT re-apply', () => {
		resetOperatorGuiStateForTests()
		const { ctx } = makeCtx()
		noteClientLayoutReport(ctx, [])
		const ch = resolveOperatorGuiChannel(ctx.config).ch
		const d = shouldReapplyPersistedLayout(ch, THREE_CELLS)
		assert.equal(d.reapply, false)
		assert.match(d.reason, /withdrew/)
	})

	it('a withdrawal is per-channel, never global', () => {
		resetOperatorGuiStateForTests()
		const { ctx } = makeCtx()
		noteClientLayoutReport(ctx, [])
		assert.equal(shouldReapplyPersistedLayout(999, THREE_CELLS).reapply, true, 'another channel is unaffected')
	})

	it('an EMPTY persisted set still "re-applies" — it only clears stale layers, it cannot light a hole', () => {
		resetOperatorGuiStateForTests()
		const { ctx } = makeCtx()
		noteClientLayoutReport(ctx, [])
		const ch = resolveOperatorGuiChannel(ctx.config).ch
		assert.equal(shouldReapplyPersistedLayout(ch, []).reapply, true, 'boot hygiene for stale layers is preserved')
	})

	it('a later non-empty report clears the veto (operator returned to Looks)', () => {
		resetOperatorGuiStateForTests()
		const { ctx } = makeCtx()
		const ch = resolveOperatorGuiChannel(ctx.config).ch
		noteClientLayoutReport(ctx, [])
		assert.equal(shouldReapplyPersistedLayout(ch, THREE_CELLS).reapply, false)
		noteClientLayoutReport(ctx, THREE_CELLS)
		assert.equal(shouldReapplyPersistedLayout(ch, THREE_CELLS).reapply, true, 'the veto must not latch')
	})

	it('noteClientLayoutReport is a no-op without an operator_gui destination', () => {
		resetOperatorGuiStateForTests()
		const app = clone(defaults)
		app.screenDestinations = { version: 1, destinations: [{ id: 'scr1', mainScreenIndex: 0, mode: 'pgm_prv' }] }
		assert.doesNotThrow(() => noteClientLayoutReport({ config: app }, []))
		assert.equal(shouldReapplyPersistedLayout(CH, THREE_CELLS).reapply, true, 'nothing was recorded')
	})
})

describe('2026-07-20: the client withdrawal path stays wired through the API boundary', () => {
	it('DELETE records the withdrawal even while Caspar is disconnected', async () => {
		resetOperatorGuiStateForTests()
		const { ctx } = makeCtx()
		const ch = resolveOperatorGuiChannel(ctx.config).ch
		const offline = { ...ctx, amcp: null }

		const res = await routesOperatorGui.handleDelete(LAYOUT_PATH, offline)
		assert.equal(JSON.parse(res.body).reason, 'amcp_disconnected')
		assert.equal(
			shouldReapplyPersistedLayout(ch, THREE_CELLS).reapply,
			false,
			'a withdrawal that arrives mid-reload is exactly the one that must count',
		)
	})

	it('POST records the report even while Caspar is disconnected', async () => {
		resetOperatorGuiStateForTests()
		const { ctx } = makeCtx()
		const ch = resolveOperatorGuiChannel(ctx.config).ch
		const offline = { ...ctx, amcp: null }

		await routesOperatorGui.handleDelete(LAYOUT_PATH, offline)
		await routesOperatorGui.handlePost(LAYOUT_PATH, { cells: clone(THREE_CELLS) }, offline)
		assert.equal(shouldReapplyPersistedLayout(ch, THREE_CELLS).reapply, true, 'the reconnect may repaint what the client just asked for')
	})
})

describe('WO-410 (todos03.08): reconnect must forget the skip-unchanged route cache', () => {
	it('ensureOperatorGuiChannel clears the per-channel route cache before re-applying', () => {
		// A fresh caspar has an empty stage; a cache describing the PREVIOUS instance made
		// the reconnect re-apply skip every PLAY (MIXER fills went out, holes stayed empty).
		const fs = require('node:fs')
		const path = require('node:path')
		const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src/system/operator-gui-channel.js'), 'utf8')
		const fnStart = src.indexOf('async function ensureOperatorGuiChannel')
		const head = src.slice(fnStart, fnStart + 900)
		assert.match(head, /lastAppliedRouteByChannel\.delete\(ch\)/, 'route cache forgotten on (re)connect')
		assert.match(head, /lastMaxLayerByChannel\.delete\(ch\)/, 'max-layer hygiene cache forgotten too')
	})
})
