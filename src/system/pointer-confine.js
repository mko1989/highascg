/**
 * Keep mouse pointer inside the operator monitor when enabled.
 *
 * The ONLY backend: XFixes pointer barriers (confine-pointer-barriers.py) — a hard edge stop
 * enforced by the X server, no XGrabPointer, no overlay windows; Caspar multiview/interactive keep
 * working. That daemon is event-driven and never touches the cursor (WO-391/391b).
 *
 * There is deliberately NO fallback. The old xdotool warp poll (80 ms setInterval → two subprocess
 * spawns per tick) was removed in WO-391b — see the block comment below `tryBarrierConfine`. If
 * barriers cannot start, the pointer is left unconfined and the 8 s watchdog retries.
 *
 * HIGHASCG_POINTER_CONFINE_XGRAB=1 still opts into legacy XGrabPointer (breaks interactive).
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFile, spawn } = require('child_process')
const { promisify } = require('util')
const {
	resolveOperatorMonitorRect,
	isOperatorPointerConfineDesired,
	evaluateOperatorPointerConfineDesire,
	resolveConfineBarriersScript,
	resolveConfineCursorScript,
	displaySessionEnv,
} = require('../utils/x-display-session')
const { calculateLayoutPositions } = require('../utils/os-layout-calculator')

const execFileAsync = promisify(execFile)

/** Idle seconds before unclutter hides the cursor (operator monitor + desktop). */
const UNCLUTTER_IDLE_SEC = 2

const BARRIER_LOG_PATH = path.join(process.env.HOME || '/home/casparcg', '.highascg/log/confine-pointer-barriers.log')
const BARRIER_PID_PATH = path.join(process.env.HOME || '/home/casparcg', '.highascg/run/confine-pointer-barriers.pid')

/** @type {import('child_process').ChildProcess | null} */
let confineProc = null
/* WO-391b: `confineTimer` is gone with the xdotool warp interval — the barrier daemon is the only
 * backend now, so liveness is a question about `confineProc`, not about a local setInterval. */
/** @type {NodeJS.Timeout | null} */
let barrierWatchdog = null
/** @type {string | null} */
let activeConfineKey = null
/** @type {object | null} */
let watchConfig = null
/** @type {{ log?: Function } | null} */
let watchOpts = null

function envTruthy(name) {
	const v = String(process.env[name] || '').trim().toLowerCase()
	return v === '1' || v === 'true' || v === 'yes'
}

function confineKey(rect) {
	if (!rect?.sysId) return null
	return `${rect.sysId}@${rect.x},${rect.y},${rect.width}x${rect.height}`
}

function barrierLogShowsActive() {
	try {
		const tail = fs.readFileSync(BARRIER_LOG_PATH, 'utf8').slice(-2000)
		if (!tail.includes('Pointer barriers active')) return false
		const m = tail.match(/\[pid=(\d+)\][^\n]*Pointer barriers active/)
		if (!m) return false
		const pid = parseInt(m[1], 10)
		if (!Number.isFinite(pid)) return false
		try {
			process.kill(pid, 0)
			return true
		} catch {
			return false
		}
	} catch {
		return false
	}
}

async function isBarrierDaemonRunning(sysId, env) {
	try {
		const raw = fs.readFileSync(BARRIER_PID_PATH, 'utf8').trim()
		const [pidStr, outName] = raw.split(/\s+/, 2)
		const pid = parseInt(pidStr, 10)
		if (outName === sysId && Number.isFinite(pid)) {
			try {
				process.kill(pid, 0)
				return true
			} catch {
				/* stale pid file */
			}
		}
	} catch {
		/* no pid file */
	}
	try {
		const { stdout } = await execFileAsync('pgrep', ['-af', 'confine-pointer-barriers.py'], { env, timeout: 2000 })
		return String(stdout || '')
			.split('\n')
			.some((line) => line.includes('confine-pointer-barriers') && line.includes(sysId))
	} catch {
		return false
	}
}

function stopBarrierWatchdog() {
	if (barrierWatchdog) clearInterval(barrierWatchdog)
	barrierWatchdog = null
	watchConfig = null
	watchOpts = null
}

function startBarrierWatchdog(config, opts) {
	watchConfig = config
	watchOpts = opts
	if (barrierWatchdog) return
	barrierWatchdog = setInterval(() => {
		if (!watchConfig) {
			stopBarrierWatchdog()
			return
		}
		const verdict = evaluateOperatorPointerConfineDesire(watchConfig)
		if (!verdict.desired) {
			// This branch only runs once per transition — stopBarrierWatchdog() clears the interval
			// that is calling it, so the poll cannot fire again to log the same line twice.
			watchOpts?.log?.('info', `[Pointer confine] stopping — ${verdict.reason}`)
			stopBarrierWatchdog()
			return
		}
		void startPointerConfine(watchConfig, watchOpts || {})
	}, 8000)
}

