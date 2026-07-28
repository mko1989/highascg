'use strict'

/**
 * WO-378 — todos28.07.26 (owner):
 *
 *   "host channels must be able to feed any and all outputs."
 *   "the vocabulary is wrong by calling casparcg channels programs. program should be only used as
 *    a label/id of a pgm screen. the rest should be dealt in channels terminology"
 *
 * `channel_<N>` names a Caspar channel outright; `program_<N>`/`preview_<N>` stay screen-bus
 * labels resolved through the channel map. Three resolvers each carried their own copy of the
 * program/preview regexes, none knew `channel_<N>`, and two fell back to `programCh(1)` — which is
 * why a cabled host channel silently recorded/streamed channel 1.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	channelSourceName,
	parseOutputSourceName,
	resolveOutputSourceToChannel,
} = require('../../src/config/output-source-name.js')
const { resolveInputTargetToChannel } = require('../../src/config/rtmp-output.js')
const { resolveRecordSourceChannel } = require('../../src/api/routes-streaming-channel-shared.js')
const { resolveStreamOutputCasparChannel } = require('../../src/config/routing-map.js')
const { getChannelMap } = require('../../src/config/routing.js')
const {
	collectDestinationOutputEdges,
	applyStreamRecordMappingsFromGraph,
	applyVirtualCameraMappingsFromGraph,
} = require('../../src/config/device-graph-output-mapping.js')

const MAP = { screenCount: 2, programCh: (n) => n, previewCh: (n) => n + 10, multiviewCh: 99 }

test('WO-378 the vocabulary means what the owner said it means', async (t) => {
	await t.test('channel_<N> names a Caspar channel, unbounded by screen count', () => {
		assert.deepEqual(parseOutputSourceName('channel_4'), { kind: 'channel', channel: 4 })
		assert.equal(resolveOutputSourceToChannel(MAP, 'channel_4'), 4)
		// A host/encode channel lives OUTSIDE the screen range — it must not be range-checked away.
		assert.equal(resolveOutputSourceToChannel(MAP, 'channel_12'), 12)
		assert.equal(channelSourceName(4), 'channel_4')
		assert.equal(channelSourceName('7'), 'channel_7')
	})

	await t.test('program_/preview_ stay SCREEN labels, resolved through the map', () => {
		assert.deepEqual(parseOutputSourceName('program_2'), { kind: 'program', index: 2 })
		assert.equal(resolveOutputSourceToChannel(MAP, 'program_2'), 2)
		assert.equal(resolveOutputSourceToChannel(MAP, 'preview_2'), 12, 'PRV of screen 2, not channel 2')
		// A screen that does not exist is not a channel number — it is nothing.
		assert.equal(resolveOutputSourceToChannel(MAP, 'program_9'), null)
	})

	await t.test('multiview and junk', () => {
		assert.equal(resolveOutputSourceToChannel(MAP, 'multiview'), 99)
		assert.equal(resolveOutputSourceToChannel({ ...MAP, multiviewCh: null }, 'multiview'), null)
		for (const junk of ['', null, undefined, 'channel_0', 'program_0', 'nonsense', 'channel_x']) {
			assert.equal(resolveOutputSourceToChannel(MAP, junk), null, String(junk))
		}
	})

	await t.test('hyphen and case tolerated (config written by hand or by older code)', () => {
		assert.equal(resolveOutputSourceToChannel(MAP, 'CHANNEL-4'), 4)
		assert.equal(resolveOutputSourceToChannel(MAP, 'Program-1'), 1)
	})
})

test('WO-378 every output resolver speaks it — one vocabulary, not three', () => {
	// RTMP / virtual camera path
	assert.equal(resolveInputTargetToChannel({}, 'channel_4'), 4)
	assert.equal(resolveInputTargetToChannel({}, 'program_1'), 1)

	// Record path (its own fallback is preserved: record SOMETHING rather than refuse)
	const ctx = {
		config: {
			recordOutputs: [
				{ id: 'r_host', source: 'channel_4' },
				{ id: 'r_pgm', source: 'program_1' },
				{ id: 'r_junk', source: 'nonsense' },
			],
		},
	}
	assert.equal(resolveRecordSourceChannel(ctx, 'r_host'), 4, 'a host channel must record ITSELF, not channel 1')
	assert.equal(resolveRecordSourceChannel(ctx, 'r_pgm'), 1)
	assert.equal(resolveRecordSourceChannel(ctx, 'r_junk'), 1, 'unknown names still fall back rather than fail')

	// Stream encode-channel path
	const map = getChannelMap({})
	assert.deepEqual(resolveStreamOutputCasparChannel({}, map, { videoSource: 'channel_4' }), { kind: 'attach', ch: 4 })
})

test('WO-378 a cabled host channel feeds record, stream AND the virtual camera', () => {
	const graphWith = (sinkId, kind) => ({
		version: 1,
		devices: [
			{ id: 'destinations', role: 'destinations', label: 'Destinations' },
			{ id: 'caspar_host', role: 'caspar', label: 'Caspar' },
		],
		connectors: [
			{
				id: 'dst_in_host_decklink_input_4',
				deviceId: 'destinations',
				kind: 'destination_in',
				externalRef: 'host_decklink_input_4',
				caspar: { hostRole: 'decklink_input', hostChannel: 4, slot: 4 },
			},
			{ id: sinkId, deviceId: 'caspar_host', kind },
		],
		edges: [{ id: 'e1', sourceId: 'dst_in_host_decklink_input_4', sinkId }],
	})
	const cfg = (sinkId, kind) => ({
		screenDestinations: { version: 1, destinations: [] }, // host channels are never in here
		deviceGraph: graphWith(sinkId, kind),
		recordOutputs: [{ id: 'record_1', label: 'Rec1', enabled: true, source: 'program_1' }],
		streamingChannel: { videoSource: 'program_1' },
		virtualCamera: { enabled: true, channel: 1, device: '/dev/video10' },
	})

	const rec = cfg('record_1', 'record_out')
	applyStreamRecordMappingsFromGraph(rec)
	assert.equal(rec.recordOutputs[0].source, 'channel_4')

	const str = cfg('stream_1', 'stream_out')
	applyStreamRecordMappingsFromGraph(str)
	assert.equal(str.streamingChannel.videoSource, 'channel_4')

	const cam = cfg('vcam_1', 'v4l2_out')
	const res = applyVirtualCameraMappingsFromGraph(cam)
	assert.equal(cam.virtualCamera.channel, 4)
	assert.equal(res.videoSource, 'channel_4')

	// …and the name it wrote resolves back to the same channel through the shared resolver.
	assert.equal(resolveInputTargetToChannel(rec, rec.recordOutputs[0].source), 4)
})

test('WO-378 screen destinations are untouched by the new name', () => {
	const cfg = {
		screenDestinations: {
			version: 1,
			destinations: [{ id: 'dst_a', label: 'PGM/PRV 1', mainScreenIndex: 0, mode: 'pgm_prv' }],
		},
		deviceGraph: {
			version: 1,
			devices: [
				{ id: 'destinations', role: 'destinations', label: 'Destinations' },
				{ id: 'caspar_host', role: 'caspar', label: 'Caspar' },
			],
			connectors: [
				{ id: 'dst_in_dst_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
				{ id: 'record_1', deviceId: 'caspar_host', kind: 'record_out' },
			],
			edges: [{ id: 'e1', sourceId: 'dst_in_dst_a', sinkId: 'record_1' }],
		},
		recordOutputs: [{ id: 'record_1', source: 'preview_1' }],
	}
	const edges = collectDestinationOutputEdges(cfg)
	assert.equal(edges[0].videoSource, 'program_1', 'a screen bus keeps its screen-label name')
	assert.equal(edges[0].hostChannel, null)
	applyStreamRecordMappingsFromGraph(cfg)
	assert.equal(cfg.recordOutputs[0].source, 'program_1')
})
