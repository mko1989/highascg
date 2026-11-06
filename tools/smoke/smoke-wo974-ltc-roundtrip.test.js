'use strict'

/**
 * WO-974: libltc encode → decode round trip through tools/ltc/ltc_helper.py at 24 / 25 / 29.97 DF / 30, and the
 * node pipeline (createLtcOutput → FIFO → createLtcInput) following a moving playhead.
 * Skips when libltc is not installed (`sudo apt install libltc11`; HIGHASCG_LIBLTC=<path> points at another copy).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { probeLibltc, HELPER } = require('../../src/timecode/ltc-helper')
const T = require('../../src/timecode/timecode-math')

const lib = probeLibltc()
const skip = lib.ok ? false : `libltc not available (${lib.hint})`

/** Encode `seconds` of LTC from `start` and decode it back (one shell pipe, stereo, LTC on channel 2). */
function roundTrip(fps, start, seconds) {
	const bytes = 48000 * 2 * 2 * seconds
	const py = `python3 -I ${HELPER}`
	const cmd = `(sleep 5; echo quit) | ${py} encode --fps ${fps} --start ${start} --report 0 --channels 2 --channel 2 | head -c ${bytes} | ${py} decode --fps ${fps} --channels 2 --channel 2`
	const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8', timeout: 20000 })
	return r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

describe('WO-974: libltc round trip', { skip }, () => {
	for (const fps of ['24', '25', '29.97', '30']) {
		it(`${fps} fps: every decoded frame is the next timecode, across a minute boundary`, () => {
			const mode = T.fpsMode(fps)
			const start = mode.df ? '00:00:59:20' : '00:00:59:' + String(mode.nominal - 10)
			const recs = roundTrip(fps, start, 2)
			assert.ok(recs.length >= Math.floor(mode.fps * 2) - 2, `decoded ${recs.length} frames`)
			assert.equal(recs[0].tc.replace(';', ':'), start)
			let n = T.tcToFrames(T.parseTc(start), mode)
			for (const r of recs) {
				assert.equal(r.tc, T.formatTc(T.framesToTc(n, mode)), `frame ${n}`)
				assert.equal(r.df, mode.df ? 1 : 0)
				n++
			}
			if (mode.df) assert.ok(recs.some((r) => r.tc === '00:01:00;02') && !recs.some((r) => r.tc === '00:01:00;00'))
		})
	}
})

describe('WO-974: generator → FIFO → reader follows the playhead', { skip }, () => {
	it('decoded TC tracks offset + playhead, and a seek is followed', async () => {
		const { createLtcOutput } = require('../../src/timecode/ltc-output')
		const { createLtcInput } = require('../../src/timecode/ltc-input')
		const { normalizeLtcConfig } = require('../../src/timecode/ltc-config')
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo974-'))
		const fifo = path.join(dir, 'ltc.fifo')
		assert.equal(spawnSync('mkfifo', [fifo]).status, 0)
		const cfg = normalizeLtcConfig({
			fps: 25,
			input: { enabled: true, source: 'fifo', path: fifo },
			output: { enabled: true, source: 'timeline', sink: 'fifo', path: fifo, offset: '01:00:00:00', leadMs: 0 },
		})
		let p0 = 5000
		let t0 = Date.now()
		const playhead = () => ({ playing: true, position: p0 + (Date.now() - t0) })
		const out = createLtcOutput({ cfg: cfg.output, fps: cfg.fps, getPlayhead: playhead })
		const inp = createLtcInput({ cfg: cfg.input, fps: cfg.fps })
		inp.start()
		out.start()
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
		try {
			await sleep(1500)
			const a = inp.status()
			assert.equal(a.state, 'locked', JSON.stringify(a))
			const want = T.tcToFrames(T.parseTc('01:00:00:00'), 25) + T.msToFrames(playhead().position, 25)
			// the FIFO holds up to one pipe page per side + scheduling: allow a few frames of transport latency
			assert.ok(Math.abs(T.frameDelta(want, a.frames, 25)) <= 6, `reader ${a.tc} vs playhead ${T.formatTc(T.framesToTc(want, 25))}`)
			p0 = 30000
			t0 = Date.now()
			out.sync()
			await sleep(1200)
			const b = inp.status()
			const want2 = T.tcToFrames(T.parseTc('01:00:00:00'), 25) + T.msToFrames(playhead().position, 25)
			assert.equal(b.state, 'locked')
			assert.ok(Math.abs(T.frameDelta(want2, b.frames, 25)) <= 6, `after seek: reader ${b.tc}`)
			assert.ok(b.jumps >= 1, 'the reader saw the seek as a jump')
		} finally {
			out.stop()
			inp.stop()
			await sleep(100)
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
