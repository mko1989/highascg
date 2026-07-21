/**
 * Keep mouse pointer inside the operator monitor when enabled.
 *
 * Primary: XFixes pointer barriers (confine-pointer-barriers.py) — hard edge stop,
 * no XGrabPointer, no overlay windows; Caspar multiview/interactive keep working.
 *
 * Fallback: xdotool warp polling (if xdotool is installed).
 * HIGHASCG_POINTER_CONFINE_XGRAB=1 opts into legacy XGrabPointer (breaks interactive).
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
	pointerInConfineAllowance,
	parkPointerOnOperatorDisplay,
	resolveConfineBarriersScript,
	resolveConfineCursorScript,
	resolveXdotoolBin,
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
/** @type {NodeJS.Timeout | null} */
let confineTimer = null
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

function clamp(n, min, max) {
	return Math.max(min, Math.min(max, n))
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
		child.unref()
		log?.('info', `[Pointer confine] unclutter -idle ${UNCLUTTER_IDLE_SEC} started`)
		return true
	} catch (e) {
		log?.('warn', `[Pointer confine] unclutter unavailable: ${e?.message || e}`)
		return false
	}
}

function stopXdotoolConfine() {
	if (confineTimer) clearInterval(confineTimer)
	confineTimer = null
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
	stopXdotoolConfine()
	stopBarrierProc(env)
	void ensureUnclutterRunning(env)
}

function isPointerConfineActive() {
	if (confineTimer) return true
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

/**
 * @param {object} config
 * @param {{ log?: Function, layout?: object }} [opts]
 */
async function tickXdotoolConfine(config, opts = {}) {
	const layout = opts.layout || calculateLayoutPositions(config)
	const rect = resolveOperatorMonitorRect(config, layout)
	if (!rect || rect.width <= 0 || rect.height <= 0) return
	const env = displaySessionEnv()
	const xdotool = await resolveXdotoolBin(env)
	if (!xdotool) return
	const minX = rect.x
	const minY = rect.y
	const maxX = rect.x + rect.width - 1
	const maxY = rect.y + rect.height - 1
	try {
		const { stdout } = await execFileAsync(xdotool, ['getmouselocation', '--shell'], { env, timeout: 2000 })
		let x = 0
		let y = 0
		for (const line of String(stdout || '').split('\n')) {
			if (line.startsWith('X=')) x = parseInt(line.slice(2), 10)
			if (line.startsWith('Y=')) y = parseInt(line.slice(2), 10)
		}
		if (!Number.isFinite(x) || !Number.isFinite(y)) return
		if (pointerInConfineAllowance(config, layout, x, y)) return
		const nx = clamp(x, minX, maxX)
		const ny = clamp(y, minY, maxY)
		if (nx !== x || ny !== y) {
			await execFileAsync(xdotool, ['mousemove', '--sync', String(nx), String(ny)], { env, timeout: 2000 })
			opts.log?.('debug', `[Pointer confine] Warped ${x},${y} → ${nx},${ny}`)
		}
	} catch (e) {
		opts.log?.('warn', `[Pointer confine] tick failed: ${e?.message || e}`)
	}
}

function startXdotoolConfine(config, rect, opts = {}) {
	const layout = opts.layout || calculateLayoutPositions(config)
	stopXdotoolConfine()
	confineTimer = setInterval(() => {
		void tickXdotoolConfine(config, { ...opts, layout })
	}, 80)
	void parkPointerOnOperatorDisplay(config, { ...opts, layout })
	opts.log?.(
		'info',
		`[Pointer confine] xdotool fallback on ${rect.sysId} @ ${rect.x},${rect.y} ${rect.width}x${rect.height}`,
	)
	activeConfineKey = confineKey(rect)
	return { ok: true, rect, mode: 'xdotool' }
}

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

	const xdotool = await resolveXdotoolBin(env)
	if (xdotool) {
		return startXdotoolConfine(config, rect, opts)
	}

	log?.('warn', '[Pointer confine] barriers failed and xdotool not installed — confine inactive')
	return { ok: false, reason: 'no_backend', rect }
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
