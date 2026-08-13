'use strict'

const {
	isAmcpTcpConnected,
	isAmcpPortListening,
	killStuckCasparMainProcess,
	nudgeCasparConnectionReconnect,
	isCasparMainProcessRunning,
} = require('../utils/caspar-restart')

function envTruthy(name, defaultVal) {
	const raw = process.env[name]
	if (raw == null || String(raw).trim() === '') return defaultVal
	const v = String(raw).trim().toLowerCase()
	return v === '1' || v === 'true' || v === 'yes'
}

function parsePositiveInt(name, fallback) {
	const n = parseInt(process.env[name] || '', 10)
	return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * @typedef {object} AmcpWatchdogState
 * @property {number|null} downSince
 * @property {number|null} lastWarnAt
 * @property {number|null} lastNudgeAt
 * @property {number|null} lastRecoveryAt
 */

/** @returns {AmcpWatchdogState} */
function createAmcpWatchdogState() {
	return {
		downSince: null,
		lastWarnAt: null,
		lastNudgeAt: null,
		lastRecoveryAt: null,
	}
}

/**
 * One watchdog evaluation tick (exported for smoke tests).
 * @param {object} ctx
 * @param {AmcpWatchdogState} state
 * @param {number} now
 * @param {{
 *   pollMs?: number,
 *   warnMs?: number,
 *   recoverMs?: number,
 *   recoveryCooldownMs?: number,
 *   clientNudgeMs?: number,
 *   log?: (level: string, msg: string) => void,
 *   isTcpConnected?: (ctx: object) => boolean,
 *   isPortListening?: () => Promise<boolean>,
 *   isMainRunning?: (ctx: object) => Promise<boolean>,
 *   killMain?: (ctx: object) => Promise<boolean>,
 *   nudgeReconnect?: (ctx: object) => void,
 * }} [opts]
 */
async function evaluateAmcpWatchdogTick(ctx, state, now, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const pollMs = opts.pollMs ?? 5000
	const warnMs = opts.warnMs ?? 30_000
	const recoverMs = opts.recoverMs ?? 120_000
	const recoveryCooldownMs = opts.recoveryCooldownMs ?? 90_000
	const clientNudgeMs = opts.clientNudgeMs ?? 15_000
	const isTcpConnected = opts.isTcpConnected ?? isAmcpTcpConnected
	const isPortListening = opts.isPortListening ?? isAmcpPortListening
	const isMainRunning = opts.isMainRunning ?? isCasparMainProcessRunning
	const killMain = opts.killMain ?? killStuckCasparMainProcess
	const nudgeReconnect = opts.nudgeReconnect ?? nudgeCasparConnectionReconnect

	if (!ctx || ctx.config?.offline_mode || ctx._fullApplyInProgress) {
		state.downSince = null
		return { action: 'skip', state }
	}
	if (!ctx.casparConnection) {
		state.downSince = null
		return { action: 'skip', state }
	}

	const tcpUp = isTcpConnected(ctx)
	if (tcpUp) {
		state.downSince = null
		state.lastWarnAt = null
		return { action: 'ok', state }
	}

	if (state.downSince == null) state.downSince = now
	const downMs = now - state.downSince
	const portUp = await isPortListening()

	if (portUp) {
		if (
			downMs >= clientNudgeMs &&
			(state.lastNudgeAt == null || now - state.lastNudgeAt >= clientNudgeMs)
		) {
			nudgeReconnect(ctx)
			state.lastNudgeAt = now
			log(
				'warn',
				`[AMCP-Watchdog] Caspar port is up but client disconnected for ${Math.round(downMs / 1000)}s — nudging reconnect`
			)
			return { action: 'nudge', state }
		}
		if (downMs >= warnMs && (state.lastWarnAt == null || now - state.lastWarnAt >= warnMs)) {
			state.lastWarnAt = now
			log(
				'warn',
				`[AMCP-Watchdog] AMCP port up, client still down for ${Math.round(downMs / 1000)}s (reconnect in progress)`
			)
			return { action: 'warn', state }
		}
		return { action: 'wait_port', state }
	}

	const mainRunning = await isMainRunning(ctx)
	if (!mainRunning) {
		if (downMs >= warnMs && (state.lastWarnAt == null || now - state.lastWarnAt >= warnMs)) {
			state.lastWarnAt = now
			log(
				'warn',
				`[AMCP-Watchdog] AMCP down for ${Math.round(downMs / 1000)}s — no casparcg main process (waiting for run.sh)`
			)
		}
		return { action: 'wait_runsh', state }
	}

	if (downMs >= recoverMs) {
		if (state.lastRecoveryAt != null && now - state.lastRecoveryAt < recoveryCooldownMs) {
			return { action: 'cooldown', state }
		}
		log(
			'warn',
			`[AMCP-Watchdog] AMCP down for ${Math.round(downMs / 1000)}s with casparcg still running — killing hung process so run.sh can relaunch`
		)
		const killed = await killMain(ctx)
		nudgeReconnect(ctx)
		state.lastRecoveryAt = now
		state.downSince = now
		state.lastWarnAt = now
		state.lastNudgeAt = now
		return { action: killed ? 'kill' : 'kill_failed', state }
	}

	if (downMs >= warnMs && (state.lastWarnAt == null || now - state.lastWarnAt >= warnMs)) {
		state.lastWarnAt = now
		log(
			'warn',
			`[AMCP-Watchdog] AMCP down for ${Math.round(downMs / 1000)}s (casparcg boot/hung — recovery in ${Math.max(0, Math.round((recoverMs - downMs) / 1000))}s)`
		)
		return { action: 'warn', state }
	}

	void pollMs
	return { action: 'wait', state }
}

/**
 * Periodic failsafe: if AMCP stays unavailable while casparcg is hung, kill so run.sh relaunches.
 * @param {object} ctx
 */
function startCasparAmcpWatchdog(ctx) {
	if (!envTruthy('HIGHASCG_AMCP_WATCHDOG', true)) return null
	if (ctx?.config?.offline_mode) return null

	const pollMs = parsePositiveInt('HIGHASCG_AMCP_WATCHDOG_POLL_MS', 5000)
	const warnMs = parsePositiveInt('HIGHASCG_AMCP_WATCHDOG_WARN_MS', 30_000)
	const recoverMs = parsePositiveInt('HIGHASCG_AMCP_WATCHDOG_RECOVER_MS', 120_000)
	const recoveryCooldownMs = parsePositiveInt('HIGHASCG_AMCP_WATCHDOG_RECOVERY_COOLDOWN_MS', 90_000)
	/* WO-516: 15 s was a backstop default from when this only ever caught a hung Caspar. It is also the
	 * floor on how fast we recover from an ORDINARY restart, which happens on every Apply — so the
	 * operator waited 15 s+ for the UI to come back from a routine config change. Once the AMCP port is
	 * listening again, waiting buys nothing. */
	const clientNudgeMs = parsePositiveInt('HIGHASCG_AMCP_WATCHDOG_CLIENT_NUDGE_MS', 1000)
	/* Poll fast only while DOWN. WO-398's fork-loop lesson applies: `isAmcpPortListening` forks `ss`,
	 * so a permanent 500 ms poll would be ~170k forks/day. Healthy steady state stays at pollMs and the
	 * fast cadence exists solely for the seconds around a restart. */
	const downPollMs = parsePositiveInt('HIGHASCG_AMCP_WATCHDOG_DOWN_POLL_MS', 500)
	const log = typeof ctx?.log === 'function' ? ctx.log : () => {}

	const state = createAmcpWatchdogState()
	let busy = false

	/* Self-scheduling instead of setInterval so the cadence can follow the state: 5 s when healthy,
	 * `downPollMs` while the client is disconnected. A fixed 5 s interval meant a Caspar restart cost
	 * up to a full poll before we even looked, on top of the library's own 5 s reconnect timer. */
	let timer = null
	let stopped = false
	const schedule = (ms) => {
		if (stopped) return
		timer = setTimeout(run, ms)
		if (timer.unref) timer.unref()
	}
	const run = () => {
		if (busy || stopped) return
		busy = true
		void evaluateAmcpWatchdogTick(ctx, state, Date.now(), {
			pollMs,
			warnMs,
			recoverMs,
			recoveryCooldownMs,
			clientNudgeMs,
			log,
		})
			.then((res) => {
				const healthy = res?.action === 'ok' || res?.action === 'skip'
				schedule(healthy ? pollMs : downPollMs)
			})
			.catch((e) => {
				log('warn', `[AMCP-Watchdog] tick failed: ${e?.message || e}`)
				schedule(pollMs)
			})
			.finally(() => {
				busy = false
			})
	}
	run()
	log(
		'info',
		`[AMCP-Watchdog] Started (poll=${pollMs}ms down-poll=${downPollMs}ms nudge=${clientNudgeMs}ms warn=${warnMs}ms recover=${recoverMs}ms)`
	)

	return () => {
		stopped = true
		if (timer) clearTimeout(timer)
	}
}

module.exports = {
	startCasparAmcpWatchdog,
	evaluateAmcpWatchdogTick,
	createAmcpWatchdogState,
}
