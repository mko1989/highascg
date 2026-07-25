'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { REPO_ROOT } = require('../repo-paths')
const { resolveOperatorDisplayRect, resolveHelperWindowRect } = require('./x-display-session-layout')
const { displaySessionEnv, commandExists } = require('./x-display-session-runtime-env')

const execFileAsync = promisify(execFile)

async function parkPointerOnOperatorDisplay(config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const rect = resolveOperatorDisplayRect(config, opts.layout)
	if (!rect || !(await commandExists('xdotool'))) return false
	const env = displaySessionEnv()
	const cx = rect.x + Math.floor(rect.width / 2)
	const cy = rect.y + Math.floor(rect.height / 2)
	try {
		await execFileAsync('xdotool', ['mousemove', '--sync', String(cx), String(cy)], { env, timeout: 5000 })
		log('info', `[X-Display] Pointer parked @ ${cx},${cy} (${rect.sysId || 'operator'})`)
		return true
	} catch (e) {
		log('warn', `[X-Display] park pointer failed: ${e?.message || e}`)
		return false
	}
}

/**
 * WO-283. Find the currently mapped X window ids for a GUI action, without touching them.
 *
 * Two things this does that `raiseOperatorGuiWindows`'s inline search does not, both required for
 * the operator-helper path:
 *
 *  - SEARCHES BOTH `--class` (res_class) AND `--classname` (res_name). GUI_WINDOW_CLASS.firefox is
 *    `'Navigator'`, which is Firefox-ESR's res_NAME on this box — `xdotool search --class Navigator`
 *    matches NOTHING here (verified live), while `--class firefox-esr-esr140` matches. Same
 *    res_name/res_class confusion WO-279 hit in operator-gui-launcher.js.
 *  - EXCLUDES THE KIOSK BY TITLE. The operator helper Firefox is the same binary as the kiosk, so
 *    it has the identical WM_CLASS and no class-based filter can separate them. Without
 *    `excludeTitle` the 'firefox' action would match the kiosk itself: the watchdog would see a
 *    window forever (never restoring), and the promote would slap `_NET_WM_STATE_ABOVE` on the
 *    kiosk. The kiosk is identified by the OPERATOR_TITLE_MARKER its page forces into the window
 *    title — the same marker the shape helper matches on.
 *
 * @param {string} action
 * @param {{ excludeTitle?: string, withNames?: boolean }} [opts]
 * @returns {Promise<string[] | { id: string, name: string }[]>} ids, or `{id,name}` with `withNames`
 *   (the caller needs titles to tell a real helper window from a "Close Firefox" profile-lock modal)
 */
async function findGuiWindowIds(action, opts = {}) {
	const winClassRaw = GUI_WINDOW_CLASS[action]
	const winClasses = Array.isArray(winClassRaw) ? winClassRaw : winClassRaw ? [winClassRaw] : []
	if (!winClasses.length || !(await commandExists('xdotool'))) return []
	const env = displaySessionEnv()
	/** @type {Set<string>} */
	const found = new Set()
	for (const winClass of winClasses) {
		for (const flag of ['--class', '--classname']) {
			try {
				const { stdout } = await execFileAsync('xdotool', ['search', '--onlyvisible', flag, winClass], {
					env,
					timeout: 3000,
				})
				for (const id of String(stdout || '').trim().split(/\s+/).filter(Boolean)) found.add(id)
			} catch {
				/* no window matched this flag/pattern pair */
			}
		}
	}
	if (!found.size) return []

	// The kiosk process owns MORE than the marker-titled window. Live on this box the kiosk PID also
	// owns a 1x1 off-screen window at -99,-99 titled just "Firefox" — no marker in its title, so a
	// title-only filter lets it through. If that window is ever accepted as "the helper", the
	// watchdog sees a helper window forever and NEVER restores the kiosk. So exclude the whole kiosk
	// PID, and drop windows too small to be a thing the operator could use.
	const kioskPid = opts.excludeTitle ? await findWindowPidByTitle(opts.excludeTitle, env) : null

	/** @type {{ id: string, name: string }[]} */
	const kept = []
	for (const wid of found) {
		let name = ''
		try {
			const { stdout } = await execFileAsync('xdotool', ['getwindowname', wid], { env, timeout: 3000 })
			name = String(stdout || '').trim()
		} catch {
			/* unnamed window — cannot be the marker-carrying kiosk, keep it */
		}
		if (opts.excludeTitle && name.includes(opts.excludeTitle)) continue
		if (kioskPid && (await getWindowPid(wid, env)) === kioskPid) continue
		if (!(await isUsableWindowSize(wid, env))) continue
		kept.push({ id: wid, name })
	}
	return opts.withNames ? kept : kept.map((w) => w.id)
}

