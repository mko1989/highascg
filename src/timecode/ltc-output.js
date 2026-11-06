'use strict'

/**
 * WO-974 — LTC generator: libltc encoder helper → ALSA playback (aplay) or a FIFO.
 *
 * source 'timeline': LTC = offset + the on-air timeline's playhead; silence while it is paused/stopped (a
 *   chasing receiver then parks). source 'clock': time of day, always running.
 * The encoder free-runs on the sink's audio clock (back-pressure) and reports the frame it is writing every
 * few frames; a report ≥ 2 frames away from where the playhead (+ lead) says it should be re-locates it, so
 * seeks land within one report and audio-vs-system clock drift never accumulates.
 */

const { spawn } = require('child_process')
const { spawnEncoder, onLines, LTC_SAMPLE_RATE } = require('./ltc-helper')
const { fpsMode, msToFrames, framesToTc, formatTc, tcToFrames, parseTc, frameDelta } = require('./timecode-math')

const RESTART_MS = 2000
const RELOCATE_FRAMES = 2 // off by this much on two reports in a row: drift → re-locate
const SEEK_FRAMES = 5 // off by this much once: the playhead jumped → re-locate now

function msSinceLocalMidnight(now) {
	const d = new Date(now)
	return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds()
}

/**
 * @param {{ cfg: object, fps: unknown, log?: Function, getPlayhead?: () => ({ playing: boolean, position: number } | null) }} deps
 */
/**
 * Frame count LTC should be writing at wall time `at` (null = silent). An encoder report is read after a node or
 * pipe delay; judging it against the playhead of NOW made an 80 ms event-loop stall look like a 2-frame error and
 * re-located a healthy encoder (box 06.11, 30 fps: one repeated frame). So the playhead is taken back to `at`.
 */
function targetFramesAt(cfg, mode, offsetFrames, pb, now, at = now) {
	const age = Math.max(0, Math.min(1000, now - at))
	if (cfg.source === 'clock') return msToFrames(msSinceLocalMidnight(now - age) + cfg.leadMs, mode)
	if (!pb || !pb.playing) return null
	return offsetFrames + msToFrames(Math.max(0, pb.position - age) + cfg.leadMs, mode)
}

