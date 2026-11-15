'use strict'

/**
 * WO-1089 — Stage Salad browser files, served with the RC game's static-file logic (rc-static.js through the kit:
 * decoded once, `..` / NUL / backslash refused, the real path must stay inside the directory, listed MIME types only,
 * GET / HEAD only):
 *   /game/salad            → 302 /game/salad/ (query kept)
 *   /game/salad/<file>     → modules/stage-salad/client/<file> (`/game/salad/` → index.html)
 *   /game/salad/kit/<file> → the sibling's client directory (modules/rc-game/client), `.js` / `.mjs` / `.css` only
 *   /vendor/three/build/*, /vendor/three/examples/jsm/*  → the core's node_modules/three
 */

const path = require('path')
const { kit } = require('./salad-kit')

const PREFIX = '/game/salad'
const KIT = '/game/salad/kit/'
const KIT_EXT = new Set(['.js', '.mjs', '.css'])
const VENDOR = ['/vendor/three/build/', '/vendor/three/examples/jsm/']
const CLIENT_DIR = path.join(__dirname, '..', 'client')

const notFound = () => ({ status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Not found' })
const isVendor = (p) => VENDOR.some((v) => String(p || '').startsWith(v))

/** Is this request path the game's (exact prefix, not `/game/saladx`) or a three file the page loads? */
const isSaladStaticPath = (p) => p === PREFIX || String(p || '').startsWith(`${PREFIX}/`) || isVendor(p)

/** @param {string} reqPath @param {{ method?: string, query?: string, root?: string, kitRoot?: string }} [opts] */
async function serveSaladStatic(reqPath, opts = {}) {
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

module.exports = { serveSaladStatic, isSaladStaticPath }
