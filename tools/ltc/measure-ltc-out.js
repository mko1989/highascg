#!/usr/bin/env node
'use strict'

/**
 * WO-1092 — measure LTC out against a scripted timeline playhead, at the sound card, with an independent decoder.
 *
 *   node tools/ltc/measure-ltc-out.js --device "tee:'plughw:1,7','/tmp/tap.raw',raw" --tap /tmp/tap.raw \
 *        --status /proc/asound/card1/pcm7p/sub0/status [--fps 25] [--channels 1] [--channel 1] [--secs 30] [--mod src/timecode/ltc-output.js]
 *   node tools/ltc/measure-ltc-out.js --capture "hw:CARD=Loopback,DEV=1" --capture-channels 8 …   (snd-aloop: the far end)
 *
 * The real generator (`createLtcOutput` from --mod) plays a scripted playhead: stopped 1.5 s, play from 0, seek to 60 s
 * at +10 s, pause at +16 s for 2 s, resume, loop-wrap 3 s later (back to 0), stop at --secs. What went out is read back
 * either from an ALSA `tee` (file plugin) tap in front of the device — sample n of the tap is sample n of the stream —
 * with the card's DMA pointer (`hw_ptr` in /proc/asound/…/status, polled every 20 ms) giving the wall time each sample
 * left the buffer, or from a capture device (snd-aloop) timed by its own reads. Every decoded frame is compared with
 * where the playhead was when it played: error = frame time − playhead (ms, + = LTC ahead).
 * --cfg merges LTC output settings (latencyMs, whenPaused, userBits …); 'hold' repeats frames while paused (counted as breaks).
 * Prints JSON: start latency, error stats per segment, monotonic / continuity checks, df flags, user bits, peak dBFS.
 */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { decodeLtc } = require('./ltc-biphase')
const { fpsMode, tcToFrames } = require('../../src/timecode/timecode-math')

function arg(name, d) {
	const i = process.argv.indexOf(`--${name}`)
	return i > 0 ? process.argv[i + 1] : d
}

const now = () => performance.timeOrigin + performance.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ROOT = path.join(__dirname, '..', '..')
const mod = path.resolve(arg('mod', path.join(ROOT, 'src', 'timecode', 'ltc-output.js')))
const { createLtcOutput } = require(mod)
const fpsKey = arg('fps', '25')
const fps = { 24: 24, 23.976: 24000 / 1001, 25: 25, '29.97df': 30000 / 1001, 29.97: 30000 / 1001, 30: 30 }[fpsKey] || 25
const secs = Number(arg('secs', 30))
const channels = Number(arg('channels', 1))
const channel = Number(arg('channel', 1))
const tap = arg('tap', '')
const statusFile = arg('status', '')
const capture = arg('capture', '')
const capCh = Number(arg('capture-channels', channels))
const extra = JSON.parse(arg('cfg', '{}'))

/** Scripted playhead (ms since play) → { playing, position }. */
function script(t0) {
	const PLAY = 1500
	return (t) => {
		const e = t - t0
		if (e < PLAY) return { playing: false, position: 0 }
		const r = e - PLAY
		if (r < 10000) return { playing: true, position: r, seg: 'run' }
		if (r < 16000) return { playing: true, position: 60000 + (r - 10000), seg: 'after-seek' }
		if (r < 18000) return { playing: false, position: 66000, seg: 'paused' }
		if (r < 21000) return { playing: true, position: 66000 + (r - 18000), seg: 'resumed' }
		if (r < secs * 1000 - PLAY) return { playing: true, position: r - 21000, seg: 'after-wrap' }
		return { playing: false, position: 0, seg: 'stopped' }
	}
}

