'use strict'

/**
 * WO-317 — the taskbar feature gate + routes.
 *
 * The load-bearing safety property on a LIVE box: with the flag OFF (the shipped default), the
 * coordinator is never constructed and the WO-283 single-helper path stays the sole authority over
 * the kiosk shape flag. Two writers would fight. These tests pin that the gate holds and that the
 * POST refuses to act when disabled.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	isMultiHelperTaskbarEnabled,
	getHelperCoordinator,
	_resetHelperCoordinator,
} = require('../../src/system/operator-helper-live')
const {
	handleOperatorHelperTaskbarGet,
	handleOperatorHelperTaskbarPost,
} = require('../../src/api/system-hardware-gui')

test('the feature is OFF unless operatorTools.multiHelperTaskbar === true', () => {
	assert.equal(isMultiHelperTaskbarEnabled(undefined), false)
	assert.equal(isMultiHelperTaskbarEnabled({}), false)
	assert.equal(isMultiHelperTaskbarEnabled({ operatorTools: {} }), false)
	assert.equal(isMultiHelperTaskbarEnabled({ operatorTools: { multiHelperTaskbar: false } }), false)
	assert.equal(isMultiHelperTaskbarEnabled({ operatorTools: { multiHelperTaskbar: 'true' } }), false, 'string is not true')
	assert.equal(isMultiHelperTaskbarEnabled({ operatorTools: { multiHelperTaskbar: true } }), true)
})

test('getHelperCoordinator returns null while the flag is off (no second shape-flag writer built)', () => {
	_resetHelperCoordinator()
	assert.equal(getHelperCoordinator({ config: {}, log: () => {} }), null)
})

test('GET taskbar reports enabled:false and no helpers when the flag is off', () => {
	const r = handleOperatorHelperTaskbarGet({ config: {} })
	const body = JSON.parse(r.body)
	assert.equal(r.status, 200)
	assert.equal(body.enabled, false)
	assert.deepEqual(body.helpers, [])
})

test('GET taskbar reports enabled:true with the action vocabulary when the flag is on', () => {
	_resetHelperCoordinator()
	const r = handleOperatorHelperTaskbarGet({ config: { operatorTools: { multiHelperTaskbar: true } }, log: () => {} })
	const body = JSON.parse(r.body)
	assert.equal(body.enabled, true)
	assert.ok(Array.isArray(body.actions) && body.actions.includes('file-manager'))
	_resetHelperCoordinator()
})

test('POST taskbar is refused (400) when the feature is off, even with a valid password', async () => {
	// No nuclearPassword configured → checkNuclearPassword passes; the gate is what must refuse.
	const r = await handleOperatorHelperTaskbarPost(JSON.stringify({ id: 'firefox' }), { config: {}, log: () => {} })
	assert.equal(r.status, 400)
	assert.match(JSON.parse(r.body).error, /disabled/)
})

test('POST taskbar requires an id when the feature is on', async () => {
	_resetHelperCoordinator()
	const r = await handleOperatorHelperTaskbarPost(JSON.stringify({}), {
		config: { operatorTools: { multiHelperTaskbar: true } },
		log: () => {},
	})
	assert.equal(r.status, 400)
	assert.match(JSON.parse(r.body).error, /id required/)
	_resetHelperCoordinator()
})
