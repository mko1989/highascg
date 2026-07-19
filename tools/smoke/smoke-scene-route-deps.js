const test = require('node:test')
const assert = require('node:assert/strict')

const {
	remapIntraLookRoutesForTakeChannel,
	partitionTakeJobsPlayOrder,
	orderRouteJobsByDependency,
	crossfadeSuffixLinesForStaggeredRoutes,
	incomingCrossfadeOpacityLine,
	sendStaggeredTakePlays,
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

// ---------------------------------------------------------------------------
// todos19.07.26: a look mixing 1 media layer + route:// layers must land on ONE
// frame — sendStaggeredTakePlays folds same-channel route PLAYs into the same
// BEGIN…COMMIT batch as the source PLAYs (dependency-ordered) when two-phase
// batching is on. The staggered sequential path survives only for flag-off rollback.
// ---------------------------------------------------------------------------

function makeRecordingAmcp() {
	const events = []
	return {
		events,
		mixerCommit: async (ch) => {
			events.push({ t: 'commit', channel: ch })
		},
		batchSendChunked: async (lines, opts) => {
			events.push({ t: 'batch', lines: lines.slice(), opts: { ...(opts || {}) } })
			return { ok: true, batched: true }
		},
		// legacy path (sendAmcpLinesSequential) drives client._send line by line
		_send: async (line) => {
			events.push({ t: 'send', line })
			return { status: 200 }
		},
	}
}

/** 1 media source + 3 routes consuming it on the same channel (the reported look shape). */
function mediaPlusThreeRouteJobs() {
	return [
		{ pLayer: 110, clip: 'clip.mov', layer: { layerNumber: 10 } },
		{ pLayer: 120, clip: 'route://1-110', layer: { layerNumber: 20 } },
		{ pLayer: 130, clip: 'route://1-110', layer: { layerNumber: 30 } },
		{ pLayer: 140, clip: 'route://1-110', layer: { layerNumber: 40 } },
	]
}

test('sendStaggeredTakePlays (two-phase): source + all route PLAYs in ONE batch, source first', async () => {
	const amcp = makeRecordingAmcp()
	const jobs = mediaPlusThreeRouteJobs()
	await sendStaggeredTakePlays(amcp, 1, jobs, (job) => [`PLAY 1-${job.pLayer}`], {
		leadingCommit: true,
		commitAfterSources: true,
		commitAfterRoutes: true,
		suffixAfterSources: ['MIXER 1-110 OPACITY 1 25 linear'],
		twoPhaseBatch: true,
	})

	const batches = amcp.events.filter((e) => e.t === 'batch')
	assert.equal(batches.length, 1, `exactly one BEGIN…COMMIT batch (atomic, one frame); events: ${JSON.stringify(amcp.events)}`)
	const lines = batches[0].lines
	assert.deepEqual(
		lines.filter((l) => l.startsWith('PLAY ')),
		['PLAY 1-110', 'PLAY 1-120', 'PLAY 1-130', 'PLAY 1-140'],
		'source PLAY precedes every route PLAY inside the batch',
	)
	assert.ok(lines.includes('MIXER 1-110 OPACITY 1 25 linear'), 'crossfade suffix rides the same batch')
	assert.equal(batches[0].opts.forceBatch, true, 'batch is forced (independent of global amcp_batch flag)')

	// Commits stay OUTSIDE the batch: one leading, one trailing, nothing between PLAYs.
	const kinds = amcp.events.map((e) => e.t)
	assert.deepEqual(kinds, ['commit', 'batch', 'commit'], `leading commit → batch → trailing commit; got ${JSON.stringify(kinds)}`)
	assert.ok(!amcp.events.some((e) => e.t === 'send'), 'no sequential straggler sends (the old pop-in path)')
})

test('sendStaggeredTakePlays (two-phase): chained routes stay dependency-ordered inside the batch', async () => {
	const amcp = makeRecordingAmcp()
	const jobs = [
		{ pLayer: 130, clip: 'route://1-120', layer: { layerNumber: 30 } }, // depends on the other route
		{ pLayer: 110, clip: 'clip.mov', layer: { layerNumber: 10 } },
		{ pLayer: 120, clip: 'route://1-110', layer: { layerNumber: 20 } },
	]
	await sendStaggeredTakePlays(amcp, 1, jobs, (job) => [`PLAY 1-${job.pLayer}`], { twoPhaseBatch: true })
	const batches = amcp.events.filter((e) => e.t === 'batch')
	assert.equal(batches.length, 1)
	assert.deepEqual(
		batches[0].lines.filter((l) => l.startsWith('PLAY ')),
		['PLAY 1-110', 'PLAY 1-120', 'PLAY 1-130'],
		'route chain executes source → first hop → second hop within the atomic batch',
	)
})

test('sendStaggeredTakePlays (flag off): legacy staggered sequential path is preserved byte-for-byte', async () => {
	process.env.HIGHASCG_ROUTE_SOURCE_PLAY_DELAY_MS = '1'
	process.env.HIGHASCG_ROUTE_CHAIN_PLAY_DELAY_MS = '1'
	try {
		const amcp = makeRecordingAmcp()
		const jobs = mediaPlusThreeRouteJobs()
		await sendStaggeredTakePlays(amcp, 1, jobs, (job) => [`PLAY 1-${job.pLayer}`], {
			leadingCommit: true,
			commitAfterSources: true,
			commitAfterRoutes: true,
			twoPhaseBatch: false,
		})
		assert.ok(!amcp.events.some((e) => e.t === 'batch'), 'rollback flag: no BEGIN…COMMIT batches at all')
		const sends = amcp.events.filter((e) => e.t === 'send').map((e) => e.line)
		assert.deepEqual(sends, [
			'MIXER 1 COMMIT',
			'PLAY 1-110',
			'MIXER 1 COMMIT',
			'PLAY 1-120',
			'PLAY 1-130',
			'PLAY 1-140',
			'MIXER 1 COMMIT',
		])
	} finally {
		delete process.env.HIGHASCG_ROUTE_SOURCE_PLAY_DELAY_MS
		delete process.env.HIGHASCG_ROUTE_CHAIN_PLAY_DELAY_MS
	}
})
