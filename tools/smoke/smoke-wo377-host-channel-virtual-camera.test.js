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
	// WO-378 superseded WO-377's interim `videoSource: null`: a host channel is now NAMED
	// `channel_<N>`, which is what lets it feed record/stream outputs and not just the vcam.
	assert.equal(edges[0].videoSource, 'channel_4')
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

test('WO-377 → WO-378: a host-channel cable now feeds a record output too', () => {
	/* This assertion INVERTED on purpose. WO-377 could only give the virtual camera (which takes a
	 * channel NUMBER) its host channel; a record output stores a source STRING and there was no
	 * name for a host channel, so the rule was "leave it alone rather than blank it".
	 * WO-378 gave it a name — `channel_<N>` — per the owner's "host channels must be able to feed
	 * any and all outputs", so the correct result is now that the record source FOLLOWS the cable.
	 * The no-blanking guard it used to test is still in place for any future unnameable source. */
	const cfg = config({
		recordOutputs: [{ id: 'record_1', label: 'Rec1', enabled: true, source: 'program_1' }],
	})
	cfg.deviceGraph.edges = [{ id: 'e1', sourceId: 'dst_in_host_decklink_input_4', sinkId: 'record_1' }]

	applyStreamRecordMappingsFromGraph(cfg)
	assert.equal(cfg.recordOutputs[0].source, 'channel_4')
	assert.ok(cfg.recordOutputs[0].source, 'and it is never blanked')
})

test('WO-377 a host connector with no usable channel is still ignored', () => {
	const cfg = config()
	cfg.deviceGraph.connectors = cfg.deviceGraph.connectors.map((c) =>
		c.id === 'dst_in_host_decklink_input_4' ? { ...c, caspar: { hostRole: 'decklink_input' } } : c,
	)
	assert.deepEqual(collectDestinationOutputEdges(cfg), [], 'no channel to resolve → drop it, as before')
	assert.deepEqual(applyVirtualCameraMappingsFromGraph(cfg), { changed: false })
})
