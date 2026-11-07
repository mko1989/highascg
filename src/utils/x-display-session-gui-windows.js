'use strict'

const { execFile } = require('child_process')
const { promisify } = require('util')
const { resolveOperatorDisplayRect } = require('./x-display-session-layout')
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
		// WO-805: no --sync (a pointer already parked here never "moves" → 5 s timeout, then a false failure)
		await execFileAsync('xdotool', ['mousemove', String(cx), String(cy)], { env, timeout: 5000 })
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
	const winClasses = windowClassesFor(action)
	if (!winClasses.length || !(await commandExists('xdotool'))) return []
	const env = displaySessionEnv()
	/** @type {Set<string>} */
	const found = new Set()
	for (const winClass of winClasses) {
		for (const flag of ['--class', '--classname']) {
			try {
				/* Owner 27.07: '--onlyvisible' excludes ICONIFIED windows — a minimized helper
				 * vanished from the taskbar and got reaped. includeHidden keeps it listed. */
				const searchArgs = opts.includeHidden === true ? ['search', flag, winClass] : ['search', '--onlyvisible', flag, winClass]
				const { stdout } = await execFileAsync('xdotool', searchArgs, {
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
 * @param {string} action
 * @param {object} config
 * @param {{ log?: Function }} [opts]
 * @returns {Promise<boolean>}
 */
async function raiseOperatorGuiWindows(action, config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const rect = resolveOperatorDisplayRect(config)
	const winClasses = windowClassesFor(action)
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

/**
 * WO-387. The window-class candidates for an action. The five WO-283 tools keep their curated
 * entries below — hand-checked res_name/res_class values that no .desktop file states (Firefox's
 * `Navigator`, the DeckLink tools' shared `DesktopVideo`) — while an `app:<id>` action gets its
 * classes from the installed .desktop entry's `StartupWMClass`. Same contract either way: whatever
 * comes back is what the helper watchdog will find, promote, park and reap.
 * @param {string} action
 * @returns {string[]}
 */
function windowClassesFor(action) {
	const raw = GUI_WINDOW_CLASS[action]
	if (raw) return Array.isArray(raw) ? raw : [raw]
	if (!String(action || '').startsWith('app:')) return []
	try {
		return require('./desktop-app-catalog').resolveAppWindowClasses(action)
	} catch {
		return [] // catalog unavailable — behave as an unknown action rather than throwing into X code
	}
}

/** @type {Record<string, string | string[]>} */
const GUI_WINDOW_CLASS = {
	'nvidia-settings': 'nvidia-settings',
	desktopvideo_setup: 'DesktopVideo',
	desktop_video_updater: 'DesktopVideo',
	alsamixer: 'Alsamixer',
	'os-password': 'highascg-passwd', // WO-811 phase 3: the passwd terminal's private class (terminalArgv)
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
	windowClassesFor,
	findGuiWindowIds,
	raiseOperatorGuiWindows,
	positionGuiWindowForAction,
	scheduleGuiWindowPosition,
}
