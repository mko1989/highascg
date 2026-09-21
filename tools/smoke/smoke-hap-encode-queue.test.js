'use strict'

/* WO-575: the serial HAP encode queue (src/media/hap-encode-queue.js).
 * Most cases use a fake ffmpeg/ffprobe so failure paths are deterministic; the last case runs the
 * real ffmpeg on a tiny synthetic clip and is skipped when this ffmpeg has no `hap` encoder. */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { spawnSync } = require('child_process')
const { HapEncodeQueue } = require('../../src/media/hap-encode-queue')

const SRC_PROBE = {
	hasVideo: true,
	codec: 'notchlc',
	width: 64,
	height: 48,
	pixFmt: 'yuva444p12le',
	hasAlpha: true,
	fps: 30,
	frames: 30,
	framesEst: 30,
	durationSec: 1,
	audioCodecs: ['pcm_s16le'],
}
const OUT_PROBE = {
	hasVideo: true,
	codec: 'hap',
	width: 64,
	height: 48,
	pixFmt: 'rgba',
	hasAlpha: true,
	fps: 30,
	frames: 30,
	framesEst: 30,
	durationSec: 1,
	audioCodecs: ['pcm_s16le'],
}

function tmpMedia(names) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-q-'))
	for (const n of names) {
		fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true })
		fs.writeFileSync(path.join(dir, n), 'ORIGINAL')
	}
	return dir
}

/** Fake ffmpeg: writes the .part (last argv), emits progress, exits with `behaviour(argv)`. */
function makeFakeSpawn(log, behaviour = () => ({ code: 0 })) {
	let active = 0
	return (cmd, argv) => {
		const child = new EventEmitter()
		child.stdout = new EventEmitter()
		child.stderr = new EventEmitter()
		child.killed = []
		child.kill = (sig) => {
			child.killed.push(sig)
			setImmediate(() => child.emit('close', null, sig))
		}
		const full = [cmd, ...argv]
		if (cmd === 'nice') log.nice = (log.nice || 0) + 1
		const out = argv[argv.length - 1]
		log.calls.push({ cmd, argv })
		active++
		log.maxActive = Math.max(log.maxActive || 0, active)
		const b = behaviour(full, child)
		setImmediate(() => {
			if (b.hang) return // stays "running" until killed
			if (b.enoent) {
				active--
				const e = new Error('spawn nice ENOENT')
				e.code = 'ENOENT'
				return child.emit('error', e)
			}
			if (b.code === 0) fs.writeFileSync(out, 'HAPDATA')
			child.stdout.emit('data', 'frame=15\nout_time_us=500000\nspeed=2.0x\nprogress=continue\n')
			if (b.stderr) child.stderr.emit('data', b.stderr)
			setImmediate(() => {
				active--
				child.emit('close', b.code, null)
			})
		})
		child.kill = ((orig) => (sig) => {
			active = Math.max(0, active - 1)
			orig(sig)
		})(child.kill)
		return child
	}
}

function makeQueue(dir, over = {}) {
	const events = []
	const rescans = { n: 0 }
	const logs = []
	const ctx = {
		config: { local_media_path: dir },
		log: (l, m) => logs.push(`${l} ${m}`),
		_wsBroadcast: (type, payload) => events.push({ type, payload: JSON.parse(JSON.stringify(payload)) }),
		runMediaLibraryQueryCycle: () => rescans.n++,
	}
	const log = { calls: [] }
	const probeMap = over.probe || {}
	const q = new HapEncodeQueue(ctx, {
		spawn: makeFakeSpawn(log, over.behaviour),
		probe: async (bin, file) => {
			if (file.endsWith('.part')) return probeMap.part === undefined ? OUT_PROBE : probeMap.part
			const k = path.basename(file)
			return k in probeMap ? probeMap[k] : SRC_PROBE
		},
		resolve: (cfg, id) => {
			const p = path.join(dir, id)
			return fs.existsSync(p) ? p : null
		},
		statfs: over.statfs || (async () => ({ bavail: 1e12, bsize: 1 })),
		progressThrottleMs: 0,
	})
	return { q, ctx, events, rescans, logs, log }
}

