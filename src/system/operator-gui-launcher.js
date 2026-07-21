/**
 * operator-gui-launcher.js — WO-255 T255.2: launch/raise the fullscreen Firefox-ESR process that
 * hosts the operator GUI web page. Firefox runs 100% native (no CEF, no compositor) — the operator
 * GUI Caspar channel's screen consumer window sits shaped ABOVE it (operator-shape-overlay.js).
 *
 * WO-279 — xdotool window-match, corrected against the live box. Firefox-ESR here reports
 * `WM_CLASS(STRING) = "Navigator", "firefox-esr-esr140"`: "Navigator" is the *instance* (WM_CLASS
 * res_name, which `xdotool search --classname` searches) and "firefox-esr-esr140" is the *class*
 * (res_class, which `xdotool search --class` searches). The pre-WO-279 list tried
 * `--class Navigator` FIRST, which can never match — combined with `--sync` (blocks until a match)
 * that call was killed by its own 8s execFile timeout on every launch, so the first placement
 * attempt landed ~8s after spawn instead of as soon as the window mapped (journal 2026-07-20
 * 00:03:57.530 spawn -> 00:04:05.544 "kiosk window found +8014ms"). Matchers are now ordered
 * most-specific-first and `--sync` is gone: we poll on our own backoff schedule so a
 * non-matching pattern costs one short timeout, not the whole budget.
 *
 * WO-279 — placement is verified, not assumed. `--kiosk` Firefox holds
 * `_NET_WM_STATE_FULLSCREEN` (verified live via xprop on wid 0x1e0002d), and a fullscreen window's
 * geometry belongs to the WM: a single unverified `windowmove` can be silently dropped or undone
 * by Firefox's own kiosk/fullscreen transition, which is exactly the wrong-monitor symptom WO-279
 * was filed for. `placeKioskWindow` therefore moves, reads the resulting geometry back, and
 * retries with bounded backoff — escalating once to a FULLSCREEN off/move/on toggle, the standard
 * way to relocate a fullscreen window between monitors, using the xdotool already required here
 * rather than adding wmctrl.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { promisify } = require('util')
const { REPO_ROOT } = require('../repo-paths')
// resolveOperatorMonitorRect is imported from the SAME module (and is the SAME function) the
// pointer confinement uses — src/system/pointer-confine.js:17. WO-279 requirement 1: the kiosk
// window and the pointer barrier must never derive "the operator monitor" independently.
const { displaySessionEnv, resolveOperatorMonitorRect } = require('../utils/x-display-session')
const {
	resolveOperatorGuiChannel,
	resolveOperatorGuiChannelDims,
	resolveOperatorGuiMonitorRect,
	DEFAULT_GUI_URL,
} = require('./operator-gui-channel')
const { writeOperatorGuiScalePref } = require('./operator-gui-scale')

const execFileAsync = promisify(execFile)

const PROFILE_DIR = path.join(REPO_ROOT, '.operator-firefox-profile')
const FIREFOX_BINARIES = ['/usr/bin/firefox-esr', '/usr/bin/firefox']
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
const AUTO_LAUNCH_RETRIES = 5
const AUTO_LAUNCH_RETRY_MS = 10_000
// After a boot-time spawn, firefox that came up before X was ready exits within a couple of
// seconds — wait this long before trusting the pid as a successful launch.
const AUTO_LAUNCH_VERIFY_MS = 3000

/** @type {import('child_process').ChildProcess | null} */
let firefoxProc = null
let firefoxPid = null

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
function probeLaunchPhase(log, phase, extra = '') {
	const now = Date.now()
	const dt = launchSpawnAt == null ? '?' : String(now - launchSpawnAt)
	log?.('info', `[Operator GUI] timing: ${phase} t=${now} +${dt}ms${extra ? ` ${extra}` : ''}`)
}

function isRunning() {
	if (!firefoxPid) return false
	try {
		process.kill(firefoxPid, 0)
		return true
	} catch (_) {
		firefoxPid = null
		firefoxProc = null
		return false
	}
}

