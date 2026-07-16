/**
 * browser-source-session.js — WO-258 T258.1/T258.4: spawn/stop/reposition the real Firefox process
 * that backs one browser_display live source. Mirrors operator-gui-launcher.js's (WO-255 T255.2)
 * spawn/track-pid/exit-log/xdotool-position conventions — `displaySessionEnv()` (hardcoded
 * `DISPLAY: ':0'`) is reused UNCHANGED, which is itself evidence for the T258.0 "off-screen region
 * of :0" recommendation: a second Xvfb display would need a parallel `DISPLAY=:1` env variant this
 * file does not build.
 *
 * One Firefox process per browser_display source (dedicated profile dir per `sourceId`, unlike
 * operator-gui-launcher.js's single global PROFILE_DIR — multiple browser sources can coexist).
 * Window identification uses `xdotool search --pid <spawned pid>` rather than
 * operator-gui-launcher.js's `--class Navigator` — WO-255 only ever manages ONE Firefox instance, so
 * class matching (with a same-class fallback) was unambiguous; N simultaneous browser_display
 * sources would all report `WM_CLASS Navigator`, so PID-scoped search is required here (probe-verified
 * on Xvfb :77, 2026-07-16: `xdotool search --pid <PID>` reliably returns only that process's window).
 *
 * T258.4 "grab-vs-move" (the other half lives in browser-capture-bridge.js's
 * restartBrowserCaptureBridge — see that file's header for the full design rationale):
 * `moveBrowserSourceToOperator` xdotool-windowmoves the REAL window from its off-screen capture
 * region onto the operator's monitor and activates it for native input; `returnBrowserSourceToOffscreen`
 * reverses it. Callers are expected to pair each with a capture-bridge restart at the matching region
 * so the on-air feed keeps tracking the window instead of showing an empty dead zone.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { promisify } = require('util')
const { REPO_ROOT } = require('../repo-paths')
const { displaySessionEnv } = require('../utils/x-display-session')

const execFileAsync = promisify(execFile)

const PROFILE_ROOT = path.join(REPO_ROOT, '.browser-source-profiles')
const FIREFOX_BINARIES = ['/usr/bin/firefox-esr', '/usr/bin/firefox']
const WINDOW_SEARCH_TIMEOUT_MS = 5000
const FIRST_WINDOW_SEARCH_TIMEOUT_MS = 20000
const FIRST_WINDOW_POLL_INTERVAL_MS = 500

/** @type {Map<string, { proc: import('child_process').ChildProcess|null, pid: number|null, url: string, width: number, height: number, region: object|null, interacting: boolean }>} */
const _sessions = new Map()

/**
 * @param {string} raw
 * @returns {string}
 */
function slugSourceId(raw) {
	return (
		String(raw || 'browser')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 48) || 'browser'
	)
}

/**
 * @param {string} sourceId
 * @returns {string}
 */