async function finished(q, jobId) {
	for (let i = 0; i < 400; i++) {
		const j = q.list().find((x) => x.jobId === jobId)
		if (j?.finished) return j
		await new Promise((r) => setTimeout(r, 5))
	}
	throw new Error('job did not finish')
}

const states = (j) => Object.fromEntries(j.items.map((i) => [i.id, i.state]))

test('happy path: encodes next to the source, renames after verify, original untouched, rescan + ws events', async () => {
	const dir = tmpMedia(['proj/L_INTRO.mov'])
	const { q, events, rescans, log } = makeQueue(dir)
	try {
		const snap = q.enqueue({ ids: ['proj/L_INTRO.mov'], alpha: true, hq: false })
		assert.strictEqual(snap.format, 'hap_alpha')
		const j = await finished(q, snap.jobId)
		assert.deepStrictEqual(states(j), { 'proj/L_INTRO.mov': 'done' })
		assert.strictEqual(j.items[0].outId, 'proj/L_INTRO_HAP.mov')
		assert.strictEqual(fs.readFileSync(path.join(dir, 'proj/L_INTRO_HAP.mov'), 'utf8'), 'HAPDATA')
		assert.ok(!fs.existsSync(path.join(dir, 'proj/L_INTRO_HAP.mov.part')), '.part gone after rename')
		assert.strictEqual(fs.readFileSync(path.join(dir, 'proj/L_INTRO.mov'), 'utf8'), 'ORIGINAL')
		assert.strictEqual(rescans.n, 1)
		assert.ok(events.length >= 2 && events.every((e) => e.type === 'media:hap-encode'))
		assert.ok(
			events.some((e) => e.payload.items[0].pct > 0 && e.payload.items[0].pct < 1),
			'progress was broadcast'
		)
		assert.ok(
			events.some((e) => e.payload.items[0].speed === 2),
			'speed parsed from -progress'
		)
		assert.strictEqual(events[events.length - 1].payload.finished, true)
		assert.strictEqual(log.calls[0].cmd, 'nice', 'runs under nice')
		assert.deepStrictEqual(log.calls[0].argv.slice(0, 2), ['-n', '10'])
	} finally {
		q.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('skips with a stated reason: already HAP, target exists, not found, still image, no video — batch continues', async () => {
	const dir = tmpMedia(['hap.mov', 'has_out.mov', 'has_out_HAP.mov', 'pic.png', 'song.wav', 'good.mov'])
	const { q, log } = makeQueue(dir, {
		probe: {
			'hap.mov': { ...SRC_PROBE, codec: 'hap' },
			'pic.png': { ...SRC_PROBE, codec: 'png', frames: 1, durationSec: 0 },
			'song.wav': { hasVideo: false, audioCodecs: ['pcm_s16le'] },
		},
	})
	try {
		const snap = q.enqueue({ ids: ['hap.mov', 'has_out.mov', 'missing.mov', 'pic.png', 'song.wav', 'good.mov'] })
		const j = await finished(q, snap.jobId)
		assert.deepStrictEqual(states(j), {
			'hap.mov': 'skipped',
			'has_out.mov': 'skipped',
			'missing.mov': 'skipped',
			'pic.png': 'skipped',
			'song.wav': 'skipped',
			'good.mov': 'done',
		})
		const why = Object.fromEntries(j.items.map((i) => [i.id, i.reason]))
		assert.strictEqual(why['hap.mov'], 'already HAP')
		assert.match(why['has_out.mov'], /already exists/)
		assert.strictEqual(why['missing.mov'], 'file not found')
		assert.strictEqual(why['pic.png'], 'still image')
		assert.strictEqual(why['song.wav'], 'no video stream')
		assert.strictEqual(
			fs.readFileSync(path.join(dir, 'has_out_HAP.mov'), 'utf8'),
			'ORIGINAL',
			'existing target never overwritten'
		)
		assert.strictEqual(log.calls.length, 1, 'only good.mov reached ffmpeg')
	} finally {
		q.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('one failing file does not abort the batch; failed encode leaves no .part and no output', async () => {
	const dir = tmpMedia(['a.mov', 'b.mov'])
	const { q } = makeQueue(dir, {
		behaviour: (full) =>
			full.some((x) => x.endsWith('a.mov')) ? { code: 1, stderr: 'Conversion failed!' } : { code: 0 },
	})
	try {
		const j = await finished(q, q.enqueue({ ids: ['a.mov', 'b.mov'] }).jobId)
		assert.deepStrictEqual(states(j), { 'a.mov': 'failed', 'b.mov': 'done' })
		assert.match(j.items[0].reason, /ffmpeg exited 1.*Conversion failed/)
		assert.ok(!fs.existsSync(path.join(dir, 'a_HAP.mov')) && !fs.existsSync(path.join(dir, 'a_HAP.mov.part')))
	} finally {
		q.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('verification failure (wrong size / unreadable result) never publishes the file', async () => {
	for (const part of [{ ...OUT_PROBE, width: 32 }, null]) {
		const dir = tmpMedia(['a.mov'])
		const { q, rescans } = makeQueue(dir, { probe: { part } })
		try {
			const j = await finished(q, q.enqueue({ ids: ['a.mov'] }).jobId)
			assert.strictEqual(j.items[0].state, 'failed')
			assert.match(j.items[0].reason, /verification failed/)
			assert.ok(!fs.existsSync(path.join(dir, 'a_HAP.mov')) && !fs.existsSync(path.join(dir, 'a_HAP.mov.part')))
			assert.strictEqual(rescans.n, 0)
		} finally {
			q.dispose()
			fs.rmSync(dir, { recursive: true, force: true })
		}
	}
})

test('disk-space refusal happens before ffmpeg starts', async () => {
	const dir = tmpMedia(['a.mov'])
	const { q, log } = makeQueue(dir, { statfs: async () => ({ bavail: 10, bsize: 1 }) })
	try {
		const j = await finished(q, q.enqueue({ ids: ['a.mov'] }).jobId)
		assert.strictEqual(j.items[0].state, 'failed')
		assert.match(j.items[0].reason, /not enough disk space/)
		assert.strictEqual(log.calls.length, 0)
	} finally {
		q.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('strictly serial: two batches never run two ffmpegs at once', async () => {
	const dir = tmpMedia(['a.mov', 'b.mov', 'c.mov'])
	const { q, log } = makeQueue(dir)
	try {
		const j1 = q.enqueue({ ids: ['a.mov', 'b.mov'] })
		const j2 = q.enqueue({ ids: ['c.mov'], hq: true })
		assert.strictEqual(j2.format, 'hap_q')
		await finished(q, j1.jobId)
		const done2 = await finished(q, j2.jobId)
		assert.strictEqual(done2.items[0].state, 'done')
		assert.strictEqual(log.maxActive, 1)
		assert.strictEqual(log.calls.length, 3)
	} finally {
		q.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('duplicate ids that resolve to the same file are encoded once; alpha+HQ is flagged downgraded', async () => {
	const dir = tmpMedia(['a.mov'])
	const { q, log } = makeQueue(dir)
	try {
		const snap = q.enqueue({ ids: ['a.mov', 'MEDIA/../a.mov'.replace('MEDIA/../', ''), 'a.mov'], alpha: true, hq: true })
		assert.strictEqual(snap.items.length, 1)
		assert.strictEqual(snap.downgraded, true)
		assert.strictEqual(snap.format, 'hap_alpha')
		await finished(q, snap.jobId)
		assert.strictEqual(log.calls.length, 1)
		assert.ok(log.calls[0].argv.join(' ').includes('-format hap_alpha'))
	} finally {
		q.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('cancel: kills the running ffmpeg, removes .part, cancels the queued rest', async () => {
	const dir = tmpMedia(['a.mov', 'b.mov'])
	let child
	const { q } = makeQueue(dir, {
		behaviour: (full, c) => {
			child = c
			fs.writeFileSync(full[full.length - 1], 'PARTIAL')
			return { hang: true }
		},
	})
	try {
		const snap = q.enqueue({ ids: ['a.mov', 'b.mov'] })
		for (let i = 0; i < 200 && !child; i++) await new Promise((r) => setTimeout(r, 5))
		assert.ok(child, 'ffmpeg started')
		assert.strictEqual(q.cancel(snap.jobId), true)
		const j = await finished(q, snap.jobId)
		assert.deepStrictEqual(states(j), { 'a.mov': 'cancelled', 'b.mov': 'cancelled' })
		assert.ok(child.killed.includes('SIGTERM'))
		assert.ok(!fs.existsSync(path.join(dir, 'a_HAP.mov.part')) && !fs.existsSync(path.join(dir, 'a_HAP.mov')))
		assert.strictEqual(q.cancel('nope'), false)
	} finally {
		q.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('falls back to a bare ffmpeg when `nice` is not installed', async () => {
	const dir = tmpMedia(['a.mov'])
	const { q, log } = makeQueue(dir, { behaviour: (full) => (full[0] === 'nice' ? { enoent: true } : { code: 0 }) })
	try {
		const j = await finished(q, q.enqueue({ ids: ['a.mov'] }).jobId)
		assert.strictEqual(j.items[0].state, 'done')
		assert.deepStrictEqual(
			log.calls.map((c) => c.cmd),
			['nice', 'ffmpeg']
		)
	} finally {
		q.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('modal pre-check reports alpha / codec / skip reasons without side effects', async () => {
	const dir = tmpMedia(['a.mov', 'h.mov'])
	const { q, log } = makeQueue(dir, { probe: { 'h.mov': { ...SRC_PROBE, codec: 'hap', hasAlpha: false } } })
	try {
		const r = await q.probeFiles(['a.mov', 'h.mov', 'nope.mov'])
		assert.strictEqual(r[0].ok, true)
		assert.strictEqual(r[0].hasAlpha, true)
		assert.strictEqual(r[0].fps, 30)
		assert.strictEqual(r[0].resolution, '64×48')
		assert.deepStrictEqual([r[1].ok, r[1].reason], [false, 'already HAP'])
		assert.deepStrictEqual([r[2].ok, r[2].reason], [false, 'file not found'])
		assert.strictEqual(log.calls.length, 0)
	} finally {
		q.dispose()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

const HAS_HAP = (() => {
	const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
	return r.status === 0 && /\bhap\b/.test(r.stdout)
})()

test(
	'REAL ffmpeg: every frame rate passes through; odd size, alpha, audio and mkv sources encode and verify',
	{ skip: !HAS_HAP && 'ffmpeg has no hap encoder' },
	async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-real-'))
		const mk = (name, rate, extra = [], ext = 'mov') => {
			const f = path.join(dir, `${name}.${ext}`)
			const r = spawnSync(
				'ffmpeg',
				[
					'-v',
					'error',
					'-f',
					'lavfi',
					'-i',
					`testsrc2=size=70x50:rate=${rate}:duration=1`,
					'-f',
					'lavfi',
					'-i',
					'sine=frequency=440:duration=1',
					'-shortest',
					...extra,
					f,
				],
				{ encoding: 'utf8' }
			)
			assert.strictEqual(r.status, 0, r.stderr)
			return f
		}
		const alphaPix = ['-vf', 'format=yuva444p', '-c:v', 'qtrle', '-pix_fmt', 'argb']
		const files = {
			r25: mk('r25', '25', ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le']),
			r2997: mk('r2997', '30000/1001', ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le']),
			r50: mk('r50', '50', ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le']),
			r5994: mk('r5994', '60000/1001', ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le']),
			alpha: mk('alpha', '30', [...alphaPix, '-c:a', 'pcm_s16le']),
			mkvopus: mk('mkvopus', '25', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'libopus'], 'mkv'),
			noaudio: (() => {
				const f = path.join(dir, 'noaudio.mp4')
				const r = spawnSync(
					'ffmpeg',
					['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24:duration=1', '-c:v', 'mpeg4', f],
					{ encoding: 'utf8' }
				)
				assert.strictEqual(r.status, 0, r.stderr)
				return f
			})(),
		}
		const ctx = {
			config: { local_media_path: dir },
			log: () => {},
			_wsBroadcast: () => {},
			runMediaLibraryQueryCycle: () => {},
		}
		const q = new HapEncodeQueue(ctx)
		const probe = (f) =>
			JSON.parse(
				spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', f], { encoding: 'utf8' }).stdout
			).streams
		try {
			for (const [combo, opts] of [
				['default (DXT1)', {}],
				['alpha', { alpha: true }],
				['hq', { hq: true }],
				['alpha+hq', { alpha: true, hq: true }],
			]) {
				const ids = Object.values(files).map((f) => path.basename(f))
				const snap = q.enqueue({ ids, ...opts })
				const j = await finished(q, snap.jobId)
				const bad = j.items.filter((i) => i.state !== 'done' && !(i.state === 'skipped' && /already exists/.test(i.reason)))
				assert.deepStrictEqual(bad, [], `${combo}: ${JSON.stringify(bad)}`)
				// second combo finds the first's outputs; remove them so each combo really encodes
				for (const f of Object.values(files))
					fs.rmSync(path.join(dir, `${path.basename(f, path.extname(f))}_HAP.mov`), { force: true })
			}
			// One clean run to inspect the results
			const snap = q.enqueue({ ids: Object.values(files).map((f) => path.basename(f)), alpha: true })
			const j = await finished(q, snap.jobId)
			assert.ok(
				j.items.every((i) => i.state === 'done'),
				JSON.stringify(j.items)
			)
			for (const [name, f] of Object.entries(files)) {
				const out = path.join(dir, `${path.basename(f, path.extname(f))}_HAP.mov`)
				const [vin] = probe(f)
				const streams = probe(out)
				const v = streams.find((s) => s.codec_type === 'video')
				assert.strictEqual(v.codec_name, 'hap', name)
				assert.strictEqual(v.r_frame_rate, vin.r_frame_rate, `${name}: frame rate must pass through unchanged`)
				const r4 = (n) => Math.max(4, Math.round(n / 4) * 4)
				assert.strictEqual(
					`${v.width}x${v.height}`,
					`${r4(vin.width)}x${r4(vin.height)}`,
					`${name}: size (70x50 → 72x52, 64x64 untouched)`
				)
				assert.strictEqual(v.nb_frames, vin.nb_frames || v.nb_frames, `${name}: frame count`)
				const aIn = probe(f).filter((s) => s.codec_type === 'audio')
				assert.strictEqual(streams.filter((s) => s.codec_type === 'audio').length, aIn.length, `${name}: audio streams`)
				assert.ok(fs.existsSync(f), `${name}: original kept`)
			}
			// alpha survived on the alpha source
			const out = path.join(dir, 'alpha_HAP.mov')
			const r = spawnSync(
				'ffmpeg',
				[
					'-v',
					'error',
					'-i',
					out,
					'-frames:v',
					'1',
					'-vf',
					'alphaextract,signalstats,metadata=print:file=-',
					'-f',
					'null',
					'-',
				],
				{ encoding: 'utf8' }
			)
			assert.match(r.stdout, /YMAX=255/)
			assert.deepStrictEqual(
				fs.readdirSync(dir).filter((n) => n.endsWith('.part')),
				[],
				'no .part left behind'
			)
		} finally {
			q.dispose()
			fs.rmSync(dir, { recursive: true, force: true })
		}
	}
)
