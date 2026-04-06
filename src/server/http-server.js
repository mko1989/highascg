/**
 * HTTP server: static `web/`, `/templates/`, `/api/*` (delegated).
 * Also routes `/instance/<id>/api/*` so the same process works when the browser uses a Companion-style path prefix (see `web/lib/api-client.js` `getApiBase`).
 */

'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { mergeCors } = require('./cors')

const MIME = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.ico': 'image/x-icon',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
}

/** Must be read as binary — utf8 would corrupt fonts, images, etc. */
const BINARY_EXT = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.cur'])

/**
 * Companion-style UI prefix: `/instance/<id>/app.js` → `/app.js` for static resolution.
 * `index.html` uses relative `href`/`src`, so the browser requests assets under the same prefix.
 * @param {string} requestPath path without query
 * @returns {string}
 */
function mapInstanceStaticPath(requestPath) {
	const m = String(requestPath || '/').match(/^\/instance\/[^/]+(\/.*)?$/)
	if (!m) return requestPath
	const rest = m[1]
	if (!rest || rest === '/') return '/'
	return rest
}

/**
 * @returns {string[]}
 */
function getLanIPv4Addresses() {
	const out = []
	const nets = os.networkInterfaces()
	for (const k of Object.keys(nets)) {
		for (const n of nets[k] || []) {
			if (n.family === 'IPv4' && !n.internal) out.push(n.address)
		}
	}
	return out
}

/**
 * @param {string} requestPath
 * @param {{ webDir: string, templatesDir?: string }} dirs
 */
async function serveWebApp(requestPath, dirs) {
	let filePath = mapInstanceStaticPath(requestPath || '/')
	if (filePath === '/') filePath = '/index.html'
	if (filePath.includes('..')) {
		return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' }
	}
	if (filePath.startsWith('/templates/') && dirs.templatesDir) {
		const tplName = filePath.replace(/^\/templates\//, '')
		const tplPath = path.join(dirs.templatesDir, tplName)
		try {
			const body = await fs.promises.readFile(tplPath, 'utf8')
			const ext = path.extname(tplPath)
			return { status: 200, headers: { 'Content-Type': MIME[ext] || 'text/html' }, body }
		} catch {
			return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' }
		}
	}
	const relPath = filePath.replace(/^\/+/, '') || 'index.html'
	let fullPath = path.join(dirs.webDir, relPath)
	try {
		const stat = await fs.promises.stat(fullPath)
		if (stat.isDirectory()) fullPath = path.join(fullPath, 'index.html')
		const ext = path.extname(fullPath)
		const contentType = MIME[ext] || 'application/octet-stream'
		if (BINARY_EXT.has(ext)) {
			const body = await fs.promises.readFile(fullPath)
			return { status: 200, headers: { 'Content-Type': contentType }, body }
		}
		const body = await fs.promises.readFile(fullPath, 'utf8')
		return { status: 200, headers: { 'Content-Type': contentType }, body }
	} catch (e) {
		if (e.code === 'ENOENT') {
			try {
				const body = await fs.promises.readFile(path.join(dirs.webDir, 'index.html'), 'utf8')
				return { status: 200, headers: { 'Content-Type': 'text/html' }, body }
			} catch {
				return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' }
			}
		}
		throw e
	}
}

/**
 * @param {string} method
 * @param {string} reqPath
 * @param {string} body
 * @param {import('http').IncomingMessage} _req
 */
async function defaultRouteApi(method, reqPath, body, _req) {
	return {
		status: 503,
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify({
			error: 'API routes not migrated yet',
			method,
			path: reqPath,
		}),
	}
}

/**
 * @param {{
 *   port: number,
 *   bindAddress?: string,
 *   webDir: string,
 *   templatesDir?: string,
 *   routeApi?: (method: string, path: string, body: string, req: import('http').IncomingMessage) => Promise<{ status?: number, headers?: Record<string, string>, body?: string | Buffer }>,
 *   log?: (msg: string) => void,
 * }} options
 * @returns {import('http').Server}
 */
function startHttpServer(options) {
	const {
		port,
		bindAddress = '0.0.0.0',
		webDir,
		templatesDir,
		routeApi = defaultRouteApi,
		log = (m) => console.log(m),
	} = options

	const server = http.createServer(async (req, res) => {
		if (req.method === 'OPTIONS') {
			res.writeHead(204, mergeCors())
			res.end()
			return
		}
		try {
			const rawPath = ((req.url || '').split('#')[0] || '/')
			const reqPath = rawPath.split('?')[0]
			const isIngestUpload = reqPath.endsWith('/api/ingest/upload')
			let body = ''
			if (!isIngestUpload) {
				for await (const chunk of req) body += chunk
			}

			let result
			// Same-origin API when UI is served under Companion: /instance/<id>/api/...
			const isApi =
				reqPath.startsWith('/api/') ||
				reqPath === '/api' ||
				/^\/instance\/[^/]+\/api(\/.*)?$/.test(reqPath)
			if (isApi) {
				// Pass path including ?query so router can parse query params (e.g. go2rtc webrtc ?src=)
				result = await routeApi(req.method || 'GET', rawPath, body, req)
			} else {
				result = await serveWebApp(reqPath, { webDir, templatesDir })
			}
			const headers = mergeCors(result.headers)
			res.writeHead(result.status ?? 200, headers)
			res.end(result.body ?? '')
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			res.writeHead(502, mergeCors({ 'Content-Type': 'application/json; charset=utf-8' }))
			res.end(JSON.stringify({ error: msg }))
		}
	})

	server.listen(port, bindAddress, () => {
		const urls = new Set([`http://127.0.0.1:${port}/`, `http://localhost:${port}/`])
		for (const ip of getLanIPv4Addresses()) urls.add(`http://${ip}:${port}/`)
		log('[HighAsCG] HTTP server listening:')
		for (const u of urls) log(`  ${u}`)
	})

	/** Track sockets so shutdown works on Node < 18.2 (no `server.closeAllConnections`). */
	const trackedSockets = new Set()
	server.on('connection', (socket) => {
		trackedSockets.add(socket)
		socket.on('close', () => trackedSockets.delete(socket))
	})
	/** @internal */
	server._highascgDestroyTrackedSockets = () => {
		for (const s of trackedSockets) {
			try {
				s.destroy()
			} catch (_) {
				/* ignore */
			}
		}
		trackedSockets.clear()
	}

	return server
}

/**
 * @param {import('http').Server | null | undefined} server
 * @param {() => void} [onClose]
 */
function stopHttpServer(server, onClose) {
	if (server && typeof server.close === 'function') {
		// Drop keep-alive / long-lived sockets so server.close() does not wait ~TimeoutStopSec (systemd).
		if (typeof server._highascgDestroyTrackedSockets === 'function') {
			server._highascgDestroyTrackedSockets()
		}
		if (typeof server.closeAllConnections === 'function') {
			server.closeAllConnections()
		}
		server.close(() => onClose && onClose())
	} else if (onClose) {
		onClose()
	}
}

module.exports = {
	startHttpServer,
	stopHttpServer,
	serveWebApp,
	mapInstanceStaticPath,
	defaultRouteApi,
	getLanIPv4Addresses,
}
