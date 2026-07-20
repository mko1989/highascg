'use strict'

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { REPO_ROOT } = require('../repo-paths')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const { getXAuthority } = require('./hardware-info')
const {
	resolveNvidiaXApplyScript,
	buildNvidiaDisplayPolicyShellLines,
	applyNvidiaDisplayPolicy,
} = require('./nvidia-display-policy')
const {
	isOperatorPointerConfineDesired,
	resolveOperatorMonitorRect,
	resolveOperatorDisplayRect,
	nvidiaSyncToDisplayPortIndex,
	readCasparSetting,
} = require('./x-display-session-layout')

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
 * @param {{ excludeTitle?: string }} [opts]
 * @returns {Promise<string[]>}
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
	if (!found.size || !opts.excludeTitle) return [...found]

	/** @type {string[]} */
	const kept = []
	for (const wid of found) {
		let name = ''
		try {
			const { stdout } = await execFileAsync('xdotool', ['getwindowname', wid], { env, timeout: 3000 })
			name = String(stdout || '')
		} catch {
			/* unnamed window — cannot be the marker-carrying kiosk, keep it */
		}
		if (!name.includes(opts.excludeTitle)) kept.push(wid)
	}
	return kept
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
	const rect = resolveOperatorDisplayRect(config)
	const x = rect ? rect.x + Math.max(0, Math.floor(rect.width * 0.05)) : 0
	const y = rect ? rect.y + Math.max(0, Math.floor(rect.height * 0.05)) : 0
	for (const wid of ids) {
		await execFileAsync('xdotool', ['windowstate', '--add', 'ABOVE', wid], { env, timeout: 3000 }).catch(() => {})
		await execFileAsync('xdotool', ['windowraise', wid], { env, timeout: 3000 }).catch(() => {})
		if (rect) {
			await execFileAsync('xdotool', ['windowmove', wid, String(x), String(y)], { env, timeout: 3000 }).catch(() => {})
		}
		await execFileAsync('xdotool', ['windowactivate', wid], { env, timeout: 3000 }).catch(() => {})
	}
	log('info', `[X-Display] Promoted ${action} ABOVE the kiosk (${ids.length} window(s))`)
	return true
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
	firefox: 'Navigator',
	'file-manager': ['Thunar', 'Pcmanfm', 'Nautilus', 'Dolphin'],
	calamares: 'calamares',
}
function displaySessionEnv() {
	return {
		...process.env,
		DISPLAY: ':0',
		XAUTHORITY: getXAuthority(),
	}
}

async function commandExists(bin) {
	try {
		await execFileAsync('/usr/bin/command', ['-v', bin], { timeout: 2000, env: displaySessionEnv() })
		return true
	} catch {
		return false
	}
}

/**
 * @returns {string|null}
 */
