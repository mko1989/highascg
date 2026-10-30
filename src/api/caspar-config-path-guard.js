/**
 * WO-830b — where may the Caspar config XML be written?
 *
 * `POST /api/caspar-config/apply` used to accept `body.path` (and `body.casparServer.configPath`) and write the
 * XML there: `~/.ssh/authorized_keys`, `~/.bashrc`, … were all reachable. Two layers:
 *  - {@link validateRequestedConfigPath}: a path coming from a request body must be a `*.config` file inside a
 *    directory we already trust (the default config dir, the CASPAR_CONFIG_PATH dir, the saved path's dir).
 *  - {@link assertWritableConfigTarget}: whatever the path came from (settings included), the final write target —
 *    after resolving symlinks — must still be named `*.config`.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_CONFIG_PATH = '/home/casparcg/highascg/config/casparcg.config'

/** @param {string} name */
function isConfigName(name) {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*\.config$/.test(name) && !name.includes('..')
}

/** realpath of the deepest existing ancestor + the not-yet-existing tail (so a new file in a real dir resolves).
 * A dangling symlink (target does not exist yet) is followed by hand — realpath() alone would stop at it and a
 * link to `~/.ssh/authorized_keys` would look like a harmless new file. */
function realpathLoose(p, depth = 0) {
	let cur = path.resolve(p)
	const tail = []
	for (;;) {
		try {
			const real = fs.realpathSync(cur)
			return path.join(real, ...tail.reverse())
		} catch {
			try {
				if (depth < 8 && fs.lstatSync(cur).isSymbolicLink()) {
					const target = path.resolve(path.dirname(cur), fs.readlinkSync(cur))
					return path.join(realpathLoose(target, depth + 1), ...tail.reverse())
				}
			} catch {
				/* not a link either: keep walking up */
			}
			const parent = path.dirname(cur)
			if (parent === cur) return path.resolve(p)
			tail.push(path.basename(cur))
			cur = parent
		}
	}
}

/**
 * @param {object} [ctx]
 * @returns {string[]} real directories a requested config path may live in
 */
function trustedConfigDirs(ctx) {
	const dirs = new Set()
	const add = (p) => {
		const s = String(p || '').trim()
		if (s) dirs.add(realpathLoose(path.dirname(path.resolve(s))))
	}
	add(DEFAULT_CONFIG_PATH)
	add(process.env.CASPAR_CONFIG_PATH)
	add(ctx?.config?.casparServer?.configPath)
	return [...dirs]
}

/**
 * @param {unknown} requested - path from a request body
 * @param {object} [ctx]
 * @returns {{ ok: true, path: string } | { ok: false, error: string }}
 */
function validateRequestedConfigPath(requested, ctx) {
	const raw = typeof requested === 'string' ? requested.trim() : ''
	if (!raw) return { ok: false, error: 'empty path' }
	if (raw.includes('\0')) return { ok: false, error: 'invalid path' }
	if (raw.split(/[\\/]/).includes('..')) return { ok: false, error: 'path traversal is not allowed' }
	const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
	if (!isConfigName(path.basename(abs))) return { ok: false, error: 'path must name a *.config file' }
	const real = realpathLoose(abs)
	if (!isConfigName(path.basename(real))) return { ok: false, error: 'path resolves to a non-*.config file' }
	const dir = path.dirname(real)
	if (!trustedConfigDirs(ctx).includes(dir)) {
		return { ok: false, error: 'path is outside the Caspar config directory' }
	}
	return { ok: true, path: abs }
}

/**
 * Last line of defence at the write itself (covers a hostile saved settings path too).
 * @param {string} filePath
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function assertWritableConfigTarget(filePath) {
	const abs = path.resolve(String(filePath || ''))
	if (!isConfigName(path.basename(abs))) return { ok: false, error: 'Caspar config path must name a *.config file' }
	const real = realpathLoose(abs)
	if (!isConfigName(path.basename(real))) {
		return { ok: false, error: 'Caspar config path is a symlink to a non-*.config file' }
	}
	return { ok: true }
}

module.exports = { validateRequestedConfigPath, assertWritableConfigTarget, trustedConfigDirs, isConfigName, DEFAULT_CONFIG_PATH }
