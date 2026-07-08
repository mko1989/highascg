'use strict'

/**
 * App-managed loop restart for LONG looping clips (WO-154).
 *
 * CasparCG's producer-internal `LOOP` seeks back to 0 without reopening the file; on
 * long multi-audio-stream HAP masters the producer decays to ~50% playback speed after
 * the second/third wrap (observed live: 5.02s elapsed per 10s wall clock, DeckLink
 * "Failed to schedule primary video" starting right after wrap #2). A FRESH producer
 * plays realtime again — so near each wrap this watchdog re-issues the layer's original
 * PLAY line verbatim (captured by playback-tracker, audio filter included), trading a
 * cut at the loop point (which Caspar's wrap is anyway) for a clean producer.
 *
 * Opt-in via config:
 *   "playback": { "appManagedLoop": { "enabled": true, "minDurationSec": 600, "marginMs": 2500 } }
 * Only foreground `PLAY … LOOP` layers with a known duration ≥ minDurationSec are managed;
 * timeline-engine loops are already app-driven and never rely on producer LOOP.
 * The restart fires marginMs before the wrap (must exceed the 1s poll so the window
 * cannot be missed) — the last ~marginMs of the clip is skipped on each loop.
 */

const DEFAULTS = Object.freeze({
	enabled: false,
	/** manage only clips at least this long (short loops wrap fine) */
	minDurationSec: 600,
	/** restart this many ms before the producer would wrap; keep > poll interval */
	marginMs: 2500,
})

const POLL_MS = 1000
/** ignore a managed layer for this long after we restarted it */
const RESTART_COOLDOWN_MS = 10000

/** @param {unknown} raw */
function normalizeAppManagedLoop(raw) {
	const src = raw && typeof raw === 'object' ? raw : {}
	const minDurationSec = Number(src.minDurationSec)
	const marginMs = Number(src.marginMs)
	return {
		enabled: src.enabled === true,
		minDurationSec:
			Number.isFinite(minDurationSec) && minDurationSec >= 10 ? minDurationSec : DEFAULTS.minDurationSec,
		marginMs:
			Number.isFinite(marginMs) && marginMs >= POLL_MS + 500 ? Math.min(marginMs, 15000) : DEFAULTS.marginMs,
	}
}

/**
 * One poll pass over the playback matrix. Pure apart from the injected send/now —
 * unit-testable with a fake matrix + snapshot.
 * @param {object} matrix ctx._playbackMatrix
 * @param {object|null} oscSnapshot oscState.getSnapshot()
 * @param {{ minDurationSec: number, marginMs: number }} cfg
 * @param {(line: string) => void} send
 * @param {() => number} [now]
 * @returns {number} restarts issued
 */
function pollLoopRestarts(matrix, oscSnapshot, cfg, send, now = Date.now) {
	if (!matrix) return 0
	let restarts = 0
	const t = now()
	for (const key of Object.keys(matrix)) {
		const e = matrix[key]
		if (!e || !e.playing || !e.loop || !e.playLine) continue
		if (!(Number(e.durationMs) >= cfg.minDurationSec * 1000)) continue
		if (t - (e._loopRestartAt || 0) < RESTART_COOLDOWN_MS) continue
		const file = oscSnapshot?.channels?.[String(e.channel)]?.layers?.[String(e.layer)]?.file
		const elapsedSec = Number(file?.elapsed)
		if (!Number.isFinite(elapsedSec)) continue
		const remainingMs = Number(e.durationMs) - elapsedSec * 1000
		if (remainingMs <= cfg.marginMs && remainingMs > -2000) {
			e._loopRestartAt = t
			send(e.playLine)
			restarts++
		}
	}
	return restarts
}

/**
 * @param {{ config?: object, amcp?: { raw: (l: string) => Promise<any> }, oscState?: { getSnapshot: () => object }, _playbackMatrix?: object, log?: Function }} ctx
 * @returns {{ stop: () => void }}
 */
function startLoopRestartWatchdog(ctx) {
	let timer = null
	const tick = () => {
		try {
			const cfg = normalizeAppManagedLoop(ctx?.config?.playback?.appManagedLoop)
			if (!cfg.enabled || !ctx?.amcp || !ctx?._playbackMatrix) return
			const snap = typeof ctx.oscState?.getSnapshot === 'function' ? ctx.oscState.getSnapshot() : null
			pollLoopRestarts(ctx._playbackMatrix, snap, cfg, (line) => {
				ctx.log?.('info', `[loop-restart] re-issuing fresh producer near wrap: ${line.slice(0, 120)}`)
				ctx.amcp.raw(line).catch((e) => {
					ctx.log?.('warn', `[loop-restart] re-PLAY failed: ${e?.message || e}`)
				})
			})
		} catch (e) {
			ctx?.log?.('debug', `[loop-restart] tick error: ${e?.message || e}`)
		}
	}
	timer = setInterval(tick, POLL_MS)
	if (typeof timer.unref === 'function') timer.unref()
	return {
		stop() {
			if (timer) clearInterval(timer)
			timer = null
		},
	}
}

module.exports = { startLoopRestartWatchdog, pollLoopRestarts, normalizeAppManagedLoop }
