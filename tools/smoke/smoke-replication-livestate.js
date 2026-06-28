'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildLivePlayoutIntent } = require('../../src/replication/live-state-feed')
const { getChannelMap } = require('../../src/config/routing')

test('buildLivePlayoutIntent keys scenes by main screen index', () => {
	const persistence = require('../../src/utils/persistence')
	const origGet = persistence.get
	persistence.get = () => null

	const config = {
		screen_count: 2,
		casparServer: { screen_count: 2, channel_layout: 'stereo' },
		screenDestinations: [
			{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' },
			{ id: 'm2', mainScreenIndex: 1, mode: 'pgm_prv' },
		],
	}
	const map = getChannelMap(config)
	const pgmCh = map.programCh(1)
	persistence.get = () => ({ [String(pgmCh)]: { sceneId: 'scene-a', scene: {}, updatedAt: 100 } })

	const intent = buildLivePlayoutIntent({ config, timelineEngine: null })
	assert.equal(intent.channels['1'].sceneId, 'scene-a')
	assert.equal(Object.keys(intent.channels).length, 1)

	persistence.get = origGet
})

test('announceLeaderProgramTake stamps applyAtLeaderTimeMs at take start', () => {
	const persistence = require('../../src/utils/persistence')
	const origGet = persistence.get
	persistence.get = () => null

	const { RoleState } = require('../../src/replication/role-state')
	const { announceLeaderProgramTake } = require('../../src/replication/live-state-feed')
	const config = {
		screen_count: 1,
		casparServer: { screen_count: 1, channel_layout: 'mono' },
		screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
	}
	const roleState = new RoleState()
	roleState.configure({ enabled: true, role: 'leader' })
	const runtime = {
		roleState,
		liveStateSeq: 0,
		peerWsClients: new Set(),
		lastLiveIntent: null,
	}
	const before = Date.now()
	const takeUpdatedAt = announceLeaderProgramTake(runtime, { config }, {
		screenIdx: 1,
		sceneId: 'scene-a',
		forceCut: false,
		takeUpdatedAt: before,
	})
	assert.equal(takeUpdatedAt, before)
	assert.equal(runtime.liveStateSeq, 1)
	assert.equal(runtime.lastLiveIntent.intent.channels['1'].sceneId, 'scene-a')
	assert.equal(runtime.lastLiveIntent.intent.channels['1'].updatedAt, before)
	assert.equal(runtime.lastLiveIntent.applyAtLeaderTimeMs, runtime.lastLiveIntent.leaderTimeMs)
	assert.ok(runtime.lastLiveIntent.applyAtLeaderTimeMs >= before)

	persistence.get = origGet
})

test('screen index 1 resolves to program channel via channel map', () => {
	const config = {
		screen_count: 2,
		casparServer: { screen_count: 2, channel_layout: 'stereo' },
		screenDestinations: [
			{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' },
			{ id: 'm2', mainScreenIndex: 1, mode: 'pgm_prv' },
		],
	}
	const map = getChannelMap(config)
	const ch1 = map.programCh(1)
	const ch2 = map.programCh(2)
	assert.ok(Number.isFinite(ch1) && ch1 >= 1)
	assert.ok(Number.isFinite(ch2) && ch2 >= 1)
	assert.notEqual(ch1, ch2)
})
