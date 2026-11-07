const test = require('node:test')
const assert = require('node:assert/strict')

const {
	resolveFtbChannels,
	shouldStopTimelineForFtb,
} = require('../../src/api/routes-ftb')

const map = {
	screenCount: 2,
	programCh: (n) => (n === 1 ? 1 : 3),
	previewCh: (n) => (n === 1 ? 2 : null),
	programChannels: [1, 3],
}

test('resolveFtbChannels: all screens', () => {
	assert.deepEqual(resolveFtbChannels(map, null), [1, 2, 3])
})

test('resolveFtbChannels: single screen with PRV', () => {
	assert.deepEqual(resolveFtbChannels(map, 0), [1, 2])
})

test('resolveFtbChannels: PGM-only screen', () => {
	assert.deepEqual(resolveFtbChannels(map, 1), [3])
})

test('resolveFtbChannels: out of range', () => {
	assert.equal(resolveFtbChannels(map, 9), null)
})

test('shouldStopTimelineForFtb: global always stops', () => {
	assert.equal(shouldStopTimelineForFtb({}, null), true)
})

test('shouldStopTimelineForFtb: per-screen stops when scoped', () => {
	const ctx = {
		timelineEngine: {
			getPlayback: () => ({ timelineId: 'tl1', sendTo: { screenIdx: 1 } }),
		},
	}
	assert.equal(shouldStopTimelineForFtb(ctx, 1), true)
	assert.equal(shouldStopTimelineForFtb(ctx, 0), false)
})

// 07.11 (WO-979 two-box run): FTB blacks PGM and PRV in Caspar, so the server must forget both. A kept PRV entry made the
// next preview-push of that look a mixer nudge onto an empty channel, and PRV stayed black.
test('handlePost: FTB forgets the PRV look as well as the PGM look', async () => {
	const liveSceneState = require('../../src/state/live-scene-state')
	const { handlePost } = require('../../src/api/routes-ftb')
	const { getChannelMap } = require('../../src/config/routing')
	const map = getChannelMap({})
	const pgm = map.programCh(1)
	const prv = map.previewCh(1)
	const cleared = []
	const orig = { clearChannel: liveSceneState.clearChannel, broadcastSceneLive: liveSceneState.broadcastSceneLive }
	liveSceneState.clearChannel = async (ch) => void cleared.push(Number(ch))
	liveSceneState.broadcastSceneLive = () => {}
	const sent = []
	const amcp = new Proxy({}, { get: (_, k) => async (...a) => void sent.push([k, ...a]) })
	try {
		const r = await handlePost('/api/ftb', JSON.stringify({ screenIdx: 0, durationFrames: 0 }), { amcp, config: {} })
		assert.equal(r.status, 200, r.body)
		assert.deepEqual(JSON.parse(r.body).channels, [pgm, prv])
		assert.deepEqual(cleared.sort(), [pgm, prv].sort(), 'both blacked channels are forgotten')
	} finally {
		Object.assign(liveSceneState, orig)
	}
})
