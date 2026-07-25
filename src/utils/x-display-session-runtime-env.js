'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { getXAuthority } = require('./hardware-info')

function displaySessionEnv() {
	return {
		...process.env,
		DISPLAY: ':0',
		XAUTHORITY: getXAuthority(),
	}
}

/** Default PATH used when the service env somehow has none. @readonly */
const FALLBACK_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

/**
 * Resolve an executable the way `command -v` would, IN-PROCESS.
 *
 * THIS IS THE WO-283 ROOT-CAUSE FIX. The previous implementation shelled out to
 * `execFile('/usr/bin/command', ['-v', bin])` — but `command` is a POSIX SHELL BUILTIN, not a
 * binary, and on this box it does not exist as a file:
 *
 *   $ ls -l /usr/bin/command
 *   ls: cannot access '/usr/bin/command': No such file or directory
 *   $ type command
 *   command is a shell builtin
 *
 * execFile therefore threw ENOENT for EVERY probe, so `commandExists()` answered `false` for every
 * binary on the box — including `xdotool`, which is installed. `findGuiWindowIds()` gates on
 * `commandExists('xdotool')` and so returned `[]` on every watchdog tick, no matter what was on
 * screen. That is why the operator's "Open window" press always ended in `helper_never_appeared`:
 * the helper window was there, the lookup was structurally blind to it. Verified live 2026-07-20 —
 * before this fix `findGuiWindowIds('firefox', …)` returned `[]` while `xdotool search
 * --onlyvisible --classname Navigator` returned the running helper window 33554477.
 *
 * Doing the lookup with `fs` removes the dependency on any external binary existing, which is
 * exactly the class of bug that caused this.
 *
 * @param {string} bin
 * @returns {string|null} absolute path, or null when not found/not executable
 */
function lookupCommandPath(bin) {
	const name = String(bin || '').trim()
	if (!name) return null
	const candidates = name.includes('/')
		? [name]
		: String(process.env.PATH || FALLBACK_PATH)
				.split(':')
				.filter(Boolean)
				.map((dir) => path.join(dir, name))
	for (const p of candidates) {
		try {
			if (!fs.statSync(p).isFile()) continue
			fs.accessSync(p, fs.constants.X_OK)
			return p
		} catch {
			/* not here, or not executable — keep looking */
		}
	}
	return null
}

/** @param {string} bin @returns {Promise<boolean>} */
async function commandExists(bin) {
	return lookupCommandPath(bin) !== null
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

module.exports = {
	displaySessionEnv,
	FALLBACK_PATH,
	lookupCommandPath,
	commandExists,
	resolveConfineCursorScript,
	resolveConfineBarriersScript,
	resolveXdotoolBin,
}
