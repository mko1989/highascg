'use strict'

// WO-1029: a cable left by a destination that no longer exists on this server (removed on a linked server) must not
// keep its input occupied — seen on highascg5867: "Pixel Mapping 1" could not take PGM/PRV 3.
const test = require('node:test')
const assert = require('node:assert/strict')
const { orphanDestinationEdges, withoutOrphanDestinationEdges } = require('../../src/config/device-graph-edges')

const graph = {
	connectors: [
		{ id: 'dst_in_dst_mw2fn9wr_1', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_mw2fn9wr_1' },
		{ id: 'dst_in_dst_mw9orj4o_1', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_mw9orj4o_1' },
		{ id: 'dst_in_host_decklink_input_3', deviceId: 'destinations', kind: 'destination_in', externalRef: 'host_decklink_input_3' },
		{ id: 'mapping_a_in', deviceId: 'mapping_a', kind: 'pixel_map_in' },
		{ id: 'mapping_a_out_1', deviceId: 'mapping_a', kind: 'pixel_map_out' },
		{ id: 'gpu_p2', deviceId: 'caspar_host', kind: 'gpu_out' },
		{ id: 'str_1', deviceId: 'caspar_host', kind: 'stream_out' },
	],
	edges: [
		{ id: 'e1', sourceId: 'dst_in_dst_mw2fn9wr_1', sinkId: 'mapping_a_in' },
		{ id: 'e2', sourceId: 'dst_in_dst_mw9orj4o_1', sinkId: 'str_1' },
		{ id: 'e3', sourceId: 'mapping_a_out_1', sinkId: 'gpu_p2' },
		{ id: 'e4', sourceId: 'dst_in_host_decklink_input_3', sinkId: 'mapping_a_in' },
		{ id: 'e5', sourceId: 'dst_in_dst_operator_gui', sinkId: 'gpu_p2' },
	],
}
const ids = ['dst_operator_gui', 'dst_mw9orj4o_1']

test('only the cable of a destination that is not in the list is an orphan', () => {
	assert.deepEqual(orphanDestinationEdges(graph, ids).map((e) => e.id), ['e1'])
	assert.deepEqual(orphanDestinationEdges(graph, [...ids, 'dst_mw2fn9wr_1']), [], 'a known destination has no orphan')
	assert.deepEqual(orphanDestinationEdges(graph, []).map((e) => e.id), ['e1', 'e2', 'e5'], 'host channels and mapping outputs are never orphans')
})

test('the graph without orphans drops the cable and its unused connector, nothing else', () => {
	const { graph: g, orphans } = withoutOrphanDestinationEdges(graph, ids)
	assert.deepEqual(orphans.map((e) => e.id), ['e1'])
	assert.deepEqual(g.edges.map((e) => e.id), ['e2', 'e3', 'e4', 'e5'])
	assert.ok(!g.connectors.some((c) => c.id === 'dst_in_dst_mw2fn9wr_1'))
	assert.equal(g.connectors.length, graph.connectors.length - 1)
	assert.equal(graph.edges.length, 5, 'the input graph is not changed')
})

test('limited to one input: an orphan elsewhere stays', () => {
	const two = { ...graph, edges: [...graph.edges, { id: 'e6', sourceId: 'dst_in_dst_gone_9', sinkId: 'str_1' }] }
	assert.deepEqual(withoutOrphanDestinationEdges(two, ids, 'mapping_a_in').orphans.map((e) => e.id), ['e1'])
	assert.deepEqual(withoutOrphanDestinationEdges(two, ids, 'gpu_p2').orphans, [])
	assert.equal(withoutOrphanDestinationEdges(two, ids, 'gpu_p2').graph, two, 'nothing to drop: the same graph object')
})

test('the routes use it: the view lists orphans apart, cabling an input drops the orphan in it', () => {
	const fs = require('fs')
	const path = require('path')
	const src = (f) => fs.readFileSync(path.join(__dirname, '../../src/api', f), 'utf8')
	assert.match(src('routes-device-view.js'), /graph\.orphanEdges = shown\.orphans/)
	assert.match(src('device-view-crud.js'), /withoutOrphanDestinationEdges\(normalizeDeviceGraph\(ctx\.config\?\.deviceGraph\), destIds, tid\)/)
})
