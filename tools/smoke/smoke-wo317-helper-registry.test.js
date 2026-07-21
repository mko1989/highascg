'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

/**
 * WO-317: Multiple helper windows + taskbar on the operator monitor.
 * Pure registry logic tests: transitions, refcount, park/raise decision table,
 * restore-on-crash per helper, and unknown-id safety.
 */

const {
	createHelperRegistry,
	registerHelper,
	markHelperMapped,
	markHelperGone,
	setHelperParked,
	listHelpers,
	helperOpenCount,
	shouldSuspendKioskTopAssert,
	decideRaise,
} = require('../../src/system/operator-helper-registry')

/* ───────────────────────────────────────────────────────────────────────────── */
/* CREATE AND BASIC STATE */
/* ───────────────────────────────────────────────────────────────────────────── */

test('createHelperRegistry returns empty registry', () => {
	const reg = createHelperRegistry()
	assert.deepStrictEqual(reg, { helpers: {} })
})

test('registerHelper creates a helper in launching state', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'file_browser', { action: 'file-manager' })
	assert.strictEqual(reg.helpers['file_browser'].state, 'launching')
	assert.strictEqual(reg.helpers['file_browser'].windowId, null)
	assert.strictEqual(reg.helpers['file_browser'].parked, false)
	assert.deepStrictEqual(reg.helpers['file_browser'].info, { action: 'file-manager' })
})

test('registerHelper with no info defaults to empty object', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'web_browser')
	assert.deepStrictEqual(reg.helpers['web_browser'].info, {})
})

test('registerHelper with empty id is a no-op', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, '', { action: 'test' })
	registerHelper(reg, null, { action: 'test' })
	registerHelper(reg, undefined, { action: 'test' })
	assert.deepStrictEqual(reg.helpers, {})
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* TRANSITIONS: LAUNCHING -> OPEN */
/* ───────────────────────────────────────────────────────────────────────────── */

test('markHelperMapped transitions to open state and sets windowId', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'file_browser', { action: 'file-manager' })
	markHelperMapped(reg, 'file_browser', '12345')
	const h = reg.helpers['file_browser']
	assert.strictEqual(h.state, 'open')
	assert.strictEqual(h.windowId, '12345')
})

test('markHelperMapped accepts both string and number windowIds', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser1', {})
	registerHelper(reg, 'browser2', {})
	markHelperMapped(reg, 'browser1', '9999')
	markHelperMapped(reg, 'browser2', 8888)
	assert.strictEqual(reg.helpers['browser1'].windowId, '9999')
	assert.strictEqual(reg.helpers['browser2'].windowId, 8888)
})

test('markHelperMapped on unknown id is a no-op', () => {
	const reg = createHelperRegistry()
	markHelperMapped(reg, 'nonexistent', '12345')
	assert.deepStrictEqual(reg.helpers, {})
})

test('markHelperMapped with empty id is a no-op', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'file_browser', {})
	markHelperMapped(reg, '', '12345')
	assert.strictEqual(reg.helpers['file_browser'].windowId, null)
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* MARKING GONE: CLEANUP AND IDEMPOTENCE */
/* ───────────────────────────────────────────────────────────────────────────── */

test('markHelperGone removes the helper', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'file_browser', {})
	markHelperMapped(reg, 'file_browser', '12345')
	assert.strictEqual(Object.keys(reg.helpers).length, 1)
	markHelperGone(reg, 'file_browser')
	assert.strictEqual(Object.keys(reg.helpers).length, 0)
})

test('markHelperGone is idempotent', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'file_browser', {})
	markHelperGone(reg, 'file_browser')
	markHelperGone(reg, 'file_browser')
	markHelperGone(reg, 'file_browser')
	assert.deepStrictEqual(reg.helpers, {})
})

test('markHelperGone on unknown id is a no-op', () => {
	const reg = createHelperRegistry()
	markHelperGone(reg, 'nonexistent')
	assert.deepStrictEqual(reg.helpers, {})
})

test('markHelperGone with empty id is a no-op', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'file_browser', {})
	markHelperGone(reg, '')
	markHelperGone(reg, null)
	assert.strictEqual(Object.keys(reg.helpers).length, 1)
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* PARKED STATE */
/* ───────────────────────────────────────────────────────────────────────────── */

test('setHelperParked transitions to parked', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '999')
	assert.strictEqual(reg.helpers['browser'].parked, false)
	setHelperParked(reg, 'browser', true)
	assert.strictEqual(reg.helpers['browser'].parked, true)
})

