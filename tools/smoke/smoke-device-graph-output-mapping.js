const test = require('node:test')
const assert = require('node:assert/strict')

const { applyStreamRecordMappingsFromGraph } = require('../../src/config/device-graph-output-mapping')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { getChannelMap } = require('../../src/config/routing')

test('graph edges sync stream/record source from PGM 2 destination', () => {
	const app = {
		deviceGraph: require('../../config/device_graph.json'),
		screenDestinations: require('../../config/screen_destinations.json'),
		streamingChannel: { enabled: true, videoSource: 'program_1' },
		recordOutputs: [{ id: 'rec_1', label: 'Rec1', enabled: true, name: 'Rec1', source: 'program_1' }],
		casparServer: { screen_count: 2 },
	}
	const res = applyStreamRecordMappingsFromGraph(app)
	assert.equal(res.changed, true)
	assert.equal(app.streamingChannel.videoSource, 'program_2')
	assert.equal(app.recordOutputs[0].source, 'program_2')

	const flat = buildCasparGeneratorFlatConfig(app)
	assert.equal(flat.streamingChannel.videoSource, 'program_2')
	const map = getChannelMap(flat)
	assert.equal(map.programCh(2), 3)
})
