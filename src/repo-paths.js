'use strict'

const fs = require('fs')
const path = require('path')

/** Repo root (parent of `src/`). Server lives here; UI is `client/` or `dist-web/`. */
const REPO_ROOT = path.join(__dirname, '..')

/**
 * Directory served as static UI when not headless (local dev / legacy monolith only).
 * Production playout: HIGHASCG_HEADLESS=true — UI via Electron launcher, not Node static files.
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
