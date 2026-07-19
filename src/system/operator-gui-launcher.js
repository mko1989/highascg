/**
 * operator-gui-launcher.js — WO-255 T255.2: launch/raise the fullscreen Firefox-ESR process that
 * hosts the operator GUI web page. Firefox runs 100% native (no CEF, no compositor) — the operator
 * GUI Caspar channel's screen consumer window sits shaped ABOVE it (operator-shape-overlay.js).
 *
 * xdotool window-match: Firefox's WM_CLASS on this box is "Navigator" — an already-working
 * convention in this codebase (GUI_WINDOW_CLASS.firefox in src/utils/x-display-session-runtime.js,
 * used by the unrelated Settings -> Open browser feature against the SAME firefox-esr install).
 * `--class firefox` (as a literal string) does not match that convention, so both are tried,
 * "Navigator" first, "firefox" as a fallback in case a future ESR build changes it.
 *
 * NOTE: the windowmove/windowsize/windowactivate sequence below has NOT been exercised against the
 * live :0 display (constraint: this box is live, don't launch firefox or run the shape helper
 * against it) — A255.1 (owner) is the actual live verification step. `--kiosk` firefox usually
 * accepts a post-launch resize/reposition via xdotool (widely used pattern), but if the window
 * manager on this box holds it in a true `_NET_WM_STATE_FULLSCREEN` state that ignores
 * windowsize/windowmove, that would need a follow-up fix (e.g. `wmctrl -r :ACTIVE: -b remove,fullscreen`
 * before resizing) — left as a documented risk, not silently papered over.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { promisify } = require('util')
const { REPO_ROOT } = require('../repo-paths')
const { displaySessionEnv } = require('../utils/x-display-session')
const { resolveOperatorGuiChannel, resolveOperatorGuiMonitorRect, DEFAULT_GUI_URL } = require('./operator-gui-channel')

const execFileAsync = promisify(execFile)

const PROFILE_DIR = path.join(REPO_ROOT, '.operator-firefox-profile')
const FIREFOX_BINARIES = ['/usr/bin/firefox-esr', '/usr/bin/firefox']
const XDOTOOL_FIREFOX_CLASSES = ['Navigator', 'firefox']
const FIRST_SEARCH_TIMEOUT_MS = 8000
const SEARCH_TIMEOUT_MS = 5000
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
 * @param {object} env
 * @param {number} [timeout]
 * @returns {Promise<string[]>} xdotool window ids, most-recently-created last (xdotool's own order)
 */
async function findFirefoxWindowIds(env, timeout = SEARCH_TIMEOUT_MS) {
	for (const cls of XDOTOOL_FIREFOX_CLASSES) {
		try {
			const { stdout } = await execFileAsync('xdotool', ['search', '--sync', '--onlyvisible', '--class', cls], {
				env,
				timeout,
			})
			const ids = String(stdout || '')
				.trim()
				.split(/\s+/)
				.filter(Boolean)
			if (ids.length) return ids
		} catch (_) {
			/* no windows for this class yet — try the next class */
		}
	}
	return []
}

/**
 * @param {object} env
 * @param {{x:number,y:number,w:number,h:number}|null} monitorRect
 * @param {Function} [log]
 * @param {number} [timeout]
 */
async function positionFirefoxWindow(env, monitorRect, log, timeout = FIRST_SEARCH_TIMEOUT_MS) {
	const ids = await findFirefoxWindowIds(env, timeout)
	if (!ids.length) {
		log?.('warn', '[Operator GUI] launch: no Firefox window found to position')
		return false
	}
	const wid = ids[ids.length - 1]
	probeLaunchPhase(log, 'kiosk window found', `wid=${wid} candidates=${ids.length}`)
	if (monitorRect && monitorRect.w > 0 && monitorRect.h > 0) {
		try {
			await execFileAsync('xdotool', ['windowmove', wid, String(monitorRect.x), String(monitorRect.y)], {
				env,
				timeout: SEARCH_TIMEOUT_MS,
			})
			await execFileAsync('xdotool', ['windowsize', wid, String(monitorRect.w), String(monitorRect.h)], {
				env,
				timeout: SEARCH_TIMEOUT_MS,
			})
		} catch (e) {
			log?.('warn', `[Operator GUI] launch: windowmove/windowsize failed: ${e?.message || e}`)
		}
	}
	try {
		await execFileAsync('xdotool', ['windowactivate', wid], { env, timeout: SEARCH_TIMEOUT_MS })
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

	const monitorRect = resolveOperatorGuiMonitorRect(ctx.config)
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
	raiseOperatorGuiBrowser,
	shouldAutoLaunchOperatorGui,
	maybeAutoLaunchOperatorGui,
	PROFILE_DIR,
}
