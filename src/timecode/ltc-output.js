'use strict'

/**
 * WO-974 / WO-1092 — LTC generator: the libltc encoder helper plays to ALSA itself (in-process libasound) or writes a FIFO.
 *
 * source 'timeline': LTC = offset + the on-air timeline's playhead, for timelines marked `ltcOut` (WO-1060); silence
 *   (or the held frame, whenPaused 'hold') while it is paused / stopped or another timeline is on air.
 * source 'clock': time of day. source 'test': free-running from `offset` (line-up of a receiver without a show).
 * Lock: ltc-out-sync.js — every report says when its frame PLAYS; a whole-frame error re-aligns to the exact epoch, a
 *   smaller one is slewed away (≤ 1 % speed), so the LTC is continuous and on time at the DAC (before: 53-109 ms late).
 * Device trouble (WO-1092): a missing card is not a 2 s retry storm — the state machine waits for the card to come
 *   back (polls /proc/asound/cards every 2 s, resumes at once on hot-plug), backs other failures off 2 → 30 s, and logs
 *   once per state change. States: off · starting · running · silent · missing · busy · error.
 */

const { spawn } = require('child_process')
const { spawnEncoder, onLines, LTC_SAMPLE_RATE } = require('./ltc-helper')
const { fpsMode, tcToFrames, parseTc, framesToTc, formatTc } = require('./timecode-math')
const S = require('./ltc-out-sync')

const BACKOFF_MS = [2000, 4000, 8000, 16000, 30000]
const PRESENCE_POLL_MS = 2000
const REPORT_FRAMES = 2
const ALSA_BUFFER_MS = 40
const ALIGN_LEAD_MS = 30 // an align names a frame this far ahead (the helper reads commands between frames)
const JUMP_FRAMES = 3 // a report this far off is a playhead jump, not drift (slews keep drift < 1 frame)
const HEALTHY_MS = 5000 // a sink that played this long resets the back-off
const WINDOW_MS = 60000 // health: under-runs / drift re-aligns counted over the last minute

/**
 * @param {{ cfg: object, fps: unknown, log?: Function, getPlayhead?: () => ({ playing: boolean, position: number } | null),
 *   target?: () => ({ pcm: string, channels: number, positions: number[], present: boolean, label?: string } | null),
 *   sinkCmd?: string[], sinkLatencyMs?: number }} deps
 *   target: where to play (ltc-share.js resolveLtcTarget, re-read on each start); sinkCmd: test seam, a fake player.
 */
