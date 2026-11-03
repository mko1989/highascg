'use strict'

/**
 * WO-940 — spacebar pause → play sometimes flashed black.
 *
 * `_prevKey.frame` only advanced on the 40 ms tick. A pause landing in a later timeline frame than the last
 * tick left the cache a frame behind the paused position; the client's pre-play seek to that same position
 * is a no-op (`samePausedPos`), so `_canResumePlayback` saw a frame mismatch and `play()` took the full
 * transport — STOP + PLAY SEEK, the black flash — instead of RESUME. `pause()` now runs one last tick-sync
 * at the pause instant.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { TimelineEngine } = require('../../src/engine/timeline-engine')

function makeEngine(clock) {
	const wire = []
	const ok = () => Promise.resolve()
	const self = {
		config: { screen_count: 1 },
		log: () => {},
		mediaDetails: {},
		CHOICES_MEDIAFILES: [],
		_mediaProbeCache: {},
		amcp: {
			raw: (s) => { wire.push(s); return ok() },
			stop: (ch, l) => { wire.push(`STOP ${ch}-${l}`); return ok() },
			pause: (ch, l) => { wire.push(`PAUSE ${ch}-${l}`); return ok() },
			resume: (ch, l) => { wire.push(`RESUME ${ch}-${l}`); return ok() },
			call: (ch, l, cmd, arg) => { wire.push(`CALL ${ch}-${l} ${cmd} ${arg}`); return ok() },
			batchSendChunked: (lines) => { wire.push(...lines.filter((x) => !/^MIXER/.test(x))); return ok() },
			loadbg: ok, mixerFill: ok, mixerOpacity: ok, mixerVolume: ok, mixerCommit: ok, sendBatch: ok,
		},
	}
	const eng = new TimelineEngine(self)
	eng.create({
		id: 'tl1',
		duration: 60000,
		fps: 25,
		layers: [{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 60000, source: { value: 'test.mov' } }] }],
	})
	eng.setSendTo({ preview: true, program: false, screenIdx: 0 }, 'tl1')
	return { eng, wire }
}

describe('WO-940 pause → play resumes in place', () => {
	for (const lateMs of [0, 10, 20, 30, 39]) {
		it(`pause ${lateMs} ms after the last tick → RESUME, no STOP/PLAY`, (t) => {
			const clock = { now: 1_000_000 }
			t.mock.method(Date, 'now', () => clock.now)
			const { eng, wire } = makeEngine(clock)
			try {
				eng.play('tl1', 4025) // not frame-aligned: 40 ms ticks keep the cache mid-frame
				clearInterval(eng._ticker)
				for (let i = 0; i < 5; i++) {
					clock.now += 40
					eng._tick()
				}
				clock.now += lateMs
				eng.pause('tl1')
				const pos = eng.getPlayback('tl1').position
				wire.length = 0
				// the Godot client's toggle_play: PUT, seek(round(playhead)), sendto, play
				eng.update('tl1', eng.get('tl1'))
				eng.seek('tl1', Math.round(pos))
				eng.setSendTo({ preview: true, program: false, screenIdx: 0 }, 'tl1')
				eng.play('tl1', Math.round(pos))
				clearInterval(eng._ticker)
				assert.deepEqual(wire, ['RESUME 2-210'])
			} finally {
				clearInterval(eng._ticker)
			}
		})
	}
})
