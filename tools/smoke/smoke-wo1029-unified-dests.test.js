'use strict'

/**
 * WO-1029 plan 06 S5 / S6 (owner D1, D7) — the destination list is shared whenever servers are linked, without the
 * show toggle (shared-show-dests.js), through the guard of shared-show-dests-ctx.js:
 *   a Devices add / remove on any server reaches the others at once (no poll, no autosave);
 *   a list that merely lacks a destination CABLED on the receiving server keeps it and says so ({ conflict: 'cabled here' });
 *   an explicit delete removes it and its cables everywhere online; a server offline during the delete is pending and
 *   deletes its (orphan) cables when it is back — never on a transient empty list;
 *   a follower's Load / New project is not an edit: the shared list comes back; lists converge after a flap;
 *   a writer on an older build (no 'dests-shared') → nothing shared (today's behaviour).
 * Real ctx glue (takeList / applyOps / saveConfig on a mock config manager); the signed transport is a direct call.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createSharedDests } = require('../../src/cluster/shared-show-dests')
const { takeList, applyOps, sharedList, guardIncoming } = require('../../src/cluster/shared-show-dests-ctx')
const caps = require('../../src/cluster/cluster-caps')

const dest = (id, label = id, i = 0) => ({ id, label, mode: 'pgm_prv', mainScreenIndex: i, videoMode: '1080p5000', width: 1920, height: 1080, fps: 50, caspar: { bus: 'pgm' } })
const gui = (port) => ({ id: 'dst_operator_gui', label: 'Operator GUI', mode: 'operator_gui', physicalPort: port })
function graph(cabled) {
	const connectors = [{ id: 'gpu_p0', deviceId: 'caspar_host', kind: 'gpu_out' }, { id: 'gpu_p1', deviceId: 'caspar_host', kind: 'gpu_out' }]
	const edges = cabled.map((id, i) => ({ id: `e_${id}`, sourceId: `dst_in_${id}`, sinkId: `gpu_p${i}` }))
	for (const id of cabled) connectors.push({ id: `dst_in_${id}`, deviceId: 'destinations', kind: 'destination_in', externalRef: id })
	return { version: 1, devices: [], connectors, edges }
}

function cluster(spec) {
	const nodes = new Map()
	const cut = new Set()
	let clock = 1e12
	const reach = (a, b) => !cut.has([a, b].sort().join('|'))
	for (const [name, s] of Object.entries(spec)) {
		const config = { screenDestinations: { version: 1, destinations: [gui(s.port || 1), ...(s.dests || [])] }, deviceGraph: graph(s.cabled || []) }
		const ctx = { config, configManager: { get: () => config, save: (next) => Object.assign(config, structuredClone(next)) }, log: () => {} }
		nodes.set(name, { name, fp: `fp_${name}`, caps: s.caps ?? caps.supported(), ctx, store: new Map(), claim: null })
	}
	const all = [...nodes.values()]
	for (const n of all) {
		const others = () => all.filter((o) => o !== n)
		n.dests = createSharedDests({
			store: { get: (k) => structuredClone(n.store.get(k)), set: (k, v) => n.store.set(k, structuredClone(v)) },
			selfFp: () => n.fp,
			claim: () => n.claim,
			peers: () => others().map((o) => ({ id: o.name, name: o.name, fp: o.fp, online: reach(n.name, o.name), caps: reach(n.name, o.name) ? o.caps : [] })),
			call: async (id, action, args) => {
				await new Promise((r) => setImmediate(r))
				const to = nodes.get(id)
				if (!reach(n.name, id)) return { ok: false, status: 0, error: 'unreachable' }
				if (!to.dests || !to.caps.includes('dests-shared')) return { ok: false, status: 400, json: { error: 'unknown action' } }
				const r = await to.dests.info[action](args, { id: n.name, name: n.name, fp: n.fp })
				return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.body }
			},
			list: () => sharedList(n.ctx.config),
			take: (list, tombs) => takeList(n.ctx, list, tombs),
			applyOps: (ops) => applyOps(n.ctx, ops),
			now: () => clock,
		})
		if (!n.caps.includes('dests-shared')) n.dests = { tick: async () => {}, localEdit: () => null, info: {}, view: () => ({}) } // an older build
		/** A Devices add / remove here (the CRUD as device-view-crud.js runs it, then its hook). */
		n.add = (d) => {
			n.ctx.config.screenDestinations.destinations.push(d)
			return n.dests.localEdit({ upsert: d, index: n.ctx.config.screenDestinations.destinations.length - 1 })
		}
		n.remove = (id) => {
			require('../../src/api/device-view-crud').removeDestinationHere(n.ctx, id)
			return n.dests.localEdit({ remove: id })
		}
		n.ids = () => sharedList(n.ctx.config).map((d) => d.id)
		n.edges = () => n.ctx.config.deviceGraph.edges.map((e) => e.sourceId)
	}
	const c = {
		node: (k) => nodes.get(k),
		master(k, epoch = 1) {
			for (const n of all) n.claim = { epoch, master: nodes.get(k).fp }
		},
		cut: (a, b) => cut.add([a, b].sort().join('|')),
		heal: () => cut.clear(),
		advance: (ms) => (clock += ms),
		async flush() {
			for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r))
		},
		async settle(rounds = 4) {
			for (let i = 0; i < rounds; i++) {
				await c.flush()
				for (const n of all) await n.dests.tick()
				c.advance(6000)
			}
			await c.flush()
		},
	}
	return c
}

