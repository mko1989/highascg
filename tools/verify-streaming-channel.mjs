#!/usr/bin/env node
/**
 * WO-27 Phase 4 helper: HTTP GET /api/streaming-channel against a running server.
 * (Does not need Caspar for JSON shape — may 503 for AMCP but GET is always 200 for this route.)
 *
 *   node tools/verify-streaming-channel.mjs 8080
 */
import http from 'http'

const port = parseInt(process.argv[2] || '8080', 10)
const host = process.env.HIGHASCG_SMOKE_HOST || '127.0.0.1'

const req = http.request(
	{ hostname: host, port, path: '/api/streaming-channel', method: 'GET', timeout: 5000 },
	(res) => {
		let b = ''
		res.on('data', (c) => {
			b += c
		})
		res.on('end', () => {
			if (res.statusCode !== 200) {
				console.error(`[streaming-ch] status ${res.statusCode}`)
				process.exit(1)
			}
			try {
				const j = JSON.parse(b)
				const need = [
					'enabled',
					'channel',
					'contentLayer',
					'videoSource',
					'audioSource',
					'route',
					'audioRoute',
					'splitAvRouted',
					'rtmp',
					'record',
				]
				for (const k of need) {
					if (!(k in j)) {
						console.error(`[streaming-ch] missing key: ${k}`)
						process.exit(1)
					}
				}
				console.log(
					`[streaming-ch] OK — ch=${j.channel} video=${j.route} audio=${j.audioSource} -> ${j.audioRoute} split=${j.splitAvRouted}`
				)
			} catch (e) {
				console.error('[streaming-ch] parse', e)
				process.exit(1)
			}
		})
	}
)
req.on('error', (e) => {
	console.error('[streaming-ch]', e.message)
	process.exit(1)
})
req.end()
