/**
 * Polling logic for go2rtc ingest status.
 */
'use strict'

const http = require('http')

function streamsHaveProducers(apiPort, names) {
	return new Promise(resolve => {
		const req = http.get({ hostname: '127.0.0.1', port: apiPort, path: '/api/streams', timeout: 3000 }, res => {
			let data = ''; res.on('data', c => { data += c }); res.on('end', () => {
				try {
					const json = JSON.parse(data)
					resolve(names.every(n => { const s = json[n]; return s && Array.isArray(s.producers) && s.producers.length > 0 }))
				} catch { resolve(false) }
			})
		}); req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false) })
	})
}

async function waitForPushIngestReady(targets, config, ctx = {}) {
	const names = targets.map(t => t.name); const port = config.go2rtcPort; const log = ctx.log || (() => {})
	const raw = process.env.HIGHASCG_GO2RTC_PUSH_WAIT_MS; let timeout = 10000
	if (raw !== undefined && raw !== '') { const n = parseInt(raw, 10); if (Number.isFinite(n)) timeout = Math.max(0, n) }
	if (timeout === 0) return
	const deadline = Date.now() + timeout
	while (Date.now() < deadline) {
		if (await streamsHaveProducers(port, names)) { log('info', '[Streaming] go2rtc: push ingest active'); return }
		await new Promise(r => setTimeout(r, 250))
	}
	log('warn', `[Streaming] go2rtc: push ingest not confirmed within ${timeout}ms`)
}

module.exports = { streamsHaveProducers, waitForPushIngestReady }