/** @returns {Promise<string|null>} the _NET_WM_PID of the first window whose title contains `title` */
async function findWindowPidByTitle(title, env) {
	try {
		const { stdout } = await execFileAsync('xdotool', ['search', '--name', title], { env, timeout: 3000 })
		for (const id of String(stdout || '').trim().split(/\s+/).filter(Boolean)) {
			const pid = await getWindowPid(id, env)
			if (pid) return pid
		}
	} catch {
		/* no kiosk window found — nothing to exclude by PID */
	}
	return null
}

/** @returns {Promise<string|null>} */
async function getWindowPid(wid, env) {
	try {
		const { stdout } = await execFileAsync('xdotool', ['getwindowpid', wid], { env, timeout: 3000 })
		return String(stdout || '').trim() || null
	} catch {
		return null
	}
}

/** A window the operator can actually see and use — not a 1x1 IPC/marker window. @readonly */
const MIN_USABLE_WINDOW_W = 80
const MIN_USABLE_WINDOW_H = 40

/** @returns {Promise<boolean>} */
async function isUsableWindowSize(wid, env) {
	try {
		const { stdout } = await execFileAsync('xdotool', ['getwindowgeometry', '--shell', wid], { env, timeout: 3000 })
		const w = Number(/^WIDTH=(\d+)$/m.exec(String(stdout))?.[1])
		const h = Number(/^HEIGHT=(\d+)$/m.exec(String(stdout))?.[1])
		if (!Number.isFinite(w) || !Number.isFinite(h)) return true
		return w >= MIN_USABLE_WINDOW_W && h >= MIN_USABLE_WINDOW_H
	} catch {
		return true // cannot measure — do not throw away a possibly good window
	}
}

/**
 * WO-283. Put a helper window OVER the operator kiosk and give it focus.
 *
 * Why this is not just `windowraise`: the kiosk client permanently carries `_NET_WM_STATE_ABOVE`
 * (set by tools/runtime/operator-shape-overlay.py's `lock_window_above`; verified live with
 * `xprop -id <kiosk> _NET_WM_STATE`), and Openbox clamps every restack request to the window's own
 * layer. A NORMAL-layer helper therefore CANNOT be raised over it — the raise silently does
 * nothing. So we promote the helper into the same ABOVE layer first, then raise, then focus.
 * `windowactivate` last is load-bearing too: the kiosk's FULLSCREEN state lifts it into Openbox's
 * fullscreen layer only while it is FOCUSED, so handing focus to the helper drops the kiosk back
 * to ABOVE where the helper can actually sit on top.
 *
 * Separate from {@link raiseOperatorGuiWindows} on purpose: that one is the pre-existing
 * gui-launch path and keeps its exact behaviour, so nothing is promoted unless the operator asked.
 *
 * @param {string} action
 * @param {object} config
 * @param {{ log?: Function, excludeTitle?: string }} [opts]
 * @returns {Promise<boolean>}
 */
