'use strict'

const fs = require('fs')
const path = require('path')

/** Repo root (parent of `src/`). Server lives here; UI is `dist-web/` (WO-52) or dev `client/`. */
const REPO_ROOT = path.join(__dirname, '..')

/**
 * Directory served as static UI when not headless.
 * Production playout (WO-52): serve built `dist-web/` on :4200 — LAN browsers, no Electron required.
 * Set HIGHASCG_HEADLESS=true only for CI / API-only debugging.
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
