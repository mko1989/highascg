#!/usr/bin/env node
/**
 * Optional smoke when CasparCG is connected (GET /api/state returns 200).
 * Verifies unknown route → 404 and AMCP passthrough via POST /api/raw.
 *
 * Usage: start HighAsCG with Caspar reachable, then:
 *   node scripts/smoke-caspar.js 8080
 *
 * Exits 0 on success, 1 on failure or if Caspar is not connected (503 on /api/state).
 */
'use strict'

const http = require('http')

const port = parseInt(process.argv[2] || process.env.HIGHASCG_SMOKE_PORT || '8080', 10)
const host = process.env.HIGHASCG_SMOKE_HOST || '127.0.0.1'

function req(method, path, body = null) {
	return new Promise((resolve, reject) => {
		const opts = { hostname: host, port, path, method, timeout: 8000 }
		const r = http.request(opts, (res) => {
			let data = ''
			res.on('data', (c) => {
				data += c
			})
			res.on('end', () => resolve({ status: res.statusCode, body: data }))
		})
		r.on('error', reject)
		r.on('timeout', () => {
			r.destroy()
			reject(new Error('timeout'))
		})
		if (body != null) {
			r.setHeader('Content-Type', 'application/json')
			r.write(typeof body === 'string' ? body : JSON.stringify(body))
		}
		r.end()
	})
}

function fail(msg) {
	console.error('[smoke-caspar FAIL]', msg)
	process.exit(1)
}

async function main() {
	const base = `http://${host}:${port}`
	console.log(`[smoke-caspar] ${base} (expects Caspar connected)`)

	let r = await req('GET', '/api/state')
	if (r.status === 503) {
		console.error('[smoke-caspar] Caspar not connected (GET /api/state → 503). Skip or use scripts/http-smoke.js without Caspar.')
		process.exit(1)
	}
	if (r.status !== 200) fail(`GET /api/state expected 200, got ${r.status}`)

	r = await req('GET', '/api/__smoke_not_a_route__')
	if (r.status !== 404) fail(`GET unknown /api/* expected 404 when Caspar on, got ${r.status}`)

	r = await req('POST', '/api/raw', { cmd: 'VERSION' })
	if (r.status !== 200) fail(`POST /api/raw VERSION expected 200, got ${r.status}`)
	let parsed
	try {
		parsed = JSON.parse(r.body)
	} catch {
		fail('POST /api/raw body not JSON')
	}
	if (!parsed || (parsed.data === undefined && parsed.ok === undefined)) {
		fail('POST /api/raw unexpected response shape')
	}

	console.log('[smoke-caspar] OK')
	process.exit(0)
}

main().catch((e) => fail(e?.message || String(e)))
