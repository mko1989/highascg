'use strict'

/**
 * WO-377 — todos28.07.26 (owner):
 *
 *   "i connected decklink input 4 host channel to a virtual camera output and on the output there
 *    is channel 1 output instead of decklink. if i change the id to 4 it starts with the correct
 *    channel but it defaults to 1 instead of using the connection to determine the channel."
 *
 * HOST-CHANNEL destinations (decklink/live-audio input buses) are VIRTUAL — Device View builds
 * them from the channel map and they are never persisted into `screenDestinations`. So
 * `collectDestinationOutputEdges()`'s `byDestId` lookup missed and the edge was DROPPED: the cable
 * existed in the graph and meant nothing downstream, leaving `virtualCamera.channel` at its stored
 * default of 1.
 *
 * The fixture below is the box's real `GET /api/device-view` graph, trimmed.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	collectDestinationOutputEdges,
	applyVirtualCameraMappingsFromGraph,
	applyStreamRecordMappingsFromGraph,
} = require('../../src/config/device-graph-output-mapping.js')

/** Real connectors/edges from this box, 28.07.26. */
const graph = () => ({
	version: 1,
	devices: [
		{ id: 'destinations', role: 'destinations', label: 'Destinations' },
		{ id: 'caspar_host', role: 'caspar', label: 'Caspar' },
	],
	connectors: [
		{ id: 'dst_in_dst_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
		{
			id: 'dst_in_host_decklink_input_4',
			deviceId: 'destinations',
			kind: 'destination_in',
			externalRef: 'host_decklink_input_4',
			caspar: { hostRole: 'decklink_input', hostChannel: 4, slot: 4 },
		},
		{ id: 'vcam_1', deviceId: 'caspar_host', kind: 'v4l2_out' },
		{ id: 'record_1', deviceId: 'caspar_host', kind: 'record_out' },
	],
	edges: [{ id: 'e1', sourceId: 'dst_in_host_decklink_input_4', sinkId: 'vcam_1' }],
})

const config = (over = {}) => ({
	screenDestinations: {
		version: 1,
		// NOTE: the host channel is deliberately absent — that is the whole point.
		destinations: [{ id: 'dst_a', label: 'PGM/PRV 1', mainScreenIndex: 0, mode: 'pgm_prv' }],
	},
	deviceGraph: graph(),
	virtualCamera: { enabled: true, channel: 1, device: '/dev/video10' },
	...over,
})

test('WO-377 a host-channel cable is no longer invisible to the output mapping', () => {
	const edges = collectDestinationOutputEdges(config()).filter((e) => e.sink.kind === 'v4l2_out')
	assert.equal(edges.length, 1, 'the edge must survive the screenDestinations lookup miss')
	assert.equal(edges[0].hostChannel, 4, 'the channel comes off the connector, not the destination list')
	assert.equal(edges[0].videoSource, null, 'a host channel has no program_N/preview_N name')
	assert.equal(edges[0].mode, 'host_channel')
})

test('WO-377 the virtual camera follows the cable instead of defaulting to 1', () => {
	const cfg = config()
	const res = applyVirtualCameraMappingsFromGraph(cfg)
	assert.equal(res.changed, true)
	assert.equal(res.channel, 4)
	assert.equal(cfg.virtualCamera.channel, 4, 'the reported symptom: it used to stay on 1')
})

test('WO-377 a normal screen destination still resolves through the named source', () => {
	const cfg = config()
	cfg.deviceGraph.edges = [{ id: 'e1', sourceId: 'dst_in_dst_a', sinkId: 'vcam_1' }]
	cfg.channelMap = undefined
	const edges = collectDestinationOutputEdges(cfg).filter((e) => e.sink.kind === 'v4l2_out')
	assert.equal(edges.length, 1)
	assert.equal(edges[0].hostChannel, null, 'only host-channel sources carry an explicit channel')
	assert.equal(edges[0].videoSource, 'program_1')
})

test('WO-377 an unnameable source never blanks a record/stream source string', () => {
	const cfg = config({
		recordOutputs: [{ id: 'record_1', label: 'Rec1', enabled: true, source: 'program_1' }],
	})
	// Same host-channel cable, this time landing on a RECORD sink, whose config field is a STRING.
	cfg.deviceGraph.edges = [{ id: 'e1', sourceId: 'dst_in_host_decklink_input_4', sinkId: 'record_1' }]

	applyStreamRecordMappingsFromGraph(cfg)
	assert.equal(cfg.recordOutputs[0].source, 'program_1', 'must be left alone, not set to null/undefined')
})

test('WO-377 a host connector with no usable channel is still ignored', () => {
	const cfg = config()
	cfg.deviceGraph.connectors = cfg.deviceGraph.connectors.map((c) =>
		c.id === 'dst_in_host_decklink_input_4' ? { ...c, caspar: { hostRole: 'decklink_input' } } : c,
	)
	assert.deepEqual(collectDestinationOutputEdges(cfg), [], 'no channel to resolve → drop it, as before')
	assert.deepEqual(applyVirtualCameraMappingsFromGraph(cfg), { changed: false })
})
