'use strict'

/**
 * WO-974 — LTC service: owns the reader (+ timeline chase) and the generator built from `config.ltc`, broadcasts
 * `ltc.status` on /api/ws (5 Hz while a direction is enabled) and answers /api/ltc.
 */

const { normalizeLtcConfig, inputProblem, outputProblem } = require('./ltc-config')
const { probeLibltc, setLibPath, APT_HINT } = require('./ltc-helper')
const { createLtcInput } = require('./ltc-input')
const { createLtcOutput } = require('./ltc-output')
const { decideChase, chaseOps } = require('./ltc-lock')
const { fpsMode, tcToFrames, parseTc } = require('./timecode-math')

const CHASE_TICK_MS = 40
const STATUS_BROADCAST_MS = 200

/**
 * @param {{ appCtx: object, log?: (level: string, msg: string) => void }} deps
 */
function createLtcService({ appCtx, log = () => {} }) {
	let cfg = normalizeLtcConfig(appCtx.config?.ltc)
	let input = null
	let output = null
	let lib = null
	let timers = []
	let onPlayback = null
	const chase = { engaged: false, lastActionAt: 0, lastAction: null, timelineId: null, actions: 0, position: null, errorMs: null, error: null, busyUntil: 0, timer: null }
	/** Chase error (timeline − LTC, ms) since the last chase action: what "in sync" measured, for status + tests. */
	function noteError(ms) {
		const e = chase.error || (chase.error = { n: 0, sumAbs: 0, maxAbs: 0, min: Infinity, max: -Infinity })
		e.n++
		e.sumAbs += Math.abs(ms)
		e.maxAbs = Math.max(e.maxAbs, Math.abs(ms))
		e.min = Math.min(e.min, ms)
		e.max = Math.max(e.max, ms)
		chase.errorMs = Math.round(ms * 10) / 10
	}

	const engine = () => appCtx.timelineEngine || null
	let hydrateAt = 0

	/** The engine holds only timelines a client pushed since the node started (WO-949): load a configured chase
	 * target from the stored project, at most every 5 s. */
	function hydrate(eng, id) {
		if (Date.now() - hydrateAt < 5000) return null
		hydrateAt = Date.now()
		try {
			const list = require('../engine/project-scenes-load').loadFullProject()?.timelines?.timelines
			const stored = Array.isArray(list) ? list.find((t) => t && String(t.id) === String(id)) : null
			if (!stored) return null
			eng.create(JSON.parse(JSON.stringify(stored)))
			log('info', `[LTC chase] timeline ${id} loaded from the stored project`)
			return eng.get(id)
		} catch {
			return null
		}
	}

	function chaseTarget() {
		const eng = engine()
		if (!eng) return null
		const id = cfg.input.chase.timelineId || eng._airTimelineId
		const tl = id ? eng.get(id) || hydrate(eng, id) : null
		if (!tl) return null
		const pb = eng.getPlayback(id)
		return { id, pb: { position: pb?.position ?? 0, playing: !!pb?.playing, duration: tl.duration } }
	}

	/** Run a chaseOps list; a `wait` defers the rest (the preroll) and holds further chase decisions until then. */
	function runOps(id, ops, moving, now) {
		const eng = engine()
		// a running LTC moved on while we decided and while the engine ran the previous op (box: 8–11 ms late)
		const at = (x) => (moving && x != null ? x + (Date.now() - now) : x)
		let seekAt = Date.now()
		for (let i = 0; i < ops.length; i++) {
			const [op, arg] = ops[i]
			if (op === 'wait') {
				// the preroll counts from when the seek target was taken, not from after the engine's seek work (~10 ms)
				const delay = Math.max(0, arg - (Date.now() - seekAt))
				chase.busyUntil = Date.now() + delay + CHASE_TICK_MS
				const rest = ops.slice(i + 1)
				chase.timer = setTimeout(() => {
					chase.timer = null
					try {
						runOps(id, rest, false, Date.now())
					} catch (e) {
						log('warn', `[LTC chase] preroll resume failed: ${e instanceof Error ? e.message : e}`)
					}
				}, delay)
				return
			}
			if (op === 'play') eng.play(id, at(arg))
			else if (op === 'seek') {
				seekAt = Date.now()
				eng.seek(id, at(arg))
			}
			else if (op === 'pause') eng.pause(id)
		}
	}

	function chaseTick() {
		if (!input) return
		const t = chaseTarget()
		chase.timelineId = t?.id || null
		if (!t) return
		const now = Date.now()
		chase.position = Math.round(t.pb.position)
		if (chase.timer || now < chase.busyUntil) {
			chase.errorMs = null // a preroll locate is running: the timeline is parked on purpose
			return
		}
		const c = cfg.input.chase
		const mode = fpsMode(cfg.fps)
		const snap = input.lock.snapshot(now)
		const d = decideChase(snap, t.pb, {
			fps: mode.key,
			offsetFrames: tcToFrames(parseTc(c.offset, mode) || { h: 0, m: 0, s: 0, f: 0 }, mode),
			thresholdFrames: c.thresholdFrames,
			stopOnLoss: c.stopOnLoss,
			engaged: chase.engaged,
			now,
			lastActionAt: chase.lastActionAt,
			latencyMs: c.latencyMs,
		})
		if (d.errorMs != null) noteError(d.errorMs)
		else chase.errorMs = null
		if (d.action === 'none') return
		chase.error = null
		const ms = d.ms
		try {
			const ops = chaseOps(d, t.pb, ms, mode.fps, { prerollMs: c.prerollMs })
			runOps(t.id, ops, d.action === 'play' || d.action === 'seek', now)
			if (d.action === 'play') chase.engaged = true
			else if (d.action === 'pause' && d.reason !== 'ltc_still') chase.engaged = false
		} catch (e) {
			log('warn', `[LTC chase] ${d.action} failed: ${e instanceof Error ? e.message : e}`)
		}
		chase.lastActionAt = now
		chase.lastAction = { ...d, ms, at: now }
		chase.actions++
		log('info', `[LTC chase] ${d.action}${ms != null ? ` ${Math.round(ms)} ms` : ''} (${d.reason || ''}) on ${t.id}`)
	}

	function airPlayhead() {
		const eng = engine()
		const id = eng?._airTimelineId
		if (!id) return null
		const pb = eng.getPlayback(id)
		return pb ? { playing: !!pb.playing, position: pb.position ?? 0 } : null
	}

	function chaseStatus() {
		const e = chase.error
		const r = (x) => Math.round(x * 10) / 10
		const error = e && e.n ? { n: e.n, meanAbsMs: r(e.sumAbs / e.n), maxAbsMs: r(e.maxAbs), minMs: r(e.min), maxMs: r(e.max) } : null
		const { timer: _timer, ...rest } = chase
		return { ...rest, error, preroll: !!_timer }
	}

	function status() {
		return {
			libltc: lib,
			config: cfg,
			input: input ? input.status() : { enabled: cfg.input.enabled, problem: cfg.input.enabled ? inputProblem(cfg) || null : null },
			output: output ? output.status() : { enabled: cfg.output.enabled, problem: cfg.output.enabled ? outputProblem(cfg) || null : null },
			chase: cfg.input.chase.enabled ? chaseStatus() : null,
		}
	}

	function start() {
		cfg = normalizeLtcConfig(appCtx.config?.ltc)
		setLibPath(cfg.libPath)
		lib = null // re-probed below: a status must never show the library of an earlier config
		if (!cfg.input.enabled && !cfg.output.enabled) {
			log('info', '[LTC] in/out disabled')
			return
		}
		lib = probeLibltc({ fresh: true })
		if (!lib.ok) {
			log('warn', `[LTC] libltc unavailable (${lib.error}) — ${APT_HINT}`)
			return
		}
		const fps = cfg.fps
		if (cfg.input.enabled && !inputProblem(cfg)) {
			input = createLtcInput({ cfg: cfg.input, fps, log })
			input.start()
			log('info', `[LTC in] ${cfg.input.source} ${input.status().where} @ ${fps}`)
			if (cfg.input.chase.enabled) timers.push(setInterval(chaseTick, CHASE_TICK_MS))
		}
		if (cfg.output.enabled && !outputProblem(cfg)) {
			output = createLtcOutput({ cfg: cfg.output, fps, log, getPlayhead: airPlayhead })
			output.start()
			onPlayback = () => output?.sync()
			engine()?.on?.('playback', onPlayback)
			log('info', `[LTC out] ${cfg.output.source} → ${output.status().where} @ ${fps}`)
		}
		timers.push(
			setInterval(() => {
				if (typeof appCtx._wsBroadcast === 'function') appCtx._wsBroadcast('ltc.status', status())
			}, STATUS_BROADCAST_MS)
		)
	}

	function stop() {
		for (const t of timers) clearInterval(t)
		timers = []
		if (onPlayback) engine()?.off?.('playback', onPlayback)
		onPlayback = null
		input?.stop()
		output?.stop()
		input = null
		output = null
		chase.engaged = false
		chase.error = null
		chase.errorMs = null
		if (chase.timer) clearTimeout(chase.timer)
		chase.timer = null
		chase.busyUntil = 0
	}

	function restart() {
		stop()
		start()
	}

	return { start, stop, restart, status, onShutdown: stop }
}

module.exports = { createLtcService }
