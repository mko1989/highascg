'use strict'
/**
 * WO-1058: LTC out to ALSA must be paced by the sound card. A fake `aplay` on PATH consumes PCM at exactly real time
 * (10 ms periods). Before the fix the encoder ran ~1 s ahead in bursts through node's socket stdio and sync()
 * re-located ~3×/s (60 in 20 s); now the encoder runs aplay itself on a real 4 KiB pipe → no re-locates.
 * Also: a sink that dies is reported with its stderr and restarted.
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
	leadMs: 60,
})

describe('WO-1058: LTC out paced by the sound card', { skip }, () => {
	let dir
	let oldPath
	before(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1058-'))
		fs.writeFileSync(path.join(dir, 'aplay'), FAKE_APLAY, { mode: 0o755 })
		oldPath = process.env.PATH
		process.env.PATH = `${dir}${path.delimiter}${oldPath}`
	})
	after(() => {
		process.env.PATH = oldPath
		delete process.env.FAKE_APLAY_FAIL
		fs.rmSync(dir, { recursive: true, force: true })
	})

	for (const channels of [1, 2]) {
		it(`${channels} ch: runs on the clock without re-locating`, async () => {
			const out = createLtcOutput({ cfg: cfg(channels), fps: '25' })
			out.start()
			try {
				// a start can need one correction pair (a running re-locate lands late, the next one aims ahead); then none
				await sleep(3000)
				const early = out.status().relocates
				assert.ok(early <= 2, `re-located ${early}× while starting`)
				await sleep(4000)
				const s = out.status()
				assert.equal(s.running, true, 'running')
				assert.equal(s.starts, 1, `no restarts (${s.error})`)
				assert.equal(s.relocates, early, `kept re-locating once settled: ${s.relocates - early}× in 4 s (was ~3/s)`)
				assert.match(String(s.tc), /^\d\d:\d\d:\d\d:\d\d$/)
			} finally {
				out.stop()
			}
		})
	}

	it('timeline loop wrap: the LTC lands on the playhead again within two re-locates, one per later wrap', async () => {
		const t0 = Date.now()
		const getPlayhead = () => ({ playing: true, position: (Date.now() - t0) % 3000 })
		const out = createLtcOutput({ cfg: { ...cfg(1), source: 'timeline' }, fps: '25', getPlayhead })
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

	it('a dying sink is reported with its stderr and restarted', async () => {
		process.env.FAKE_APLAY_FAIL = '1'
		const logs = []
		const out = createLtcOutput({ cfg: cfg(1), fps: '25', log: (l, m) => logs.push(`${l} ${m}`) })
		out.start()
		try {
			await sleep(3000)
			const s = out.status()
			assert.ok(s.starts >= 2, `restarted (starts ${s.starts})`)
			assert.match(logs.join('\n'), /aplay -D fake exited.*No such device/)
		} finally {
			out.stop()
			delete process.env.FAKE_APLAY_FAIL
		}
	})
})
