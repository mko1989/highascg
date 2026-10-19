'use strict'

/**
 * WO-616 T7 — trigger zones (src/tracking/zone-*.js, ported from OpenFollow zones/).
 * Geometry: OpenFollow's own tests/test_zone_geometry.py vectors. Engine: the transition kinds and order,
 * hysteresis, debounce HOLD (re-evaluated, never lost), triggered_by, disabled / degenerate zones, reload carry
 * (and none with the master off), stale = hold vs removed = exit. Actions: parser + runner seams. Service: project
 * slice → engine → action, via project-events.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { pointInPolygon, signedArea, shrinkPolygon } = require('../../src/tracking/zone-geometry')
const { ZoneEngine, normalizeZones } = require('../../src/tracking/zone-engine')
const { parseAction, runAction } = require('../../src/tracking/zone-actions')
const { createZoneService } = require('../../src/tracking/zone-service')
const { emitProjectChanged } = require('../../src/engine/project-events')

const SQUARE = [[0, 0], [4, 0], [4, 4], [0, 4]]
const L_SHAPE = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]
const near = (a, b) => Math.abs(a - b) < 1e-6
const M = (id, x, y, stale = false) => ({ id, x, y, z: 0, stale })

function rig(zones, extra = {}) {
	const events = []
	const eng = new ZoneEngine((e) => events.push(`${e.zone.id}:${e.kind}:${e.marker}:${e.count}`))
	eng.reload({ enabled: true, debounce_ms: 0, hysteresis: 0.5, list: zones, ...extra })
	return { eng, events }
}

describe('WO-616 T7 trigger zones', () => {
	it('point in polygon (OpenFollow vectors)', () => {
		assert.equal(pointInPolygon(2, 2, SQUARE), true)
		assert.equal(pointInPolygon(10, 10, SQUARE), false)
		assert.equal(pointInPolygon(-1, 2, SQUARE), false)
		assert.equal(pointInPolygon(3, 3, L_SHAPE), false, 'concave notch')
		assert.equal(pointInPolygon(1, 3, L_SHAPE), true)
		assert.equal(pointInPolygon(3, 1, L_SHAPE), true)
		assert.equal(pointInPolygon(0, 0, []), false)
		assert.equal(pointInPolygon(1, 0, [[0, 0], [2, 0]]), false)
		assert.equal(pointInPolygon(2, 2, [...SQUARE].reverse()), true, 'winding independent')
		assert.equal(signedArea(SQUARE), 16)
		assert.equal(signedArea([...SQUARE].reverse()), -16)
	})

	it('shrink polygon (OpenFollow vectors)', () => {
		assert.deepEqual(shrinkPolygon(SQUARE, 0), SQUARE)
		assert.deepEqual(shrinkPolygon(SQUARE, -1), SQUARE)
		const s = shrinkPolygon(SQUARE, 0.5)
		;[[0.5, 0.5], [3.5, 0.5], [3.5, 3.5], [0.5, 3.5]].forEach(([x, y], i) => assert.ok(near(s[i][0], x) && near(s[i][1], y)))
		assert.equal(pointInPolygon(0.1, 0.1, s), false)
		assert.equal(pointInPolygon(2, 2, s), true)
		const cw = shrinkPolygon([...SQUARE].reverse(), 0.5)
		assert.equal(pointInPolygon(0.2, 0.2, cw), false, 'clockwise also shrinks inward')
		assert.equal(pointInPolygon(2, 2, cw), true)
		const dup = [[0, 0], [0, 0], [4, 0], [4, 4]]
		assert.deepEqual(shrinkPolygon(dup, 0.5), dup, 'coincident vertices: no-op')
		for (const [x, y] of shrinkPolygon([[0, 0], [10, 0], [-10, 0], [0, 10]], 0.5)) assert.ok(Number.isFinite(x) && Number.isFinite(y), 'hairpin')
		const narrow = [[0, -0.1], [0, 0.1], [10, 0]]
		const sn = shrinkPolygon(narrow, 0.05)
		sn.forEach(([x, y], i) => assert.ok(Math.hypot(x - narrow[i][0], y - narrow[i][1]) <= 0.05 / 0.2 + 1e-9, 'miter clamp'))
		assert.equal(pointInPolygon(1, 0, sn), true)
		const strip = shrinkPolygon([[0, 0], [5, 0], [5, 0.2], [0, 0.2]], 0.3)
		assert.equal(pointInPolygon(2.5, 0.25, strip), false)
		assert.equal(pointInPolygon(2.5, -0.05, strip), false)
		assert.equal(pointInPolygon(2.5, 0.1, strip), true)
		const needle = [[0, 0], [1, 0], [0.5, 0.05]]
		assert.deepEqual(shrinkPolygon(needle, 10), needle, 'winding flip → original')
		const eq = [[0, 0], [1, 0], [0.5, Math.sqrt(3) / 2]]
		assert.deepEqual(shrinkPolygon(eq, 10), eq, 'area collapse → original')
	})

	it('normalize: defaults, master off by default, bad vertices / ids / actions dropped', () => {
		const z = normalizeZones({ list: [{ id: 'a', vertices: [[0, 0], ['x', 1], [1, 'nope'], [1, 1], [0, 1]], triggered_by: [3, 3, 0, 1], actions: { first_entry: ' look:s1 ', bogus: 'x' } }, { id: 'a' }] })
		assert.equal(z.enabled, false)
		assert.equal(z.debounce_ms, 200)
		assert.equal(z.hysteresis, 0.05)
		assert.deepEqual(z.list[0].vertices, [[0, 0], [1, 1], [0, 1]])
		assert.deepEqual(z.list[0].triggered_by, [1, 3])
		assert.deepEqual(z.list[0].actions, { first_entry: 'look:s1', additional_entry: '', partial_exit: '', final_exit: '' })
		assert.equal(z.list[1].id, 'a_', 'duplicate id made unique')
	})

	it('transitions: first / additional entry, partial / final exit, entries before exits, sorted', () => {
		const { eng, events } = rig([{ id: 'z', vertices: SQUARE }])
		assert.equal(eng.update([M(2, 1, 1), M(1, 2, 2), M(3, 9, 9)], 0), 2)
		assert.deepEqual(events.splice(0), ['z:first_entry:1:1', 'z:additional_entry:2:2'])
		eng.update([M(1, 2, 2), M(2, 9, 9), M(3, 1, 1)], 100)
		assert.deepEqual(events.splice(0), ['z:additional_entry:3:3', 'z:partial_exit:2:2'], 'entry counted before the exit')
		eng.update([M(1, 9, 9), M(3, 9, 9)], 200)
		assert.deepEqual(events.splice(0), ['z:partial_exit:1:1', 'z:final_exit:3:0'])
		assert.deepEqual(eng.states()[0], { id: 'z', occupied: false, count: 0, occupants: [], last_kind: 'final_exit' })
	})

	it('hysteresis: enter on the drawn edge, leave only past the shrunk one', () => {
		const { eng, events } = rig([{ id: 'z', vertices: SQUARE }])
		eng.update([M(1, 0.2, 2)], 0) // inside the drawn square, outside the 0.5 m-shrunk one
		assert.deepEqual(events.splice(0), ['z:first_entry:1:1'], 'entry tests the drawn polygon')
		eng.update([M(1, 2, 2)], 100)
		eng.update([M(1, 0.6, 2)], 200)
		assert.equal(eng.states()[0].count, 1, 'still inside the shrunk polygon')
		eng.update([M(1, 0.3, 2)], 300)
		assert.equal(eng.states()[0].count, 0, 'past the shrunk edge → exit')
	})

	it('debounce HOLDS a change and fires it on a later tick (never drops it)', () => {
		const { eng, events } = rig([{ id: 'z', vertices: SQUARE }], { debounce_ms: 200 })
		eng.update([M(1, 2, 2)], 1000)
		eng.update([M(1, 9, 9)], 1050)
		assert.deepEqual(events.splice(0), ['z:first_entry:1:1'], 'exit held inside 200 ms')
		assert.equal(eng.states()[0].count, 1, 'occupancy not advanced while held')
		eng.update([M(1, 9, 9)], 1250)
		assert.deepEqual(events.splice(0), ['z:final_exit:1:0'])
		eng.update([M(1, 2, 2)], 1300)
		eng.update([M(1, 9, 9)], 1350)
		eng.update([M(1, 2, 2)], 1400)
		assert.deepEqual(events.splice(0), [], 'a bounce that came back inside the hold fires nothing')
		assert.equal(eng.states()[0].count, 0)
		eng.update([M(1, 2, 2)], 1460)
		assert.deepEqual(events.splice(0), ['z:first_entry:1:1'])
	})

	it('triggered_by filter; disabled zone clears; degenerate zone skipped', () => {
		const { eng, events } = rig([{ id: 'a', vertices: SQUARE, triggered_by: [2] }, { id: 'b', vertices: [[0, 0], [4, 0]] }])
		eng.update([M(1, 2, 2), M(2, 2, 2)], 0)
		assert.deepEqual(events.splice(0), ['a:first_entry:2:1'])
		eng.reload({ enabled: true, debounce_ms: 0, list: [{ id: 'a', vertices: SQUARE, triggered_by: [2], enabled: false }] })
		eng.update([M(2, 2, 2)], 100)
		assert.deepEqual(events.splice(0), [], 'disabled: nothing fires')
		assert.deepEqual(eng.states()[0], { id: 'a', occupied: false, count: 0, occupants: [], last_kind: '' })
	})

	it('reload carries occupancy for an unchanged zone (FIFO for duplicates); edited zone / master off starts fresh', () => {
		const { eng, events } = rig([{ id: 'a', vertices: SQUARE }, { id: 'b', vertices: SQUARE }])
		eng.update([M(1, 2, 2)], 0)
		events.length = 0
		eng.reload({ enabled: true, debounce_ms: 0, list: [{ id: 'x', name: 'renamed', vertices: SQUARE }, { id: 'y', vertices: [[0, 0], [5, 0], [5, 5]] }] })
		eng.update([M(1, 2, 2)], 100)
		assert.deepEqual(events.splice(0), ['y:first_entry:1:1'], 'renamed zone carried (no refire); reshaped zone re-enters')
		eng.reload({ enabled: false, list: [{ id: 'x', vertices: SQUARE }] })
		assert.equal(eng.update([M(1, 2, 2)], 200), 0, 'master off: no evaluation')
		eng.reload({ enabled: true, debounce_ms: 0, list: [{ id: 'x', vertices: SQUARE }] })
		eng.update([M(1, 2, 2)], 300)
		assert.deepEqual(events.splice(0), ['x:first_entry:1:1'], 're-arming fires first_entry again')
	})

	it('a STALE marker keeps its place (no exit cue on a dropped client); a removed one exits', () => {
		const { eng, events } = rig([{ id: 'z', vertices: SQUARE }])
		eng.update([M(1, 2, 2)], 0)
		eng.update([M(1, 2, 2, true)], 100)
		eng.update([M(1, 9, 9, true)], 200)
		assert.deepEqual(events.splice(0), ['z:first_entry:1:1'], 'stale: held')
		eng.update([], 300)
		assert.deepEqual(events.splice(0), ['z:final_exit:1:0'])
	})

	it('actions: parse look / companion / blank / invalid; run through the seams', async () => {
		assert.equal(parseAction('  '), null)
		assert.deepEqual(parseAction('look:scene_7'), { type: 'look', sceneId: 'scene_7', target: 'program' })
		assert.deepEqual(parseAction('look:scene_7@preview'), { type: 'look', sceneId: 'scene_7', target: 'preview' })
		assert.deepEqual(parseAction('companion:1/2/3'), { type: 'companion', page: 1, row: 2, col: 3 })
		assert.equal(parseAction('/openfollow/zone/1').type, 'invalid')
		const calls = []
		const deps = {
			takeLook: async (b) => (calls.push(['take', b]), b.sceneId === 'gone' ? { status: 404, body: '{"error":"look gone not found"}' } : { status: 200 }),
			fetch: async (url, o) => (calls.push(['fetch', url, o.method]), { ok: true, status: 200 }),
		}
		const ctx = { config: { companion: { host: '10.1.1.5', port: 8001 } } }
		assert.deepEqual(await runAction(parseAction('look:s1@preview'), ctx, deps), { ok: true, detail: 'look s1 → preview' })
		assert.equal((await runAction(parseAction('look:gone'), ctx, deps)).ok, false)
		assert.deepEqual(await runAction(parseAction('companion:4/0/7'), ctx, deps), { ok: true, detail: 'companion 4/0/7 → 200' })
		assert.deepEqual(calls[2], ['fetch', 'http://10.1.1.5:8001/api/location/4/0/7/press', 'POST'])
		assert.equal((await runAction(parseAction('nope'), ctx, deps)).ok, false)
		assert.equal((await runAction({ type: 'look', sceneId: 'x' }, ctx, { takeLook: () => { throw new Error('boom') } })).detail, 'boom')
	})

	it('service: project slice → engine → action; reloads on project-events', async () => {
		const marks = [M(1, 2, 2)]
		const hub = { now: () => 5000, list: () => marks }
		const taken = []
		const project = (on) => ({ previs: { tracking: { zones: { enabled: on, debounce_ms: 0,
			list: [{ id: 'z', name: 'Downstage', vertices: SQUARE, actions: { first_entry: 'look:s1', final_exit: 'companion:1/0/0' } }] } } } })
		const svc = createZoneService({ log: () => {} }, hub, { project: project(false), autostart: false,
			takeLook: async (b) => (taken.push(b.sceneId), { status: 200 }), fetch: async () => ({ ok: true, status: 200 }) })
		try {
			assert.equal(svc.tick(), 0, 'master off by default')
			emitProjectChanged(project(true))
			assert.equal(svc.tick(), 1)
			await new Promise((r) => setImmediate(r))
			assert.deepEqual(taken, ['s1'])
			const st = svc.status()
			assert.equal(st.recent[0].kind, 'first_entry')
			assert.equal(st.recent[0].ok, true)
			assert.deepEqual(svc.snapshot(), { enabled: true, zones: [{ id: 'z', occupied: true, count: 1, occupants: [1], last_kind: 'first_entry' }] })
		} finally {
			svc.stop()
		}
	})
})