function createLtcOutput({ cfg, fps, log = () => {}, getPlayhead = () => null, target, sinkCmd, sinkLatencyMs = 10 }) {
	const mode = fpsMode(fps)
	const offsetFrames = tcToFrames(parseTc(cfg.offset, mode) || { h: 0, m: 0, s: 0, f: 0 }, mode)
	const resolve = target || (() => ({ pcm: cfg.device, channels: cfg.channels, positions: [cfg.channel], present: true, label: cfg.device }))
	let stopped = true
	let enc = null
	let sink = null
	let timer = null
	let syncTimer = null
	let state = 'off'
	let stateText = ''
	let logged = '' // the condition last written to the journal
	let lastError = ''
	let running = false // the encoder is sending timecode (not silence)
	let holding = false
	let ready = false
	let lastRep = null // { frames, at, label, delayMs, xruns, slew }
	let awaitAlign = false // an align is on its way: reports until the helper's {aligned} are of frames written before it
	let alignEpoch = 0 // reports for frames before this epoch are stale (written before the last align)
	let quietUntil = 0 // frame count: a slew is draining, judge again after it
	let relocates = 0
	let starts = 0
	let failures = 0
	let upAt = 0
	let driftMs = 0
	let t0 = Date.now()
	let lastRead = null
	let where = null
	const history = []
	const events = { xruns: [], drift: [] }

	/**
	 * One journal line per change of condition: a failure (state + words), or healthy — logged at the first report of a
	 * sink that really plays (a sink that opens and dies on its first write must not log "back" every retry).
	 */
	function setState(next, text = '') {
		state = next
		stateText = text
		const bad = next === 'missing' || next === 'busy' || next === 'error'
		if (bad) note(`${next}: ${text}`, 'warn')
	}

	function note(cond, level) {
		if (cond === logged) return
		const was = logged
		logged = cond
		log(level, cond === 'ok' ? `[LTC out] ${was ? 'back: ' : ''}${where?.label || where?.pcm || cfg.device || cfg.path}` : `[LTC out] ${cond}`)
	}

	function send(line) {
		try {
			enc?.stdin?.write(line + '\n')
		} catch {
			/* restarting */
		}
	}

	function align(now, jump) {
		const pb = getPlayhead()
		const a = S.alignCommand(cfg, mode, offsetFrames, pb, now, now + ALIGN_LEAD_MS, t0)
		if (!a) return
		send(a.line)
		awaitAlign = true
		log('debug', `[LTC out] ${a.line}${running && !holding ? (jump ? ' (playhead jump)' : ' (drift)') : ''}`)
		lastRead = { now, pb } // the jump is handled: the next sync() compares against this playhead
		alignEpoch = a.epoch
		history.length = 0
		if (running && !holding) {
			relocates++
			if (!jump) events.drift.push(now)
		}
		running = true
		holding = false
	}

	/** Re-evaluate run / silence / hold (playback change, 1 s timer) and catch playhead jumps without waiting for a report. */
	function sync() {
		if (!enc || !ready) return
		const now = Date.now()
		const pb = getPlayhead()
		const cur = { now, pb }
		const jumped = S.playheadJumped(lastRead, cur, mode)
		lastRead = cur
		const want = S.expectedFramesAt(cfg, mode, offsetFrames, pb, now, now, t0)
		if (want == null) {
			if (cfg.whenPaused === 'hold' && pb && !pb.playing && cfg.source === 'timeline') {
				if (!holding) {
					send(`locate ${formatTc({ ...framesToTc(S.heldFrames(cfg, mode, offsetFrames, pb), mode), df: false })}`)
					send('hold')
					holding = true
					running = true
				}
			} else if (running) {
				send('stop')
				running = false
				holding = false
			}
			setState('silent')
			return
		}
		setState('running')
		if (!running || holding) return align(now, true)
		if (jumped && now > alignEpoch) align(now, true)
	}

	function onReport(rec) {
		note('ok', 'info')
		if (failures && Date.now() - upAt > HEALTHY_MS) {
			failures = 0 // up long enough: the next failure starts the back-off from 2 s again
			lastError = ''
		}
		if (Number.isFinite(rec.xruns) && lastRep && rec.xruns > lastRep.xruns) events.xruns.push(Date.now())
		const frames = rec.out ? S.reportFrames(rec.out, mode) : null
		lastRep = { frames, at: Number(rec.at), label: rec.out || null, delayMs: Number(rec.delayMs) || 0, xruns: Number(rec.xruns) || 0, n: rec.frames }
		if (awaitAlign || !running || holding || frames == null || !(lastRep.at >= alignEpoch) || rec.frames < quietUntil) return
		const now = Date.now()
		const want = S.expectedFramesAt(cfg, mode, offsetFrames, getPlayhead(), now, lastRep.at, t0)
		if (want == null) return
		const err = S.errorFrames(frames, want, mode)
		const d = S.decide(err, history, mode, LTC_SAMPLE_RATE)
		if (d.action === 'align') return align(now, Math.abs(err) >= JUMP_FRAMES) // a jump the next sync() would have caught
		driftMs = d.driftMs
		if (d.action === 'slew') {
			send(`slew ${d.samples}`)
			const cap = Math.max(1, Math.floor(LTC_SAMPLE_RATE / mode.fps / 100))
			quietUntil = rec.frames + Math.ceil(Math.abs(d.samples) / cap) + 2 * REPORT_FRAMES
		}
	}

	function teardown() {
		const e = enc
		const s = sink
		enc = null
		sink = null
		running = holding = ready = awaitAlign = false
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

	function later(fn, ms) {
		if (stopped || timer) return
		timer = setTimeout(() => {
			timer = null
			fn()
		}, ms)
	}

	function safeResolve() {
		try {
			return resolve()
		} catch (e) {
			return { problem: e instanceof Error ? e.message : String(e) }
		}
	}

	/** The card is not listed: no process, a cheap presence poll; back the moment it is listed again (hot-plug). */
	function pollPresence() {
		later(() => {
			const t = safeResolve()
			if (t && t.present) start()
			else pollPresence()
		}, PRESENCE_POLL_MS)
	}

	function fail(kind, text) {
		teardown()
		lastError = String(text).slice(0, 240)
		setState(kind, lastError)
		const t = kind === 'missing' ? safeResolve() : null
		if (t && !t.problem && !t.present) return pollPresence()
		later(start, BACKOFF_MS[Math.min(failures++, BACKOFF_MS.length - 1)])
	}

	function attachFifo(e) {
		// never open() the FIFO in node (see ltc-input.js): a `dd` child blocks instead, killable at any point
		const p = spawn('dd', [`of=${cfg.path}`, 'status=none'], { stdio: ['pipe', 'ignore', 'pipe'] })
		p.on('error', (err) => fail('error', `dd ${cfg.path}: ${err.message}`))
		p.stdin.on('error', () => {})
		p.stderr.on('data', (b) => (lastError = String(b).trim().slice(0, 240)))
		p.on('close', (code) => enc === e && fail('error', `${cfg.path}: sink closed (${code})`))
		e.stdout.pipe(p.stdin)
		ready = true
		return p
	}

	function start() {
		if (stopped) return
		const fifo = cfg.sink === 'fifo'
		where = fifo ? { pcm: cfg.path, channels: 1, positions: [1], present: true, label: cfg.path } : safeResolve()
		if (!where) return fail('error', 'no output device chosen')
		if (where.problem) return fail('error', where.problem)
		if (!where.present) {
			setState('missing', `${where.label || where.pcm} is not connected`)
			return pollPresence()
		}
		starts++
		setState('starting')
		const opts = { channels: where.channels, channel: where.positions, volume: cfg.volumeDb, stopped: true, report: REPORT_FRAMES,
			userBits: cfg.userBits || '' }
		if (fifo) opts.realtime = true
		else if (sinkCmd) Object.assign(opts, { sinkCmd, sinkLatencyMs })
		else Object.assign(opts, { alsa: where.pcm, latencyMs: ALSA_BUFFER_MS })
		const e = spawnEncoder(mode, opts)
		enc = e
		lastRep = null
		lastRead = null
		e.on('error', (err) => fail('error', `encoder: ${err.message}`))
		e.on('close', (code) => {
			if (enc !== e) return
			const t = fifo ? where : resolve()
			const gone = !t || !t.present || /no such device|no such file/i.test(lastError)
			if (code === 3) fail('error', 'libltc missing (sudo apt install libltc11)')
			else if (code === 5 && /busy/i.test(lastError)) fail('busy', `${where.pcm}: in use by another program`)
			else if ((code === 5 || code === 4) && gone) fail('missing', `${where.pcm}: ${lastError || 'not connected'}`)
			else fail('error', `${where.pcm}: ${lastError || `encoder exited ${code}`}`)
		})
		e.stdin.on('error', () => {})
		onLines(e.stderr, (line) => {
			let rec
			try {
				rec = JSON.parse(line)
			} catch {
				return
			}
			if (rec.error) lastError = String(rec.error).replace(/^sink: /, '')
			if (rec.ready) {
				ready = true
				upAt = Date.now()
				sync()
			}
			if ('aligned' in rec) awaitAlign = false
			if ('out' in rec) onReport(rec)
		})
		if (fifo) sink = attachFifo(e)
	}

	function begin() {
		stopped = false
		t0 = Date.now()
		start()
		syncTimer = setInterval(sync, 1000)
	}

	function stop() {
		stopped = true
		if (timer) clearTimeout(timer)
		if (syncTimer) clearInterval(syncTimer)
		timer = null
		syncTimer = null
		teardown()
		state = 'off'
		logged = ''
	}

	function recent(list) {
		const cut = Date.now() - WINDOW_MS
		while (list.length && list[0] < cut) list.shift()
		return list.length
	}

	function status() {
		return {
			state,
			running: state === 'running' && running,
			source: cfg.source,
			fps: mode.key,
			where: cfg.sink === 'fifo' ? cfg.path : where?.pcm || cfg.device,
			device: where?.label || null,
			channel: cfg.channel,
			channels: where?.ltcChannels || (cfg.pair ? [cfg.channel, cfg.channel + 1] : [cfg.channel]),
			tc: running && lastRep?.label ? lastRep.label : null,
			rate: LTC_SAMPLE_RATE,
			delayMs: lastRep ? +lastRep.delayMs.toFixed(1) : null,
			underruns: lastRep ? lastRep.xruns : 0,
			underrunsRecent: recent(events.xruns),
			driftMs: +driftMs.toFixed(1),
			relocates,
			driftRelocatesRecent: recent(events.drift),
			error: state === 'missing' || state === 'busy' || state === 'error' ? stateText || lastError : null,
			starts,
		}
	}

	return { start: begin, stop, sync, status, mode }
}

module.exports = { createLtcOutput, targetFramesAt: S.targetFramesAt }
