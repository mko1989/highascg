'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	syncStreamOutputsToDeviceGraph,
	applyStreamRecordMappingsFromGraph,
} = require('../../src/config/device-graph-output-mapping')
const {
	hardwareConfigHasOperatorData,
	hardwareConfigHasStreamOperatorData,
} = require('../../src/engine/project-hardware-config')

test('syncStreamOutputsToDeviceGraph copies URL/key from streamOutputs into graph connector', () => {
	const config = {
		streamOutputs: [
			{
				id: 'str_1',
				type: 'rtmp',
				name: 'Main',
				label: 'Main',
				quality: 'high',
				rtmpServerUrl: 'rtmp://example/live',
				streamKey: 'secret-key',
				videoCodec: 'h264',
				videoBitrateKbps: 6000,
				encoderPreset: 'fast',
				audioCodec: 'aac',
				audioBitrateKbps: 160,
			},
		],
		deviceGraph: {
			version: 1,
			devices: [],
			connectors: [
				{
					id: 'str_1',
					kind: 'stream_out',
					label: 'Str1',
					caspar: {
						type: 'rtmp',
						name: 'Str1',
						rtmpServerUrl: 'rtmp://stale/old',
						streamKey: 'old-key',
					},
				},
			],
			edges: [],
		},
	}

	const { changed } = syncStreamOutputsToDeviceGraph(config)
	assert.equal(changed, true)
	const caspar = config.deviceGraph.connectors[0].caspar
	assert.equal(caspar.rtmpServerUrl, 'rtmp://example/live')
	assert.equal(caspar.streamKey, 'secret-key')
	assert.equal(caspar.name, 'Main')
})

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

	syncStreamOutputsToDeviceGraph(config)
	applyStreamRecordMappingsFromGraph(config)
	assert.equal(config.streamingChannel.rtmpServerUrl, '')
	assert.equal(config.streamingChannel.streamKey, '')
})

test('hardwareConfigHasStreamOperatorData detects streamOutputs in project hardwareConfig', () => {
	const hc = {
		streamOutputs: [{ id: 'str_1', rtmpServerUrl: 'rtmp://live', streamKey: 'abc' }],
	}
	assert.equal(hardwareConfigHasStreamOperatorData(hc), true)
	assert.equal(hardwareConfigHasOperatorData(hc), true)
})
