#!/usr/bin/env node
'use strict'

/**
 * WO-670 P2 dev aid: a stand-in second server for the Devices → Servers section when there is only one box.
 * Answers /api/replication/ping as HighAsCG (its own selfId / instanceId) and /api/device-view with a copy of the real
 * server's (so its rear panel looks like real hardware). P2b: its own ed25519 device identity on /api/cluster/identity,
 * and /api/cluster/ssh-key through the REAL cluster-media.js acceptSshKey, with the real server as its only linked
 * peer — but the key goes to --trust-file (default: a temp file), never ~/.ssh/authorized_keys.
 *   node tools/dev/fake-cluster-peer.js [--port=4301] [--name=fake-b] [--from=http://127.0.0.1:4200] [--trust-file=…]
 *   [--trust=none]  (it has NOT linked the real server: Send media must be refused)
 * Then Devices → Servers → + → 127.0.0.1:4301.
 */

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { acceptSshKey } = require('../../src/cluster/cluster-media')

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d
const port = Number(arg('port', '4301'))
const name = arg('name', 'fake-b')
const from = new URL(arg('from', 'http://127.0.0.1:4200'))
const trustFile = arg('trust-file', path.join(os.tmpdir(), `fake-peer-${port}-authorized_keys`))
const me = crypto.generateKeyPairSync('ed25519')
const myKey = me.publicKey.export({ type: 'spki', format: 'pem' })

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
	const linked = (await get('/api/cluster/identity')).device_key.trim()  // the real server is this stub's one linked peer
	const deps = {
		cluster: { byDeviceKey: (pem) => (arg('trust', 'linked') !== 'none' && String(pem).trim() === linked ? { id: 'real', device_key: linked } : null) },
		selfKey: myKey,
		verify: (pem, msg, sig) => crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(sig, 'base64')),
		install: (key, o) => (fs.appendFileSync(trustFile, `from="${o.fromHost}" ${key}\n`), console.log(`trusted ${key.slice(0, 40)}… from ${o.fromHost} → ${trustFile}`), { ok: true }),
	}
	http.createServer(async (req, res) => {
		res.setHeader('Content-Type', 'application/json')
		if (req.url === '/api/replication/ping') {
			return res.end(JSON.stringify({ ...ping, selfId: name, hostname: name, instanceId: `fake-${name}`, serverTimeMs: Date.now() }))
		}
		if (req.url === '/api/device-view') return res.end(JSON.stringify(view))
		if (req.url === '/api/cluster/identity') return res.end(JSON.stringify({ id: name, hostname: name, device_key: myKey }))
		if (req.url === '/api/cluster/ssh-key' && req.method === 'POST') {
			const chunks = []
			for await (const c of req) chunks.push(c)
			const r = acceptSshKey(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), req.socket.remoteAddress, deps)
			res.statusCode = r.status
			return res.end(JSON.stringify(r.body))
		}
		res.statusCode = 404
		res.end('{"error":"fake peer"}')
	}).listen(port, '0.0.0.0', () => console.log(`fake peer ${name} on :${port}`))
})().catch((e) => {
	console.error(e.message)
	process.exit(1)
})
