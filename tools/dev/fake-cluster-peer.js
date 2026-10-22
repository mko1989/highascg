#!/usr/bin/env node
'use strict'

/**
 * WO-670 P2 dev aid: a stand-in second server for the Devices → Servers section when there is only one box.
 * Answers /api/replication/ping as HighAsCG (its own selfId / instanceId) and /api/device-view with a copy of the real
 * server's (so its rear panel looks like real hardware). Nothing else.
 *   node tools/dev/fake-cluster-peer.js [--port=4301] [--name=fake-b] [--from=http://127.0.0.1:4200]
 * Then Devices → Servers → + → 127.0.0.1:4301.
 */

const http = require('http')

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d
const port = Number(arg('port', '4301'))
const name = arg('name', 'fake-b')
const from = new URL(arg('from', 'http://127.0.0.1:4200'))

const get = (p) => new Promise((resolve, reject) => {
	http.get({ host: from.hostname, port: from.port, path: p }, (res) => {
		const c = []
		res.on('data', (d) => c.push(d))
		res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString('utf8'))))
	}).on('error', reject)
})

;(async () => {
	const ping = await get('/api/replication/ping')
	const view = await get('/api/device-view')
	http.createServer(async (req, res) => {
		res.setHeader('Content-Type', 'application/json')
		if (req.url === '/api/replication/ping') {
			return res.end(JSON.stringify({ ...ping, selfId: name, hostname: name, instanceId: `fake-${name}`, serverTimeMs: Date.now() }))
		}
		if (req.url === '/api/device-view') return res.end(JSON.stringify(view))
		res.statusCode = 404
		res.end('{"error":"fake peer"}')
	}).listen(port, '0.0.0.0', () => console.log(`fake peer ${name} on :${port}`))
})().catch((e) => {
	console.error(e.message)
	process.exit(1)
})
