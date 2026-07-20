'use strict'

/**
 * Resolve an executable on PATH, without a shell.
 *
 * Several modules used to probe with `execFileSync('/usr/bin/command', ['-v', name])`. That can
 * never work: `command` is a POSIX SHELL BUILTIN, so /usr/bin/command does not exist on Debian or
 * Ubuntu and every probe threw ENOENT. The operator-GUI helper feature failed outright because of
 * it — an installed xdotool was reported missing, so the window lookup returned nothing on every
 * poll. The other call sites happened to survive because they fall back to fs.existsSync on a few
 * hard-coded paths, but their PATH branch was dead.
 *
 * Keep this dependency-free: it is required by audio, network, X and API code alike.
 */

const fs = require('fs')
const path = require('path')

/** Used when PATH is empty (systemd units often start with a minimal environment). */
const FALLBACK_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

/**
 * @param {string} bin executable name, or an absolute/relative path
 * @returns {string|null} absolute path to an executable file, or null when not found
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

/**
 * @param {string} bin
 * @returns {boolean}
 */
function commandExistsSync(bin) {
	return lookupCommandPath(bin) !== null
}

module.exports = { lookupCommandPath, commandExistsSync, FALLBACK_PATH }
