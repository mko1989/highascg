'use strict'

/**
 * Opt-in playhead drift correction (WO-147 T147.4, WO-65 G1).
 *
 * The leader measures drift (playhead-sync.js); when |drift| exceeds `driftFrames`
 * sustained for `sustainedSec`, a rate-limited `CALL <ch>-<layer> SEEK <frame>` is
 * queued to the FOLLOWER Caspar only (peer-caspar-connection enqueueCorrection —
 * never local, never through the take fan-out path).
 *
 * Disabled by default: `replication.playheadCorrection.enabled = false`.
 * Config is read from the raw `replication` block (kept out of the shared
 * normalizer on purpose — WO-147 touches src/replication/** only).
 */

const PLAYHEAD_CORRECTION_DEFAULTS = Object.freeze({
	enabled: false,
	/** correct when |drift| > N frames … */
	driftFrames: 12,
	/** … sustained for M seconds … */
	sustainedSec: 5,
	/** … at most once per this many seconds. */
	minCorrectionIntervalSec: 10,
})

/**
 * @param {unknown} raw — `config.replication.playheadCorrection` (may be missing)
 * @returns {{ enabled: boolean, driftFrames: number, sustainedSec: number, minCorrectionIntervalSec: number }}
 */
function normalizePlayheadCorrection(raw) {
	const d = PLAYHEAD_CORRECTION_DEFAULTS
	const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
	return {
		enabled: o.enabled === true,
		driftFrames: Math.max(1, parseInt(String(o.driftFrames ?? d.driftFrames), 10) || d.driftFrames),
		sustainedSec: Math.max(1, parseInt(String(o.sustainedSec ?? d.sustainedSec), 10) || d.sustainedSec),
		minCorrectionIntervalSec: Math.max(
			1,
			parseInt(String(o.minCorrectionIntervalSec ?? d.minCorrectionIntervalSec), 10) ||
				d.minCorrectionIntervalSec,
		),
	}
}

/**
 * @param {object} config — full bridge config
 */
function getPlayheadCorrectionConfig(config) {
	return normalizePlayheadCorrection(config?.replication?.playheadCorrection)
}

/**
 * Pure threshold / sustain / rate-limit state machine. No timers, no AMCP —
 * callers inject the clock (`now`) so the logic is unit-testable (WO-147 A147.3).
 *
 * @param {object} [opts]
 * @param {ReturnType<typeof normalizePlayheadCorrection>} [opts.config]
 * @param {() => number} [opts.now] — ms clock (default Date.now)
 */
function createPlayheadCorrectionController(opts = {}) {
	const cfg = normalizePlayheadCorrection(opts.config)
	const now = typeof opts.now === 'function' ? opts.now : Date.now

	let exceededSince = 0
	let lastCorrectionAt = 0
	let correctionsTotal = 0
	let lastCommand = ''

	/**
	 * Feed one drift sample (or null when there is nothing comparable playing).
	 * @param {{ channel: string|number, layer: string|number, driftMs: number, leaderFrame: number, fps?: number, clip?: string }|null} sample
	 * @returns {{ correct: boolean, reason: string, driftFrames?: number, command?: string }}
	 */
	function observe(sample) {
		if (!cfg.enabled) return { correct: false, reason: 'disabled' }
		if (!sample || !Number.isFinite(sample.driftMs)) {
			exceededSince = 0
			return { correct: false, reason: 'no_sample' }
		}
		const fps = Number.isFinite(sample.fps) && sample.fps > 0 ? sample.fps : 25
		const driftFrames = (Math.abs(sample.driftMs) * fps) / 1000
		const t = now()

		if (driftFrames <= cfg.driftFrames) {
			exceededSince = 0
			return { correct: false, reason: 'within_threshold', driftFrames }
		}
		if (!exceededSince) exceededSince = t
		if (t - exceededSince < cfg.sustainedSec * 1000) {
			return { correct: false, reason: 'sustaining', driftFrames }
		}
		if (lastCorrectionAt && t - lastCorrectionAt < cfg.minCorrectionIntervalSec * 1000) {
			return { correct: false, reason: 'rate_limited', driftFrames }
		}

		lastCorrectionAt = t
		exceededSince = 0
		correctionsTotal += 1
		const targetFrame = Math.max(0, Math.round(Number(sample.leaderFrame) || 0))
		lastCommand = `CALL ${sample.channel}-${sample.layer} SEEK ${targetFrame}`
		return { correct: true, reason: 'correct', driftFrames, command: lastCommand }
	}

	function getState() {
		return { correctionsTotal, lastCorrectionAt, exceededSince, lastCommand, enabled: cfg.enabled }
	}

	return { observe, getState, config: cfg }
}

module.exports = {
	PLAYHEAD_CORRECTION_DEFAULTS,
	normalizePlayheadCorrection,
	getPlayheadCorrectionConfig,
	createPlayheadCorrectionController,
}
