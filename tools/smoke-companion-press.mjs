#!/usr/bin/env node
/**
 * WO-24 T24.5: Verify Bitfocus-style Companion HTTP press URL accepts POST with JSON body.
 * Does not use HighAsCG; starts a local mock and runs the same request shape as
 * `src/engine/timeline-playback.js` (companion_press flag).
 *
 *   node tools/smoke-companion-press.mjs
 */
import http from 'http'

let hit = 0
const port = 19876
const wantPath = '/api/location/1/0/0/press'
const server = http.createServer((req, res) => {
	if (req.method === 'POST' && req.url === wantPath) {
		let b = ''
		req.on('data', (c) => {
			b += c
		})
		req.on('end', () => {
			hit += 1
			res.writeHead(200, { 'Content-Type': 'text/plain' })
			res.end('ok')
		})
	} else {
		res.writeHead(404)
		res.end()
	}
})

server.listen(port, '127.0.0.1', async () => {
	try {
		const url = `http://127.0.0.1:${port}${wantPath}`
		const r = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
		})
		if (!r.ok) {
			console.error(`[companion-press-smoke] expected 200, got ${r.status}`)
			process.exit(1)
		}
		if (hit !== 1) {
			console.error(`[companion-press-smoke] server hit count ${hit}`)
			process.exit(1)
		}
		console.log('[companion-press-smoke] OK — POST + JSON body matches HighAsCG fetch()')
		process.exit(0)
	} catch (e) {
		console.error('[companion-press-smoke]', e)
		process.exit(1)
	} finally {
		server.close()
	}
})
