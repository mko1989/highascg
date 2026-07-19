/**
 * CG Studio — module descriptor (WO-32 shell, WO-265 playout-server hosting).
 *
 * Two hosting modes share the handlers in `routes.js`:
 *  - Electron launcher (WO-32): standalone HTTP server on :4300 (`studio-server.js`).
 *  - Playout server (WO-265): mounted into the main :4200 process via this descriptor —
 *    API under `/api/cg-studio/*` (router falls through to `moduleRegistry.handleApi`),
 *    UI at `/cg-studio/index.html` + `/studio-assets/` through `staticMounts`
 *    (merged into `serveWebApp`'s vendorDirs by `src/bootstrap/modules.js`).
 *
 * Template files are read/written under the repo `template/` tree either way.
 */

'use strict'

const path = require('path')
const context = require('./cg-studio-context')
const { handleStudioApi } = require('./routes')

/**
 * This file is synced verbatim into client/tools/electron-launcher/cg-studio/
 * (sync-cg-studio.sh), where `require('../repo-paths')` does not resolve —
 * walk up to the repo root (dir containing template/ + package.json) instead.
 */
function findRepoRoot(start) {
	const fs = require('fs')
	let dir = start
	for (let i = 0; i < 8; i++) {
		if (fs.existsSync(path.join(dir, 'template')) && fs.existsSync(path.join(dir, 'package.json'))) {
			return dir
		}
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return path.join(start, '..', '..')
}
const REPO_ROOT = findRepoRoot(__dirname)

context.configure({ packageDir: __dirname, templateRoot: path.join(REPO_ROOT, 'template') })

/** Strip the playout mount prefix so `routes.js` sees its native `/api/...` paths. */
function toStudioPath(p) {
	const rest = String(p || '').replace(/^\/api\/cg-studio(?=\/|$)/, '')
	return `/api${rest || '/health'}`
}

module.exports = {
	name: 'cg-studio',

	apiPathPrefixes: ['/api/cg-studio'],

	/**
	 * @param {{ method: string, path: string, body: string, query?: Record<string,string> }} args
	 */
	async handleApi({ method, path: p, body, query }) {
		return handleStudioApi(method, toStudioPath(p), body, query || {})
	},

	staticMounts: {
		'/cg-studio/': path.join(__dirname, 'public'),
		'/studio-assets/': path.join(REPO_ROOT, 'template'),
	},

	onBoot(ctx) {
		if (ctx && typeof ctx.log === 'function') {
			ctx.log('info', '[cg-studio] mounted on playout server — UI at /cg-studio/index.html, API at /api/cg-studio')
		}
	},
}
