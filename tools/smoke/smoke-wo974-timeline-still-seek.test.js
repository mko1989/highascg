'use strict'

/**
 * WO-974 (found by the LTC chase campaign, box 06.11): Caspar never answers `CALL … SEEK` on an image producer
 * (no reply in 4 s; PLAY / CLEAR answer in ms) and AMCP sends are serialized — one scrub seek on a still under the
 * playhead stalled EVERY Caspar command, PGM included, for the 15 s response timeout. Timeline seeks must seek the
 * video layers only, and a still must not go stale for the next RESUME (that would re-PLAY it: a flash).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { TimelineEngine } = require('../../src/engine/timeline-engine')
const { clipTransportMeta } = require('../../src/engine/timeline-playback-amcp-schedule')

function makeEngine(still) {
	const calls = []
	const ok = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		amcp: {
			raw: (cmd) => (calls.push({ type: 'raw', cmd }), ok()),
			stop: ok,
			pause: ok,
			resume: () => (calls.push({ type: 'resume' }), ok()),
			call: (ch, layer, cmd, arg) => (calls.push({ type: 'call', ch, layer, cmd, arg }), ok()),
			mixerFill: ok,
			mixerOpacity: ok,
			mixerVolume: ok,
			mixerCommit: ok,
			batchSendChunked: (lines) => {
				for (const cmd of lines || []) calls.push({ type: 'raw', cmd })
				return ok()
			},
		},
	}
	const eng = new TimelineEngine(self)
	const tl = eng.create({
		id: 'tl-still',
		duration: 120000,
		fps: 25,
		layers: [
			{ id: 'l1', clips: [{ id: 'film', startTime: 0, duration: 120000, source: { value: 'film.mov', kind: 'video' } }] },
			{ id: 'l2', clips: [{ id: 'logo', startTime: 0, duration: 120000, source: still }] },
		],
	})
	eng.play(tl.id, 0)
	if (eng._ticker) {
		clearInterval(eng._ticker)
		eng._ticker = null
	}
	return { eng, tl, calls }
}

const seeks = (calls) => calls.filter((c) => c.type === 'call' && c.cmd === 'SEEK')

describe('WO-974: timeline seeks never CALL SEEK a still', () => {
	for (const [name, still] of [
		['source.kind still', { value: 'logo', kind: 'still' }],
		['image extension', { value: 'wss_logo_statyk.png' }],
	]) {
		it(`paused scrub + resume (${name})`, () => {
			const { eng, tl, calls } = makeEngine(still)
			eng.pause(tl.id)
			calls.length = 0
			eng.seek(tl.id, 5000)
			const s = seeks(calls)
			assert.equal(s.length, 1, `only the film layer is seeked, got ${JSON.stringify(s)}`)
			calls.length = 0
			eng.play(tl.id, null)
			assert.ok(calls.some((c) => c.type === 'resume'), 'the still stays valid: play RESUMEs, no re-PLAY')
			eng.stop(tl.id, { skipAmcp: true })
		})
		it(`playing seek (${name})`, () => {
			const { eng, tl, calls } = makeEngine(still)
			calls.length = 0
			eng.seek(tl.id, 40000)
			assert.equal(seeks(calls).length, 1)
			eng.stop(tl.id, { skipAmcp: true })
		})
	}
	it('clip meta flags stills, not video or routes', () => {
		const tl = { fps: 25, duration: 60000 }
		const meta = (source) => clipTransportMeta({ id: 'x', startTime: 0, duration: 60000, source }, 1000, tl, { config: {} })
		assert.equal(meta({ value: 'a.png' }).isStill, true)
		assert.equal(meta({ value: 'A.JPG' }).isStill, true)
		assert.equal(meta({ value: 'logo', kind: 'still' }).isStill, true)
		assert.equal(meta({ value: 'film.mov', kind: 'video' }).isStill, false)
		assert.equal(meta({ value: 'route://1' }).isStill, false)
	})
})