async function ensureUnclutterRunning(env, log) {
	try {
		const { stdout } = await execFileAsync('pgrep', ['-x', 'unclutter'], { env, timeout: 2000 })
		if (String(stdout || '').trim()) return true
	} catch {
		/* not running */
	}
	try {
		const child = spawn('unclutter', ['-idle', String(UNCLUTTER_IDLE_SEC), '-root'], {
			env,
			detached: true,
			stdio: 'ignore',
		})
		/* spawn ENOENT arrives as an async 'error' event the try/catch can NOT see —
		 * unhandled it is an uncaughtException that kills the whole service. */
		child.on('error', (e) => log?.('warn', `[Pointer confine] unclutter unavailable: ${e?.message || e}`))
		child.unref()
		log?.('info', `[Pointer confine] unclutter -idle ${UNCLUTTER_IDLE_SEC} started`)
		return true
	} catch (e) {
		log?.('warn', `[Pointer confine] unclutter unavailable: ${e?.message || e}`)
		return false
	}
}

function stopBarrierProc(env) {
	if (confineProc) {
		try {
			confineProc.kill('SIGTERM')
		} catch {
			/* ignore */
		}
		confineProc = null
	}
	void execFileAsync('pkill', ['-f', 'confine-pointer-barriers.py'], { env, timeout: 3000 }).catch(() => {})
	void execFileAsync('pkill', ['-f', 'confine-cursor.py'], { env, timeout: 3000 }).catch(() => {})
}

function stopPointerConfine() {
	const env = displaySessionEnv()
	activeConfineKey = null
	stopBarrierWatchdog()
	stopBarrierProc(env)
	void ensureUnclutterRunning(env)
}

function isPointerConfineActive() {
	if (confineProc && confineProc.exitCode == null && !confineProc.killed) return true
	return false
}

function waitMs(ms) {
	return new Promise((r) => setTimeout(r, ms))
}

async function tryBarrierConfine(rect, env, log) {
	const script = resolveConfineBarriersScript()
	if (!script || !rect.sysId || !/^[A-Za-z0-9._-]+$/.test(rect.sysId)) return null
	if (await isBarrierDaemonRunning(rect.sysId, env)) {
		log?.('info', `[Pointer confine] XFixes barriers already running on ${rect.sysId}`)
		activeConfineKey = confineKey(rect)
		return { ok: true, rect, mode: 'barriers' }
	}
	stopBarrierProc(env)
	confineProc = spawn('python3', [script, rect.sysId], {
		env,
		detached: true,
		stdio: 'ignore',
	})
	confineProc.unref()
	for (let attempt = 0; attempt < 8; attempt++) {
		await waitMs(200)
		if (await isBarrierDaemonRunning(rect.sysId, env)) {
			confineProc.on('exit', () => {
				if (confineProc) confineProc = null
			})
			log?.(
				'info',
				`[Pointer confine] XFixes barriers on ${rect.sysId} @ ${rect.x},${rect.y} ${rect.width}x${rect.height}`,
			)
			activeConfineKey = confineKey(rect)
			startBarrierWatchdog(watchConfig, watchOpts)
			return { ok: true, rect, mode: 'barriers' }
		}
	}
	stopBarrierProc(env)
	log?.('warn', '[Pointer confine] barrier daemon failed to start')
	return null
}

/* WO-391b: `tickXdotoolConfine` / `startXdotoolConfine` are DELETED.
 *
 * They were the fallback when XFixes barriers could not be started: a `setInterval(…, 80)` that
 * shelled out to `xdotool getmouselocation` and then `xdotool mousemove` — **12.5 process spawns a
 * second, indefinitely**. Two reasons it is gone rather than tuned:
 *
 *   1. It polls and warps the CURSOR, the mechanism the owner rejected outright ("i dont like that
 *      mouse cursor poll loop at all … i dont see the need for that at all") and which WO-391 already
 *      removed from the barrier daemon. Keeping a second copy behind a failure branch defeats that.
 *   2. It fired for the wrong reason. Journal 30.07: `barrier daemon failed to start` at 12:40:46 →
 *      xdotool fallback → barriers succeeded anyway at 12:40:52. The "failure" was a transient race
 *      in tryBarrierConfine's 1.6 s start window (it pkills the old daemon then waits for the new
 *      pid file), so the box spent 6 s spawning processes at 12.5/s to solve nothing.
 *
 * What replaces it: nothing. If barriers cannot start we log and leave the pointer UNCONFINED, and
 * the 8 s `startBarrierWatchdog` keeps retrying barriers — which is how the 12:40 case recovered on
 * its own. That is the principle this component already applies to a vanished output ("releasing
 * instead of holding a stale fence"): not confining is recoverable and cheap, confining wrongly (or
 * expensively) is neither.
 */