async function promoteGuiWindowsAboveKiosk(action, config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const ids = await findGuiWindowIds(action, { excludeTitle: opts.excludeTitle })
	if (!ids.length) return false
	const env = displaySessionEnv()
	// PLACEMENT IS THE THING THAT KEEPS PGM CLEAR — not the stacking. Since PGM screen consumers also
	// default to always-on-top, helper and PGM share the ABOVE layer and raise order alone can no
	// longer protect program output. `resolveHelperWindowRect` pins the helper INSIDE the operator
	// monitor (the shared `resolveOperatorMonitorRect` SSOT) and refuses to place at all when that
	// monitor is unknown. It deliberately replaces `resolveOperatorDisplayRect` here: that helper's
	// documented fallback is the FIRST PGM SCREEN CONSUMER HEAD, i.e. it moved helpers onto air.
	const placement = resolveHelperWindowRect(config)
	const rect = placement.rect
	// ABOVE-promotion goes through the python/EWMH helper, NOT `xdotool windowstate`: that
	// subcommand only exists in xdotool >= 3.20211022 and this box ships 3.20160805.1, where it
	// errors with "Unknown command: windowstate". The old `.catch(() => {})` hid that, so the one
	// step that makes WO-283 work was a silent no-op and the helper stayed stuck under the kiosk.
	const promoter = resolveWindowAbovePromoter()
	let promoted = 0
	for (const wid of ids) {
		let ok = false
		if (promoter) {
			try {
				await execFileAsync('python3', [promoter, wid], { env, timeout: 5000 })
				ok = true
			} catch (e) {
				log('warn', `[X-Display] ABOVE promote helper failed for ${wid}: ${e?.message || e}`)
			}
		}
		if (!ok) {
			// Only useful on a newer xdotool; harmless (and still logged) where the verb is missing.
			await execFileAsync('xdotool', ['windowstate', '--add', 'ABOVE', wid], { env, timeout: 3000 }).catch((e) =>
				log('warn', `[X-Display] xdotool windowstate fallback failed for ${wid}: ${e?.message || e}`),
			)
		}
		if (ok) promoted += 1
		await execFileAsync('xdotool', ['windowraise', wid], { env, timeout: 3000 }).catch(() => {})
		if (rect) {
			// Move AND size. Moving alone left a window wider than the operator head hanging over the
			// neighbouring output — on this box that neighbour is the program head.
			await execFileAsync('xdotool', ['windowmove', wid, String(rect.x), String(rect.y)], { env, timeout: 3000 }).catch(
				() => {},
			)
			await execFileAsync('xdotool', ['windowsize', wid, String(rect.width), String(rect.height)], {
				env,
				timeout: 3000,
			}).catch(() => {})
		}
		await execFileAsync('xdotool', ['windowactivate', wid], { env, timeout: 3000 }).catch(() => {})
	}
	if (rect) {
		log('info', `[X-Display] Helper ${action} confined to the operator monitor @ ${rect.x},${rect.y} ${rect.width}x${rect.height}`)
	} else {
		// Loud, because this is the state in which a helper CAN end up over program output: we do not
		// know where the operator monitor is, so we leave the window wherever the app opened it rather
		// than guess (guessing is what put a browser on PGM in the first place).
		log(
			'warn',
			`[X-Display] Helper ${action} NOT repositioned (${placement.reason}) — cannot guarantee it stays off the ${placement.programRects.length} program consumer head(s); set Device View → GPU port → Operator monitor`,
		)
	}
	log(
		promoted === ids.length ? 'info' : 'warn',
		`[X-Display] Promoted ${action} ABOVE the kiosk (${promoted}/${ids.length} window(s) got the ABOVE layer)`,
	)
	return true
}

