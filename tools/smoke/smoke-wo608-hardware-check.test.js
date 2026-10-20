'use strict'

/**
 * WO-608 — project hardware reconcile on the node: GET /api/project/hardware-check runs the web's pure
 * mismatch lib against the live routes in-process and applies the web boot / reconnect prompt rule. The project
 * and the three live routes are stubbed — nothing is read from or written to the box.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const read = require('../../src/api/routes-data-project-read')
const dv = require('../../src/api/routes-device-view')
const snap = require('../../src/api/routes-device-snapshot')
const settings = require('../../src/api/routes-settings')
const HW = require('../../src/api/routes-project-hardware')

const ok = (o) => ({ status: 200, body: JSON.stringify(o) })
const graph = (n) => ({ devices: [], connectors: Array.from({ length: n }, (_, i) => ({ id: `c${i}` })), edges: [] })
let project = null
let live = {}
read.loadProjectMerged = async () => project
dv.handleGet = async () => ok(live.dv || {})
snap.handleGet = async () => ok(live.snap || {})
settings.handleGet = async () => ok(live.settings || {})

test('needsPrompt follows the web boot rule', () => {
	const soft = (section) => ({ section, message: '', severity: 'soft' })
	assert.equal(HW.needsPrompt({ severity: 'none', items: [], sameMachine: false }), false)
	assert.equal(HW.needsPrompt({ severity: 'hard', items: [], sameMachine: true }), false, 'same machine never asks')
	assert.equal(HW.needsPrompt({ severity: 'soft', items: [soft('OS display layout'), soft('Caspar screen modes')], sameMachine: false }), false)
	assert.equal(HW.needsPrompt({ severity: 'soft', items: [soft('Screen destinations')], sameMachine: false }), true)
	assert.equal(HW.needsPrompt({ severity: 'hard', items: [], sameMachine: false }), true)
})

test('check: no project hardware → nothing to reconcile', async () => {
	project = { name: 'Show' }
	const r = await HW.check({})
	assert.deepEqual([r.hasHardware, r.severity, r.prompt, r.projectName], [false, 'none', false, 'Show'])
})

test('check: a foreign machine with fewer connectors asks; the same hardwareId does not', async () => {
	project = { name: 'Tour', hardwareConfig: { deviceGraph: graph(3), fingerprint: { hardwareId: 'A' } } }
	live = { dv: { graph: graph(1), host: { hardwareId: 'B' } } }
	const r = await HW.check({})
	assert.equal(r.severity, 'hard')
	assert.equal(r.sameMachine, false)
	assert.equal(r.prompt, true)
	assert.ok(r.items.some((it) => /Connector count differs \(3 in project vs 1 live\)/.test(it.message)))
	live.dv.host.hardwareId = 'A'
	const same = await HW.check({})
	assert.deepEqual([same.severity, same.sameMachine, same.prompt], ['hard', true, false])
})

test('routes: GET answers hardware-check only; POST without project hardware is a 400', async () => {
	project = { name: 'Show' }
	assert.equal(await HW.handleGet('/api/project/other', {}), null)
	const g = await HW.handleGet('/api/project/hardware-check', {})
	assert.equal(g.status, 200)
	const p = await HW.handlePost('/api/project/hardware-apply', {})
	assert.equal(p.status, 400)
	assert.match(JSON.parse(p.body).error, /no saved hardware/)
})