test('setHelperParked can raise a parked helper back', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '999')
	setHelperParked(reg, 'browser', true)
	setHelperParked(reg, 'browser', false)
	assert.strictEqual(reg.helpers['browser'].parked, false)
})

test('setHelperParked on launching helper is a no-op (not open yet)', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	setHelperParked(reg, 'browser', true)
	assert.strictEqual(reg.helpers['browser'].parked, false)
})

test('setHelperParked on unknown id is a no-op', () => {
	const reg = createHelperRegistry()
	setHelperParked(reg, 'nonexistent', true)
	assert.deepStrictEqual(reg.helpers, {})
})

test('parking one helper does not affect another', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	registerHelper(reg, 'file', {})
	markHelperMapped(reg, 'browser', '100')
	markHelperMapped(reg, 'file', '200')
	setHelperParked(reg, 'browser', true)
	assert.strictEqual(reg.helpers['browser'].parked, true)
	assert.strictEqual(reg.helpers['file'].parked, false)
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* OPEN COUNT */
/* ───────────────────────────────────────────────────────────────────────────── */

test('helperOpenCount returns 0 for empty registry', () => {
	const reg = createHelperRegistry()
	assert.strictEqual(helperOpenCount(reg), 0)
})

test('helperOpenCount includes helpers in launching state', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	assert.strictEqual(helperOpenCount(reg), 1)
})

test('helperOpenCount includes helpers in open state', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '123')
	assert.strictEqual(helperOpenCount(reg), 1)
})

test('helperOpenCount counts multiple helpers', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	registerHelper(reg, 'file', {})
	registerHelper(reg, 'settings', {})
	assert.strictEqual(helperOpenCount(reg), 3)
	markHelperGone(reg, 'browser')
	assert.strictEqual(helperOpenCount(reg), 2)
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* KIOSK TOP-ASSERT REFCOUNT (THE CRITICAL LOGIC) */
/* ───────────────────────────────────────────────────────────────────────────── */

test('shouldSuspendKioskTopAssert is false for empty registry', () => {
	const reg = createHelperRegistry()
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
})

test('shouldSuspendKioskTopAssert is false while helper is launching', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
})

test('shouldSuspendKioskTopAssert is true when a helper is open and raised', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '123')
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
})

test('shouldSuspendKioskTopAssert is false when the raised helper is parked', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '123')
	setHelperParked(reg, 'browser', true)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
})

test('shouldSuspendKioskTopAssert: refcount only releases on LAST unparked helper gone', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	registerHelper(reg, 'file', {})
	markHelperMapped(reg, 'browser', '100')
	markHelperMapped(reg, 'file', '200')
	// Both open and raised: should suspend.
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
	// Park one: should still suspend (file is unparked).
	setHelperParked(reg, 'browser', true)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
	// Park the second: should NOT suspend (all are parked).
	setHelperParked(reg, 'file', true)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
	// Raise one: should suspend again.
	setHelperParked(reg, 'browser', false)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
})

test('shouldSuspendKioskTopAssert: crashed parked helper does not wedge the latch', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	registerHelper(reg, 'file', {})
	markHelperMapped(reg, 'browser', '100')
	markHelperMapped(reg, 'file', '200')
	// Park both.
	setHelperParked(reg, 'browser', true)
	setHelperParked(reg, 'file', true)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
	// Browser crashes while parked. markHelperGone should clean up without leaving it stuck true.
	markHelperGone(reg, 'browser')
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
	// Even if file was raised, should still work.
	registerHelper(reg, 'browser2', {})
	markHelperMapped(reg, 'browser2', '300')
	setHelperParked(reg, 'file', false)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
})

test('shouldSuspendKioskTopAssert: all removed helpers restore to false', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '100')
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
	markHelperGone(reg, 'browser')
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
})

