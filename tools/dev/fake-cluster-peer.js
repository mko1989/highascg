#!/usr/bin/env node
'use strict'

/**
 * WO-670 P2 dev aid: a stand-in second server for the Devices → Servers section when there is only one box.
 * Answers /api/replication/ping as HighAsCG (its own selfId / instanceId) and /api/device-view with a copy of the real
 * server's (so its rear panel looks like real hardware). P2b: its own ed25519 device identity on /api/cluster/identity,
 * and /api/cluster/ssh-key through the REAL cluster-media.js acceptSshKey, with the real server as its only linked
 * peer — but the key goes to --trust-file (default: a temp file), never ~/.ssh/authorized_keys.
 * P3a: the REAL cluster-master.js with the real server as its one linked peer (polled every 5 s), its claim kept in
 * --state-file (default a temp file, so a restarted stub comes back with its old epoch). POST /api/cluster/master/set
 * {master:'self'} makes the stub the master; kill it to watch the real server fail over.
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
const { createMaster } = require('../../src/cluster/cluster-master')
const { getJson, postJson } = require('../../src/cluster/cluster-peers')

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d
const port = Number(arg('port', '4301'))
const name = arg('name', 'fake-b')
const from = new URL(arg('from', 'http://127.0.0.1:4200'))
const trustFile = arg('trust-file', path.join(os.tmpdir(), `fake-peer-${port}-authorized_keys`))
const stateFile = arg('state-file', path.join(os.tmpdir(), `fake-peer-${port}-state.json`))
const keyFile = stateFile.replace(/\.json$/, '') + '-key.pem'
const priv = fs.existsSync(keyFile) ? crypto.createPrivateKey(fs.readFileSync(keyFile)) : crypto.generateKeyPairSync('ed25519').privateKey
fs.writeFileSync(keyFile, priv.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })  // same identity after a restart
const myKey = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' })
const readState = () => {
	try {
		return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
	} catch {
		return {}
	}
}
const persistence = { get: (k) => readState()[k], set: (k, v) => fs.writeFileSync(stateFile, JSON.stringify({ ...readState(), [k]: v })) }

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
	const trusted = arg('trust', 'linked') !== 'none'
	const real = { id: 'real', host: from.hostname, port: Number(from.port || 80), name: ping.hostname || 'real', device_key: linked }
	const seen = { online: true, last_seen: Date.now() }
	const cluster = {
		list: () => (trusted ? [real] : []),
		saved: (id) => (trusted && id === 'real' ? real : null),
		byDeviceKey: (pem) => (trusted && String(pem).trim() === linked ? real : null),
		snapshot: () => ({ peers: [{ id: 'real', ...seen }] }),
	}
	const master = createMaster({ cluster, persistence, selfKey: myKey, fetchJson: getJson, post: postJson,
		sign: (msg) => crypto.sign(null, Buffer.from(msg), priv).toString('base64'),
		verify: (pem, msg, sig) => crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(sig, 'base64')),
		log: (lvl, msg) => console.log(`${lvl} ${msg}`) })
	setInterval(async () => {
		const r = await getJson(real.host, real.port, '/api/replication/ping')
		Object.assign(seen, r.ok ? { online: true, last_seen: Date.now() } : { online: false })
		await master.tick()
	}, 5000)
	const deps = {
		cluster,
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
		if (req.url === '/api/cluster/master' && req.method === 'GET') return res.end(JSON.stringify({ claim: master.claim(), ...master.view() }))
		if (req.method === 'POST' && ['/api/cluster/ssh-key', '/api/cluster/master', '/api/cluster/master/set'].includes(req.url)) {
			const chunks = []
			for await (const c of req) chunks.push(c)
			const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
			const r = req.url === '/api/cluster/ssh-key' ? acceptSshKey(body, req.socket.remoteAddress, deps)
				: req.url === '/api/cluster/master' ? master.accept(body) : await master.set(body)
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
