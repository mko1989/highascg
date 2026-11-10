'use strict'

/**
 * WO-1029 plan 07 (C2) — the one "cabled here" predicate (src/config/destination-cabling.js) and cluster-fanout's
 * cabledIds delegating to it.
 *
 * Rule: a destination source reaches a physical sink by a directed path, through mapping nodes only when the node has
 * a cabled output. Orphan cables (a destination not in this server's list) never count.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const cab = require('../../src/config/destination-cabling')
const { cabledIds } = require('../../src/cluster/cluster-fanout')
const { orphanDestinationEdges } = require('../../src/config/device-graph-edges')

const conn = (id, kind, extra = {}) => ({ id, deviceId: extra.deviceId || 'caspar_host', kind, ...extra })
const dstIn = (id) => conn(`dst_in_${id}`, 'destination_in', { deviceId: 'destinations', externalRef: id })

function cfg(edges, connectors = [], dests = ['dst_a_1', 'dst_b_1']) {
	return {
		screenDestinations: { destinations: dests.map((id, i) => ({ id, mode: 'pgm_prv', mainScreenIndex: i })) },
		deviceGraph: {
			connectors: [
				...dests.map(dstIn),
				conn('gpu_p0', 'gpu_out'),
				conn('str_1', 'stream_out'),
				conn('rec_1', 'record_out'),
				conn('aud_1', 'audio_out'),
				conn('dl_in', 'decklink_io', { caspar: { ioDirection: 'in' } }),
				conn('dl_out', 'decklink_io', { caspar: { ioDirection: 'out' } }),
				conn('local_1', 'local_use'),
				conn('artnet_1', 'artnet_out'),
				conn('map_in', 'pixel_map_in', { deviceId: 'map' }),
				conn('map_out_1', 'pixel_map_out', { deviceId: 'map' }),
				conn('map_out_2', 'pixel_map_out', { deviceId: 'map' }),
				...connectors,
			],
			edges: edges.map(([s, t, note], i) => ({ id: `e${i}`, sourceId: s, sinkId: t, ...(note ? { note } : {}) })),
		},
	}
}

describe('WO-1029 C2 cabledHere', () => {
	it('a GPU / stream / record / audio / DeckLink-out / Local use / Art-Net cable makes it cabled', () => {
		for (const sink of ['gpu_p0', 'str_1', 'rec_1', 'aud_1', 'dl_out', 'local_1', 'artnet_1']) {
			assert.equal(cab.cabledHere(cfg([['dst_in_dst_a_1', sink]]), 'dst_a_1'), true, sink)
		}
		assert.equal(cab.cabledHere(cfg([['dst_in_dst_a_1', 'gpu_p0']]), 'dst_b_1'), false, 'only the cabled one')
	})

	it('a DeckLink port in input direction is not a sink', () => {
		assert.equal(cab.cabledHere(cfg([['dst_in_dst_a_1', 'dl_in']]), 'dst_a_1'), false)
	})

	it('a mapping node counts only when one of its outputs is cabled', () => {
		assert.equal(cab.cabledHere(cfg([['dst_in_dst_a_1', 'map_in']]), 'dst_a_1'), false, 'mapping without outputs = no')
		const c = cfg([['dst_in_dst_a_1', 'map_in'], ['map_out_2', 'gpu_p0']])
		assert.equal(cab.cabledHere(c, 'dst_a_1'), true, 'mapping → out_2 → GPU = yes')
		assert.deepEqual(cab.destinationCabling(c, 'dst_a_1').sinks, [{ id: 'gpu_p0', kind: 'gpu_out' }])
	})

	it('PRV-only cable (outputLayer ≥ 2) makes this server an owner too, reported per bus', () => {
		const prvOnly = cab.destinationCabling(cfg([['dst_in_dst_a_1', 'gpu_p0', '{"outputLayer":2}']]), 'dst_a_1')
		assert.deepEqual([prvOnly.cabled, prvOnly.pgm, prvOnly.prv], [true, false, true])
		const both = cab.destinationCabling(cfg([['dst_in_dst_a_1', 'gpu_p0'], ['dst_in_dst_a_1', 'str_1', '{"outputLayer":2}']]), 'dst_a_1')
		assert.deepEqual([both.pgm, both.prv], [true, true])
	})

	it('orphan cables of destinations not in the list never count', () => {
		const c = cfg([['dst_in_dst_gone_1', 'gpu_p0']], [dstIn('dst_gone_1')])
		assert.equal(orphanDestinationEdges(c.deviceGraph, ['dst_a_1', 'dst_b_1']).length, 1, 'it is an orphan')
		assert.equal(cab.cabledHere(c, 'dst_gone_1'), false)
		assert.deepEqual([...cab.cabledDestinationIds(c)], [])
		assert.equal(cab.destinationCabling(c, 'dst_gone_1').known, false)
	})

	it('a connector found by externalRef, legacy dst_chN, and an undescribed sink all count; an empty sink does not', () => {
		const viaRef = cfg([['custom_conn', 'gpu_p0']], [conn('custom_conn', 'destination_in', { deviceId: 'destinations', externalRef: 'dst_b_1' })])
		assert.equal(cab.cabledHere(viaRef, 'dst_b_1'), true)
		assert.equal(cab.cabledHere(cfg([['dst_ch2', 'gpu_p0']]), 'dst_b_1'), true, 'legacy dst_ch2 = screen index 1')
		assert.equal(cab.cabledHere(cfg([['dst_in_dst_a_1', 'gpu_unplugged']]), 'dst_a_1'), true, 'an unplugged port must not renumber channels')
		assert.equal(cab.cabledHere(cfg([['dst_in_dst_a_1', '']]), 'dst_a_1'), false)
	})

	it('localScreenPlan: per screen index, stream-mode destinations cable their screen, host_channel stays local', () => {
		const c = cfg([['dst_in_dst_s_1', 'str_1']], [dstIn('dst_s_1')])
		c.screenDestinations.destinations.push({ id: 'dst_s_1', mode: 'stream', mainScreenIndex: 1 })
		c.screenDestinations.destinations.push({ id: 'dst_h_1', mode: 'host_channel', mainScreenIndex: 2 })
		const p = cab.localScreenPlan(c, 3)
		assert.deepEqual(p.local, [false, true, true])
		assert.equal(p.hosts[1].destId, 'dst_b_1', 'the screen is named by its main destination')
		assert.equal(cab.localScreenPlan({ deviceGraph: {} }, 2), null, 'no destination list (legacy) → the rule does not apply')
		assert.ok(cab.SINK_KINDS.has('local_use') && cab.isPhysicalSink({ kind: 'artnet_out' }))
		assert.equal(typeof cab.createCablingContext(c).out.get, 'function')
	})
})

/** Today's rule (cluster-fanout.js before plan 07): any edge with a sink out of a destination_in with an externalRef. */
function oldCabledIds(view) {
	const destOf = new Map()
	for (const c of view.graph.connectors || []) if (c?.kind === 'destination_in' && c.externalRef) destOf.set(String(c.id), String(c.externalRef))
	const out = new Set()
	for (const e of view.graph.edges || []) if (e && destOf.has(String(e.sourceId)) && e.sinkId) out.add(destOf.get(String(e.sourceId)))
	return out
}

