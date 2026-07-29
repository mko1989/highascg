'use strict'

/**
 * desktop-app-catalog-parse.js — WO-387: the PURE half of the installed-app catalog. The operator
 * "Open window" menu stops being a hard-coded list
 * of five tools and becomes "whatever is installed on this box", read from freedesktop `.desktop`
 * entries.
 *
 * WHY THE DESKTOP ENTRIES AND NOT A LONGER HARD-CODED TABLE: the three tables WO-283/WO-317 had to
 * maintain by hand are each already a field of the spec, and every installed app ships them:
 *
 *   - what to run      -> `Exec=` (field codes stripped)          (was: spawnGuiDetached's if-chain)
 *   - what window it is -> `StartupWMClass=`                       (was: GUI_WINDOW_CLASS)
 *   - what icon it has  -> `Icon=`                                 (was: HELPER_ICON_CANDIDATES)
 *
 * `StartupWMClass` is the load-bearing one: the helper watchdog finds, promotes, parks and reaps a
 * helper purely by window class, so an app the table does not know is an app the kiosk can never
 * recover from. Zoom declares `StartupWMClass=zoom`, XTerm declares `XTerm` — verified on this box.
 * Where an entry omits it we fall back to the Exec binary's basename (thunar -> `thunar` matches
 * res_class `Thunar`: xdotool's `search --class` regex is case-insensitive, verified live).
 *
 * SECURITY MODEL — this is NOT "the client may run a command". The API vocabulary is an app ID
 * (`app:<desktop-id>`); the server re-reads the catalog and refuses any ID that is not a currently
 * installed, launchable entry. The command line comes from the on-disk `.desktop` file, never from
 * the request. The nuclear-password gate on the route is unchanged. So the allow-list is exactly
 * "what root installed on this box", which is what the owner asked for, and a client that invents
 * an ID gets a 400 rather than an exec.
 *
 * PURE: every function here takes text and returns data, so the whole vocabulary (what runs, what
 * window it is, what may appear) is offline-testable against fixtures. The filesystem half — the
 * scan, its TTL cache and the launch command — is ./desktop-app-catalog.js.
 */

const path = require('path')

/** Action-vocabulary prefix that marks a catalog app, keeping it unambiguous against the five
 * pinned WO-283 actions (`firefox`, `file-manager`, …) which keep their own bespoke launch paths. */
const APP_ACTION_PREFIX = 'app:'

/** XDG_DATA_DIRS-style roots, highest precedence first (first entry for an ID wins, per spec).
 * snapd/flatpak export dirs are listed explicitly — they are in XDG_DATA_DIRS for a login session
 * but the server runs under systemd where that variable is not set. @readonly */
const APP_DIRS = [
	path.join(process.env.HOME || '/home/casparcg', '.local/share/applications'),
	'/usr/local/share/applications',
	'/usr/share/applications',
	'/var/lib/snapd/desktop/applications',
	'/var/lib/flatpak/exports/share/applications',
	path.join(process.env.HOME || '/home/casparcg', '.local/share/flatpak/exports/share/applications'),
]

/** Terminal emulators for `Terminal=true` entries (mc, mcedit…), best first. Debian's
 * `x-terminal-emulator` alternative is preferred so the box's own choice wins. @readonly */
const TERMINAL_BINARIES = [
	'/usr/bin/x-terminal-emulator',
	'/usr/bin/xfce4-terminal',
	'/usr/bin/gnome-terminal',
	'/usr/bin/konsole',
	'/usr/bin/xterm',
]

/**
 * Catalog entries whose binary IS one of the five pinned tools are routed to the pinned action
 * instead of being launched raw. This is not a filter — the entry still appears in the menu — it
 * only redirects the launch, and it matters most for Firefox: `firefox-esr.desktop` run raw would
 * open the DEFAULT profile, which is the profile the kiosk holds, producing the "Close Firefox"
 * profile-lock modal WO-283 has explicit handling for. The pinned `firefox` action uses the
 * isolated operator profile. Same idea for thunar (pinned action opens the media ingest path) and
 * nvidia-settings (pinned action applies the display policy first).
 * @readonly
 */
