'use strict'

/**
 * WO-974 — LTC service: owns the reader (+ timeline chase) and the generator built from `config.ltc`, broadcasts
 * `ltc.status` on /api/ws (5 Hz while a direction is enabled) and answers /api/ltc.
 */

const { normalizeLtcConfig, inputProblem, outputProblem } = require('./ltc-config')
const { probeLibltc, setLibPath, APT_HINT } = require('./ltc-helper')
const { createLtcInput } = require('./ltc-input')
const { createLtcOutput } = require('./ltc-output')
const { decideChase } = require('./ltc-lock')
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
	const chase = { engaged: false, lastActionAt: 0, lastAction: null, timelineId: null, actions: 0 }

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

	function chaseTick() {
		if (!input) return
		const t = chaseTarget()
		chase.timelineId = t?.id || null
		if (!t) return
		const now = Date.now()
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
		})
		if (d.action === 'none') return
		const eng = engine()
		const ms = d.ms != null ? Math.max(0, d.ms + c.latencyMs) : undefined
		try {
			if (d.action === 'play') {
				eng.play(t.id, ms)
				chase.engaged = true
			} else if (d.action === 'seek') eng.seek(t.id, ms)
			else if (d.action === 'pause') {
				eng.pause(t.id)
				if (ms != null) eng.seek(t.id, ms)
				if (d.reason !== 'ltc_still') chase.engaged = false
			}
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

	function status() {
		return {
			libltc: lib,
			config: cfg,
			input: input ? input.status() : { enabled: cfg.input.enabled, problem: cfg.input.enabled ? inputProblem(cfg) || null : null },
			output: output ? output.status() : { enabled: cfg.output.enabled, problem: cfg.output.enabled ? outputProblem(cfg) || null : null },
			chase: cfg.input.chase.enabled ? { ...chase } : null,
		}
	}

	function start() {
		cfg = normalizeLtcConfig(appCtx.config?.ltc)
		if (!cfg.input.enabled && !cfg.output.enabled) {
			log('info', '[LTC] in/out disabled')
			return
		}
		setLibPath(cfg.libPath)
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
	}

	function restart() {
		stop()
		start()
	}

	return { start, stop, restart, status, onShutdown: stop }
}

module.exports = { createLtcService }