function resolveFirefoxBin() {
	for (const p of FIREFOX_BINARIES) {
		try {
			if (fs.statSync(p).isFile()) return p
		} catch (_) {
			/* try next candidate */
		}
	}
	return null
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

/**
 * @param {{ config: object, log?: Function }} ctx
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function raiseOperatorGuiBrowser(ctx) {
	const env = displaySessionEnv()
	const ids = await findFirefoxWindowIds(env)
	if (!ids.length) return { ok: false, reason: 'not_running' }
	const wid = ids[ids.length - 1]
	try {
		await execFileAsync('xdotool', ['windowactivate', wid], { env, timeout: SEARCH_TIMEOUT_MS })
		return { ok: true }
	} catch (e) {
		ctx?.log?.('warn', `[Operator GUI] raise failed: ${e?.message || e}`)
		return { ok: false, reason: 'xdotool_failed' }
	}
}

/**
 * POST /api/operator-gui/launch handler body. Raises the already-running instance instead of
 * spawning a second one (kiosk profiles are single-instance anyway — `--new-instance` just avoids
 * silently handing off to an unrelated already-running Firefox on the box).
 * @param {{ config: object, log?: Function }} ctx
 * @returns {Promise<{ ok: boolean, action?: 'launched'|'raised', pid?: number|null, reason?: string }>}
 */
async function launchOperatorGuiBrowser(ctx) {
	if (isRunning()) {
		const raised = await raiseOperatorGuiBrowser(ctx)
		return { ok: raised.ok, action: 'raised', pid: firefoxPid, reason: raised.reason }
	}

	const bin = resolveFirefoxBin()
	if (!bin) {
		ctx.log?.('warn', '[Operator GUI] launch: firefox-esr not installed')
		return { ok: false, reason: 'firefox_not_installed' }
	}

	const resolved = resolveOperatorGuiChannel(ctx.config)
	const guiUrl = resolved?.guiUrl || DEFAULT_GUI_URL

	try {
		fs.mkdirSync(PROFILE_DIR, { recursive: true })
	} catch (e) {
		ctx.log?.('warn', `[Operator GUI] launch: profile dir failed: ${e?.message || e}`)
		return { ok: false, reason: 'profile_dir_failed' }
	}

	// WO-310-ish (2026-07-21 report: "the gui has no scaling for 4k") — force Firefox's DPI-scale
	// pref to match the destination's resolution over the 1920x1080 CSS baseline, so buttons/text
	// read at a consistent physical size whether the operator_gui destination is 1080p or 2160p.
	const dims = resolveOperatorGuiChannelDims(ctx.config)
	const scaleRatio = writeOperatorGuiScalePref(PROFILE_DIR, dims, ctx.log)
	if (scaleRatio != null) {
		ctx.log?.('info', `[Operator GUI] launch: UI scale ${scaleRatio}x for ${dims?.width || '?'}x${dims?.height || '?'}`)
	}

	const env = displaySessionEnv()
	// child pid tracked below; a relaunch (isRunning() false — the old child already exited) simply
	// replaces the tracked proc/pid, no explicit kill needed.
	const child = spawn(bin, ['--kiosk', '--new-instance', '--profile', PROFILE_DIR, guiUrl], {
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	firefoxProc = child
	firefoxPid = child.pid
	launchSpawnAt = Date.now()
	probeLaunchPhase(ctx.log, 'kiosk spawned', `pid=${child.pid} bin=${bin}`)
	child.stdout.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) ctx.log?.('info', `[Operator GUI firefox] ${t}`)
	})
	child.stderr.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) ctx.log?.('info', `[Operator GUI firefox] ${t}`)
	})
	child.on('exit', (code, sig) => {
		ctx.log?.('warn', `[Operator GUI] firefox exited code=${code} sig=${sig}`)
		if (firefoxProc === child) {
			firefoxProc = null
			firefoxPid = null
		}
	})

	const monitorRect = resolveKioskMonitorRect(ctx.config)
	await positionFirefoxWindow(env, monitorRect, ctx.log)
	return { ok: true, action: 'launched', pid: firefoxPid }
}