test('shouldSuspendKioskTopAssert: launching helpers do not affect the latch', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	registerHelper(reg, 'file', {})
	markHelperMapped(reg, 'browser', '100')
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
	// File is still launching (no window yet).
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
	// Park the open one.
	setHelperParked(reg, 'browser', true)
	// Launching ones do not count, so should be false.
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
	// Map the launching helper.
	markHelperMapped(reg, 'file', '200')
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* LIST HELPERS: DETERMINISTIC ORDER AND NO LEAKS */
/* ───────────────────────────────────────────────────────────────────────────── */

test('listHelpers returns empty array for empty registry', () => {
	const reg = createHelperRegistry()
	assert.deepStrictEqual(listHelpers(reg), [])
})

test('listHelpers returns helpers sorted by id', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'zebra', {})
	registerHelper(reg, 'apple', {})
	registerHelper(reg, 'middle', {})
	const list = listHelpers(reg)
	assert.deepStrictEqual(
		list.map((h) => h.id),
		['apple', 'middle', 'zebra']
	)
})

test('listHelpers returns copies, not internal references', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', { action: 'firefox' })
	markHelperMapped(reg, 'browser', '123')
	const list1 = listHelpers(reg)
	// Mutate the returned copy.
	list1[0].state = 'corrupted'
	list1[0].windowId = 'hacked'
	list1[0].info.action = 'malware'
	// Registry should be untouched.
	const list2 = listHelpers(reg)
	assert.strictEqual(list2[0].state, 'open')
	assert.strictEqual(list2[0].windowId, '123')
	assert.strictEqual(list2[0].info.action, 'firefox')
})

test('listHelpers includes all helper states', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'launching', { action: 'firefox' })
	registerHelper(reg, 'open', { action: 'file-manager' })
	markHelperMapped(reg, 'open', '456')
	const list = listHelpers(reg)
	assert.strictEqual(list[0].id, 'launching')
	assert.strictEqual(list[0].state, 'launching')
	assert.strictEqual(list[1].id, 'open')
	assert.strictEqual(list[1].state, 'open')
})

test('listHelpers includes parked state', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'raised', {})
	registerHelper(reg, 'parked', {})
	markHelperMapped(reg, 'raised', '100')
	markHelperMapped(reg, 'parked', '200')
	setHelperParked(reg, 'parked', true)
	const list = listHelpers(reg)
	// listHelpers sorts by id: 'parked' comes before 'raised'
	const byId = Object.fromEntries(list.map((h) => [h.id, h.parked]))
	assert.strictEqual(byId['parked'], true)
	assert.strictEqual(byId['raised'], false)
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* DECIDE RAISE: TASKBAR CLICK LOGIC */
/* ───────────────────────────────────────────────────────────────────────────── */

test('decideRaise on unknown id returns launch', () => {
	const reg = createHelperRegistry()
	const d = decideRaise(reg, 'nonexistent')
	assert.strictEqual(d.action, 'launch')
})

test('decideRaise on empty/null id returns launch', () => {
	const reg = createHelperRegistry()
	assert.deepStrictEqual(decideRaise(reg, '').action, 'launch')
	assert.deepStrictEqual(decideRaise(reg, null).action, 'launch')
	assert.deepStrictEqual(decideRaise(reg, undefined).action, 'launch')
})

test('decideRaise on launching helper returns launch', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	const d = decideRaise(reg, 'browser')
	assert.strictEqual(d.action, 'launch')
})

test('decideRaise on open raised helper returns park', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '123')
	const d = decideRaise(reg, 'browser')
	assert.strictEqual(d.action, 'park')
})

test('decideRaise on open parked helper returns raise', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '123')
	setHelperParked(reg, 'browser', true)
	const d = decideRaise(reg, 'browser')
	assert.strictEqual(d.action, 'raise')
})

test('decideRaise includes reason codes', () => {
	const reg = createHelperRegistry()
	const d1 = decideRaise(reg, 'unknown')
	assert.ok(d1.reason)
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '123')
	const d2 = decideRaise(reg, 'browser')
	assert.ok(d2.reason)
})

test('decideRaise toggles correctly: park -> raise -> park -> ...', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	markHelperMapped(reg, 'browser', '123')
	// Open and raised: click means park.
	assert.strictEqual(decideRaise(reg, 'browser').action, 'park')
	// Park it.
	setHelperParked(reg, 'browser', true)
	// Now raised (not parked) means raise.
	assert.strictEqual(decideRaise(reg, 'browser').action, 'raise')
	// Raise it.
	setHelperParked(reg, 'browser', false)
	// Back to park.
	assert.strictEqual(decideRaise(reg, 'browser').action, 'park')
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* MULTI-HELPER INDEPENDENCE */
/* ───────────────────────────────────────────────────────────────────────────── */

test('two helpers open simultaneously are independent', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', { action: 'firefox' })
	registerHelper(reg, 'file', { action: 'file-manager' })
	markHelperMapped(reg, 'browser', '100')
	markHelperMapped(reg, 'file', '200')
	// Both open and raised.
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
	// Park browser: file is still raised, should suspend.
	setHelperParked(reg, 'browser', true)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
	// Park file: all parked, should not suspend.
	setHelperParked(reg, 'file', true)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
	// Raise browser: should suspend.
	setHelperParked(reg, 'browser', false)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
	// Each helper's taskbar decision is independent.
	assert.strictEqual(decideRaise(reg, 'browser').action, 'park')
	assert.strictEqual(decideRaise(reg, 'file').action, 'raise')
})

