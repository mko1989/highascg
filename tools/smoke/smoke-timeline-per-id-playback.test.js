'use strict'

const assert = require('assert')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

function makeEngine() {
	const self = {
		config: { screen_count: 1 },
		amcp: {
			raw: () => Promise.resolve(),
			stop: () => Promise.resolve(),
			pause: () => Promise.resolve(),
			resume: () => Promise.resolve(),
			call: () => Promise.resolve(),
			mixerFill: () => Promise.resolve(),
			mixerOpacity: () => Promise.resolve(),
			mixerVolume: () => Promise.resolve(),
			mixerCommit: () => Promise.resolve(),
			batchSendChunked: () => Promise.resolve(),
		},
	}
	return new TimelineEngine(self)
}

const eng = makeEngine()
const clip = { id: 'c1', startTime: 0, duration: 60000, source: { value: 'test.mov' } }
const tl1 = eng.create({ id: 'tl1', duration: 60000, fps: 25, layers: [{ id: 'l1', clips: [clip] }] })
const tl2 = eng.create({ id: 'tl2', duration: 60000, fps: 25, layers: [{ id: 'l2', clips: [{ ...clip, id: 'c2' }] }] })

eng.seek('tl1', 3000)
eng.seek('tl2', 7000)

const pb1 = eng.getPlayback('tl1')
const pb2 = eng.getPlayback('tl2')
assert.strictEqual(pb1.position, 3000, 'tl1 keeps its own playhead')
assert.strictEqual(pb2.position, 7000, 'tl2 keeps its own playhead')

eng.play('tl1', 3000)
assert.strictEqual(eng.getPlayback('tl1').playing, true)
assert.strictEqual(eng.getPlayback('tl2').playing, false)
assert.strictEqual(eng._airTimelineId, 'tl1')

eng.pause('tl1')
const paused1 = eng.getPlayback('tl1').position
assert.ok(paused1 >= 3000, 'tl1 position advances while playing')

eng.play('tl2', 7000)
assert.strictEqual(eng._airTimelineId, 'tl2')
assert.strictEqual(eng.getPlayback('tl1').playing, false)
assert.strictEqual(eng.getPlayback('tl2').playing, true)
assert.strictEqual(eng.getPlayback('tl1').position, paused1, 'tl1 position frozen when tl2 goes on air')

eng.stop('tl2', { skipAmcp: true })
assert.strictEqual(eng.getPlayback('tl2').position, 0)
assert.strictEqual(eng.getPlayback('tl1').position, paused1, 'tl1 position unchanged after tl2 stop')

console.log('smoke-timeline-per-id-playback: OK')