/** @param {object} config @returns {object|null} the `operator_gui`-mode screen destination, if any */
function findOperatorGuiDestination(config) {
	const dests = config?.screenDestinations?.destinations
	if (!Array.isArray(dests)) return null
	return dests.find((d) => d && d.mode === 'operator_gui') || null
}

/**
 * WO-264 T264.1: pure boot-time auto-launch decision. Launch only when an operator_gui destination
 * is defined, its `autoLaunch` field (default true) isn't off, and a monitor resolves — an explicit
 * `physicalPort` on the destination counts (the generator honors it before the resolver, see
 * config-generator-operator-gui.js resolveOperatorGuiPort), otherwise resolveOperatorMonitorPort
 * decides. Mode 'none' (multiple displays, no screen_N_operator_monitor flag) deliberately does
 * NOT launch: guessing a monitor on a live multi-output box risks covering a program screen.
 * @param {object} config
 * @param {{ resolveMonitorPort?: (config: object) => { port: number|null, mode: string } }} [opts] injectable for offline tests
 * @returns {{ launch: boolean, reason: string }}
 */
function shouldAutoLaunchOperatorGui(config, opts = {}) {
	const dest = findOperatorGuiDestination(config)
	if (!dest) return { launch: false, reason: 'no_operator_gui_destination' }
	if (dest.autoLaunch === false) return { launch: false, reason: 'auto_launch_disabled' }
	if (Number.isFinite(dest.physicalPort)) return { launch: true, reason: 'explicit_port' }
	const resolveMonitorPort =
		opts.resolveMonitorPort || require('../utils/operator-monitor-resolve').resolveOperatorMonitorPort
	const resolved = resolveMonitorPort(config) || {}
	if (resolved.mode === 'none') return { launch: false, reason: 'no_monitor_resolved' }
	return { launch: true, reason: String(resolved.mode || 'resolved') }
}

/** @type {Promise<void>|null} in-flight auto-launch retry loop (at most one) */
let autoLaunchChain = null

/** @type {Promise<void>|null} in-flight boot monitor picker (at most one, never re-prompts) */
let bootPickerChain = null

/**
 * True when any channel has a live look on air — the picker must never paint over program.
 * On a genuinely fresh boot this is empty; a box that rebooted mid-show restores its live state
 * before routing-setup runs, so that case refuses too.
 * @returns {boolean}
 */
function anyLiveLookOnAir() {
	try {
		const st = require('../state/live-scene-state').getAll()
		return Object.values(st || {}).some((e) => (e?.scene?.layers || []).length > 0)
	} catch (_) {
		return false
	}
}

/**
 * WO-290 boot call site (owner request, todos21.07.26): fresh multi-display boot with no operator
 * monitor chosen → full-screen "press this to run the operator GUI on this screen" prompt on every
 * output. Fire-and-forget; a successful click persists the flag via configManager and re-enters
 * maybeAutoLaunchOperatorGui, which now resolves the monitor and launches.
 * @param {{ config: object, configManager?: object, log?: Function }} ctx
 */
function maybeRunBootMonitorPicker(ctx) {
	if (bootPickerChain) return
	const log = typeof ctx?.log === 'function' ? ctx.log : () => {}
	bootPickerChain = (async () => {
		const { runOperatorMonitorPicker } = require('./operator-monitor-picker')
		const res = await runOperatorMonitorPicker({
			config: ctx.config,
			log,
			freshBoot: true,
			playoutActive: anyLiveLookOnAir(),
			persist: (next) => {
				try {
					if (!ctx.configManager?.save) return false
					ctx.configManager.save(next)
					if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
					return true
				} catch (e) {
					log('error', `[Operator monitor picker] persist failed: ${e?.message || e}`)
					return false
				}
			},
		})
		if (res?.ok) {
			log('info', `[Operator GUI] monitor picked (${res.output}, port ${res.port}) — launching`)
			maybeAutoLaunchOperatorGui(ctx)
		}
	})()
		.catch((e) => log('warn', `[Operator monitor picker] ${e?.message || e}`))
		.finally(() => {
			/* deliberately NOT reset: one prompt per process. An abandoned picker (Esc/timeout) must
			 * not re-appear on every reconnect — the operator said no; the inspector Launch button
			 * and Device View flag remain the manual paths. */
		})
}