function resolveConfineCursorScript() {
	const candidates = [
		path.join(REPO_ROOT, 'tools/runtime/confine-cursor.py'),
		'/usr/local/bin/confine-cursor.py',
	]
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * XFixes pointer barriers — confines cursor without XGrabPointer (Caspar-safe).
 * @returns {string|null}
 */
function resolveConfineBarriersScript() {
	const candidates = [
		path.join(REPO_ROOT, 'tools/runtime/confine-pointer-barriers.py'),
		'/usr/local/bin/confine-pointer-barriers.py',
	]
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/** @returns {Promise<string|null>} */
async function resolveXdotoolBin(env) {
	const candidates = ['/usr/bin/xdotool', '/usr/local/bin/xdotool']
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	if (await commandExists('xdotool')) return 'xdotool'
	return null
}

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {string[]}
 */
function buildConfineCursorShellLines(config, layout) {
	if (!isOperatorPointerConfineDesired(config)) {
		return [
			"pkill -f 'confine-pointer-barriers.py' 2>/dev/null || true",
			"pkill -f 'confine-cursor.py' 2>/dev/null || true",
		]
	}
	const rect = resolveOperatorMonitorRect(config, layout)
	if (!rect?.sysId || !/^[A-Za-z0-9._-]+$/.test(rect.sysId)) return []
	const barrierScript = resolveConfineBarriersScript()
	return [
		'# Operator monitor: XFixes pointer barriers (Caspar-safe; no XGrabPointer)',
		"pkill -f 'confine-pointer-barriers.py' 2>/dev/null || true",
		"pkill -f 'confine-cursor.py' 2>/dev/null || true",
		...(barrierScript
			? [
					`if command -v python3 >/dev/null 2>&1 && [ -f '${barrierScript.replace(/'/g, `'\\''`)}' ]; then`,
					`  nohup python3 '${barrierScript.replace(/'/g, `'\\''`)}' '${String(rect.sysId).replace(/'/g, `'\\''`)}' >>"$HOME/.highascg/log/confine-pointer-barriers.log" 2>&1 &`,
					'fi',
				]
			: []),
		'if command -v unclutter >/dev/null 2>&1; then',
		'  pgrep -x unclutter >/dev/null 2>&1 || unclutter -idle 2 -root &',
		'fi',
	]
}

/**
 * @param {object} config
 * @returns {string|null}
 */
function resolveNvidiaSyncToDisplayOutput(config) {
	const port = nvidiaSyncToDisplayPortIndex(config)
	if (!port) return null
	const sysId = String(readCasparSetting(config, `screen_${port}_system_id`) || '').trim()
	if (!sysId || !/^[A-Za-z0-9._-]+$/.test(sysId)) return null
	return sysId
}

/**
 * Shell lines appended to apply-layout.sh (primary head, mouse, NVIDIA vsync policy).
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {string[]}
 */
function buildOperatorDisplaySessionShellLines(config, layout) {
	const lines = []
	const confineDesired = isOperatorPointerConfineDesired(config)
	if (confineDesired) {
		const rect = resolveOperatorMonitorRect(config, layout)
		if (rect) {
			if (rect.sysId && /^[A-Za-z0-9._-]+$/.test(rect.sysId)) {
				lines.push(`xrandr --output ${rect.sysId} --primary`)
			}
			const cx = rect.x + Math.floor(rect.width / 2)
			const cy = rect.y + Math.floor(rect.height / 2)
			lines.push(
				'if command -v xdotool >/dev/null 2>&1; then',
				`  xdotool mousemove --sync ${cx} ${cy} 2>/dev/null || true`,
				'fi',
			)
		}
	}
	lines.push(...buildConfineCursorShellLines(config, layout))
	const syncOut = resolveNvidiaSyncToDisplayOutput(config)
	if (syncOut) {
		lines.push(`export HIGHASCG_NVIDIA_SYNC_OUTPUT='${syncOut.replace(/'/g, `'\\''`)}'`)
	}
	lines.push(...buildNvidiaDisplayPolicyShellLines())
	return lines
}

/**
 * Apply operator display session live (after xrandr layout).
 * @param {object} config
 * @param {{ log?: (level: string, msg: string) => void, layout?: object }} [opts]
 */
async function applyOperatorDisplaySession(config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const layout = opts.layout || calculateLayoutPositions(config)
	const confineDesired = isOperatorPointerConfineDesired(config)
	const rect = confineDesired ? resolveOperatorMonitorRect(config, layout) : null
	if (!confineDesired) {
		const env = displaySessionEnv()
		await execFileAsync('pkill', ['-f', 'confine-cursor.py'], { env, timeout: 3000 }).catch(() => {})
		log('info', '[X-Display] No operator monitor — skip primary/confine session')
	} else if (!rect) {
		log('info', '[X-Display] Operator monitor configured but no layout rect — skip primary/mouse session')
	}
	const env = displaySessionEnv()
	if (rect) {
		if (rect.sysId && /^[A-Za-z0-9._-]+$/.test(rect.sysId)) {
			try {
				await execFileAsync('xrandr', ['--display', ':0', '--output', rect.sysId, '--primary'], {
					env,
					timeout: 8000,
				})
				log('info', `[X-Display] Primary output → ${rect.sysId} (${rect.kind} ${rect.index} @ ${rect.x},${rect.y})`)
			} catch (e) {
				log('warn', `[X-Display] xrandr --primary ${rect.sysId} failed: ${e?.message || e}`)
			}
		}
		const cx = rect.x + Math.floor(rect.width / 2)
		const cy = rect.y + Math.floor(rect.height / 2)
		if (await commandExists('xdotool')) {
			try {
				await execFileAsync('xdotool', ['mousemove', '--sync', String(cx), String(cy)], { env, timeout: 5000 })
				log('info', `[X-Display] Pointer → ${cx},${cy}`)
			} catch (e) {
				log('warn', `[X-Display] xdotool mousemove failed: ${e?.message || e}`)
			}
		}
	}
	if (confineDesired) {
		const { syncOperatorPointerConfine } = require('../system/pointer-confine')
		syncOperatorPointerConfine(config, { log, layout })
	}
	if (await commandExists('nvidia-settings')) {
		const syncOut = resolveNvidiaSyncToDisplayOutput(config)
		const policyEnv = syncOut ? { ...env, HIGHASCG_NVIDIA_SYNC_OUTPUT: syncOut } : env
		const result = await applyNvidiaDisplayPolicy(policyEnv, { log })
		if (!result.ok && resolveNvidiaXApplyScript()) {
			// Script exists but first pass can race empty MetaMode after xrandr — one delayed retry.
			setTimeout(() => {
				applyNvidiaDisplayPolicy(policyEnv, { log, timeoutMs: 20_000 }).catch(() => {})
			}, 6000)
		}
	}
	return { ok: true, rect: rect || null, confineDesired }
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
	resolveConfineCursorScript,
	resolveConfineBarriersScript,
	resolveXdotoolBin,
	buildConfineCursorShellLines,
	resolveNvidiaSyncToDisplayOutput,
	buildOperatorDisplaySessionShellLines,
	applyOperatorDisplaySession,
	parkPointerOnOperatorDisplay,
	raiseOperatorGuiWindows,
	findGuiWindowIds,
	promoteGuiWindowsAboveKiosk,
	positionGuiWindowForAction,
	scheduleGuiWindowPosition,
	displaySessionEnv,
}
