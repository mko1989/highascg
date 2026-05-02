#!/usr/bin/env node
'use strict'

const http = require('http')

const port = parseInt(process.argv[2] || process.env.HIGHASCG_SMOKE_PORT || '8080', 10)
const host = process.env.HIGHASCG_SMOKE_HOST || '127.0.0.1'

function httpJson(method, path, payload) {
	const body = payload == null ? null : JSON.stringify(payload)
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: host,
				port,
				path,
				method,
				timeout: 5000,
				headers: body
					? {
							'Content-Type': 'application/json',
							'Content-Length': Buffer.byteLength(body, 'utf8'),
						}
					: undefined,
			},
			(res) => {
				let raw = ''
				res.on('data', (c) => (raw += c))
				res.on('end', () => {
					let json = null
					try {
						json = raw ? JSON.parse(raw) : null
					} catch (_) {}
					resolve({ status: res.statusCode || 0, raw, json })
				})
			}
		)
		req.on('error', reject)
		req.on('timeout', () => {
			req.destroy()
			reject(new Error('timeout'))
		})
		if (body) req.write(body)
		req.end()
	})
}

function fail(msg) {
	console.error('[pixelhue-validation FAIL]', msg)
	process.exit(1)
}

async function expect400(path, payload, wantErrorIncludes) {
	const res = await httpJson('POST', path, payload)
	if (res.status !== 400) {
		fail(`${path} expected 400, got ${res.status} (${res.raw})`)
	}
	const msg = String((res.json && res.json.error) || '')
	if (wantErrorIncludes && !msg.includes(wantErrorIncludes)) {
		fail(`${path} expected error containing "${wantErrorIncludes}", got "${msg}"`)
	}
}

async function main() {
	console.log(`[pixelhue-validation] http://${host}:${port}`)
	const st = await httpJson('GET', '/api/pixelhue/status')
	if (st.status !== 200) fail(`/api/pixelhue/status expected 200, got ${st.status}`)
	if (!st.json || st.json.connected !== true) {
		console.log('[pixelhue-validation] SKIP: PixelHue not connected; skipping validation checks that require live connection')
		process.exit(0)
		return
	}

	await expect400('/api/pixelhue/take', { nope: 1 }, 'take body must be an array')
	await expect400('/api/pixelhue/cut', { nope: 1 }, 'cut body must be an array')
	await expect400('/api/pixelhue/preset-apply', { presetId: '' }, 'preset-apply body must include presetId and targetRegion')
	await expect400('/api/pixelhue/source-backup', [], 'source-backup body must be an object')

	console.log('[pixelhue-validation] OK')
	process.exit(0)
}

main().catch((e) => fail(e && e.message ? e.message : String(e)))

