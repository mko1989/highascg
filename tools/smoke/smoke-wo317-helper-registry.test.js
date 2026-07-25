'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

/**
 * WO-317: Multiple helper windows + taskbar on the operator monitor.
 * Pure registry logic tests: create/register, mapped/gone transitions, parked state, open count.
 *
 * Split from a single oversized file to stay under the 480-line file cap; continues in
 * tools/smoke/smoke-wo317-helper-registry-raise-and-stress.test.js (kiosk top-assert refcount,
 * listHelpers ordering, decideRaise taskbar-click logic, multi-helper independence, and the
 * many-helpers stress lifecycle).
 */

const {
	createHelperRegistry,
	registerHelper,
	markHelperMapped,
	markHelperGone,
	setHelperParked,
	helperOpenCount,
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