/**
 * WO-264 T264.2: fire-and-forget boot/reconnect auto-launch. Never throws and never blocks the
 * caller (routing-setup awaits nothing here) — the retry loop covers the `:0` X session coming up
 * after highascg at boot. On reconnects the isRunning() guard makes this a no-op, matching the
 * manual Launch button's raise-instead-of-respawn semantics.
 * @param {{ config: object, log?: Function }} ctx
 */
function maybeAutoLaunchOperatorGui(ctx) {
	try {
		if (process.env.NODE_TEST_CONTEXT) return
		if (isRunning() || autoLaunchChain) return
		const verdict = shouldAutoLaunchOperatorGui(ctx.config)
		if (!verdict.launch) {
			ctx?.log?.('info', `[Operator GUI] auto-start skipped: ${verdict.reason}`)
			// Fresh multi-display boot: nothing chose a monitor yet. Paint the WO-290 "press this to
			// run the operator GUI on this screen" prompt on every connected output; a click persists
			// screen_N_operator_monitor and re-enters this function, which then launches normally.
			// Every WO-290 hard gate still applies inside (configured / pinned / on-air all refuse).
			if (verdict.reason === 'no_monitor_resolved') maybeRunBootMonitorPicker(ctx)
			return
		}
		autoLaunchChain = (async () => {
			for (let attempt = 1; attempt <= AUTO_LAUNCH_RETRIES; attempt++) {
				try {
					if (isRunning()) return
					const res = await launchOperatorGuiBrowser(ctx)
					if (res?.ok && res.action !== 'launched') return
					if (res?.ok) {
						await new Promise((r) => setTimeout(r, AUTO_LAUNCH_VERIFY_MS))
						if (isRunning()) {
							ctx?.log?.('info', `[Operator GUI] auto-started (attempt ${attempt}, ${verdict.reason})`)
							return
						}
						ctx?.log?.('info', `[Operator GUI] auto-start attempt ${attempt}/${AUTO_LAUNCH_RETRIES}: firefox exited right after spawn (display not ready?)`)
					} else {
						ctx?.log?.('info', `[Operator GUI] auto-start attempt ${attempt}/${AUTO_LAUNCH_RETRIES} failed: ${res?.reason || 'unknown'}`)
					}
				} catch (e) {
					ctx?.log?.('info', `[Operator GUI] auto-start attempt ${attempt}/${AUTO_LAUNCH_RETRIES} threw: ${e?.message || e}`)
				}
				if (attempt < AUTO_LAUNCH_RETRIES) await new Promise((r) => setTimeout(r, AUTO_LAUNCH_RETRY_MS))
			}
			ctx?.log?.('warn', `[Operator GUI] auto-start gave up after ${AUTO_LAUNCH_RETRIES} attempts — use the inspector Launch button`)
		})().finally(() => {
			autoLaunchChain = null
		})
	} catch (e) {
		ctx?.log?.('warn', `[Operator GUI] auto-start: ${e?.message || e}`)
	}
}

module.exports = {
	launchOperatorGuiBrowser,
	maybeRunBootMonitorPicker,
	anyLiveLookOnAir,
	raiseOperatorGuiBrowser,
	shouldAutoLaunchOperatorGui,
	maybeAutoLaunchOperatorGui,
	PROFILE_DIR,
	// WO-279: pure/injectable placement parts — exercised offline by
	// tools/smoke/smoke-wo279-operator-gui-monitor-placement.test.js (no live X server).
	XDOTOOL_WINDOW_MATCHERS,
	PLACEMENT_ATTEMPTS,
	WINDOW_WAIT_ATTEMPTS,
	placementAttemptDelays,
	parseXdotoolGeometry,
	geometryMatches,
	formatRect,
	resolveKioskMonitorRect,
	placeKioskWindow,
	waitForFirefoxWindowIds,
	positionFirefoxWindow,
}
