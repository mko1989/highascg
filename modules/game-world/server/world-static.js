'use strict'

/**
 * WO-1101 — the world pages: `/game/world/*` served from this module's `client/` directory (no build step).
 * `/game/world` → 302 `/game/world/`; `/game/world/` → index.html. GET / HEAD only; only .html / .js / .mjs / .css; the
 * path is decoded once, `..` / `.` / NUL / backslash / absolute refused, and the resolved real path must stay inside the
 * directory (no symlink escapes). No-cache. A copy-adapt of the RC game's rc-static.js safety logic — the world module
 * never requires a game file. The pages are served whether or not a game runs (they are files; the host page must load
 * to enable the games; every data path is the API's, world-public.js).
 */

const { core } = require('./host')
const fs = require('fs')
const path = require('path')

const PREFIX = '/game/world'
const ROOT = path.join(__dirname, '..', 'client')
const MIME = Object.freeze({
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
})
const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' }
const notFound = () => ({ status: 404, headers: TEXT, body: 'Not found' })
const forbidden = () => ({ status: 403, headers: TEXT, body: 'Forbidden' })

/** Is this request path the world's (exact prefix, not `/game/worldx`)? */
const isWorldStaticPath = (p) => p === PREFIX || String(p || '').startsWith(`${PREFIX}/`)

function securityHeaders(h, html) {
	try {
		return core('src/server/security-headers').mergeSecurityHeaders(h, { html })
	} catch {
		return { ...h, 'X-Content-Type-Options': 'nosniff' }
	}
}

/**
 * @param {string} reqPath path without query
 * @param {{ root?: string, query?: string, method?: string }} [opts] root: the directory (default <module>/client)
 */
async function serveWorldStatic(reqPath, opts = {}) {
	const method = String(opts.method || 'GET').toUpperCase()
	if (method !== 'GET' && method !== 'HEAD') return { status: 405, headers: { ...TEXT, Allow: 'GET, HEAD' }, body: 'Method not allowed' }
	if (reqPath === PREFIX) return { status: 302, headers: { Location: `${PREFIX}/${opts.query || ''}`, 'Cache-Control': 'no-store' }, body: '' }
	if (!isWorldStaticPath(reqPath)) return notFound()
	const root = path.resolve(opts.root || ROOT)
	let rel
	try {
		rel = decodeURIComponent(reqPath.slice(PREFIX.length + 1))
	} catch {
		return { status: 400, headers: TEXT, body: 'Bad path' }
	}
	if (!rel || rel.endsWith('/')) rel += 'index.html'
	if (rel.includes('\0') || rel.includes('\\') || rel.split('/').some((s) => s === '..' || s === '.' || s === '') || path.isAbsolute(rel)) return forbidden()
	const ext = path.extname(rel).toLowerCase()
	if (!MIME[ext]) return notFound()
	let real
	try {
		const realRoot = await fs.promises.realpath(root)
		real = await fs.promises.realpath(path.join(root, rel))
		if (!real.startsWith(realRoot + path.sep)) return forbidden()
		if (!(await fs.promises.stat(real)).isFile()) return notFound()
	} catch {
		return notFound()
	}
	const body = method === 'HEAD' ? '' : await fs.promises.readFile(real)
	const headers = securityHeaders({ 'Content-Type': MIME[ext] }, ext === '.html')
	headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
	return { status: 200, headers, body }
}

module.exports = { serveWorldStatic, isWorldStaticPath, PREFIX }
