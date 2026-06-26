const test = require('node:test')
const assert = require('node:assert/strict')

const {
	remapIntraLookRoutesForTakeChannel,
	partitionTakeJobsPlayOrder,
	orderRouteJobsByDependency,
	crossfadeSuffixLinesForStaggeredRoutes,
	incomingCrossfadeOpacityLine,
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

test('remap intra-look routes to inactive bank B physical layers on PGM', () => {
	const scene = {
		id: 'look1',
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'a.mp4' } },
			{ layerNumber: 20, source: { type: 'route', value: 'route://1-10' } },
		],
	}
	const out = remapIntraLookRoutesForTakeChannel(scene, 1, 'b')
	assert.equal(out.layers[1].source.value, 'route://1-110')
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

test('orderRouteJobsByDependency plays chained routes in source order', () => {
	const jobs = [
		{ pLayer: 10, clip: 'a.mp4', layer: { layerNumber: 10 } },
		{ pLayer: 30, clip: 'route://1-20', layer: { layerNumber: 30 } },
		{ pLayer: 20, clip: 'route://1-10', layer: { layerNumber: 20 } },
	]
	const { routes } = partitionTakeJobsPlayOrder(jobs, 1)
	const ordered = orderRouteJobsByDependency(routes, jobs)
	assert.equal(ordered.length, 2)
	assert.equal(ordered[0].pLayer, 20)
	assert.equal(ordered[1].pLayer, 30)
})

test('crossfadeSuffixLinesForStaggeredRoutes defers route incoming fades to route PLAY batch', () => {
	const takeJobs = [
		{ pLayer: 110, clip: 'a.mp4', layer: { layerNumber: 10 }, incomingIsAboveOutgoing: true, targetOpacity: 1 },
		{ pLayer: 120, clip: 'route://1-10', layer: { layerNumber: 20 }, incomingIsAboveOutgoing: true, targetOpacity: 1 },
		{ pLayer: 10, clip: 'old.mp4', layer: { layerNumber: 10 }, incomingIsAboveOutgoing: false, targetOpacity: 1 },
	]
	const crossfadeLines = [
		'MIXER 1-110 OPACITY 1 25 linear',
		'MIXER 1-120 OPACITY 1 25 linear',
		'MIXER 1-10 OPACITY 0 25 linear',
	]
	const suffix = crossfadeSuffixLinesForStaggeredRoutes(crossfadeLines, takeJobs)
	assert.deepEqual(suffix, ['MIXER 1-110 OPACITY 1 25 linear', 'MIXER 1-10 OPACITY 0 25 linear'])
})

test('incomingCrossfadeOpacityLine builds fade-in for bank-B incoming', () => {
	const job = { pLayer: 120, incomingIsAboveOutgoing: true, targetOpacity: 1 }
	assert.equal(incomingCrossfadeOpacityLine(job, 1, 25, 'linear'), 'MIXER 1-120 OPACITY 1 25 linear')
})
