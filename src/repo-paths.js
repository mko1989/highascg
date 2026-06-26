'use strict'

const fs = require('fs')
const path = require('path')

/** Repo root (parent of `src/`). Server lives here; UI is `client/` or `dist-web/`. */
const REPO_ROOT = path.join(__dirname, '..')

/**
 * Directory served as static operator UI when not headless.
 * Production (unified repo): dist-web/ on the same playout machine as the API (:4200).
 * HIGHASCG_HEADLESS=true skips static UI (API-only debug). Electron launcher is hub-only.
 * @param {string} [repoRoot]
 * @returns {string}
 */
function resolveWebDir(repoRoot = REPO_ROOT) {
	if (process.env.HIGHASCG_WEB_DIR) {
		return path.resolve(process.env.HIGHASCG_WEB_DIR)
	}
	const distWeb = path.join(repoRoot, 'dist-web')
	if (fs.existsSync(path.join(distWeb, 'index.html'))) {
		return distWeb
	}
	return path.join(repoRoot, 'client')
}

module.exports = { REPO_ROOT, resolveWebDir }