describe('WO-1029 S5: one destination list on every linked server, show sharing off', () => {
	it('an add on a follower reaches the master and the third server at once (no poll)', async () => {
		const c = cluster({ a: { dests: [dest('dst_led_1', 'LED')] }, b: { dests: [dest('dst_led_1', 'LED')], port: 3 }, c: { dests: [dest('dst_led_1', 'LED')] } })
		c.master('a')
		const r = c.node('b').add(dest('dst_new_1', 'Screen 3', 1))
		assert.equal(r.writer, 'a')
		await c.flush() // the propose and the push it causes; no tick
		for (const k of ['a', 'b', 'c']) assert.deepEqual(c.node(k).ids(), ['dst_led_1', 'dst_new_1'], k)
		const g = c.node('b').ctx.config.screenDestinations.destinations.find((d) => d.mode === 'operator_gui')
		assert.equal(g.physicalPort, 3, 'b keeps its own operator GUI')
	})

	it('a list that lacks a destination cabled here keeps it, with a conflict; an uncabled one goes', async () => {
		const c = cluster({ a: { dests: [dest('dst_x_1'), dest('dst_y_1')] }, b: { dests: [dest('dst_x_1'), dest('dst_y_1')], cabled: ['dst_y_1'] }, c: { dests: [dest('dst_x_1'), dest('dst_y_1')] } })
		c.master('a')
		// a's list changes outside the CRUD (a Load on the master): no tombstone
		c.node('a').ctx.config.screenDestinations.destinations = c.node('a').ctx.config.screenDestinations.destinations.filter((d) => d.id !== 'dst_y_1')
		await c.settle(1)
		assert.deepEqual(c.node('c').ids(), ['dst_x_1'], 'uncabled on c: it follows the list')
		assert.deepEqual(c.node('b').ids(), ['dst_x_1', 'dst_y_1'], 'cabled on b: kept')
		assert.deepEqual(c.node('b').dests.view().conflicts, [{ conflict: 'cabled here', destId: 'dst_y_1', label: 'dst_y_1' }])
		assert.deepEqual(c.node('a').dests.view().peers.b.conflicts.map((x) => x.destId), ['dst_y_1'], 'the writer sees it too')
		assert.deepEqual(c.node('b').edges(), ['dst_in_dst_y_1'], 'its cable stays')
	})

	it('a transient empty list never empties a server', () => {
		const config = { screenDestinations: { destinations: [gui(1), dest('dst_x_1')] }, deviceGraph: graph([]) }
		const g = guardIncoming(config, [], [])
		assert.deepEqual(g.list.map((d) => d.id), ['dst_operator_gui', 'dst_x_1'])
		assert.equal(g.conflicts[0].conflict, 'empty list')
	})

	it('a follower\'s Load / New project is not an edit: the master keeps its list, the follower gets it back', async () => {
		const c = cluster({ a: { dests: [dest('dst_x_1'), dest('dst_y_1')] }, b: { dests: [dest('dst_x_1'), dest('dst_y_1')] } })
		c.master('a')
		await c.settle(1)
		c.node('b').ctx.config.screenDestinations.destinations = [gui(2)] // a New project's factory list
		await c.settle(2)
		assert.deepEqual(c.node('a').ids(), ['dst_x_1', 'dst_y_1'], 'the master\'s list is untouched')
		assert.deepEqual(c.node('b').ids(), ['dst_x_1', 'dst_y_1'], 'the follower is back on the shared list')
	})

	it('both lists converge after a flap: an edit on each side while cut', async () => {
		const c = cluster({ a: { dests: [dest('dst_x_1')] }, b: { dests: [dest('dst_x_1')] } })
		c.master('a')
		await c.settle(1)
		c.cut('a', 'b')
		c.node('b').add(dest('dst_b_1', 'from b'))
		c.node('a').add(dest('dst_a_1', 'from a'))
		await c.settle(2)
		assert.equal(c.node('b').dests.view().pending, 1, 'b\'s edit waits (kept in the store)')
		c.heal()
		await c.settle(3)
		assert.deepEqual(c.node('a').ids().sort(), ['dst_a_1', 'dst_b_1', 'dst_x_1'])
		assert.deepEqual(c.node('b').ids().sort(), c.node('a').ids().sort())
	})

	it('a writer on an older build: nothing is shared (today\'s behaviour)', async () => {
		const c = cluster({ a: { dests: [dest('dst_x_1')], caps: [] }, b: { dests: [dest('dst_x_1')] } })
		c.master('a')
		assert.equal(c.node('b').add(dest('dst_b_1')), null)
		await c.settle(1)
		assert.deepEqual(c.node('a').ids(), ['dst_x_1'])
		assert.deepEqual(c.node('b').ids(), ['dst_x_1', 'dst_b_1'])
	})
})

