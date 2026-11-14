'use strict'

/**
 * WO-1074 — the RC game's browser files: `/game/rc/*` served from the repo's `game/rc/` directory (no build step).
 * `/game/rc` → 302 `/game/rc/`; `/game/rc/` → index.html. Paths are decoded once, `..` / NUL / backslash refused, and
 * the resolved real path must stay inside the directory (no symlink escapes). Only listed file types are served.
 * Text files are no-store while the game is being developed. GET / HEAD only.
 * Also `/vendor/three/build/*` and `/vendor/three/examples/jsm/*` from node_modules/three, whether or not the previs
 * module (which mounts all of /vendor/three/) is loaded — the game page imports three.module.js and GLTFLoader.js.
 */

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { mergeSecurityHeaders } = require('../server/security-headers')

const PREFIX = '/game/rc'
const THREE = path.join(REPO_ROOT, 'node_modules', 'three')
/** URL prefix → directory: the only parts of three the game page loads. */
const VENDOR = [
	['/vendor/three/build/', path.join(THREE, 'build')],
	['/vendor/three/examples/jsm/', path.join(THREE, 'examples', 'jsm')],
]
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.glb': 'model/gltf-binary',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.txt': 'text/plain; charset=utf-8',
	'.webmanifest': 'application/manifest+json',
}
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest'])

const notFound = () => ({ status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Not found' })

const vendorOf = (p) => VENDOR.find(([pre]) => String(p || '').startsWith(pre))

/** Is this request path the game's (exact prefix, not `/game/rcx`) or the three files it loads? */
const isRcStaticPath = (p) => p === PREFIX || String(p || '').startsWith(`${PREFIX}/`) || !!vendorOf(p)

/**
 * @param {string} reqPath path without query
 * @param {{ root?: string, query?: string, method?: string }} [opts] root = the game directory (default <repo>/game/rc)
 */
async function serveRcStatic(reqPath, opts = {}) {
	const method = String(opts.method || 'GET').toUpperCase()
	if (method !== 'GET' && method !== 'HEAD') return { status: 405, headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Method not allowed' }
	const vendor = vendorOf(reqPath)
	const root = path.resolve(vendor ? vendor[1] : opts.root || path.join(REPO_ROOT, 'game', 'rc'))
	if (reqPath === PREFIX) return { status: 302, headers: { Location: `${PREFIX}/${opts.query || ''}`, 'Cache-Control': 'no-store' }, body: '' }
	let rel
	try {
		rel = decodeURIComponent(reqPath.slice(vendor ? vendor[0].length : PREFIX.length + 1))
	} catch {
		return { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Bad path' }
	}
	if (vendor && (!rel || rel.endsWith('/'))) return notFound()
	if (!rel || rel.endsWith('/')) rel += 'index.html'
	if (rel.includes('\0') || rel.includes('\\') || rel.split('/').some((s) => s === '..' || s === '.') || path.isAbsolute(rel)) {
		return { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Forbidden' }
	}
	const ext = path.extname(rel).toLowerCase()
	if (!MIME[ext]) return notFound()
	let real
	try {
		const realRoot = await fs.promises.realpath(root)
		real = await fs.promises.realpath(path.join(root, rel))
		if (!real.startsWith(realRoot + path.sep)) return { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Forbidden' }
		if (!(await fs.promises.stat(real)).isFile()) return notFound()
	} catch {
		return notFound()
	}
	const body = await fs.promises.readFile(real)
	const headers = mergeSecurityHeaders({ 'Content-Type': MIME[ext] }, { html: ext === '.html' })
	// three is a pinned npm package: cacheable for an hour; the game's own files are not cached while it is developed
	headers['Cache-Control'] = vendor ? 'public, max-age=3600' : TEXT.has(ext) ? 'no-cache, no-store, must-revalidate' : 'no-cache'
	return { status: 200, headers, body }
}

module.exports = { serveRcStatic, isRcStaticPath }
