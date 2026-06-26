const path = require('path')
const fs = require('fs')
const http = require('http')
const url = require('url')

const PROXY_LOG_ENABLED = process.env.HIGHASCG_PROXY_LOG !== '0'

function logProxy(...args) {
	if (!PROXY_LOG_ENABLED) return
	const ts = new Date().toISOString().slice(11, 23)
	console.log(`[Electron Main] [proxy ${ts}]`, ...args)
}

function logProxyError(...args) {
	const ts = new Date().toISOString().slice(11, 23)
	console.error(`[Electron Main] [proxy ${ts}]`, ...args)
}

function mapInstanceStaticPath(requestPath) {
	const m = String(requestPath || '/').match(/^\/instance\/[^/]+(\/.*)?$/)
	if (!m) return requestPath
	const rest = m[1]
	if (!rest || rest === '/') return '/'
	return rest
}

/**
 * @param {{ getApiOrigin: () => string, distWebPath: string, port: number, getEnabledModuleIds: () => string[], buildModulesApiPayload: () => object }} opts
 */
function createLauncherStaticServer({
	getApiOrigin,
	distWebPath,
	port,
	getEnabledModuleIds,
	buildModulesApiPayload,
}) {
	const server = http.createServer((req, res) => {
		const parsedUrl = url.parse(req.url)
		const pathname = parsedUrl.pathname
		const webuiApiOrigin = getApiOrigin()
		const enabledIds = getEnabledModuleIds()

		if (pathname === '/api/modules' && req.method === 'GET') {
			res.setHeader('Content-Type', 'application/json')
			res.setHeader('Cache-Control', 'no-store')
			res.end(JSON.stringify(buildModulesApiPayload()))
			return
		}

		const isProxyPath =
			pathname !== '/api/modules' &&
			/^\/(instance\/[^/]+\/)?(api|vendor|template|templates)\b/.test(pathname)
		if (isProxyPath) {
			const startedAt = Date.now()
			try {
				const targetUrl = new URL(req.url, webuiApiOrigin)
				const targetLabel = `${targetUrl.host}${targetUrl.pathname}${parsedUrl.search || ''}`
				logProxy(`→ ${req.method} ${req.url}  ⇒  ${targetLabel}`)
				const proxyReq = http.request(
					{
						hostname: targetUrl.hostname,
						port: targetUrl.port || 80,
						path: targetUrl.pathname + (parsedUrl.search || ''),
						method: req.method,
						headers: {
							...req.headers,
							host: targetUrl.host,
						},
					},
					(proxyRes) => {
						logProxy(
							`← ${proxyRes.statusCode} ${req.method} ${req.url} (${Date.now() - startedAt}ms)`,
						)
						res.writeHead(proxyRes.statusCode, proxyRes.headers)
						proxyRes.pipe(res)
					},
				)
				proxyReq.on('error', (err) => {
					logProxyError(
						`✗ ${req.method} ${req.url} → upstream error after ${Date.now() - startedAt}ms: ${err.message}`,
					)
					res.statusCode = 502
					res.end(`Proxy error: ${err.message}`)
				})
				req.pipe(proxyReq)
			} catch (err) {
				logProxyError(`✗ ${req.method} ${req.url} → proxy failed: ${err.message}`)
				res.statusCode = 500
				res.end(`Proxy failed: ${err.message}`)
			}
			return
		}

		let cleanPath = mapInstanceStaticPath(pathname)
		if (cleanPath === '/' || cleanPath === '') cleanPath = '/index.html'

		let filePath = path.join(distWebPath, cleanPath)
		if (!filePath.startsWith(distWebPath)) {
			res.statusCode = 403
			res.end('Forbidden')
			return
		}

		fs.stat(filePath, (err, stats) => {
			if (err || !stats.isFile()) {
				filePath = path.join(distWebPath, 'index.html')
			}

			fs.readFile(filePath, (readErr, data) => {
				if (readErr) {
					res.statusCode = 500
					res.end(`Error reading file: ${readErr.message}`)
					return
				}

				const ext = path.extname(filePath).toLowerCase()
				let contentType = 'text/plain'
				if (ext === '.html') contentType = 'text/html'
				else if (ext === '.js') contentType = 'application/javascript'
				else if (ext === '.css') contentType = 'text/css'
				else if (ext === '.json') contentType = 'application/json'
				else if (ext === '.png') contentType = 'image/png'
				else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg'
				else if (ext === '.svg') contentType = 'image/svg+xml'
				else if (ext === '.ico') contentType = 'image/x-icon'
				else if (ext === '.woff') contentType = 'font/woff'
				else if (ext === '.woff2') contentType = 'font/woff2'
				else if (ext === '.ttf') contentType = 'font/ttf'

				res.setHeader('Content-Type', contentType)
				res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
				res.setHeader('Pragma', 'no-cache')
				res.setHeader('Expires', '0')

				if (ext === '.html') {
					let htmlContent = data.toString('utf8')
					htmlContent = htmlContent.replace(
						/<meta name="highascg-api-origin" content="[^"]*">/,
						`<meta name="highascg-api-origin" content="${webuiApiOrigin}">`,
					)
					const modulesJson = JSON.stringify(enabledIds).replace(/</g, '\\u003c')
					if (htmlContent.includes('name="highascg-optional-modules"')) {
						htmlContent = htmlContent.replace(
							/<meta name="highascg-optional-modules" content="[^"]*">/,
							`<meta name="highascg-optional-modules" content='${modulesJson}'>`,
						)
					} else {
						htmlContent = htmlContent.replace(
							/<meta name="highascg-api-origin" content="[^"]*">/,
							`<meta name="highascg-api-origin" content="${webuiApiOrigin}">\n\t<meta name="highascg-optional-modules" content='${modulesJson}'>`,
						)
					}
					res.end(htmlContent)
				} else {
					res.end(data)
				}
			})
		})
	})

	server.on('upgrade', (req, socket, head) => {
		const parsedUrl = url.parse(req.url)
		const pathname = parsedUrl.pathname
		const webuiApiOrigin = getApiOrigin()
		const isWsPath = /^\/(instance\/[^/]+\/)?api\/ws\b/.test(pathname)
		if (!isWsPath) {
			logProxy(`✗ WS upgrade rejected (non-ws path): ${req.url}`)
			socket.destroy()
			return
		}
		try {
			const targetUrl = new URL(webuiApiOrigin)
			const targetHost = targetUrl.hostname
			const targetPort = targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80)
			logProxy(`⇅ WS upgrade ${req.url}  ⇒  ${targetHost}:${targetPort}`)
			const net = require('net')
			const targetSocket = net.connect(targetPort, targetHost, () => {
				logProxy(`⇅ WS connected to upstream ${targetHost}:${targetPort} for ${req.url}`)
				socket.on('close', () => logProxy(`⇅ WS client closed: ${req.url}`))
				targetSocket.on('close', () => logProxy(`⇅ WS upstream closed: ${req.url}`))
				let rawHeaders = `${req.method} ${req.url} HTTP/1.1\r\n`
				for (let i = 0; i < req.rawHeaders.length; i += 2) {
					const key = req.rawHeaders[i]
					const val = req.rawHeaders[i + 1]
					if (key.toLowerCase() === 'host') {
						rawHeaders += `Host: ${targetUrl.host}\r\n`
					} else {
						rawHeaders += `${key}: ${val}\r\n`
					}
				}
				rawHeaders += '\r\n'
				targetSocket.write(rawHeaders)
				if (head && head.length > 0) targetSocket.write(head)
				targetSocket.pipe(socket)
				socket.pipe(targetSocket)
			})
			targetSocket.on('error', (err) => {
				logProxyError(`✗ WS upstream error for ${req.url}: ${err.message}`)
				socket.destroy()
			})
			socket.on('error', (err) => {
				logProxyError(`✗ WS client error for ${req.url}: ${err.message}`)
				targetSocket.destroy()
			})
		} catch (err) {
			logProxyError(`✗ WS upgrade failed for ${req.url}: ${err.message}`)
			socket.destroy()
		}
	})

	server.on('error', (err) => {
		if (err && err.code === 'EADDRINUSE') {
			console.error(
				`[Electron Main] Port ${port} is already in use. Stop the other process first (often \`npm run dev\` / Vite): lsof -i :${port}`,
			)
			return
		}
		console.error('[Electron Main] WebUI static server error:', err?.message || err)
	})

	server.listen(port, '0.0.0.0', () => {
		console.log(`[Electron Main] WebUI Static Server listening on http://localhost:${port}`)
	})

	return server
}

module.exports = { createLauncherStaticServer }