test('closing one helper does not affect another', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', { action: 'firefox' })
	registerHelper(reg, 'file', { action: 'file-manager' })
	markHelperMapped(reg, 'browser', '100')
	markHelperMapped(reg, 'file', '200')
	// Remove browser.
	markHelperGone(reg, 'browser')
	// File should be unaffected.
	assert.strictEqual(reg.helpers['file'].state, 'open')
	assert.strictEqual(reg.helpers['file'].windowId, '200')
})

test('helper state machine works for each helper independently', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', {})
	registerHelper(reg, 'file', {})
	// Advance browser to open.
	markHelperMapped(reg, 'browser', '100')
	// File is still launching.
	assert.strictEqual(reg.helpers['browser'].state, 'open')
	assert.strictEqual(reg.helpers['file'].state, 'launching')
	// Each can be parked independently.
	setHelperParked(reg, 'browser', true)
	assert.strictEqual(reg.helpers['browser'].parked, true)
	assert.strictEqual(reg.helpers['file'].parked, false)
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* STRESS: MANY HELPERS, DYNAMIC LIFECYCLE */
/* ───────────────────────────────────────────────────────────────────────────── */

test('registry handles many helpers without error', () => {
	const reg = createHelperRegistry()
	const ids = ['app1', 'app2', 'app3', 'app4', 'app5']
	// Register all.
	for (const id of ids) {
		registerHelper(reg, id, { action: id })
	}
	assert.strictEqual(helperOpenCount(reg), 5)
	// Map some.
	markHelperMapped(reg, 'app1', '100')
	markHelperMapped(reg, 'app3', '300')
	markHelperMapped(reg, 'app5', '500')
	// All open and raised: suspend.
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), true)
	// Park all.
	for (const id of ids) {
		setHelperParked(reg, id, true)
	}
	// app2, app4 are still launching (never mapped), parked is no-op.
	// app1, app3, app5 are open and parked: should not suspend.
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
	// Remove all.
	for (const id of ids) {
		markHelperGone(reg, id)
	}
	assert.strictEqual(helperOpenCount(reg), 0)
	assert.strictEqual(shouldSuspendKioskTopAssert(reg), false)
})

test('listHelpers is stable and sorted even during dynamic changes', () => {
	const reg = createHelperRegistry()
	const helpers = ['zebra', 'apple', 'mango']
	for (const id of helpers) {
		registerHelper(reg, id, {})
	}
	const snapshot1 = listHelpers(reg).map((h) => h.id)
	registerHelper(reg, 'banana', {})
	const snapshot2 = listHelpers(reg).map((h) => h.id)
	markHelperGone(reg, 'apple')
	const snapshot3 = listHelpers(reg).map((h) => h.id)
	// All should be sorted.
	assert.deepStrictEqual(snapshot1, ['apple', 'mango', 'zebra'])
	assert.deepStrictEqual(snapshot2, ['apple', 'banana', 'mango', 'zebra'])
	assert.deepStrictEqual(snapshot3, ['banana', 'mango', 'zebra'])
})

test('re-registering an existing helper resets it to launching', () => {
	const reg = createHelperRegistry()
	registerHelper(reg, 'browser', { action: 'firefox' })
	markHelperMapped(reg, 'browser', '100')
	setHelperParked(reg, 'browser', true)
	assert.strictEqual(reg.helpers['browser'].state, 'open')
	assert.strictEqual(reg.helpers['browser'].parked, true)
	// Re-register: should reset to launching.
	registerHelper(reg, 'browser', { action: 'firefox-new' })
	assert.strictEqual(reg.helpers['browser'].state, 'launching')
	assert.strictEqual(reg.helpers['browser'].windowId, null)
	assert.strictEqual(reg.helpers['browser'].parked, false)
})