function profileDirFor(sourceId) {
	return path.join(PROFILE_ROOT, slugSourceId(sourceId))
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
 * @param {string} id
 */
function isSessionRunning(id) {
	const s = _sessions.get(id)
	if (!s?.pid) return false
	try {
		process.kill(s.pid, 0)
		return true
	} catch (_) {
		s.proc = null
		s.pid = null
		return false
	}
}

/**
 * @param {object} env
 * @param {number} pid
 * @param {number} [timeout]
 * @returns {Promise<string|null>}
 */
async function findWindowIdByPid(env, pid, timeout = WINDOW_SEARCH_TIMEOUT_MS) {
	try {
		const { stdout } = await execFileAsync('xdotool', ['search', '--pid', String(pid)], { env, timeout })
		const ids = String(stdout || '')
			.trim()
			.split(/\s+/)
			.filter(Boolean)
		return ids.length ? ids[ids.length - 1] : null
	} catch (_) {
		return null
	}
}

/**
 * @param {object} env
 * @param {number} pid
 * @param {number} timeout
 * @returns {Promise<string|null>}
 */
async function waitForWindowIdByPid(env, pid, timeout) {
	const deadline = Date.now() + timeout
	while (Date.now() < deadline) {
		const wid = await findWindowIdByPid(env, pid, 3000)
		if (wid) return wid
		await new Promise((r) => setTimeout(r, FIRST_WINDOW_POLL_INTERVAL_MS))
	}
	return null
}

/**
 * @param {object} env
 * @param {string} wid
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {Function} [log]
 */
async function positionWindow(env, wid, rect, log) {
	try {
		await execFileAsync('xdotool', ['windowmove', wid, String(rect.x), String(rect.y)], {
			env,
			timeout: WINDOW_SEARCH_TIMEOUT_MS,
		})
		await execFileAsync('xdotool', ['windowsize', wid, String(rect.w), String(rect.h)], {
			env,
			timeout: WINDOW_SEARCH_TIMEOUT_MS,
		})
	} catch (e) {
		log?.('warn', `[browser-source] windowmove/windowsize failed: ${e?.message || e}`)
	}
}

/**
 * Spawn (or verify already-running) Firefox for one browser_display source, kiosk-sized to the
 * source's declared WxH, positioned at `region` (the T258.0 off-screen dead zone). Relaunch policy:
 * a no-op when already running with the same URL; a full stop+relaunch when the URL changed or the
 * process died; `opts.force` always relaunches.
 * @param {{ config: object, log?: Function }} ctx
 * @param {{ sourceId: string, url: string, width?: number, height?: number }} item
 * @param {{ x: number, y: number, w: number, h: number }} region
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, action?: string, pid?: number|null, reason?: string }>}
 */
async function launchBrowserSource(ctx, item, region, opts = {}) {
	const id = String(item?.sourceId || '').trim()
	const url = String(item?.url || '').trim()
	if (!id || !url) return { ok: false, reason: 'missing_source_id_or_url' }
	const width = Math.max(160, parseInt(String(item.width ?? region?.w ?? 1920), 10) || 1920)
	const height = Math.max(120, parseInt(String(item.height ?? region?.h ?? 1080), 10) || 1080)

	const existing = _sessions.get(id)
	if (!opts.force && existing && isSessionRunning(id) && existing.url === url) {
		return { ok: true, action: 'already_running', pid: existing.pid }
	}
	if (existing?.pid) stopBrowserSource(id)

	const bin = resolveFirefoxBin()
	if (!bin) {
		ctx?.log?.('warn', '[browser-source] launch: firefox-esr not installed')
		return { ok: false, reason: 'firefox_not_installed' }
	}
	const profileDir = profileDirFor(id)
	try {
		fs.mkdirSync(profileDir, { recursive: true })
	} catch (e) {
		ctx?.log?.('warn', `[browser-source] launch: profile dir failed: ${e?.message || e}`)
		return { ok: false, reason: 'profile_dir_failed' }
	}

	const env = displaySessionEnv()
	const child = spawn(
		bin,
		['--kiosk', '--no-remote', '--new-instance', '--profile', profileDir, url],
		{ env, stdio: ['ignore', 'pipe', 'pipe'] },
	)
	const session = { proc: child, pid: child.pid, url, width, height, region: region || null, interacting: false }
	_sessions.set(id, session)

	child.stdout.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) ctx?.log?.('debug', `[browser-source ${id}] ${t}`)
	})
	child.stderr.on('data', (chunk) => {
		const t = String(chunk).trim()
		if (t) ctx?.log?.('debug', `[browser-source ${id}] ${t}`)
	})
	child.on('exit', (code, sig) => {
		ctx?.log?.('warn', `[browser-source] ${id} firefox exited code=${code} sig=${sig}`)
		const cur = _sessions.get(id)
		if (cur && cur.proc === child) {
			cur.proc = null
			cur.pid = null
		}
	})

	if (region) {
		const wid = await waitForWindowIdByPid(env, child.pid, FIRST_WINDOW_SEARCH_TIMEOUT_MS)
		if (wid) {
			await positionWindow(env, wid, region, ctx?.log)
		} else {
			ctx?.log?.('warn', `[browser-source] ${id}: no window found within ${FIRST_WINDOW_SEARCH_TIMEOUT_MS}ms`)
		}
	}
	return { ok: true, action: 'launched', pid: child.pid }
}

