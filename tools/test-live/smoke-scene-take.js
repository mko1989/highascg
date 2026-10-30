#!/usr/bin/env node
'use strict'
require('./live-guard').requireLiveOrExit(__filename) // WO-836: live-box category — opt-in via HIGHASCG_LIVE_TESTS=1
/**
 * Smoke test for scene take API.
 * Calls POST /api/scene/take with a valid scene payload.
 *
 * Usage: node tools/test-live/smoke-scene-take.js
 */

const http = require('http')

const port = 4200
const host = '127.0.0.1'

function req(method, path, body = null) {
	return new Promise((resolve, reject) => {
		const opts = { hostname: host, port, path, method, timeout: 8000 }
		const r = http.request(opts, (res) => {
			let data = ''
			res.on('data', (c) => { data += c })
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

async function main() {
	console.log(`[smoke-scene-take] Calling POST /api/scene/take on ${host}:${port}`)

	const payload = {
		channel: 1,
		incomingScene: {
			id: "sc_1778329614472_gbdse4w",
			name: "Look 1",
			layers: [
				{
					layerNumber: 10,
					source: {
						type: "media",
						value: "led-grid-3840x1024.png"
					}
				}
			]
		},
		forceCut: true
	}

	const r = await req('POST', '/api/scene/take', payload)
	console.log(`Status: ${r.status}`)
	console.log(`Body: ${r.body}`)

	if (r.status === 200) {
		console.log('[smoke-scene-take] OK')
		process.exit(0)
	} else {
		console.log('[smoke-scene-take] FAIL')
		process.exit(1)
	}
}

main().catch((e) => {
	console.error('[smoke-scene-take] ERROR', e)
	process.exit(1)
})
