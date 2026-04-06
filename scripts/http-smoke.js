#!/usr/bin/env node
/**
 * HTTP + WebSocket smoke tests against a running HighAsCG server.
 * Start the app first, e.g.: node index.js --port 8090 --no-caspar
 * Then: node scripts/http-smoke.js 8090
 *
 * Flags: `--http-only` — skip WebSocket check.
 * Exits 0 on success, 1 on failure.
 */
'use strict'

const http = require('http')
const WebSocket = require('ws')

const _args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const port = parseInt(_args[0] || process.env.HIGHASCG_SMOKE_PORT || '8080', 10)
const host = process.env.HIGHASCG_SMOKE_HOST || '127.0.0.1'
const httpOnly = process.argv.includes('--http-only')

function httpGet(path) {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: host, port, path, method: 'GET', timeout: 5000 },
			(res) => {
				let body = ''
				res.on('data', (c) => {
					body += c
				})
				res.on('end', () => resolve({ status: res.statusCode, body }))
			}
		)
		req.on('error', reject)
		req.on('timeout', () => {
			req.destroy()
			reject(new Error('timeout'))
		})
		req.end()
	})
}

function httpPostJson(path, jsonBody) {
	const data = JSON.stringify(jsonBody)
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: host,
				port,
				path,
				method: 'POST',
				timeout: 5000,
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(data, 'utf8'),
				},
			},
			(res) => {
				let body = ''
				res.on('data', (c) => {
					body += c
				})
				res.on('end', () => resolve({ status: res.statusCode, body }))
			}
		)
		req.on('error', reject)
		req.on('timeout', () => {
			req.destroy()
			reject(new Error('timeout'))
		})
		req.write(data)
		req.end()
	})
}

function fail(msg) {
	console.error('[smoke FAIL]', msg)
	process.exit(1)
}

async function main() {
	const base = `http://${host}:${port}`
	console.log(`[smoke] ${base}`)

	let r = await httpGet('/')
	if (r.status !== 200) fail(`GET / expected 200, got ${r.status}`)

	const inst = '/instance/wo03-smoke'
	// SPA + relative assets when opened under Companion-style prefix (see http-server mapInstanceStaticPath)
	r = await httpGet(`${inst}/`)
	if (r.status !== 200) fail(`GET ${inst}/ expected 200, got ${r.status}`)
	if (!String(r.body).includes('<!DOCTYPE') && !String(r.body).includes('HighAsCG')) {
		fail(`GET ${inst}/ expected HTML shell`)
	}
	r = await httpGet('/api/variables/batch?categories=app,osc')
	if (r.status !== 200) fail(`GET /api/variables/batch expected 200, got ${r.status}`)
	try {
		const json = JSON.parse(r.body)
		if (typeof json !== 'object') fail('GET /api/variables/batch expected JSON object')
	} catch (e) {
		fail(`GET /api/variables/batch parse error: ${e.message}`)
	}

	r = await httpGet(`${inst}/app.js`)
	if (r.status !== 200) fail(`GET ${inst}/app.js expected 200, got ${r.status}`)
	if (!String(r.body).includes('import ')) fail(`GET ${inst}/app.js expected ES module`)

	r = await httpGet('/api/scene/live')
	if (r.status !== 200) fail(`GET /api/scene/live expected 200, got ${r.status}`)

	r = await httpGet('/api/state')
	if (r.status !== 200 && r.status !== 503) {
		fail(`GET /api/state expected 200 or 503 (no Caspar), got ${r.status}`)
	}
	const casparDisconnected = r.status === 503

	// No-Caspar client surfaces: settings, streams, audio devices (WO-05/06 + router)
	r = await httpGet('/api/settings')
	if (r.status !== 200) fail(`GET /api/settings expected 200, got ${r.status}`)

	r = await httpGet('/api/system/setup')
	if (r.status !== 200) fail(`GET /api/system/setup expected 200, got ${r.status}`)
	try {
		const setup = JSON.parse(r.body)
		if (!setup.adminUrls || !setup.syncthing) fail('GET /api/system/setup expected adminUrls + syncthing')
	} catch (e) {
		fail(`GET /api/system/setup JSON: ${e.message}`)
	}

	r = await httpGet('/api/host-stats')
	if (r.status !== 200) fail(`GET /api/host-stats expected 200, got ${r.status}`)
	try {
		const hs = JSON.parse(r.body)
		if (hs.mode === 'preshow') fail('GET /api/host-stats did not expect preshow on production smoke')
		if (!hs.cpu || hs.memory == null || !hs.media) fail('GET /api/host-stats expected cpu, memory, media')
	} catch (e) {
		fail(`GET /api/host-stats JSON: ${e.message}`)
	}

	r = await httpGet('/setup.html')
	if (r.status !== 200) fail(`GET /setup.html expected 200, got ${r.status}`)
	if (!String(r.body).includes('Server setup')) fail('GET /setup.html expected setup page')

	r = await httpGet('/api/streams')
	if (r.status !== 200) fail(`GET /api/streams expected 200, got ${r.status}`)

	r = await httpGet('/api/audio/devices')
	if (r.status !== 200) fail(`GET /api/audio/devices expected 200, got ${r.status}`)

	// Companion-style API paths (same inst as static tests above)
	r = await httpGet(`${inst}/api/settings`)
	if (r.status !== 200) fail(`GET ${inst}/api/settings expected 200, got ${r.status}`)
	r = await httpGet(`${inst}/api/streams`)
	if (r.status !== 200) fail(`GET ${inst}/api/streams expected 200, got ${r.status}`)

	r = await httpGet('/api/osc/state')
	if (r.status !== 200) fail(`GET /api/osc/state expected 200, got ${r.status}`)

	r = await httpGet('/api/variables/custom')
	if (r.status !== 200) fail(`GET /api/variables/custom expected 200, got ${r.status}`)
	r = await httpPostJson('/api/variables/batch', { keys: [] })
	if (r.status !== 200) fail(`POST /api/variables/batch expected 200, got ${r.status}`)

	r = await httpGet('/api/__smoke_not_a_route__')
	// When amcp is null, router short-circuits with 503 before 404 (see router.js).
	if (casparDisconnected) {
		if (r.status !== 503) fail(`GET unknown /api/* expected 503 when Caspar off, got ${r.status}`)
	} else if (r.status !== 404) {
		fail(`GET unknown /api/* expected 404, got ${r.status}`)
	}

	if (httpOnly) {
		console.log('[smoke] OK (HTTP only)')
		process.exit(0)
		return
	}

	const wsPaths = [`ws://${host}:${port}/api/ws`, `ws://${host}:${port}/instance/wo03-smoke/api/ws`]
	for (const wsUrl of wsPaths) {
		await new Promise((resolve, reject) => {
			const ws = new WebSocket(wsUrl)
			const t = setTimeout(() => {
				ws.close()
				reject(new Error(`WebSocket timeout (${wsUrl})`))
			}, 5000)
			ws.on('message', (raw) => {
				clearTimeout(t)
				try {
					const msg = JSON.parse(String(raw))
					if (msg.type !== 'state') {
						ws.close()
						reject(new Error(`expected first WS message type "state", got ${msg.type}`))
						return
					}
				} catch (e) {
					ws.close()
					reject(e)
					return
				}
				ws.close()
				resolve()
			})
			ws.on('error', (e) => {
				clearTimeout(t)
				reject(e)
			})
		})
	}

	console.log('[smoke] OK (HTTP + WebSocket, including /instance/… paths)')
	process.exit(0)
}

main().catch((e) => fail(e?.message || String(e)))
