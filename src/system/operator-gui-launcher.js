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

/** @type {import('child_process').ChildProcess | null} */
let firefoxProc = null
let firefoxPid = null

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

module.exports = { launchOperatorGuiBrowser, raiseOperatorGuiBrowser, PROFILE_DIR }
