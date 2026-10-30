'use strict'

/**
 * WO-829 — two on-air timeline faults found by the 29.10 code sweep (WO-828 follow-up):
 * 1. a loop wrap (play(0, seamless) of the SAME timeline) must STOP a layer whose clip ended at the
 *    timeline end — it used to stay on air for the whole next pass;
 * 2. a PUT that moves the on-air timeline off program must STOP program — update() stored the new
 *    sendTo before setSendTo diffed against it, so routingChanged was always false.
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
const transport = (sent) => sent.filter((l) => /^(STOP|PLAY)\b/.test(l))

describe('WO-829 timeline wrap and on-air reroute', () => {
	it('loop wrap STOPs a layer whose clip ended at the timeline end, keeps the running one seamless', () => {
		const { eng, sent } = makeEngine()
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: { preview: false, program: true, screenIdx: 0 },
			layers: [
				{ id: 'a', clips: [clip('A', 0, 30000)] },
				{ id: 'b', clips: [clip('B', 20000, 10000)] },
			],
		})
		eng.play('T', 25000)
		sent.length = 0
		eng.play('T', 0, { seamless: true })
		const t = transport(sent)
		assert.ok(t.includes('STOP 1-211'), `wrap must STOP the ended layer: ${t.join(' | ')}`)
		assert.ok(!t.includes('STOP 1-210'), `running clip A re-PLAYs seamlessly (no STOP): ${t.join(' | ')}`)
		assert.ok(
			t.some((l) => l.startsWith('PLAY 1-210 "A"')),
			t.join(' | ')
		)
		assert.equal(eng._prevKey.get('1-211'), null)
	})

	it('a mid-clip start gets the keyframed opacity, not the clip-local-0 fade-in; tweens count channel frames', () => {
		const { eng, sent } = makeEngine()
		const kf = (time, value) => ({ property: 'opacity', time, value })
		const c = { ...clip('C', 0, 30000), keyframes: [kf(0, 0), kf(1000, 1), kf(5000, 1), kf(6000, 0)] }
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: { preview: false, program: true, screenIdx: 0 },
			layers: [{ id: 'c', clips: [c] }],
		})
		eng.play('T', 25000)
		const mid = sent.filter((l) => l.includes('1-210 OPACITY') || l.startsWith('OPACITY 1-210'))
		assert.ok(!mid.some((l) => /OPACITY 1 \d+ linear/.test(l)), `no lead fade-in mid-clip: ${mid.join(' | ')}`)
		assert.ok(mid.includes('MIXER 1-210 OPACITY 0 0'), `keyframed 0 at 25 s: ${mid.join(' | ')}`)
		sent.length = 0
		eng.play('T', 0, { seamless: true })
		// 1 s fade on the mocked 50p channel = 50 channel frames (was the timeline's 25)
		assert.ok(sent.includes('MIXER 1-210 OPACITY 1 50 linear DEFER'), sent.join(' | '))
	})

	it('a PUT moving the on-air timeline from program to preview STOPs program and plays preview', () => {
		const { eng, sent } = makeEngine()
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: { preview: false, program: true, screenIdx: 0 },
			layers: [{ id: 'a', clips: [clip('A', 0, 30000)] }],
		})
		eng.play('T', 1000)
		sent.length = 0
		eng.update('T', { ...eng.get('T') })
		assert.deepEqual(transport(sent), [], 'same-routing PUT sends no transport')
		eng.update('T', { ...eng.get('T'), sendTo: { preview: true, program: false, screenIdx: 0 } })
		const t = transport(sent)
		assert.ok(t.includes('STOP 1-210'), `program STOPped: ${t.join(' | ')}`)
		assert.ok(
			t.some((l) => l.startsWith('PLAY 2-210 "A"')),
			`preview PLAYs: ${t.join(' | ')}`
		)
		assert.deepEqual(eng.get('T').sendTo, { preview: true, program: false, screenIdx: 0 })
	})
})