const PINNED_BY_BINARY = {
	'firefox-esr': 'firefox',
	firefox: 'firefox',
	thunar: 'file-manager',
	pcmanfm: 'file-manager',
	nautilus: 'file-manager',
	dolphin: 'file-manager',
	'nvidia-settings': 'nvidia-settings',
	BlackmagicDesktopVideoSetup: 'desktopvideo_setup',
	desktopvideo_setup: 'desktopvideo_setup',
	DesktopVideoUpdater: 'desktop_video_updater',
}

/* --------------------------------------------------------------------------------------------- *
 * PURE — parsing
 * --------------------------------------------------------------------------------------------- */

/**
 * PURE. Parse the `[Desktop Entry]` group of a .desktop file. Other groups (Desktop Action …) are
 * ignored: this reads the main entry only. Localised keys (`Name[de]`) are dropped — the operator
 * GUI is English and a locale suffix would otherwise overwrite the unlocalised value.
 * @param {string} text
 * @returns {Record<string,string>}
 */
function parseDesktopEntry(text) {
	/** @type {Record<string,string>} */
	const out = {}
	let inEntry = false
	for (const raw of String(text || '').split('\n')) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		if (line.startsWith('[')) {
			inEntry = line === '[Desktop Entry]'
			continue
		}
		if (!inEntry) continue
		const eq = line.indexOf('=')
		if (eq <= 0) continue
		const key = line.slice(0, eq).trim()
		if (key.includes('[')) continue // localised variant
		out[key] = line.slice(eq + 1).trim()
	}
	return out
}

/**
 * PURE. Tokenise an `Exec=` value per the Desktop Entry spec's quoting rules (double quotes group,
 * backslash escapes inside them) and drop the field codes. `%f/%F/%u/%U` etc. are placeholders for
 * files/URIs we never pass, and a literal `%U` handed to a program is an argument it will try to
 * open — that is how a launcher ends up showing "cannot open %U".
 * @param {string} exec
 * @returns {string[]} argv, empty when the value is unusable
 */
function splitExec(exec) {
	const s = String(exec || '')
	/** @type {string[]} */
	const argv = []
	let cur = ''
	let quoted = false
	let has = false
	for (let i = 0; i < s.length; i++) {
		const c = s[i]
		if (quoted) {
			if (c === '\\' && i + 1 < s.length) {
				cur += s[++i]
				has = true
			} else if (c === '"') quoted = false
			else {
				cur += c
				has = true
			}
			continue
		}
		if (c === '"') {
			quoted = true
			has = true
		} else if (c === ' ' || c === '\t') {
			if (has) argv.push(cur)
			cur = ''
			has = false
		} else {
			cur += c
			has = true
		}
	}
	if (has) argv.push(cur)
	/* Field codes (%f, %U, --icon %i…) are placeholders for files/URIs we never pass; a literal one
	 * handed to a program becomes an argument it tries to open. `%%` is an escaped percent and must
	 * survive that strip, so stripFieldCodes walks the argument once rather than running two
	 * regexes whose order would decide the result. An argument that was ONLY a field code vanishes.
	 */
	return argv.map(stripFieldCodes).filter((a) => a.length > 0)
}

/**
 * PURE. Remove Desktop Entry field codes from one argument, preserving `%%` as a literal percent.
 * @param {string} arg
 * @returns {string}
 */
function stripFieldCodes(arg) {
	const FIELD_CODES = 'fFuUdDnNickvm'
	let out = ''
	for (let i = 0; i < arg.length; i++) {
		if (arg[i] !== '%') {
			out += arg[i]
			continue
		}
		const next = arg[i + 1]
		if (next === '%') {
			out += '%'
			i++
		} else if (next && FIELD_CODES.includes(next)) {
			i++
		} else {
			out += '%'
		}
	}
	return out
}

/**
 * PURE. Window-class candidates for an entry, best first. See the module header for why this is
 * the field that decides whether the kiosk can recover from a helper.
 * @param {Record<string,string>} entry
 * @param {{ terminalBin?: string|null, terminalClass?: string|null }} [opts] the resolved terminal
 *   and the private WM_CLASS we start it under, for `Terminal=true` entries
 * @returns {string[]}
 */
