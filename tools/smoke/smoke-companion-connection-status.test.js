'use strict'

const assert = require('assert')
const http = require('http')
const {
	companionConfigFromQuery,
	buildCompanionConnectionStatus,
} = require('../../src/api/companion-connection-status')

const cfg = companionConfigFromQuery(
	{ host: '10.0.0.5', port: '9000', satelliteEnabled: '0' },
	{ companion: { host: '127.0.0.1', port: 8000, satelliteEnabled: true } },
)
assert.strictEqual(cfg.host, '10.0.0.5')
assert.strictEqual(cfg.port, 9000)
assert.strictEqual(cfg.satelliteEnabled, false)

const server = http.createServer((_req, res) => {
	res.writeHead(200, { 'Content-Type': 'text/plain' })
	res.end('ok')
})

server.listen(0, '127.0.0.1', async () => {
	const port = server.address().port
	try {
		const ctx = { config: { companion: { host: '127.0.0.1', port, satelliteEnabled: false } } }
		const st = await buildCompanionConnectionStatus(ctx)
		assert.strictEqual(st.connected, true)
		assert.strictEqual(st.http.connected, true)
		assert.strictEqual(st.satellite.enabled, false)
		console.log('smoke-companion-connection-status: OK')
	} finally {
		server.close()
	}
})
