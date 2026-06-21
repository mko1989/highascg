const test = require('node:test')
const assert = require('node:assert/strict')

const {
	remapIntraLookRoutesForTakeChannel,
	partitionTakeJobsPlayOrder,
} = require('../../src/engine/scene-route-deps')

test('remap intra-look routes to preview bus when staging', () => {
	const scene = {
		id: 'look1',
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'a.mp4' } },
			{ layerNumber: 20, source: { type: 'route', value: 'route://1-10' } },
			{ layerNumber: 40, source: { type: 'media', value: 'b.mp4' } },
			{ layerNumber: 50, source: { type: 'route', value: 'route://1-40' } },
		],
	}
	const out = remapIntraLookRoutesForTakeChannel(scene, 2)
	assert.equal(out.layers[1].source.value, 'route://2-10')
	assert.equal(out.layers[3].source.value, 'route://2-40')
	assert.equal(out.layers[0].source.value, 'a.mp4')
})

test('partitionTakeJobsPlayOrder plays sources before same-channel routes', () => {
	const jobs = [
		{ clip: 'a.mp4', layer: { layerNumber: 10 } },
		{ clip: 'route://1-10', layer: { layerNumber: 20 } },
		{ clip: 'b.mp4', layer: { layerNumber: 40 } },
		{ clip: 'route://1-40', layer: { layerNumber: 50 } },
	]
	const { sources, routes } = partitionTakeJobsPlayOrder(jobs, 1)
	assert.equal(sources.length, 2)
	assert.equal(routes.length, 2)
	assert.equal(sources[0].clip, 'a.mp4')
	assert.equal(routes[0].clip, 'route://1-10')
})