function deriveWindowClasses(entry, opts = {}) {
	/** @type {string[]} */
	const out = []
	const push = (v) => {
		const s = String(v || '').trim()
		if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s)
	}
	/* A Terminal=true entry has no window of its own — the emulator owns it, and every console tool
	 * would otherwise share the emulator's one class, so parking "Midnight Commander" would park an
	 * unrelated terminal too. The launcher therefore starts the emulator under a PRIVATE class
	 * (`-class`), which is unique AND exact: it is returned ALONE, because the candidate list is
	 * OR-searched and adding the emulator's generic class back would re-introduce exactly the
	 * cross-matching the private class exists to prevent. Emulators with no such flag (konsole) get
	 * the generic class instead — imprecise, but the only thing findable. `lxterm`/`uxterm` are
	 * xterm wrapper scripts: the window they map reports res_class `xterm`, never the wrapper's own
	 * name (verified live on this box). */
	if (String(entry.Terminal || '').toLowerCase() === 'true' && opts.terminalBin) {
		if (opts.terminalClass) return [String(opts.terminalClass)]
		const base = path.basename(opts.terminalBin)
		push(/^[lu]?xterm$/i.test(base) ? 'xterm' : base)
		return out
	}
	push(entry.StartupWMClass)
	const argv = splitExec(entry.Exec)
	if (argv[0]) push(path.basename(argv[0]))
	return out
}

/**
 * PURE. `xdotool search --class` takes a POSIX extended regex, so a class containing `.` or `+`
 * (python3.12, gtk+…) would match more than itself. Escaping keeps a derived class literal.
 * @param {string} cls
 * @returns {string}
 */
function escapeWindowClass(cls) {
	return String(cls || '').replace(/[.[\]{}()*+?^$|\\]/g, '\\$&')
}

/** PURE. @param {string} id @returns {string} */
function appAction(id) {
	return `${APP_ACTION_PREFIX}${id}`
}

/**
 * PURE. The desktop ID inside an `app:` action, or null for the pinned actions. Rejects anything
 * that could escape the applications directories — the ID is used to look up a parsed entry, never
 * to build a path, but a traversal-shaped ID is a bug either way.
 * @param {string} action
 * @returns {string|null}
 */
function parseAppAction(action) {
	const s = String(action || '')
	if (!s.startsWith(APP_ACTION_PREFIX)) return null
	const id = s.slice(APP_ACTION_PREFIX.length)
	if (!id || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(id) || id.includes('..')) return null
	return id
}

/**
 * PURE. Should this parsed entry appear as a launchable app? This is spec filtering only, NOT a
 * curated allow-list (owner decision, 29.07: show everything installed): `Type` must be
 * Application, `NoDisplay`/`Hidden` are the spec's own "do not show me in a menu" flags, and
 * `OnlyShowIn` naming other desktops means the entry is not for this session.
 * @param {Record<string,string>} entry
 * @param {{ currentDesktop?: string }} [opts]
 * @returns {boolean}
 */
function isMenuEntry(entry, opts = {}) {
	if (String(entry.Type || 'Application') !== 'Application') return false
	if (String(entry.NoDisplay || '').toLowerCase() === 'true') return false
	if (String(entry.Hidden || '').toLowerCase() === 'true') return false
	if (!String(entry.Exec || '').trim()) return false
	const desktops = String(opts.currentDesktop || '')
		.split(':')
		.filter(Boolean)
		.map((d) => d.toLowerCase())
	const only = String(entry.OnlyShowIn || '')
		.split(';')
		.filter(Boolean)
		.map((d) => d.toLowerCase())
	if (only.length && !only.some((d) => desktops.includes(d))) return false
	const not = String(entry.NotShowIn || '')
		.split(';')
		.filter(Boolean)
		.map((d) => d.toLowerCase())
	if (not.length && not.some((d) => desktops.includes(d))) return false
	return true
}

/** PURE. @param {Record<string,string>} entry @returns {string|null} pinned action, or null */
function pinnedActionFor(entry) {
	const argv = splitExec(entry.Exec)
	if (!argv[0]) return null
	/* Only a BARE invocation aliases: `thunar %U` is the file manager, `thunar --bulk-rename %F` is
	 * a different tool that happens to share the binary. */
	if (argv.length > 1) return null
	return PINNED_BY_BINARY[path.basename(argv[0])] || null
}

module.exports = {
	APP_DIRS,
	TERMINAL_BINARIES,
	parseDesktopEntry,
	splitExec,
	stripFieldCodes,
	deriveWindowClasses,
	escapeWindowClass,
	appAction,
	parseAppAction,
	isMenuEntry,
	pinnedActionFor,
}
