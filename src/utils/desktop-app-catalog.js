'use strict'

/**
 * desktop-app-catalog.js — WO-387: the filesystem half of the installed-app catalog. Scans the XDG
 * application directories, keeps the result behind a short TTL cache, and answers the three
 * questions the operator-helper machinery used to answer from hard-coded tables:
 *
 *   resolveAppLaunch(action)        -> { bin, args }  (spawnGuiDetached's if-chain)
 *   resolveAppWindowClasses(action) -> string[]       (GUI_WINDOW_CLASS)
 *   findAppEntry(action).icon       -> icon name      (HELPER_ICON_CANDIDATES)
 *
 * See ./desktop-app-catalog-parse.js for the pure parsing and the security model (the API takes an
 * app ID, never a command line; an ID that is not a currently installed launchable entry is a 400).
 *
 * WHY A CACHE: the helper watchdog and the 1.5s taskbar poll resolve window classes constantly, and
 * a class lookup that re-read 36 files each time would be a syscall storm for data that changes
 * only when a package is installed. TTL rather than mtime watching because a stale entry costs at
 * most CATALOG_TTL_MS of "an app you just installed is not in the menu yet"; POSTing a launch
 * invalidates, so the menu is never stale in the direction that matters.
 */

const fs = require('fs')
const path = require('path')
const { lookupCommandPath } = require('./which')
const parse = require('./desktop-app-catalog-parse')

const { APP_DIRS, TERMINAL_BINARIES } = parse

/** ms. Long enough to absorb the 1.5s taskbar poll, short enough that an apt install shows up. */
const CATALOG_TTL_MS = 15000

/** @type {{ at: number, apps: Array<object> }|null} */
let _cache = null

/** Drop the cache — called after a launch and by tests. */
function invalidateAppCatalog() {
	_cache = null
}

/**
 * The terminal emulator that hosts `Terminal=true` entries (mc, mcedit…). Debian's
 * `x-terminal-emulator` alternative is preferred so the box's own choice wins, but it is REALPATHed
 * first: the symlink's basename is not a window class any WM will ever report, and the class is how
 * the helper watchdog finds the window (see the parse module's header).
 * @returns {string|null}
 */
function resolveTerminalEmulator() {
	for (const bin of TERMINAL_BINARIES) {
		try {
			if (!fs.existsSync(bin)) continue
			return fs.realpathSync(bin)
		} catch {
			/* broken alternative link — try the next candidate */
		}
	}
	for (const name of ['x-terminal-emulator', 'xfce4-terminal', 'gnome-terminal', 'konsole', 'xterm']) {
		try {
			const p = lookupCommandPath(name)
			if (p) return fs.realpathSync(p)
		} catch {
			/* not on PATH */
		}
	}
	return null
}

/**
 * PURE. The private WM_CLASS a console app's terminal is started under. Unique per app so the
 * helper watchdog can find, raise, park and reap exactly that window — see deriveWindowClasses.
 * @param {string} id
 * @returns {string}
 */
function terminalClassFor(id) {
	return `highascg-${String(id).replace(/[^A-Za-z0-9._-]/g, '-')}`
}

/**
 * PURE. Wrap a console command in a terminal emulator, setting the private class where the
 * emulator supports it. xterm's `-class` is verified on this box (through the `lxterm` alternative,
 * which passes it to xterm: WM_CLASS became "xterm", "HighascgTestCls"). The GTK emulators take the
 * same idea via `--class`; konsole has no equivalent, so it falls back to its own class — which
 * still works, just without per-app precision.
 * @param {string} term absolute path of the emulator
 * @param {string} cls private class
 * @param {string} title window title
 * @param {string[]} cmd the console command, argv-style
 * @returns {string[]} emulator arguments
 */
function terminalArgv(term, cls, title, cmd) {
	const base = path.basename(term)
	if (/^[lu]?xterm$/i.test(base)) return ['-class', cls, '-title', title, '-e', ...cmd]
	if (/^(gnome-terminal|xfce4-terminal|mate-terminal|tilix)$/i.test(base))
		return [`--class=${cls}`, `--title=${title}`, '--', ...cmd]
	return ['-e', ...cmd]
}

/**
 * PURE. Does this emulator take a per-window class flag? Decides whether the catalog may claim the
 * private class as the window's identity (see deriveWindowClasses — claiming it for an emulator
 * that ignores the flag would leave the watchdog searching for a class no window ever carries).
 * @param {string|null} term
 * @returns {boolean}
 */
function terminalSupportsClass(term) {
	if (!term) return false
	return /^([lu]?xterm|gnome-terminal|xfce4-terminal|mate-terminal|tilix)$/i.test(path.basename(term))
}

/**
 * Absolute path of an Exec/TryExec binary, or null when it is not installed. "Not installed" is the
 * whole point of the filter: a .desktop file left behind by a removed package must not appear in
 * the operator's menu as an app that then fails to start.
 * @param {string} bin
 * @returns {string|null}
 */
function resolveBinary(bin) {
	const s = String(bin || '').trim()
	if (!s) return null
	if (s.includes('/')) {
		try {
			return fs.existsSync(s) ? s : null
		} catch {
			return null
		}
	}
	try {
		return lookupCommandPath(s) || null
	} catch {
		return null
	}
}

