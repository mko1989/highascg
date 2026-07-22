'use strict'

/**
 * WO-317 — the coordinator that replaces WO-283's single `helperOpen` boolean with a registry
 * refcount driving the shape overlay flag.
 *
 * The properties under test are exactly the ones a boolean got wrong with multiple windows:
 *  - two open helpers do not flip-flop the flag;
 *  - parking the last raised helper RESUMES the kiosk even though a helper still runs;
 *  - a helper crashing WHILE PARKED does not wedge the flag suspended;
 *  - a raise/park that fails to apply does not lie about the resulting stacking.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createHelperCoordinator } = require('../../src/system/operator-helper-coordinator')
const { planHelperWindowAction } = require('../../src/system/operator-helper-window-plan')

/** A coordinator wired to spies: records shape-flag pushes and applied plans. */
function makeCoord(opts = {}) {
	const flags = []
	const applied = []
	const coord = createHelperCoordinator({
		setShapeHelperOpen: (open) => flags.push(open),
		applyPlan: async (steps) => {
			applied.push(steps)
			return opts.applyOk === false ? { ok: false, failed: 'python3 /x/below.py' } : { ok: true, failed: null }
		},
		resolveWindowContext: async (id) => ({
			helperWid: `0x${id}`,
			kioskWid: '0xKIOSK',
			consumerWid: '0xCASPAR',
			promoteScript: '/x/above.py',
			parkScript: '/x/below.py',
			rect: { x: 0, y: 0, width: 1920, height: 1080 },
		}),
		planAction: planHelperWindowAction,
		launchHelper: opts.launchHelper,
		log: () => {},
	})
	return { coord, flags, applied }
}

test('opening then mapping one helper suspends the kiosk top-assert exactly once', async () => {
	const { coord, flags } = makeCoord()
	await coord.handleAction('web', { action: 'firefox' })
	assert.equal(coord._shapeFlag(), false, "'launching' does not suspend yet")
	coord.onHelperMapped('web', '0xweb')
	assert.equal(coord._shapeFlag(), true, 'an open, unparked helper suspends')
	assert.deepEqual(flags, [true], 'the flag was pushed once, on the launching->open transition')
})

test('a SECOND open helper does not flip-flop the flag', async () => {
	const { coord, flags } = makeCoord()
	await coord.handleAction('web')
	coord.onHelperMapped('web', '0xweb')
	await coord.handleAction('files')
	coord.onHelperMapped('files', '0xfiles')
	assert.deepEqual(flags, [true], 'still suspended, pushed only once — no redundant flip')
	assert.equal(coord._shapeFlag(), true)
})

test('parking the last raised helper RESUMES the kiosk even though the helper still runs', async () => {
	const { coord, flags, applied } = makeCoord()
	await coord.handleAction('web')
	coord.onHelperMapped('web', '0xweb')
	assert.equal(coord._shapeFlag(), true)
	// Second handleAction on an open, raised helper => park.
	const r = await coord.handleAction('web')
	assert.equal(r.action, 'park')
	assert.equal(coord._shapeFlag(), false, 'parked helper no longer suspends — holes clean again')
	assert.deepEqual(flags, [true, false])
	// The applied park plan lowered below the consumer and refocused the kiosk.
	const lines = applied[applied.length - 1].map((s) => `${s.bin} ${s.args.join(' ')}`)
	assert.ok(lines.some((l) => /below\.py 0xweb --below 0xCASPAR/.test(l)))
	assert.ok(lines.some((l) => /windowactivate 0xKIOSK/.test(l)))
})

test('raising a parked helper suspends again (toggle back)', async () => {
	const { coord } = makeCoord()
	await coord.handleAction('web')
	coord.onHelperMapped('web', '0xweb')
	await coord.handleAction('web') // park
	assert.equal(coord._shapeFlag(), false)
	const r = await coord.handleAction('web') // raise
	assert.equal(r.action, 'raise')
	assert.equal(coord._shapeFlag(), true, 'raised again -> suspended again')
})

test('a helper that crashes WHILE PARKED does not wedge the flag suspended', async () => {
	const { coord } = makeCoord()
	await coord.handleAction('web')
	coord.onHelperMapped('web', '0xweb')
	await coord.handleAction('web') // park -> flag false
	assert.equal(coord._shapeFlag(), false)
	coord.onHelperGone('web') // crash while parked
	assert.equal(coord._shapeFlag(), false, 'still false — a parked helper contributed nothing to wedge')
	assert.equal(coord.taskbar().length, 0)
})

test('a helper that crashes WHILE RAISED resumes the kiosk top-assert', async () => {
	const { coord, flags } = makeCoord()
	await coord.handleAction('web')
	coord.onHelperMapped('web', '0xweb')
	assert.equal(coord._shapeFlag(), true)
	coord.onHelperGone('web') // crash while raised
	assert.equal(coord._shapeFlag(), false, 'last unparked helper gone -> kiosk reclaims the top')
	assert.deepEqual(flags, [true, false])
})

test('with two raised helpers, one crashing keeps the flag suspended (the other still holds it)', async () => {
	const { coord } = makeCoord()
	await coord.handleAction('web')
	coord.onHelperMapped('web', '0xweb')
	await coord.handleAction('files')
	coord.onHelperMapped('files', '0xfiles')
	coord.onHelperGone('web')
	assert.equal(coord._shapeFlag(), true, 'files is still open+raised')
	coord.onHelperGone('files')
	assert.equal(coord._shapeFlag(), false, 'now the last one is gone')
})

test('a park that FAILS to apply does not record the helper as parked (no lie about stacking)', async () => {
	const { coord } = makeCoord({ applyOk: false })
	await coord.handleAction('web')
	coord.onHelperMapped('web', '0xweb')
	const r = await coord.handleAction('web') // attempt park, applier fails
	assert.equal(r.ok, false)
	// Since the park did not apply, the helper is still raised -> flag stays suspended.
	assert.equal(coord._shapeFlag(), true, 'a failed park must not resume the kiosk over a still-raised helper')
	assert.equal(coord.taskbar()[0].parked, false)
})

test('launch failure removes the helper and leaves the flag untouched', async () => {
	const { coord } = makeCoord({
		launchHelper: async () => {
			throw new Error('spawn failed')
		},
	})
	const r = await coord.handleAction('web', { action: 'firefox' })
	assert.equal(r.ok, false)
	assert.equal(coord.taskbar().length, 0, 'a helper that never launched is not left in the registry')
	assert.equal(coord._shapeFlag(), false)
})

test('taskbar lists helpers in stable order with their parked state', async () => {
	const { coord } = makeCoord()
	await coord.handleAction('web')
	coord.onHelperMapped('web', '0xweb')
	await coord.handleAction('files')
	coord.onHelperMapped('files', '0xfiles')
	await coord.handleAction('files') // park files
	const tb = coord.taskbar()
	assert.deepEqual(tb.map((h) => h.id), ['files', 'web'], 'sorted by id')
	assert.equal(tb.find((h) => h.id === 'files').parked, true)
	assert.equal(tb.find((h) => h.id === 'web').parked, false)
})
