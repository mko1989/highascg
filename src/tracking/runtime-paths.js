'use strict'

/**
 * WO-1094 — where the person-detection runtime lives (the same layout as tools/tracking-detect/runtime-lib.sh): one
 * prefix in the service user's home, outside the repo (Syncthing) and outside every ISO (penguins-eggs excludes it,
 * tools/eggs/live-usb/verify-iso-detection-runtime.sh asserts it — the AGPL weights are never redistributed).
 *   HIGHASCG_TRACKING_PREFIX  ~/.local/share/highascg   → tracking-venv/, models/, wheels/, install-work/, install-job.json
 *   HIGHASCG_TRACKING_VENV / HIGHASCG_TRACKING_PYTHON / HIGHASCG_TRACKING_MODELS override single paths (WO-616 T9).
 * An explicit `prefix` (the API's scratch-prefix test hook) derives every path from it and ignores those overrides.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const REPO = path.join(__dirname, '..', '..')
const TOOLS = path.join(REPO, 'tools', 'tracking-detect')
const INSTALL_SH = path.join(TOOLS, 'install.sh')
const BUNDLE_NAME = 'highascg-detection-runtime'

function defaultPrefix(env = process.env) {
	return env.HIGHASCG_TRACKING_PREFIX || path.join(env.HOME || os.homedir(), '.local', 'share', 'highascg')
}

/** @param {string} [prefix] scratch prefix (tests) — else the configured one */
function runtimePaths(prefix, env = process.env) {
	const scratch = !!prefix
	const root = prefix || defaultPrefix(env)
	const venv = (!scratch && env.HIGHASCG_TRACKING_VENV) || path.join(root, 'tracking-venv')
	return {
		prefix: root,
		scratch,
		venv,
		python: (!scratch && env.HIGHASCG_TRACKING_PYTHON) || path.join(venv, 'bin', 'python'),
		models: (!scratch && env.HIGHASCG_TRACKING_MODELS) || path.join(root, 'models'),
		wheels: path.join(root, 'wheels'),
		work: path.join(root, 'install-work'),
		state: path.join(root, 'install-job.json'),
		log: path.join(root, 'install.log'),
	}
}

let _features = null
/** tools/tracking-detect/features.json — what each feature needs (shared with install.sh). */
function loadFeatures(file = path.join(TOOLS, 'features.json')) {
	if (_features && file === path.join(TOOLS, 'features.json')) return _features
	const f = JSON.parse(fs.readFileSync(file, 'utf8'))
	if (file === path.join(TOOLS, 'features.json')) _features = f
	return f
}

const inside = (child, parent) => {
	const rel = path.relative(parent, child)
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * A prefix the API may install into (test isolation): absolute, no `..`, under the home or the temp dir, never the
 * repo, never `/` or the home itself. → '' when fine, else why not.
 */
function checkPrefix(p, env = process.env) {
	if (typeof p !== 'string' || !p) return 'prefix must be a path'
	if (!path.isAbsolute(p) || p.split('/').includes('..')) return 'prefix must be an absolute path without ..'
	const n = path.resolve(p)
	const home = env.HOME || os.homedir()
	if (n === home || n === '/' || n === os.tmpdir()) return 'prefix must be a folder of its own'
	if (inside(n, REPO)) return 'prefix must be outside the HighAsCG folder (it syncs)'
	if (!inside(n, home) && !inside(n, os.tmpdir())) return 'prefix must be under the home or the temp folder'
	return ''
}

module.exports = { runtimePaths, loadFeatures, checkPrefix, inside, REPO, TOOLS, INSTALL_SH, BUNDLE_NAME }