/**
 * Scan the XDG application directories. Highest-precedence directory wins per ID, per spec — a
 * user's ~/.local override shadows the system entry of the same name rather than duplicating it.
 * @param {{ currentDesktop?: string, dirs?: string[], terminalBin?: string|null }} [opts]
 * @returns {Array<object>} catalog entries sorted by display name
 */
function scanDesktopApps(opts = {}) {
	const dirs = Array.isArray(opts.dirs) ? opts.dirs : APP_DIRS
	const currentDesktop = opts.currentDesktop ?? (process.env.XDG_CURRENT_DESKTOP || '')
	const terminalBin = opts.terminalBin !== undefined ? opts.terminalBin : resolveTerminalEmulator()
	/** @type {Map<string, object>} */
	const byId = new Map()

	for (const dir of dirs) {
		/** @type {string[]} */
		let files = []
		try {
			files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop'))
		} catch {
			continue // directory absent — normal (flatpak/snap not installed)
		}
		for (const file of files) {
			const id = file.slice(0, -'.desktop'.length)
			if (byId.has(id)) continue // shadowed by a higher-precedence directory
			if (!parse.parseAppAction(parse.appAction(id))) continue // unusable ID shape
			let entry
			try {
				entry = parse.parseDesktopEntry(fs.readFileSync(path.join(dir, file), 'utf8'))
			} catch {
				continue
			}
			if (!parse.isMenuEntry(entry, { currentDesktop })) continue
			const argv = parse.splitExec(entry.Exec)
			const bin = resolveBinary(entry.TryExec || argv[0])
			if (!bin) continue // package gone, stale .desktop file
			const terminal = String(entry.Terminal || '').toLowerCase() === 'true'
			if (terminal && !terminalBin) continue // nothing to host it in
			byId.set(id, {
				id,
				action: parse.appAction(id),
				name: entry.Name || id,
				comment: entry.Comment || entry.GenericName || '',
				categories: String(entry.Categories || '').split(';').filter(Boolean),
				terminal,
				icon: entry.Icon || '',
				argv,
				windowClasses: parse.deriveWindowClasses(entry, {
					terminalBin,
					terminalClass: terminalSupportsClass(terminalBin) ? terminalClassFor(id) : null,
				}),
				pinnedAction: parse.pinnedActionFor(entry),
				file: path.join(dir, file),
			})
		}
	}
	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The catalog, cached. @param {{ force?: boolean }} [opts] @returns {Array<object>}
 */
function getAppCatalog(opts = {}) {
	const now = Date.now()
	if (!opts.force && _cache && now - _cache.at < CATALOG_TTL_MS) return _cache.apps
	_cache = { at: now, apps: scanDesktopApps() }
	return _cache.apps
}

/**
 * @param {string} action an `app:<id>` action
 * @returns {object|null} the catalog entry, or null when the action is not a currently installed app
 */
function findAppEntry(action) {
	const id = parse.parseAppAction(action)
	if (!id) return null
	return getAppCatalog().find((a) => a.id === id) || null
}

/** @param {string} action @returns {boolean} */
function isAppAction(action) {
	return findAppEntry(action) != null
}

/**
 * The command to spawn for an app action. `Terminal=true` console tools (mc, mcedit) are wrapped in
 * the resolved emulator — without that they would start with no controlling terminal and die
 * instantly, which on the operator GUI looks exactly like "the menu item does nothing".
 * @param {string} action
 * @returns {{ bin: string, args: string[], entry: object }|null}
 */
function resolveAppLaunch(action) {
	const entry = findAppEntry(action)
	if (!entry) return null
	const bin = resolveBinary(entry.argv[0])
	if (!bin) return null
	const args = entry.argv.slice(1)
	if (entry.terminal) {
		const term = resolveTerminalEmulator()
		if (!term) return null
		return { bin: term, args: terminalArgv(term, terminalClassFor(entry.id), entry.name, [bin, ...args]), entry }
	}
	return { bin, args, entry }
}

/**
 * Window-class candidates for an app action, regex-escaped for `xdotool search --class`.
 * @param {string} action
 * @returns {string[]}
 */
function resolveAppWindowClasses(action) {
	const entry = findAppEntry(action)
	if (!entry) return []
	return entry.windowClasses.map(parse.escapeWindowClass)
}

/**
 * The menu payload: no argv, no file paths — the client only ever needs to render a name and post
 * an action back.
 * @returns {Array<{ action: string, id: string, name: string, comment: string, categories: string[], pinnedAction: string|null }>}
 */
function listAppsForMenu() {
	return getAppCatalog().map((a) => ({
		action: a.action,
		id: a.id,
		name: a.name,
		comment: a.comment,
		categories: a.categories,
		pinnedAction: a.pinnedAction,
	}))
}

module.exports = {
	...parse,
	invalidateAppCatalog,
	terminalArgv,
	terminalSupportsClass,
	scanDesktopApps,
	findAppEntry,
	isAppAction,
	resolveAppLaunch,
	resolveAppWindowClasses,
	listAppsForMenu,
}
