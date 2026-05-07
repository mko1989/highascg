'use strict'

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody } = require('./response')

const PIXELWEB_APP_ROOT = path.resolve(__dirname, '..', '..', 'pixelweb', 'extracted-source', 'web', 'unicos')
const PIXELWEB_CONTROL_PATH = path.resolve(__dirname, '..', '..', 'pixelweb', 'pixelhue-web-server copy', 'public', 'control.html')

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.wasm': 'application/wasm',
}

function pxLog(ctx, level, msg) {
	if (ctx && typeof ctx.log === 'function') ctx.log(level, `[pixelweb] ${msg}`)
}

function getPixelhueHost(ctx) {
	return String(ctx?.config?.pixelhue?.host || '').trim()
}

function getUnicoPort(ctx) {
	const p = parseInt(String(ctx?.config?.pixelhue?.unicoPort ?? ''), 10)
	return Number.isFinite(p) && p > 0 ? p : 19998
}

function isPixelhueSecure(ctx) {
	const raw = ctx?.config?.pixelhue?.secure
	return !(raw === false || raw === 'false' || raw === 0 || raw === '0')
}

function getPixelwebRuntimeConfig(ctx) {
	return {
		host: getPixelhueHost(ctx),
		port: getUnicoPort(ctx),
		secure: isPixelhueSecure(ctx),
	}
}

function hasPixelhueConfig(ctx) {
	const c = getPixelwebRuntimeConfig(ctx)
	return Boolean(c.host && c.port)
}

function parseJsonBody(body) {
	if (body == null || body === '') return {}
	if (typeof body === 'string') return JSON.parse(body)
	if (typeof body === 'object') return body
	return {}
}

function savePixelwebRuntimeConfig(ctx, payload) {
	const host = String(payload?.host || '').trim()
	const port = Number(payload?.port ?? payload?.unicoPort)
	const secure = payload?.secure !== false && payload?.secure !== 'false'
	if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
		return { ok: false, error: 'Invalid host or port.' }
	}
	const cur = ctx?.configManager ? ctx.configManager.get() : (ctx?.config || {})
	const next = {
		...cur,
		pixelhue: {
			...(cur.pixelhue || {}),
			enabled: true,
			host,
			unicoPort: port,
			secure,
		},
	}
	if (ctx?.configManager) ctx.configManager.save(next)
	if (ctx?.config) ctx.config.pixelhue = next.pixelhue
	return { ok: true, config: { host, port, secure } }
}

function servePixelwebControl() {
	try {
		let body = fs.readFileSync(PIXELWEB_CONTROL_PATH, 'utf8')
		body = body
			.replace(/fetch\('\/api\/config'/g, "fetch('/pixelweb/api/config'")
			.replace(/href="\/"/g, 'href="/pixelweb/"')
			.replace(/\s+target="_blank"\s+rel="noopener"/g, '')
		return {
			status: 200,
			headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
			body: Buffer.from(body, 'utf8'),
		}
	} catch (e) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || 'Pixelweb control page not found' }) }
	}
}

function servePixelwebApp(pathWithQuery) {
	let reqPath = String(pathWithQuery || '/').split('?')[0]
	if (reqPath === '/pixelweb' || reqPath === '/pixelweb/') reqPath = '/pixelweb/index.html'
	const rel = reqPath.replace(/^\/pixelweb\/?/, '')
	const resolved = path.resolve(PIXELWEB_APP_ROOT, rel || 'index.html')
	const rootPrefix = PIXELWEB_APP_ROOT.endsWith(path.sep) ? PIXELWEB_APP_ROOT : `${PIXELWEB_APP_ROOT}${path.sep}`
	if (!(resolved === PIXELWEB_APP_ROOT || resolved.startsWith(rootPrefix))) {
		return { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Forbidden' }
	}
	try {
		let fp = resolved
		const st = fs.statSync(fp)
		if (st.isDirectory()) fp = path.join(fp, 'index.html')
		const ext = path.extname(fp).toLowerCase()
		let body = fs.readFileSync(fp)
		return {
			status: 200,
			headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' },
			body,
		}
	} catch {
		try {
			const body = fs.readFileSync(path.join(PIXELWEB_APP_ROOT, 'index.html'))
			return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }, body }
		} catch (e) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || 'Pixelweb app not found' }) }
		}
	}
}

