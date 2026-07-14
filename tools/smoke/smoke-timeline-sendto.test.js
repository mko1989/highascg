'use strict'

const assert = require('assert')
const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { normalizeTimelineSendTo } = require('../../src/engine/timeline-playback-helpers')

function makeEngine() {
	const amcpCalls = []
	const self = {
		config: { screen_count: 1 },
		amcp: {
			raw: (cmd) => {
				amcpCalls.push({ type: 'raw', cmd })
				return Promise.resolve()
			},
			stop: () => Promise.resolve(),
			pause: () => Promise.resolve(),
			resume: () => Promise.resolve(),
			call: () => Promise.resolve(),
			mixerFill: () => Promise.resolve(),
			mixerOpacity: () => Promise.resolve(),
			mixerVolume: () => Promise.resolve(),
			mixerCommit: () => Promise.resolve(),
			batchSendChunked: (lines) => {
				// Record batch calls for transport detection (T173 batched sends)
				for (const line of lines || []) {
					amcpCalls.push({ type: 'raw', cmd: line })
				}
				return Promise.resolve()
			},
		},
	}
	return { eng: new TimelineEngine(self), amcpCalls }
}

function flushAmcp() {
	return new Promise((resolve) => setImmediate(resolve))
}

;(async () => {
assert.deepStrictEqual(normalizeTimelineSendTo({ preview: true }), {
	preview: true,
	program: false,
	screenIdx: 0,
}, 'preview-only sendTo must not imply program')

{
	const { eng } = makeEngine()
	const ch = eng._channelsFor({ preview: true })
	assert.deepStrictEqual(ch, [2], 'PRV-only routes to preview channel')
	const both = eng._channelsFor({ preview: true, program: true })
	assert.deepStrictEqual(both, [2, 1], 'PRV+PGM routes to both channels')
}

{
	const { eng, amcpCalls } = makeEngine()
	const clip = { id: 'c1', startTime: 0, duration: 60000, source: { value: 'test.mov' } }
	const tl = eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'Layer 1', clips: [clip] }],
		sendTo: { preview: true, program: false, screenIdx: 0 },
	})
	assert.strictEqual(eng._airTimelineId, null, 'new timeline is not on air yet')
	eng.seek(tl.id, 1000)
	await flushAmcp()
	assert.strictEqual(eng._airTimelineId, tl.id, 'seek arms timeline on dest buses')
	const transport = amcpCalls.filter(
		(c) => c.type === 'raw' && (/\bPLAY\b/.test(c.cmd) || /\bLOAD\b/.test(c.cmd)),
	)
	assert.ok(transport.length >= 1, 'seek before play sends transport to PRV')
	eng.stop(tl.id, { skipAmcp: true })
}

{
	const { eng } = makeEngine()
	const clip = { id: 'c1', startTime: 0, duration: 60000, source: { value: 'test.mov' } }
	const tl = eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'Layer 1', clips: [clip] }],
		sendTo: { preview: true, program: false, screenIdx: 0 },
	})
	eng.play(tl.id, 0)
	eng.setSendTo({ preview: false, program: true, screenIdx: 0 }, tl.id)
	const st = eng._sendToFor(tl.id)
	assert.strictEqual(st.preview, false)
	assert.strictEqual(st.program, true)
	eng.stop(tl.id, { skipAmcp: true })
}

console.log('smoke-timeline-sendto: OK')
})().catch((err) => {
	console.error(err)
	process.exit(1)
})
