'use strict'
/**
 * WO-1058: LTC out must be paced by the sound card. A fake player consumes PCM at exactly real time (10 ms periods).
 * Before the fix the encoder ran ~1 s ahead in bursts through node's socket stdio and sync() re-located ~3×/s (60 in
 * 20 s); the encoder now drives its sink itself (WO-1092: libasound in-process; here the `sinkCmd` test seam starts the
 * fake on a real 4 KiB pipe) → no re-locates. WO-1092: small errors are slewed, not re-located, and the reports carry
 * play times, so an event-loop stall under load cannot fake an error (this smoke flaked under load before).
 * Also: a sink that dies is logged ONCE and retried with back-off (was: every 2 s, a journal line each time), and a
 * card that is not listed is waited for without spawning anything, resuming as soon as it is back (hot-plug).
 * Skips when libltc is not installed.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { probeLibltc } = require('../../src/timecode/ltc-helper')
const { createLtcOutput } = require('../../src/timecode/ltc-output')

const lib = probeLibltc()
const skip = lib.ok ? false : `libltc not available (${lib.hint})`

const FAKE_APLAY = `#!/usr/bin/env python3
import sys, os, time
a = sys.argv
if os.environ.get("FAKE_APLAY_FAIL"):
    sys.stderr.write("aplay: pcm_write:2191: write error: No such device\\n"); sys.exit(1)
ch = int(a[a.index("-c") + 1]); rate = int(a[a.index("-r") + 1])
per = rate // 100 * 2 * ch
fd = sys.stdin.fileno(); t = time.monotonic()
while True:
    need = per
    while need:
        b = os.read(fd, need)
        if not b: sys.exit(0)
        need -= len(b)
    t += 0.01
    d = t - time.monotonic()
    if d > 0: time.sleep(d)
`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cfg = (channels) => ({
	enabled: true,
	source: 'clock',
	sink: 'alsa',
	device: 'fake',
	channels,
	channel: 1,
	volumeDb: -18,
	offset: '00:00:00:00',
	latencyMs: 0,
})

describe('WO-1058: LTC out paced by the sound card', { skip }, () => {
	let dir
	let sinkCmd
	const make = (o, channels = 1) => createLtcOutput({ fps: '25', sinkCmd: [...sinkCmd, '-c', String(channels), '-r', '48000'], ...o })
	before(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1058-'))
		fs.writeFileSync(path.join(dir, 'aplay'), FAKE_APLAY, { mode: 0o755 })
		sinkCmd = [path.join(dir, 'aplay')]
	})
	after(() => {
		delete process.env.FAKE_APLAY_FAIL
		fs.rmSync(dir, { recursive: true, force: true })
	})

	for (const channels of [1, 2]) {
		it(`${channels} ch: runs on the clock without re-locating`, async () => {
			const out = make({ cfg: cfg(channels) }, channels)
			out.start()
			try {
				// WO-1092: the start is one align (not counted); the phase error left after it is slewed away
				await sleep(3000)
				const early = out.status().relocates
				assert.ok(early <= 1, `re-located ${early}× while starting`)
				await sleep(4000)
				const s = out.status()
				assert.equal(s.running, true, 'running')
				assert.equal(s.state, 'running')
				assert.equal(s.starts, 1, `no restarts (${s.error})`)
				assert.equal(s.relocates, early, `kept re-locating once settled: ${s.relocates - early}× in 4 s (was ~3/s)`)
				assert.ok(Math.abs(s.driftMs) < 20, `on time within a frame half (${s.driftMs} ms)`)
				assert.match(String(s.tc), /^\d\d:\d\d:\d\d:\d\d$/)
			} finally {
				out.stop()
			}
		})
	}

	it('timeline loop wrap: the LTC lands on the playhead again within two re-locates, one per later wrap', async () => {
		const t0 = Date.now()
		const getPlayhead = () => ({ playing: true, position: (Date.now() - t0) % 3000 })
		const out = make({ cfg: { ...cfg(1), source: 'timeline' }, getPlayhead })
		out.start()
		try {
			await sleep(2800)
			assert.equal(out.status().relocates, 0, 'none before the wrap')
			await sleep(2900) // one wrap: the jump + the learned landing latency
			const first = out.status().relocates
			assert.ok(first >= 1 && first <= 2, `first wrap re-located ${first}× (was ~2.5/s for good)`)
			await sleep(3000) // second wrap
			assert.ok(out.status().relocates - first <= 1, `second wrap re-located ${out.status().relocates - first}×`)
		} finally {
			out.stop()
		}
	})

	it('a dying sink is logged once with its stderr and retried with back-off (WO-1092: was a line every 2 s)', async () => {
		process.env.FAKE_APLAY_FAIL = '1'
		const logs = []
		const out = make({ cfg: cfg(1), log: (l, m) => logs.push(`${l} ${m}`) })
		out.start()
		try {
			await sleep(3000)
			assert.ok(out.status().starts >= 2, `retried (starts ${out.status().starts})`)
			assert.match(logs.join('\n'), /\[LTC out\] missing: fake: .*No such device/)
			await sleep(4800) // retries at ~2 s and ~6 s (2 → 4 → 8 … 30 s)
			const s = out.status()
			assert.ok(s.starts <= 3, `backed off: ${s.starts} starts in 7.8 s (was 4+)`)
			assert.equal(s.state, 'missing')
			assert.equal(logs.filter((l) => /missing/.test(l)).length, 1, `one journal line per state change:\n${logs.join('\n')}`)
		} finally {
			out.stop()
			delete process.env.FAKE_APLAY_FAIL
		}
	})

	it('a card that is not listed is waited for (nothing spawned), and LTC resumes when it is plugged in', async () => {
		let present = false
		const logs = []
		const target = () => ({ pcm: 'fake', channels: 1, positions: [1], present, label: 'USB LTC box' })
		const out = make({ cfg: cfg(1), target, log: (l, m) => logs.push(`${l} ${m}`) })
		out.start()
		try {
			await sleep(2500)
			assert.equal(out.status().starts, 0, 'no process while the card is missing')
			assert.equal(out.status().state, 'missing')
			present = true
			await sleep(3000)
			const s = out.status()
			assert.equal(s.starts, 1)
			assert.equal(s.state, 'running')
			assert.deepEqual(logs.filter((l) => !l.startsWith('debug')), ['warn [LTC out] missing: USB LTC box: not connected', 'info [LTC out] back: USB LTC box'])
		} finally {
			out.stop()
		}
	})
})