async function proxyToPixelhue({ method, pathWithQuery, req, body, ctx }) {
	const host = getPixelhueHost(ctx)
	if (!host) {
		pxLog(ctx, 'warn', `${method} ${pathWithQuery} rejected: host is not configured`)
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'PixelHue host is not configured' }) }
	}
	const port = getUnicoPort(ctx)
	const secure = isPixelhueSecure(ctx)
	const scheme = secure ? 'https' : 'http'
	const mapped = String(pathWithQuery || '').replace(/^\/pixelweb/, '') || '/'
	const target = `${scheme}://${host}:${port}${mapped.startsWith('/') ? mapped : `/${mapped}`}`
	const u = new URL(target)
	const client = u.protocol === 'https:' ? https : http
	const headers = { ...(req?.headers || {}) }
	delete headers.host
	delete headers.origin
	delete headers.referer
	return await new Promise((resolve) => {
		const upReq = client.request(
			{
				protocol: u.protocol,
				hostname: u.hostname,
				port: u.port || (u.protocol === 'https:' ? 443 : 80),
				method,
				path: `${u.pathname}${u.search}`,
				headers,
				rejectUnauthorized: false,
			},
			(upRes) => {
				const chunks = []
				upRes.on('data', (d) => chunks.push(d))
				upRes.on('end', () => {
					const status = upRes.statusCode || 502
					if (status >= 400) {
						const preview = Buffer.concat(chunks).toString('utf8').slice(0, 240).replace(/\s+/g, ' ')
						pxLog(ctx, 'warn', `${method} ${mapped} -> ${target} failed HTTP ${status}: ${preview}`)
					}
					resolve({ status, headers: upRes.headers || {}, body: Buffer.concat(chunks) })
				})
			}
		)
		upReq.on('error', (e) => {
			const msg = e?.message || String(e)
			pxLog(ctx, 'error', `${method} ${mapped} -> ${target} proxy error: ${msg}`)
			resolve({ status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) })
		})
		if (body && method !== 'GET' && method !== 'HEAD') upReq.write(body)
		upReq.end()
	})
}

async function proxyPixelweb({ method, pathWithQuery, req, body, ctx }) {
	const reqPath = String(pathWithQuery || '').split('?')[0]
	pxLog(ctx, 'info', `${method} ${reqPath}`)

	if (reqPath === '/pixelweb/unico' || reqPath.startsWith('/pixelweb/unico/')) {
		return await proxyToPixelhue({ method, pathWithQuery, req, body, ctx })
	}
	if (reqPath === '/pixelweb/control') return servePixelwebControl()
	if (reqPath === '/pixelweb/api/config' && method === 'GET') {
		pxLog(ctx, 'info', 'GET /pixelweb/api/config')
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(getPixelwebRuntimeConfig(ctx)) }
	}
	if (reqPath === '/pixelweb/api/config' && method === 'POST') {
		try {
			const parsed = parseJsonBody(body)
			const saved = savePixelwebRuntimeConfig(ctx, parsed)
			if (!saved.ok) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: saved.error || 'Invalid config' }) }
			pxLog(ctx, 'info', `saved config host=${saved.config.host} port=${saved.config.port} secure=${saved.config.secure ? 'true' : 'false'}`)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, config: saved.config }) }
		} catch (e) {
			pxLog(ctx, 'warn', `POST /pixelweb/api/config invalid JSON: ${e?.message || String(e)}`)
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Invalid JSON: ${e?.message || String(e)}` }) }
		}
	}

	if (reqPath === '/pixelweb' || reqPath === '/pixelweb/' || reqPath.startsWith('/pixelweb/')) {
		if ((reqPath === '/pixelweb' || reqPath === '/pixelweb/') && !hasPixelhueConfig(ctx)) {
			return servePixelwebControl()
		}
		return servePixelwebApp(pathWithQuery)
	}
	return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
}

async function proxyUnico({ method, pathWithQuery, req, body, ctx }) {
	return await proxyToPixelhue({ method, pathWithQuery, req, body, ctx })
}

function proxyUnicoUpgrade({ req, socket, head, ctx }) {
	const host = getPixelhueHost(ctx)
	if (!host) {
		pxLog(ctx, 'warn', 'WS upgrade rejected: host is not configured')
		try { socket.destroy() } catch {}
		return
	}
	const reqUrl = String(req?.url || '/')
	const normalizedPath = reqUrl.startsWith('/pixelweb/unico/') ? reqUrl.replace(/^\/pixelweb/, '') : reqUrl
	const port = getUnicoPort(ctx)
	const isTls = isPixelhueSecure(ctx)
	const transport = isTls ? https : http
	const headers = { ...(req?.headers || {}), host: `${host}:${port}` }
	const proxyReq = transport.request({
		host,
		port,
		method: 'GET',
		path: normalizedPath,
		headers,
		rejectUnauthorized: false,
	})
	proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
		const statusLine = `HTTP/1.1 ${proxyRes.statusCode || 101} ${proxyRes.statusMessage || 'Switching Protocols'}\r\n`
		const hs = Object.entries(proxyRes.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\r\n')
		socket.write(`${statusLine}${hs}\r\n\r\n`)
		if (proxyHead && proxyHead.length > 0) socket.write(proxyHead)
		if (head && head.length > 0) proxySocket.write(head)
		proxySocket.pipe(socket)
		socket.pipe(proxySocket)
	})
	proxyReq.on('error', () => {
		pxLog(ctx, 'warn', `WS upgrade proxy error for ${normalizedPath}`)
		try { socket.destroy() } catch {}
	})
	proxyReq.end()
}

module.exports = { proxyPixelweb, proxyUnico, proxyUnicoUpgrade }
