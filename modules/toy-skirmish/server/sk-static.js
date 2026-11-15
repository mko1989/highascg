'use strict'

/**
 * WO-1081 — Stage Skirmish browser files, served with the RC game's static-file logic (rc-static.js through the kit:
 * decoded once, `..` / NUL / backslash refused, the real path must stay inside the directory, listed MIME types only,
 * no-store while the game is developed, GET / HEAD only):
 *   /game/sk            → 302 /game/sk/ (query kept)
 *   /game/sk/<file>     → modules/toy-skirmish/client/<file> (`/game/sk/` → index.html)
 *   /game/sk/kit/<file> → the sibling's client directory (modules/rc-game/client), `.js` / `.mjs` / `.css` only
 *   /vendor/three/build/*, /vendor/three/examples/jsm/*  → the core's node_modules/three (also while the RC module is off)
 */

const path = require('path')
const { kit } = require('./sk-kit')

const PREFIX = '/game/sk'
const KIT = '/game/sk/kit/'
const KIT_EXT = new Set(['.js', '.mjs', '.css'])
const VENDOR = ['/vendor/three/build/', '/vendor/three/examples/jsm/']
const CLIENT_DIR = path.join(__dirname, '..', 'client')

const notFound = () => ({ status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Not found' })

const isVendor = (p) => VENDOR.some((v) => String(p || '').startsWith(v))

/** Is this request path the game's (exact prefix, not `/game/skx`) or a three file the page loads? */
const isSkStaticPath = (p) => p === PREFIX || String(p || '').startsWith(`${PREFIX}/`) || isVendor(p)

/**
 * @param {string} reqPath path without query
 * @param {{ method?: string, query?: string, root?: string, kitRoot?: string }} [opts] roots: smokes point them elsewhere
 */
async function serveSkStatic(reqPath, opts = {}) {
	const K = kit()
	const method = opts.method || 'GET'
	if (isVendor(reqPath)) return K.serveRcStatic(reqPath, { method })
	if (reqPath === PREFIX) return { status: 302, headers: { Location: `${PREFIX}/${opts.query || ''}`, 'Cache-Control': 'no-store' }, body: '' }
	if (reqPath.startsWith(KIT)) {
		const rest = reqPath.slice(KIT.length)
		let rel
		try {
			rel = decodeURIComponent(rest)
		} catch {
			return { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Bad path' }
		}
		if (!rel || rel.endsWith('/') || !KIT_EXT.has(path.extname(rel).toLowerCase())) return notFound()
		return K.serveRcStatic(`/game/rc/${rest}`, { method, root: opts.kitRoot || K.clientDir })
	}
	if (reqPath === `${PREFIX}/kit`) return notFound()
	return K.serveRcStatic(`/game/rc/${reqPath.slice(PREFIX.length + 1)}`, { method, root: opts.root || CLIENT_DIR })
}

module.exports = { serveSkStatic, isSkStaticPath }
