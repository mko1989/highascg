'use strict'

/**
 * Live HighAsCG HTTP → real AMCP on Caspar (server must be running with Caspar connected).
 *
 *   HIGHASCG_HTTP_PORT=8080 npm run test:highascg:live:http
 *
 * Avoid sending `DIAG` via tests: CasparCG shows diagnostics on the program output.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')

const HTTP_HOST = process.env.HIGHASCG_HTTP_HOST || '127.0.0.1'
const HTTP_PORT_RAW = process.env.HIGHASCG_HTTP_PORT || process.env.HIGHASCG_INTEGRATION_PORT || ''
const HTTP_PORT = HTTP_PORT_RAW ? Number.parseInt(String(HTTP_PORT_RAW), 10) : NaN
const runHttp = Number.isFinite(HTTP_PORT) && HTTP_PORT > 0

test('requires HIGHASCG_HTTP_PORT (or HIGHASCG_INTEGRATION_PORT)', () => {
	assert.ok(
		runHttp,
		`Set HIGHASCG_HTTP_PORT to your running HighAsCG HTTP port (e.g. 8080). Got: "${HTTP_PORT_RAW}"`,
	)
})

function requestJson(method, path, bodyObj) {
	const body = bodyObj != null ? JSON.stringify(bodyObj) : null
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: HTTP_HOST,
				port: HTTP_PORT,
				path,
				method,
				timeout: 20_000,
				headers: body
					? {
							'Content-Type': 'application/json',
							'Content-Length': Buffer.byteLength(body, 'utf8'),
						}
					: {},
			},
			(res) => {
				let text = ''
				res.on('data', (c) => {
					text += c
				})
				res.on('end', () => {
					let json = null
					try {
						json = text ? JSON.parse(text) : null
					} catch {
						/* leave null */
					}
					resolve({ status: res.statusCode, raw: text, json })
				})
			},
		)
		req.on('error', reject)
		req.on('timeout', () => {
			req.destroy()
			reject(new Error('HTTP timeout'))
		})
		if (body) req.write(body)
		req.end()
	})
}

test(
	'live HighAsCG: GET /api/state 200 (Caspar connected)',
	{ skip: !runHttp },
	async () => {
		const r = await requestJson('GET', '/api/state', null)
		assert.equal(r.status, 200, r.raw?.slice?.(0, 400) || r.raw)
		assert.ok(r.json && r.json.scene && r.json.scene.deck, 'state should include scene.deck')
		assert.ok(r.json.caspar, 'state should include caspar block')
	},
)

test(
	'live HighAsCG: POST /api/raw TLS (read-only catalog)',
	{ skip: !runHttp },
	async () => {
		const r = await requestJson('POST', '/api/raw', { cmd: 'TLS' })
		assert.equal(r.status, 200, r.raw?.slice?.(0, 400) || r.raw)
		assert.equal(r.json?.ok, true)
		assert.ok(Array.isArray(r.json?.data), 'TLS via HTTP proxy should return an array')
	},
)

test(
	'live HighAsCG: POST /api/raw VERSION',
	{ skip: !runHttp },
	async () => {
		const r = await requestJson('POST', '/api/raw', { cmd: 'VERSION' })
		assert.equal(r.status, 200, r.raw?.slice?.(0, 400) || r.raw)
		assert.equal(r.json?.ok, true)
		const blob = Array.isArray(r.json?.data) ? r.json.data.join('\n') : String(r.json?.data || '')
		assert.match(blob, /casparcg|Caspar|\d+\.\d+/i, `expected version in raw VERSION: ${blob.slice(0, 400)}`)
	},
)