async function main() {
	const t0 = now()
	const ph = script(t0)
	const ptr = [] // [wallMs, hw_ptr]
	const cfg = { enabled: true, source: 'timeline', sink: 'alsa', device: arg('device', capture ? 'default' : ''), channels, channel,
		volumeDb: -18, offset: '00:00:00:00', latencyMs: 0, ...extra }
	const out = createLtcOutput({ cfg, fps: fpsKey, log: (l, m) => process.stderr.write(`${l} ${m}\n`), getPlayhead: () => ph(now()) })
	let cap = null
	const capChunks = []
	if (capture) {
		cap = spawn('arecord', ['-q', '-D', capture, '-t', 'raw', '-f', 'S16_LE', '-r', '48000', '-c', String(capCh), '--period-time=5000', '--buffer-time=40000'])
		let got = 0
		cap.stdout.on('data', (b) => {
			capChunks.push({ at: now(), first: got / (2 * capCh), n: b.length / (2 * capCh), b })
			got += b.length
		})
	}
	const timer = setInterval(() => {
		if (!statusFile) return
		try {
			const s = fs.readFileSync(statusFile, 'utf8')
			const at = now()
			const m = /hw_ptr\s*:\s*(\d+)/.exec(s)
			if (m) ptr.push([at, Number(m[1])])
		} catch {
			/* closed */
		}
	}, 20)
	const pbTimer = setInterval(() => out.sync(), 40) // the engine emits 'playback' on every transport change
	out.start()
	await sleep(secs * 1000 + 500)
	const st = out.status()
	out.stop()
	clearInterval(timer)
	clearInterval(pbTimer)
	if (cap) cap.kill('SIGTERM')
	await sleep(300)

	// samples + sample → wall time
	let pcm
	let wallOf
	if (capture) {
		const all = Buffer.concat(capChunks.map((c) => c.b))
		const s = new Int16Array(all.buffer, all.byteOffset, all.length >> 1)
		pcm = new Int16Array(s.length / capCh)
		for (let i = 0; i < pcm.length; i++) pcm[i] = s[i * capCh + (channel - 1)]
		// a chunk read at `at` held samples first…first+n: the last one was written ≤ one period before `at` — lower envelope
		const pts = capChunks.map((c) => [c.first + c.n, c.at])
		const off = Math.min(...pts.map(([n, at]) => at - (n / 48000) * 1000))
		wallOf = (n) => off + (n / 48000) * 1000
	} else {
		const buf = fs.readFileSync(tap)
		const s = new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1)
		pcm = new Int16Array(Math.floor(s.length / channels))
		for (let i = 0; i < pcm.length; i++) pcm[i] = s[i * channels + (channel - 1)]
		// hw_ptr is sampled when read: fit wall = a + n/48 with the upper envelope of the points (reads only ever come late)
		const offs = ptr.map(([at, n]) => at - (n / 48000) * 1000).sort((a, b) => a - b)
		const a = offs[Math.floor(offs.length * 0.05)] // 5th percentile: robust against a stalled poll
		wallOf = (n) => a + (n / 48000) * 1000
	}
	const frames = decodeLtc(pcm, { fps })
	const rows = frames.map((f) => {
		const at = wallOf(f.start)
		const p = ph(at)
		const label = tcToFrames({ h: f.h, m: f.m, s: f.s, f: f.f }, fpsMode(fpsKey)) // drop-frame labels skip 00/01 each minute
		const frameMs = (label * 1000) / fps // offset 00:00:00:00
		return { at, tc: f.tc, df: f.df, ub: f.userBits, parityOk: f.parityOk, peak: f.peak, playing: p.playing, seg: p.seg, err: frameMs - p.position, label }
	})
	const segs = {}
	for (const r of rows) {
		if (!r.playing) continue
		;(segs[r.seg] ||= []).push(r.err)
	}
	const stats = (a) => {
		const s = [...a].sort((x, y) => x - y)
		const mean = a.reduce((x, y) => x + y, 0) / a.length
		const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length)
		const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
		return { n: a.length, mean: +mean.toFixed(1), sd: +sd.toFixed(1), p5: +q(0.05).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), min: +s[0].toFixed(1), max: +s[s.length - 1].toFixed(1) }
	}
	const playAt = t0 + 1500
	const first = rows.find((r) => r.at >= playAt - 100)
	let breaks = 0
	for (let i = 1; i < rows.length; i++) if (rows[i].label !== rows[i - 1].label + 1 && rows[i].at - rows[i - 1].at < 60) breaks++
	const parityBad = rows.filter((r) => !r.parityOk).length
	const peak = Math.max(0, ...rows.map((r) => r.peak))
	const result = {
		module: path.relative(ROOT, mod), fps: fpsKey, frames: rows.length, parityBad, breaks,
		startLatencyMs: first ? +(first.at - playAt).toFixed(1) : null, firstTc: first?.tc, df: [...new Set(rows.map((r) => r.df))],
		userBits: [...new Set(rows.map((r) => r.ub))], peakDbfs: peak ? +(20 * Math.log10(peak / 32768)).toFixed(1) : null,
		silentWhilePaused: rows.filter((r) => r.seg === 'paused').length,
		err: Object.fromEntries(Object.entries(segs).map(([k, v]) => [k, stats(v)])), status: st, hwPtrSamples: ptr.length,
	}
	if (arg('dump')) fs.writeFileSync(arg('dump'), JSON.stringify(rows))
	console.log(JSON.stringify(result, null, 1))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
