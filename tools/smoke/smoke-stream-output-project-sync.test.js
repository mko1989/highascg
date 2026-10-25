'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
// WO-261: stream credentials live in the active project only, never copied out of the device graph. This file
// also tested a syncStreamOutputsToDeviceGraph (copying keys INTO the graph, which WO-261 forbids) and a
// hardwareConfigHasStreamOperatorData; neither ever landed in git, so those two tests are gone (WO-755).
const { applyStreamRecordMappingsFromGraph } = require('../../src/config/device-graph-output-mapping')

test('applyStreamRecordMappingsFromGraph does not copy stale URL/key from graph to streamingChannel', () => {
	const config = {
		streamingChannel: { videoSource: 'program_1', rtmpServerUrl: '', streamKey: '' },
		streamOutputs: [{ id: 'str_1', rtmpServerUrl: '', streamKey: '' }],
		deviceGraph: {
			version: 1,
			devices: [],
			connectors: [
				{ id: 'dst_in_1', kind: 'destination_in', externalRef: 'dst_1' },
				{
					id: 'str_1',
					kind: 'stream_out',
					caspar: {
						rtmpServerUrl: 'rtmp://stale/from-graph',
						streamKey: 'graph-key',
						quality: 'high',
					},
				},
			],
			edges: [{ id: 'e1', sourceId: 'dst_in_1', sinkId: 'str_1' }],
		},
		screenDestinations: {
			destinations: [{ id: 'dst_1', mode: 'pgm_only', mainScreenIndex: 0 }],
		},
	}

	applyStreamRecordMappingsFromGraph(config)
	assert.equal(config.streamingChannel.rtmpServerUrl, '')
	assert.equal(config.streamingChannel.streamKey, '')
})
