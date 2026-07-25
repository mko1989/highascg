/**
 * operator-gui-launcher-placement.js — WO-279: the xdotool window-discovery and placement/verify
 * mechanics split out of operator-gui-launcher.js (window matching, geometry parsing, the
 * move-verify-retry loop with its FULLSCREEN toggle escalation, and the launch timing probes).
 * See operator-gui-launcher.js's header for the WO-279 root-cause writeup — this module is the
 * "how" the placement is done; the launcher owns "when" (spawn/raise/auto-launch orchestration).
 */
'use strict'

const { execFile } = require('child_process')
const { promisify } = require('util')
// resolveOperatorMonitorRect is imported from the SAME module (and is the SAME function) the
// pointer confinement uses — src/system/pointer-confine.js:17. WO-279 requirement 1: the kiosk
// window and the pointer barrier must never derive "the operator monitor" independently.
const { resolveOperatorMonitorRect } = require('../utils/x-display-session')
const { resolveOperatorGuiMonitorRect } = require('./operator-gui-channel')

const execFileAsync = promisify(execFile)

/**
 * `xdotool search` flag + pattern pairs, most-likely-first. `--class` searches WM_CLASS's res_class
 * ("firefox-esr-esr140" here — the "firefox" substring matches), `--classname` searches res_name
 * ("Navigator"). Both spellings of both fields are kept so an ESR build that flips them still matches.
 */
const XDOTOOL_WINDOW_MATCHERS = [
	['--class', 'firefox'],
	['--classname', 'Navigator'],
	['--class', 'Navigator'],
]
const SEARCH_TIMEOUT_MS = 5000
/** Poll attempts while waiting for Firefox to map its window (backoff schedule below: ~20s total). */
const WINDOW_WAIT_ATTEMPTS = 10
/** Move+verify attempts once the window exists (backoff schedule below: ~7.75s total). */
const PLACEMENT_ATTEMPTS = 6
const BACKOFF_BASE_MS = 250
const BACKOFF_MAX_MS = 4000
/** WM frames can shift a window by a pixel or two; anything larger is a real placement miss. */
const PLACEMENT_TOLERANCE_PX = 2

/**
 * todos19.07.26 release: launch timing probes — LOG-ONLY, no behavior change. Each phase line
 * carries wall-clock epoch ms (`t=`) plus ms since the kiosk spawn (`+Nms`) so startup races
 * (X not ready, slow window map, shape helper vs first rect report) are diagnosable from the
 * journal alone. NOTE: the operator-GUI Firefox is a plain native kiosk — there is NO CDP in this
 * path (CDP timing belongs to the WO-258 browser-source/CEF sessions); the later phases of this
 * timeline are the shape helper probes in operator-shape-overlay.js and the first-rect-report
 * probe in src/api/routes-operator-gui.js.
 */
let launchSpawnAt = null
function markLaunchSpawn() {
	launchSpawnAt = Date.now()
}
function probeLaunchPhase(log, phase, extra = '') {
	const now = Date.now()
	const dt = launchSpawnAt == null ? '?' : String(now - launchSpawnAt)
	log?.('info', `[Operator GUI] timing: ${phase} t=${now} +${dt}ms${extra ? ` ${extra}` : ''}`)
}

/**
 * WO-279 — PURE. Exponential backoff gaps BETWEEN `attempts` tries (so `attempts` tries have
 * `attempts - 1` waits), doubling from `baseMs` and capped at `maxMs`. Bounded by construction:
 * there is no unbounded retry anywhere in this file.
 * @param {number} attempts
 * @param {{ baseMs?: number, maxMs?: number }} [opts]
 * @returns {number[]}
 */
function placementAttemptDelays(attempts, opts = {}) {
	const base = Number.isFinite(opts.baseMs) ? opts.baseMs : BACKOFF_BASE_MS
	const max = Number.isFinite(opts.maxMs) ? opts.maxMs : BACKOFF_MAX_MS
	const n = Math.max(0, Math.floor(Number(attempts) || 0) - 1)
	const out = []
	for (let i = 0; i < n; i++) out.push(Math.min(max, base * 2 ** i))
	return out
}

/**
 * WO-279 — PURE. Parse `xdotool getwindowgeometry --shell` output (root-relative X/Y).
 * @param {string} stdout
 * @returns {{x:number,y:number,w:number,h:number}|null} null when any field is missing/unparseable
 */
function parseXdotoolGeometry(stdout) {
	const got = {}
	for (const line of String(stdout || '').split('\n')) {
		const m = /^(X|Y|WIDTH|HEIGHT)=(-?\d+)$/.exec(line.trim())
		if (m) got[m[1]] = parseInt(m[2], 10)
	}
	const { X, Y, WIDTH, HEIGHT } = got
	if (![X, Y, WIDTH, HEIGHT].every((v) => Number.isFinite(v))) return null
	return { x: X, y: Y, w: WIDTH, h: HEIGHT }
}

