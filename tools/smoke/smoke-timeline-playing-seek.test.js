'use strict'

const assert = require('assert')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

function makeEngine() {
	const amcpCalls = []
	const noop = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		amcp: {
			raw: (cmd) => {
				amcpCalls.push({ type: 'raw', cmd })
				return noop()
			},
			stop: noop,
			pause: noop,
			resume: () => {
				amcpCalls.push({ type: 'resume' })
				return noop()
			},
			call: (ch, layer, cmd, arg) => {
				amcpCalls.push({ type: 'call', ch, layer, cmd, arg })
				return noop(arg)
			},
			mixerFill: noop,
			mixerOpacity: noop,
			mixerVolume: noop,
			mixerCommit: noop,
			batchSendChunked: (lines) => {
				// Record batch calls for transport detection (T173 batched sends)
				for (const line of lines || []) {
					amcpCalls.push({ type: 'raw', cmd: line })
				}
				return noop()
			},
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
	eng.play(tl.id, 0)
	if (eng._ticker) {
		clearInterval(eng._ticker)
		eng._ticker = null
	}
	return { eng, tl, amcpCalls }
}

function flushAmcp() {
	return new Promise((resolve) => setImmediate(resolve))
}

function callSeeks(calls) {
	return calls.filter((c) => c.type === 'call' && c.cmd === 'SEEK')
}

;(async () => {
	{
		const { eng, tl, amcpCalls } = makeEngine()
		amcpCalls.length = 0
		for (let ms = 40; ms <= 2000; ms += 40) {
			eng._pbFor(tl.id)._p0 = 0
			eng._pbFor(tl.id)._t0 = Date.now() - ms
			eng._syncAmcpOnTimelineTick(tl.id, ms)
		}
		assert.strictEqual(callSeeks(amcpCalls).length, 0, 'playback tick must not CALL SEEK')
	}

	{
		// Stretched clip (timeline longer than file) must not drift-CALL-SEEK every 500ms on tick.
		const amcpCalls = []
		const self = {
			config: { screen_count: 1 },
			resolveClipDurationMs: () => 5040,
			amcp: {
				raw: (cmd) => {
					amcpCalls.push({ type: 'raw', cmd })
					return Promise.resolve()
				},
				stop: () => Promise.resolve(),
				pause: () => Promise.resolve(),
				resume: () => Promise.resolve(),
				call: (ch, layer, cmd, arg) => {
					amcpCalls.push({ type: 'call', ch, layer, cmd, arg })
					return Promise.resolve()
				},
				mixerFill: () => Promise.resolve(),
				mixerOpacity: () => Promise.resolve(),
				mixerVolume: () => Promise.resolve(),
				mixerCommit: () => Promise.resolve(),
				batchSendChunked: () => Promise.resolve(),
			},
		}
		const eng = new TimelineEngine(self)
		const clip = {
			id: 'c-stretch',
			startTime: 0,
			duration: 30000,
			source: { value: 'short.mov' },
		}
		const tl = eng.create({
			id: 'tl-stretch',
			duration: 30000,
			fps: 25,
			layers: [{ id: 'l1', clips: [clip] }],
		})
		eng.play(tl.id, 0)
		if (eng._ticker) {
			clearInterval(eng._ticker)
			eng._ticker = null
		}
		amcpCalls.length = 0
		for (let ms = 40; ms <= 3000; ms += 40) {
			eng._pbFor(tl.id)._p0 = 0
			eng._pbFor(tl.id)._t0 = Date.now() - ms
			eng._syncAmcpOnTimelineTick(tl.id, ms)
		}
		assert.strictEqual(
			callSeeks(amcpCalls).length,
			0,
			'stretched implicit-loop tick must not CALL SEEK (Caspar PLAY LOOP free-runs)',
		)
	}

	{
		const { eng, tl, amcpCalls } = makeEngine()
		amcpCalls.length = 0
		const pos = eng.getPlayback(tl.id).position
		eng.seek(tl.id, pos)
		assert.strictEqual(callSeeks(amcpCalls).length, 0, 'seek at same frame while playing must not CALL SEEK')
	}

	{
		const { eng, tl, amcpCalls } = makeEngine()
		amcpCalls.length = 0
		eng.pause(tl.id)
		const pos = eng.getPlayback(tl.id).position
		eng.seek(tl.id, pos + 40)
		assert.ok(callSeeks(amcpCalls).length >= 1, 'paused scrub must CALL SEEK')
		eng.stop(tl.id, { skipAmcp: true })
	}

	{
		const { eng, tl, amcpCalls } = makeEngine()
		eng.pause(tl.id)
		amcpCalls.length = 0
		eng.play(tl.id, null)
		assert.ok(amcpCalls.some((c) => c.type === 'resume'), 'pause then play should RESUME')
		eng.stop(tl.id, { skipAmcp: true })
	}

	{
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
			resume: () => {
				amcpCalls.push({ type: 'resume' })
				return Promise.resolve()
			},
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
	const eng = new TimelineEngine(self)
	const clip = { id: 'c1', startTime: 0, duration: 60000, source: { value: 'test.mov' } }
	const tl = eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', clips: [clip] }],
		sendTo: { preview: true, program: false, screenIdx: 0 },
	})
	eng.play(tl.id, 0)
	eng.pause(tl.id)
	eng.setSendTo({ preview: true, program: true, screenIdx: 0 }, tl.id)
	await flushAmcp()
	const applyOnSendTo = amcpCalls.filter((c) => c.type === 'raw' && (/\bPLAY\b/.test(c.cmd) || /\bLOAD\b/.test(c.cmd)))
	assert.ok(applyOnSendTo.length >= 1, 'setSendTo to PGM applies transport on new channel')
	amcpCalls.length = 0
	eng.play(tl.id, null)
	await flushAmcp()
	const resumes = amcpCalls.filter((c) => c.type === 'resume')
	assert.ok(resumes.length >= 1, 'resume after pause uses RESUME on armed layers')
	eng.stop(tl.id, { skipAmcp: true })
}

	{
		const { eng, tl, amcpCalls } = makeEngine()
		amcpCalls.length = 0
		eng.seek(tl.id, 2000)
		await flushAmcp()
		const seeks = callSeeks(amcpCalls)
		const plays = amcpCalls.filter((c) => c.type === 'raw' && /PLAY\b/.test(c.cmd))
		assert.strictEqual(seeks.length, 0, 'playing scrub must not CALL SEEK')
		assert.ok(plays.length >= 1, 'playing scrub uses STOP+PLAY transport')
		eng.stop(tl.id, { skipAmcp: true })
	}

	console.log('smoke-timeline-playing-seek: OK')
})().catch((err) => {
	console.error(err)
	process.exit(1)
})
