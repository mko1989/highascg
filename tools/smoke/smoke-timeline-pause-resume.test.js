'use strict'

const assert = require('assert')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

function makeEngine() {
	const amcpCalls = []
	const noop = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		amcp: {
			raw: noop,
			stop: noop,
			pause: noop,
			resume: noop,
			call: (ch, layer, cmd, arg) => {
				amcpCalls.push({ ch, layer, cmd, arg })
				return Promise.resolve(arg)
			},
			mixerFill: noop,
			mixerOpacity: noop,
			mixerVolume: noop,
			mixerCommit: noop,
			batchSendChunked: noop,
		},
	}
	const eng = new TimelineEngine(self)
	const clip = {
		id: 'c1',
		startTime: 0,
		duration: 60000,
		source: { value: 'test.mov' },
	}
	const tl = eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'Layer 1', clips: [clip] }],
	})
	eng.setSendTo({ preview: true, program: false, screenIdx: 0 })
	return { eng, tl, amcpCalls }
}

{
	const { eng, tl, amcpCalls } = makeEngine()
	eng.play(tl.id, 4000)
	eng.pause(tl.id)
	const pausedPos = eng.getPlayback().position
	amcpCalls.length = 0
	eng.update(tl.id, { ...tl })
	const seeks = amcpCalls.filter((c) => c.cmd === 'SEEK')
	assert.strictEqual(seeks.length, 0, 'update while paused must not CALL SEEK')
	eng.stop(tl.id, { skipAmcp: true })
}

{
	const { eng, tl } = makeEngine()
	eng.play(tl.id, 4000)
	eng.pause(tl.id)
	const pausedPos = eng.getPlayback().position
	eng.play(tl.id, 1000)
	assert.strictEqual(eng._pbFor(tl.id)._p0, pausedPos, 'resume must ignore stale client fromMs')
	eng.stop(tl.id, { skipAmcp: true })
}

console.log('smoke-timeline-pause-resume: OK')