/**
 * WO-279 — PURE. Did the window actually land on the intended rect (within WM-frame tolerance)?
 * @param {{x:number,y:number,w:number,h:number}|null} actual
 * @param {{x:number,y:number,w:number,h:number}|null} want
 * @param {number} [tol]
 * @returns {boolean}
 */
function geometryMatches(actual, want, tol = PLACEMENT_TOLERANCE_PX) {
	if (!actual || !want) return false
	return (
		Math.abs(actual.x - want.x) <= tol &&
		Math.abs(actual.y - want.y) <= tol &&
		Math.abs(actual.w - want.w) <= tol &&
		Math.abs(actual.h - want.h) <= tol
	)
}

/** WO-279 — PURE. The one rect spelling used in every placement log line. */
function formatRect(r) {
	return r ? `${r.x},${r.y} ${r.w}x${r.h}` : 'unknown'
}

/**
 * WO-279 requirement 1 — resolve the kiosk's target monitor from the SAME source of truth the
 * pointer confinement uses (`resolveOperatorMonitorRect`, src/system/pointer-confine.js:308). The
 * operator_gui destination's own rect is only a FALLBACK, used when no operator-monitor flag/port
 * is configured at all — in that case pointer confine is inactive too (see
 * `isOperatorPointerConfineDesired`), so there is no second opinion to disagree with. The returned
 * `source` is logged, so a wrong monitor is diagnosable from the journal.
 * @param {object} config
 * @param {object} [layout] pre-computed `calculateLayoutPositions()` result
 * @param {{ resolveOperatorMonitorRect?: Function, resolveOperatorGuiMonitorRect?: Function }} [deps] injectable for offline tests
 * @returns {{x:number,y:number,w:number,h:number,sysId:string|null,source:string}|null}
 */
function resolveKioskMonitorRect(config, layout, deps = {}) {
	const confine = deps.resolveOperatorMonitorRect || resolveOperatorMonitorRect
	const guiDest = deps.resolveOperatorGuiMonitorRect || resolveOperatorGuiMonitorRect
	try {
		const r = confine(config, layout)
		if (r && r.width > 0 && r.height > 0) {
			return { x: r.x, y: r.y, w: r.width, h: r.height, sysId: r.sysId || null, source: 'operator-monitor' }
		}
	} catch (_) {
		/* hardware detection unavailable (headless/tests) — try the destination fallback */
	}
	try {
		const g = guiDest(config, layout)
		if (g && g.w > 0 && g.h > 0) {
			return { x: g.x, y: g.y, w: g.w, h: g.h, sysId: null, source: 'operator_gui_destination' }
		}
	} catch (_) {
		/* unresolved — caller logs loudly and leaves the window where the WM put it */
	}
	return null
}

/**
 * @param {object} env
 * @param {number} [timeout]
 * @param {{ exec?: Function }} [deps]
 * @returns {Promise<string[]>} xdotool window ids, most-recently-created last (xdotool's own order)
 */
async function findFirefoxWindowIds(env, timeout = SEARCH_TIMEOUT_MS, deps = {}) {
	const exec = deps.exec || execFileAsync
	for (const [flag, pattern] of XDOTOOL_WINDOW_MATCHERS) {
		try {
			const { stdout } = await exec('xdotool', ['search', '--onlyvisible', flag, pattern], { env, timeout })
			const ids = String(stdout || '')
				.trim()
				.split(/\s+/)
				.filter(Boolean)
			if (ids.length) return ids
		} catch (_) {
			/* no windows for this matcher yet — try the next one */
		}
	}
	return []
}

/**
 * WO-279 requirement 2 (first half) — wait for Firefox to actually MAP a window before placing it.
 * Polls the matcher list on the backoff schedule. Deliberately silent: one line per state change
 * means the caller's "kiosk window found" probe (or the not-found warn) is the only output, never
 * one line per poll.
 * @param {object} env
 * @param {{ exec?: Function, sleep?: Function, windowAttempts?: number }} [deps]
 * @returns {Promise<string[]>}
 */
async function waitForFirefoxWindowIds(env, deps = {}) {
	const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
	const attempts = Number.isFinite(deps.windowAttempts) ? deps.windowAttempts : WINDOW_WAIT_ATTEMPTS
	const delays = placementAttemptDelays(attempts)
	for (let i = 0; i < attempts; i++) {
		const ids = await findFirefoxWindowIds(env, SEARCH_TIMEOUT_MS, deps)
		if (ids.length) return ids
		const delay = delays[i]
		if (delay == null) break
		await sleep(delay)
	}
	return []
}

/**
 * WO-279 requirement 2 (second half) + 3 — move the kiosk window onto `rect`, READ THE GEOMETRY
 * BACK, and retry with bounded backoff until it matches. Logs the intended rect once up front, one
 * line per attempt that missed, and one final line carrying the verified (or last-seen) geometry.
 *
 * Escalation: from the second attempt on, `_NET_WM_STATE_FULLSCREEN` is dropped before the move and
 * re-added after it. A `--kiosk` Firefox is fullscreen, and a fullscreen window's geometry is the
 * WM's to decide — plain `windowmove` on it is advisory and can be ignored or re-asserted. Toggling
 * the state off, moving, and toggling it back is what makes the WM re-fullscreen the window onto
 * the monitor it now sits on. Attempt 1 stays a plain move so an already-correct window is never
 * flickered out of fullscreen.
 * @param {object} env
 * @param {string} wid
 * @param {{x:number,y:number,w:number,h:number,sysId?:string|null,source?:string}} rect
 * @param {Function} [log]
 * @param {{ exec?: Function, sleep?: Function, attempts?: number }} [deps]
 * @returns {Promise<{ok:boolean, attempts:number, geometry:object|null}>}
 */