function createLtcOutput({ cfg, fps, log = () => {}, getPlayhead = () => null }) {
	const mode = fpsMode(fps)
	const offsetFrames = tcToFrames(parseTc(cfg.offset, mode) || { h: 0, m: 0, s: 0, f: 0 }, mode)
	let stopped = false
	let enc = null
	let sink = null
	let timer = null
	let syncTimer = null
	let running = false
	let lastOut = null
	let lastError = ''
	let relocates = 0
	let offReports = 0
	let starts = 0

	/** Frame count LTC should be writing (null = silent); `at` = when the encoder reported. */
	function targetFrames(at) {
		const now = Date.now()
		return targetFramesAt(cfg, mode, offsetFrames, getPlayhead(), now, Number.isFinite(at) ? at : now)
	}

	function send(line) {
		try {
			enc?.stdin?.write(line + '\n')
		} catch {
			/* restarting */
		}
	}

	function locate(frames) {
		send(`locate ${formatTc({ ...framesToTc(frames, mode), df: false })}`)
	}

	/** Re-evaluate run/stop + position (playback change, report line, 1 s timer). */
	function sync(reported, at) {
		if (!enc) return
		const tgt = targetFrames(reported == null ? undefined : at)
		if (tgt == null) {
			if (running) send('stop')
			running = false
			return
		}
		if (!running) {
			locate(tgt)
			send('run')
			running = true
			return
		}
		if (reported == null) return
		const off = Math.abs(frameDelta(tgt, reported, mode))
		offReports = off >= RELOCATE_FRAMES ? offReports + 1 : 0
		if (off >= SEEK_FRAMES || offReports >= 2) {
			relocates++
			offReports = 0
			locate(tgt)
		}
	}

	function teardown() {
		const e = enc
		const s = sink
		enc = null
		sink = null
		running = false
		try {
			e?.stdin?.end('quit\n')
			e?.kill('SIGKILL')
		} catch {
			/* gone */
		}
		try {
			s?.kill('SIGKILL')
		} catch {
			/* gone */
		}
	}

	function scheduleRestart(why) {
		if (stopped || timer) return
		if (why) {
			lastError = String(why).slice(0, 240)
			log('warn', `[LTC out] ${lastError}`)
		}
		teardown()
		timer = setTimeout(() => {
			timer = null
			start()
		}, RESTART_MS)
	}

	function attachSink(e) {
		if (cfg.sink === 'fifo') {
			// never open() the FIFO in node (see ltc-input.js): a `dd` child blocks instead, killable at any point
			const p = spawn('dd', [`of=${cfg.path}`, 'status=none'], { stdio: ['pipe', 'ignore', 'pipe'] })
			p.on('error', (err) => scheduleRestart(`dd ${cfg.path}: ${err.message}`))
			p.stdin.on('error', () => {})
			p.stderr.on('data', (b) => (lastError = String(b).trim().slice(0, 240)))
			p.on('close', (code) => scheduleRestart(`${cfg.path}: sink closed (${code})`))
			e.stdout.pipe(p.stdin)
			return p
		}
		const args = ['-q', '-D', cfg.device, '-t', 'raw', '-f', 'S16_LE', '-r', String(LTC_SAMPLE_RATE), '-c', String(cfg.channels)]
		args.push('--buffer-time=60000', '--period-time=10000')
		const p = spawn('aplay', args, { stdio: ['pipe', 'ignore', 'pipe'] })
		p.on('error', (err) => scheduleRestart(`aplay: ${err.message}`))
		p.stdin.on('error', () => {})
		p.stderr.on('data', (b) => (lastError = String(b).trim().slice(0, 240)))
		p.on('close', (code) => scheduleRestart(`aplay -D ${cfg.device} exited ${code}${lastError ? `: ${lastError}` : ''}`))
		e.stdout.pipe(p.stdin)
		return p
	}

	function start() {
		if (stopped) return
		starts++
		const chan = cfg.sink === 'alsa' ? { channels: cfg.channels, channel: cfg.channel } : {}
		const e = spawnEncoder(mode, { ...chan, volume: cfg.volumeDb, stopped: true, report: 5, realtime: cfg.sink === 'fifo' })
		enc = e
		running = false
		e.on('error', (err) => scheduleRestart(`encoder: ${err.message}`))
		e.on('close', (code) => {
			if (enc === e) scheduleRestart(code === 3 ? 'libltc missing (sudo apt install libltc11)' : `encoder exited ${code}`)
		})
		e.stdin.on('error', () => {})
		onLines(e.stderr, (line) => {
			let rec
			try {
				rec = JSON.parse(line)
			} catch {
				return
			}
			if (rec.error) lastError = String(rec.error)
			if (!rec.out) return
			lastOut = { tc: rec.out, at: Date.now() }
			const p = parseTc(rec.out, mode)
			if (p) sync(tcToFrames(p, mode), Number(rec.at))
		})
		try {
			sink = attachSink(e)
		} catch (err) {
			scheduleRestart(err instanceof Error ? err.message : String(err))
			return
		}
		sync()
	}

	function begin() {
		start()
		syncTimer = setInterval(() => sync(), 1000)
	}

	function stop() {
		stopped = true
		if (timer) clearTimeout(timer)
		if (syncTimer) clearInterval(syncTimer)
		timer = null
		syncTimer = null
		teardown()
	}

	function status() {
		return {
			running,
			source: cfg.source,
			fps: mode.key,
			where: cfg.sink === 'fifo' ? cfg.path : cfg.device,
			channel: cfg.sink === 'alsa' ? cfg.channel : 1,
			tc: running && lastOut ? lastOut.tc : null,
			relocates,
			error: lastError || null,
			starts,
		}
	}

	return { start: begin, stop, sync: () => sync(), status, mode }
}

module.exports = { createLtcOutput, targetFramesAt }
