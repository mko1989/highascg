'use strict'

/**
 * WO-1076 — live `staticMounts` of external modules (URL prefix ending in `/` → directory). Served per request by
 * module-registry.handleStatic, so a mount appears on enable and is gone on disable (the in-tree modules' mounts are a
 * boot-time vendorDirs snapshot). Same rules as the RC game's static server: GET/HEAD only, path decoded once,
 * `..` / `.` / NUL / backslash refused, the real path must stay inside the mount's real root (no symlink escapes),
 * only listed file types, `/prefix/` → index.html. Reserved prefixes (the API, the operator UI, its assets) are
 * never served from a module.
 */

const fs = require('fs')
const path = require('path')
const { mergeSecurityHeaders } = require('../server/security-headers')

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
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
	'.wasm': 'application/wasm',
	'.webmanifest': 'application/manifest+json',
}

const RESERVED = ['/api/', '/assets/', '/instance/', '/templates/']

/** @param {string} prefix */
function isAllowedMountPrefix(prefix) {
	if (typeof prefix !== 'string' || !prefix.startsWith('/') || !prefix.endsWith('/') || prefix === '/') return false
	if (prefix.includes('..') || prefix.includes('\\') || prefix.includes('//')) return false
	return !RESERVED.some((r) => prefix.startsWith(r))
}

const text = (status, body, extra = {}) => ({ status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extra }, body })

/**
 * @param {string} root mount directory
 * @param {string} rel request path below the prefix (still URL-encoded)
 * @param {string} method
 */
async function serveFile(root, rel, method) {
	if (method !== 'GET' && method !== 'HEAD') return text(405, 'Method not allowed', { Allow: 'GET, HEAD' })
	try {
		rel = decodeURIComponent(rel)
	} catch {
		return text(400, 'Bad path')
	}
	if (!rel || rel.endsWith('/')) rel += 'index.html'
	if (rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel) || rel.split('/').some((s) => s === '..' || s === '.' || s === '')) {
		return text(403, 'Forbidden')
	}
	const ext = path.extname(rel).toLowerCase()
	if (!MIME[ext]) return text(404, 'Not found')
	let real
	try {
		const realRoot = await fs.promises.realpath(root)
		real = await fs.promises.realpath(path.join(realRoot, rel))
		if (!real.startsWith(realRoot + path.sep)) return text(403, 'Forbidden')
		if (!(await fs.promises.stat(real)).isFile()) return text(404, 'Not found')
	} catch {
		return text(404, 'Not found')
	}
	const headers = mergeSecurityHeaders({ 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache' }, { html: ext === '.html' })
	return { status: 200, headers, body: method === 'HEAD' ? '' : await fs.promises.readFile(real) }
}

/**
 * @param {Record<string, string>} mounts
 * @param {{ method?: string, path: string }} args
 * @returns {Promise<object|null>} null when no mount claims the path
 */
async function serveMounts(mounts, args) {
	const p = String(args?.path || '')
	let best = null
	for (const [prefix, dir] of Object.entries(mounts || {})) {
		if (!isAllowedMountPrefix(prefix) || typeof dir !== 'string' || !dir) continue
		const bare = prefix.slice(0, -1)
		if (p !== bare && !p.startsWith(prefix)) continue
		if (!best || prefix.length > best[0].length) best = [prefix, dir]
	}
	if (!best) return null
	if (p === best[0].slice(0, -1)) return { status: 302, headers: { Location: `${best[0]}${args?.search || ''}`, 'Cache-Control': 'no-store' }, body: '' }
	return serveFile(best[1], p.slice(best[0].length), String(args?.method || 'GET').toUpperCase())
}

module.exports = { serveMounts, isAllowedMountPrefix }