/**
 * @param {string} sourceId
 */
function stopBrowserSource(sourceId) {
	const id = String(sourceId || '').trim()
	const s = _sessions.get(id)
	if (!s) return
	if (s.pid) {
		try {
			process.kill(s.pid, 'SIGTERM')
		} catch (_) {
			/* already gone */
		}
	}
	_sessions.delete(id)
}

function stopAllBrowserSources() {
	for (const id of [..._sessions.keys()]) stopBrowserSource(id)
}

/**
 * T258.4: move the real window from its off-screen capture region onto the operator's monitor and
 * activate it for native mouse/keyboard input. Pair with `restartBrowserCaptureBridge` at the same
 * rect so the on-air feed keeps showing this window instead of the now-empty dead zone.
 * @param {{ config: object, log?: Function }} ctx
 * @param {string} sourceId
 * @param {{ x: number, y: number, w: number, h: number }} operatorRect
 */
async function moveBrowserSourceToOperator(ctx, sourceId, operatorRect) {
	const id = String(sourceId || '').trim()
	const s = _sessions.get(id)
	if (!s?.pid || !isSessionRunning(id)) return { ok: false, reason: 'not_running' }
	const env = displaySessionEnv()
	const wid = await findWindowIdByPid(env, s.pid)
	if (!wid) return { ok: false, reason: 'window_not_found' }
	await positionWindow(env, wid, operatorRect, ctx?.log)
	try {
		await execFileAsync('xdotool', ['windowactivate', wid], { env, timeout: WINDOW_SEARCH_TIMEOUT_MS })
	} catch (e) {
		ctx?.log?.('warn', `[browser-source] ${id}: windowactivate failed: ${e?.message || e}`)
	}
	s.interacting = true
	return { ok: true }
}

/**
 * T258.4: move the window back to its off-screen capture region. Pair with
 * `restartBrowserCaptureBridge` at the source's original dead-zone region.
 * @param {{ config: object, log?: Function }} ctx
 * @param {string} sourceId
 */
async function returnBrowserSourceToOffscreen(ctx, sourceId) {
	const id = String(sourceId || '').trim()
	const s = _sessions.get(id)
	if (!s?.pid || !isSessionRunning(id)) return { ok: false, reason: 'not_running' }
	if (!s.region) return { ok: false, reason: 'no_offscreen_region' }
	const env = displaySessionEnv()
	const wid = await findWindowIdByPid(env, s.pid)
	if (!wid) return { ok: false, reason: 'window_not_found' }
	await positionWindow(env, wid, s.region, ctx?.log)
	s.interacting = false
	return { ok: true }
}

/**
 * @param {string} sourceId
 */
function browserSourceStats(sourceId) {
	const id = String(sourceId || '').trim()
	const s = _sessions.get(id)
	if (!s) return { running: false }
	return {
		running: isSessionRunning(id),
		pid: s.pid,
		url: s.url,
		width: s.width,
		height: s.height,
		region: s.region,
		interacting: !!s.interacting,
	}
}

/** Test-only: clear module state between smoke test cases. */
function resetBrowserSourceSessionStateForTests() {
	_sessions.clear()
}

module.exports = {
	PROFILE_ROOT,
	slugSourceId,
	profileDirFor,
	launchBrowserSource,
	stopBrowserSource,
	stopAllBrowserSources,
	moveBrowserSourceToOperator,
	returnBrowserSourceToOffscreen,
	browserSourceStats,
	resetBrowserSourceSessionStateForTests,
}