async function placeKioskWindow(env, wid, rect, log, deps = {}) {
	const exec = deps.exec || execFileAsync
	const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
	const attempts = Number.isFinite(deps.attempts) ? deps.attempts : PLACEMENT_ATTEMPTS
	const delays = placementAttemptDelays(attempts)
	const opts = { env, timeout: SEARCH_TIMEOUT_MS }
	log?.(
		'info',
		`[Operator GUI] placement: target ${formatRect(rect)} sysId=${rect.sysId || 'unknown'} source=${rect.source || 'unknown'} wid=${wid}`,
	)
	let seen = null
	let toggledFullscreen = false
	for (let i = 0; i < attempts; i++) {
		if (i >= 1 && !toggledFullscreen) {
			toggledFullscreen = true
			log?.('info', `[Operator GUI] placement: attempt ${i + 1} — dropping _NET_WM_STATE_FULLSCREEN so the WM honors the move`)
		}
		try {
			if (toggledFullscreen) await exec('xdotool', ['windowstate', '--remove', 'FULLSCREEN', wid], opts)
			await exec('xdotool', ['windowmove', wid, String(rect.x), String(rect.y)], opts)
			await exec('xdotool', ['windowsize', wid, String(rect.w), String(rect.h)], opts)
			if (toggledFullscreen) await exec('xdotool', ['windowstate', '--add', 'FULLSCREEN', wid], opts)
		} catch (e) {
			log?.('warn', `[Operator GUI] placement: windowmove/windowsize failed: ${e?.message || e}`)
		}
		try {
			const { stdout } = await exec('xdotool', ['getwindowgeometry', '--shell', wid], opts)
			seen = parseXdotoolGeometry(stdout)
		} catch (e) {
			log?.('warn', `[Operator GUI] placement: geometry read-back failed: ${e?.message || e}`)
			seen = null
		}
		if (geometryMatches(seen, rect)) {
			log?.('info', `[Operator GUI] placement: verified ${formatRect(seen)} after ${i + 1} attempt(s)`)
			return { ok: true, attempts: i + 1, geometry: seen }
		}
		const delay = delays[i]
		if (delay == null) break
		log?.(
			'info',
			`[Operator GUI] placement: attempt ${i + 1}/${attempts} got ${formatRect(seen)} want ${formatRect(rect)} — retrying in ${delay}ms`,
		)
		await sleep(delay)
	}
	log?.(
		'warn',
		`[Operator GUI] placement: FAILED after ${attempts} attempts — kiosk at ${formatRect(seen)}, want ${formatRect(rect)} (operator GUI is on the WRONG MONITOR)`,
	)
	return { ok: false, attempts, geometry: seen }
}

/**
 * @param {object} env
 * @param {{x:number,y:number,w:number,h:number}|null} monitorRect
 * @param {Function} [log]
 * @param {{ exec?: Function, sleep?: Function, attempts?: number, windowAttempts?: number }} [deps]
 */
async function positionFirefoxWindow(env, monitorRect, log, deps = {}) {
	const exec = deps.exec || execFileAsync
	const ids = await waitForFirefoxWindowIds(env, deps)
	if (!ids.length) {
		log?.('warn', '[Operator GUI] launch: no Firefox window found to position')
		return false
	}
	const wid = ids[ids.length - 1]
	probeLaunchPhase(log, 'kiosk window found', `wid=${wid} candidates=${ids.length}`)
	if (monitorRect && monitorRect.w > 0 && monitorRect.h > 0) {
		await placeKioskWindow(env, wid, monitorRect, log, deps)
	} else {
		log?.('warn', '[Operator GUI] placement: no operator monitor resolved — kiosk left wherever the WM mapped it')
	}
	try {
		await exec('xdotool', ['windowactivate', wid], { env, timeout: SEARCH_TIMEOUT_MS })
	} catch (_) {
		/* best-effort */
	}
	probeLaunchPhase(log, 'kiosk window positioned')
	return true
}

module.exports = {
	XDOTOOL_WINDOW_MATCHERS,
	PLACEMENT_ATTEMPTS,
	WINDOW_WAIT_ATTEMPTS,
	placementAttemptDelays,
	parseXdotoolGeometry,
	geometryMatches,
	formatRect,
	resolveKioskMonitorRect,
	findFirefoxWindowIds,
	waitForFirefoxWindowIds,
	placeKioskWindow,
	positionFirefoxWindow,
	probeLaunchPhase,
	markLaunchSpawn,
}
