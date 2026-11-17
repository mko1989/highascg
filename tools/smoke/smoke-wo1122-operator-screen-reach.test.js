'use strict'

/**
 * WO-1122 — a screen the confined pointer cannot reach is marked `reach: false` in GET /api/system/operator-screen,
 * so the client's second window does not stay on it after a project with one operator monitor is loaded.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { handleGet } = require('../../src/api/routes-operator-screen')

const listOutputs = () => [
	{ name: 'DP-3', port: 2, x: 0, y: 0, width: 1920, height: 1080 },
	{ name: 'DP-5', port: 3, x: 1920, y: 0, width: 1920, height: 1080 },
	{ name: 'DP-0', port: 0, x: 3840, y: 0, width: 3840, height: 1080 },
]
const get = (deps) => JSON.parse(handleGet({ config: {} }, { listOutputs, resolveFlagPort: () => 2, bootStatus: () => ({}), ...deps }).body).outputs
const roles = (gui) => () => ({ caspar: new Set(['DP-0']), gui: new Map(gui) })

test('confined: only the operator monitors are reachable', () => {
	const one = get({ confined: () => true, planRoles: roles([['DP-3', 1]]) })
	assert.deepEqual(one.map((o) => [o.name, o.reach]), [['DP-3', undefined], ['DP-5', false], ['DP-0', false]])
	const two = get({ confined: () => true, planRoles: roles([['DP-3', 1], ['DP-5', 2]]) })
	assert.equal(two[1].reach, undefined, 'operator monitor 2 is reachable')
	assert.equal(two[1].gui, 2)
})

test('not confined: nothing is marked', () => {
	assert.ok(get({ confined: () => false, planRoles: roles([['DP-3', 1]]) }).every((o) => !('reach' in o)))
})