describe('WO-1029 S6: removing a destination clears its cables on every linked server', () => {
	it('online servers drop it and its cables at once; an offline one is pending and cleans up when back', async () => {
		const cabled = ['dst_wall_1']
		const c = cluster({ a: { dests: [dest('dst_wall_1')] }, b: { dests: [dest('dst_wall_1')], cabled }, c: { dests: [dest('dst_wall_1')], cabled } })
		c.master('a')
		await c.settle(1)
		c.cut('a', 'c')
		c.cut('b', 'c')
		const r = c.node('a').remove('dst_wall_1')
		assert.deepEqual(r.pending, ['c'], 'the offline server is reported pending')
		await c.flush()
		assert.deepEqual(c.node('b').ids(), [])
		assert.deepEqual(c.node('b').edges(), [], 'b\'s cable is gone')
		assert.deepEqual(c.node('a').dests.view().removals.map((x) => [x.destId, x.pending]), [['dst_wall_1', ['c']]])
		// c, while away, takes nothing; its cable stays (an orphan only once the shared list confirms the delete)
		assert.deepEqual(c.node('c').edges(), ['dst_in_dst_wall_1'])
		c.heal()
		await c.settle(1)
		assert.deepEqual(c.node('c').ids(), [])
		assert.deepEqual(c.node('c').edges(), [], 'c deleted the cable once the list carried the delete')
		assert.deepEqual(c.node('a').dests.view().removals[0].pending, [])
	})

	it('a server that missed the delete deletes its orphan cable from the tombstone', () => {
		const config = { screenDestinations: { destinations: [gui(1)] }, deviceGraph: graph(['dst_gone_1']) }
		const ctx = { config, configManager: { get: () => config, save: (n) => Object.assign(config, structuredClone(n)) }, log: () => {} }
		assert.deepEqual(takeList(ctx, [], []).pruned, [], 'no tombstone: nothing deleted')
		assert.equal(config.deviceGraph.edges.length, 1)
		assert.deepEqual(takeList(ctx, [], ['dst_gone_1']).pruned, ['dst_gone_1'])
		assert.equal(config.deviceGraph.edges.length, 0)
	})
})
