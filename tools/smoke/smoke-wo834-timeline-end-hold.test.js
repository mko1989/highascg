'use strict'

/**
 * WO-834 (WO-828 D8) — the end of a non-looping timeline holds its last frame instead of STOPping to black,
 * unless the timeline is set to `endBehaviour: 'black'`. Play on a held timeline starts it over.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')

const { TimelineEngine } = require('../../src/engine/timeline-engine')

const engines = []
after(() => {
	for (const eng of engines) for (const tl of eng.getAll()) eng.stop(tl.id)
})

function makeEngine() {
	const sent = []
	const rec =
		(n) =>
		(...a) => {
			sent.push(`${n} ${a.join('-')}`)
			return Promise.resolve()
		}
	const amcp = {
		raw: (c) => {
			sent.push(c)
			return Promise.resolve()
		},
		stop: rec('STOP'),
		pause: rec('PAUSE'),
		resume: rec('RESUME'),
		call: rec('CALL'),
		mixerFill: rec('FILL'),
		mixerOpacity: rec('OPACITY'),
		mixerVolume: rec('VOLUME'),
		mixerCommit: rec('COMMIT'),
		batchSendChunked: (lines) => {
			sent.push(...lines)
			return Promise.resolve()
		},
	}
	const self = { amcp, config: {}, log: () => {}, variables: { channel_1_framerate: '50', channel_2_framerate: '50' } }
	const eng = new TimelineEngine(self)
	engines.push(eng)
	return { eng, sent }
}

const clip = (id, startTime, duration) => ({ id, startTime, duration, source: { type: 'media', value: id } })
const transport = (sent) => sent.filter((l) => /^(STOP|PLAY|PAUSE)\b/.test(l))

/** Play near the end, then run the tick that crosses `duration` (the tick lands a little late, like the real one). */
function runToEnd(eng, extra) {
	eng.create({
		id: 'T',
		duration: 10000,
		fps: 25,
		sendTo: { preview: false, program: true, screenIdx: 0 },
		layers: [
			{ id: 'a', clips: [clip('A', 0, 10000)] },
			{ id: 'b', clips: [clip('B', 0, 9000)] },
		],
		...extra,
	})
	eng.play('T', 8000)
	eng._prevKey.delete('1-211') // B ended at 9 s: its exit STOP already went out
	const cell = eng._pbFor('T')
	cell._p0 = 10020
	cell._t0 = Date.now()
}

describe('WO-834 timeline end holds the last frame', () => {
	it('a non-looping end PAUSEs the clip that ends with the timeline and parks on its last frame', () => {
		const { eng, sent } = makeEngine()
		runToEnd(eng)
		sent.length = 0
		eng._tick()
		const t = transport(sent)
		assert.ok(!t.some((l) => l.startsWith('STOP 1-210')), `no STOP of the held clip: ${t.join(' | ')}`)
		assert.ok(t.includes('PAUSE 1-210'), `held clip paused: ${t.join(' | ')}`)
		const pb = eng.getPlayback('T')
		assert.equal(pb.playing, false)
		assert.equal(pb.position, 10000 - 40, 'parks one timeline frame before the end')
		assert.equal(eng._airTimelineId, 'T', 'stays on air')
		assert.ok(eng._prevKey.get('1-210')?.clipId, 'the held layer keeps its transport cache')
	})

	it("endBehaviour 'black' STOPs at the end, as before", () => {
		const { eng, sent } = makeEngine()
		runToEnd(eng, { endBehaviour: 'black' })
		sent.length = 0
		eng._tick()
		const t = transport(sent)
		assert.ok(t.includes('STOP 1-210'), t.join(' | '))
		assert.equal(eng._airTimelineId, null)
	})

	it('Play on a held timeline starts over from 0 without a STOP of the continuing clip', () => {
		const { eng, sent } = makeEngine()
		runToEnd(eng)
		eng._tick()
		sent.length = 0
		eng.play('T')
		const t = transport(sent)
		assert.ok(!t.includes('STOP 1-210'), `seamless restart: ${t.join(' | ')}`)
		assert.ok(
			t.some((l) => l.startsWith('PLAY 1-210 "A"')),
			t.join(' | ')
		)
		assert.ok(
			t.some((l) => l.startsWith('PLAY 1-211 "B"')),
			`B is back from 0: ${t.join(' | ')}`
		)
		const pb = eng.getPlayback('T')
		assert.equal(pb.playing, true)
		assert.ok(pb.position < 1000, `restarted near 0: ${pb.position}`)
	})

	it('a seek after the hold clears it: Play then resumes from the seek point', () => {
		const { eng } = makeEngine()
		runToEnd(eng)
		eng._tick()
		eng.seek('T', 5000)
		assert.equal(eng._pbFor('T').endHeld, false)
		eng.play('T')
		assert.ok(Math.abs(eng.getPlayback('T').position - 5000) < 200)
	})
})