/** @returns {string|null} tools/runtime/highascg-window-above.py, or its installed copy */
function resolveWindowAbovePromoter() {
	for (const p of [
		path.join(REPO_ROOT, 'tools/runtime/highascg-window-above.py'),
		'/usr/local/lib/highascg/highascg-window-above.py',
		'/usr/local/bin/highascg-window-above.py',
	]) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * @param {string} action
 * @param {object} config
 * @param {{ log?: Function }} [opts]
 * @returns {Promise<boolean>}
 */
async function raiseOperatorGuiWindows(action, config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const rect = resolveOperatorDisplayRect(config)
	const winClassRaw = GUI_WINDOW_CLASS[action]
	const winClasses = Array.isArray(winClassRaw) ? winClassRaw : winClassRaw ? [winClassRaw] : []
	if (!winClasses.length || !(await commandExists('xdotool'))) return false
	const env = displaySessionEnv()
	const x = rect ? rect.x + Math.max(0, Math.floor(rect.width * 0.05)) : 0
	const y = rect ? rect.y + Math.max(0, Math.floor(rect.height * 0.05)) : 0

	for (const winClass of winClasses) {
		/** @type {string[]} */
		let ids = []
		for (const searchArgs of [['search', '--class', winClass], ['search', '--class', winClass, '--onlyvisible']]) {
			try {
				const { stdout } = await execFileAsync('xdotool', searchArgs, { env, timeout: 3000 })
				ids = String(stdout || '')
					.trim()
					.split(/\s+/)
					.filter(Boolean)
				if (ids.length) break
			} catch {
				/* try next search mode */
			}
		}
		if (!ids.length) continue
		for (const wid of ids) {
			await execFileAsync('xdotool', ['windowraise', wid], { env, timeout: 3000 }).catch(() => {})
			if (rect) {
				await execFileAsync('xdotool', ['windowmove', wid, String(x), String(y)], { env, timeout: 3000 }).catch(() => {})
			}
			await execFileAsync('xdotool', ['windowactivate', wid], { env, timeout: 3000 }).catch(() => {})
		}
		log('info', `[X-Display] Raised ${action} (${ids.length} window(s))`)
		return true
	}
	return false
}

/** @type {Record<string, string | string[]>} */
const GUI_WINDOW_CLASS = {
	'nvidia-settings': 'nvidia-settings',
	desktopvideo_setup: 'DesktopVideo',
	desktop_video_updater: 'DesktopVideo',
	alsamixer: 'Alsamixer',
	// 'Navigator' is Firefox-ESR's res_NAME for a real browser window on this box. 'Firefox' is the
	// res_name its DIALOGS use — including the "Close Firefox" profile-lock modal, which we WANT the
	// lookup to see so it can be raised for the operator to dismiss instead of hiding under the
	// kiosk. Safe only because findGuiWindowIds now excludes the kiosk PID and 1x1 windows: the
	// kiosk's own stray 1x1 "Firefox" window also carries res_name 'Firefox'.
	firefox: ['Navigator', 'Firefox'],
	'file-manager': ['Thunar', 'Pcmanfm', 'Nautilus', 'Dolphin'],
	calamares: 'calamares',
}

/**
 * Move a spawned GUI tool onto the operator head (retry until window exists).
 * @param {string} action
 * @param {object} config
 * @param {{ log?: Function }} [opts]
 */
async function positionGuiWindowForAction(action, config, opts = {}) {
	for (let attempt = 0; attempt < 8; attempt++) {
		await new Promise((r) => setTimeout(r, attempt === 0 ? 400 : 350))
		if (await raiseOperatorGuiWindows(action, config, opts)) return true
	}
	return false
}

/**
 * Schedule GUI reposition without blocking the HTTP handler.
 * @param {string} action
 * @param {object} config
 * @param {{ log?: Function }} [opts]
 */
function scheduleGuiWindowPosition(action, config, opts = {}) {
	setTimeout(() => {
		positionGuiWindowForAction(action, config, opts).catch(() => {})
	}, 0)
}

module.exports = {
	parkPointerOnOperatorDisplay,
	findGuiWindowIds,
	raiseOperatorGuiWindows,
	resolveWindowAbovePromoter,
	promoteGuiWindowsAboveKiosk,
	positionGuiWindowForAction,
	scheduleGuiWindowPosition,
}