describe('WO-1029 C2 cluster-fanout cabledIds delegates', () => {
	const box = (b) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/cwc', `box${b}.config.json`), 'utf8'))
	const viewOf = (c) => ({ graph: c.deviceGraph, screenDestinations: c.screenDestinations })

	it('the two real boxes: same answer as the old rule', () => {
		const v7579 = viewOf(box('7579'))
		const v5867 = viewOf(box('5867'))
		assert.deepEqual([...cabledIds(v7579)].sort(), ['dst_mw7t9epz_1', 'dst_operator_gui'])
		assert.deepEqual([...cabledIds(v5867)].sort(), ['dst_mw989wyz_1', 'dst_mw9orj4o_1', 'dst_operator_gui'])
		assert.deepEqual([...cabledIds(v7579)].sort(), [...oldCabledIds(v7579)].sort())
		assert.deepEqual([...cabledIds(v5867)].sort(), [...oldCabledIds(v5867)].sort())
	})

	it('where the old rule was wrong: a mapping node with no cabled output, an orphan cable', () => {
		const v = viewOf(box('5867'))
		v.graph = { ...v.graph, edges: v.graph.edges.filter((e) => !String(e.sourceId).startsWith('mapping_')) }
		assert.equal(oldCabledIds(v).has('dst_mw989wyz_1'), true, 'old: any edge counted')
		assert.equal(cabledIds(v).has('dst_mw989wyz_1'), false, 'new: the mapping node outputs nothing')
		const o = viewOf(box('7579'))
		o.graph = {
			...o.graph,
			connectors: [...o.graph.connectors, dstIn('dst_gone_1')],
			edges: [...o.graph.edges, { id: 'eg', sourceId: 'dst_in_dst_gone_1', sinkId: 'gpu_p0' }],
		}
		assert.equal(oldCabledIds(o).has('dst_gone_1'), true)
		assert.equal(cabledIds(o).has('dst_gone_1'), false)
	})

	it('a view without a destination list (old peer) still answers by destination_in', () => {
		const v = { graph: { connectors: [dstIn('dst_x_1')], edges: [{ sourceId: 'dst_in_dst_x_1', sinkId: 'gpu_9' }] } }
		assert.deepEqual([...cabledIds(v)], ['dst_x_1'])
	})
})