async function pythonXlibAvailable(env) {
	try {
		await execFileAsync('python3', ['-c', 'from Xlib import X'], { env, timeout: 4000 })
		return true
	} catch {
		return false
	}
}

async function tryPythonXgrabConfine(config, rect, env, log, opts, layout) {
	const script = resolveConfineCursorScript()
	if (!script || !rect.sysId || !(await pythonXlibAvailable(env))) return null
	stopBarrierProc(env)
	confineProc = spawn('python3', [script, rect.sysId], { env, detached: true, stdio: 'ignore' })
	confineProc.unref()
	await waitMs(500)
	if (confineProc.exitCode == null && !confineProc.killed) {
		log?.('warn', `[Pointer confine] XGrabPointer on ${rect.sysId} — may break Caspar interactive`)
		activeConfineKey = confineKey(rect)
		return { ok: true, rect, mode: 'xgrab' }
	}
	stopBarrierProc(env)
	return null
}

/**
 * @param {object} config
 * @param {{ log?: Function, layout?: object }} [opts]
 */
async function startPointerConfine(config, opts = {}) {
	const verdict = evaluateOperatorPointerConfineDesire(config)
	if (!verdict.desired) {
		opts.log?.('info', `[Pointer confine] SKIP — ${verdict.reason}`)
		stopPointerConfine()
		return { ok: true, enabled: false, reason: verdict.reason }
	}
	const layout = opts.layout || calculateLayoutPositions(config)
	const rect = resolveOperatorMonitorRect(config, layout)
	if (!rect) {
		opts.log?.('warn', '[Pointer confine] No operator monitor rect — not started')
		return { ok: false, reason: 'no_operator_monitor' }
	}
	const key = confineKey(rect)
	const env = displaySessionEnv()
	if (key && key === activeConfineKey && (await isBarrierDaemonRunning(rect.sysId, env))) {
		// Steady-state watchdog recheck (fires every 8s while confine stays desired) — NOT a fresh
		// decision, so it must not repeat the RUN log every tick.
		startBarrierWatchdog(config, opts)
		return { ok: true, rect, mode: 'unchanged' }
	}

	// Reached only on a genuine transition into confine (first start, or restart after the rect/key
	// changed) — never on the steady-state watchdog recheck above, so this logs once per transition.
	opts.log?.('info', `[Pointer confine] RUN — ${verdict.reason}`)
	stopPointerConfine()
	const log = opts.log
	watchConfig = config
	watchOpts = opts
	await ensureUnclutterRunning(env, log)

	if (envTruthy('HIGHASCG_POINTER_CONFINE_XGRAB')) {
		const xgrab = await tryPythonXgrabConfine(config, rect, env, log, opts, layout)
		if (xgrab) return xgrab
	}

	const barriers = await tryBarrierConfine(rect, env, log)
	if (barriers) {
		startBarrierWatchdog(config, opts)
		return barriers
	}

	/* WO-391b: no cursor-polling fallback any more (see the block comment above tryBarrierConfine's
	 * former xdotool sibling). Leave the pointer free and let the 8 s watchdog keep retrying
	 * barriers — a transient start race then heals itself, and a persistent failure stays visible
	 * in the log instead of being masked by 12.5 subprocess spawns a second. */
	startBarrierWatchdog(config, opts)
	log?.(
		'warn',
		`[Pointer confine] XFixes barriers could not be started on ${rect.sysId} — pointer left UNCONFINED; ` +
			'the 8s watchdog will keep retrying (WO-391b: the xdotool warp fallback was removed)',
	)
	return { ok: false, reason: 'barriers_unavailable', rect }
}

/**
 * @param {object} config
 * @param {{ log?: Function }} [opts]
 */
function syncOperatorPointerConfine(config, opts = {}) {
	const verdict = evaluateOperatorPointerConfineDesire(config)
	// WO-308: one line per decision, mirroring WO-290's RUN/SKIP verdict style. startPointerConfine
	// logs its OWN skip below when desired — logging here too would just be the same reason twice
	// for the enabled case, so this line covers the disabled case only.
	if (verdict.desired) {
		void startPointerConfine(config, opts).then((r) => {
			if (!r.ok) stopPointerConfine()
		})
		return { ok: true, enabled: true, starting: true, reason: verdict.reason }
	}
	opts.log?.('info', `[Pointer confine] SKIP — ${verdict.reason}`)
	stopPointerConfine()
	return { ok: true, enabled: false, reason: verdict.reason }
}

module.exports = {
	UNCLUTTER_IDLE_SEC,
	startPointerConfine,
	stopPointerConfine,
	isPointerConfineActive,
	syncOperatorPointerConfine,
}
