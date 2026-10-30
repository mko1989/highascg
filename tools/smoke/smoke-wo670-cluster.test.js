'use strict'

/**
 * WO-670 P2 — linked servers. The peer list is device-local (persistence `clusterPeers`), a peer must answer
 * /api/replication/ping as HighAsCG and not be this server, media parity compares the project media signatures, a
 * peer's device view is read from it (cached), offline peers stay listed, scan skips self and linked ones, and the
 * routes are registered. A real HTTP stub peer answers on 127.0.0.1.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const { createCluster: realCreateCluster, parseAddress, mediaParity, subnetHosts, getJson } = require('../../src/cluster/cluster-peers')
const { RouteRegistry } = require('../../src/api/route-registry')
// WO-836: add() links back through the real localAddressTo/requestJson (net.connect + POST to the owner's LAN hosts) unless
// they are injected — default them to an offline stub so this file never opens a socket to 10.0.0.x.
const createCluster = (o) =>
	realCreateCluster({ localAddress: async () => '', request: async () => ({ ok: false, status: 0, error: 'offline test' }), ...o })

const ROOT = path.join(__dirname, '..', '..')
const SELF = { appId: 'highascg', selfId: 'boxA', hostname: 'boxA', instanceId: 'iA', appVersion: '2026.05.20', role: 'standalone',
	projectMedia: { slug: 'show', signature: 's1', fileCount: 3 } }
const pingOf = (o) => ({ appId: 'highascg', selfId: 'boxB', hostname: 'boxB', instanceId: 'iB', appVersion: '2026.05.20', role: 'standalone',
	leaderEpoch: 0, channelMap: { programChannels: [1, 3] }, projectMedia: { slug: 'show', signature: 's1', fileCount: 3 }, ...o })

function memStore(init) {
	const m = new Map(init ? [['clusterPeers', init]] : [])
	return { get: (k) => m.get(k), set: (k, v) => m.set(k, v), m }
}

function fakeNet(table) {
	const calls = []
	const fetchJson = async (host, port, p) => {
		calls.push(`${host}:${port}${p}`)
		const v = table[`${host}:${port}${p}`]
		return v === undefined ? { ok: false, status: 0, json: null, error: 'ECONNREFUSED' } : { ok: true, status: 200, json: typeof v === 'function' ? v() : v }
	}
	return { fetchJson, calls }
}

const servers = []
after(() => servers.forEach((s) => s.close()))

describe('WO-670 P2 cluster peers', () => {
	it('parses addresses and media parity', () => {
		assert.deepEqual(parseAddress('10.0.0.5'), { host: '10.0.0.5', port: 4200 })
		assert.deepEqual(parseAddress('http://box-b.local:4300/'), { host: 'box-b.local', port: 4300 })
		assert.equal(parseAddress('a b'), null)
		assert.equal(parseAddress('x:99999'), null)
		assert.equal(mediaParity({ slug: 'a', signature: '1' }, { slug: 'a', signature: '1' }), 'same')
		assert.equal(mediaParity({ slug: 'a', signature: '1' }, { slug: 'a', signature: '2' }), 'differs')
		assert.equal(mediaParity({ slug: 'a', signature: '1' }, { slug: 'b', signature: '1' }), 'other-show')
		assert.equal(mediaParity(null, { slug: 'b' }), 'unknown')
		const nets = { lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], ts: [{ family: 'IPv4', address: '100.1.2.3', internal: false }],
			eth: [{ family: 'IPv4', address: '192.168.0.23', internal: false }] }
		const hs = subnetHosts(nets)
		assert.equal(hs.length, 254, 'private /24s only (not loopback, not tailscale CGNAT)')
		assert.equal(hs[0], '192.168.0.1')
	})

	it('adds a HighAsCG peer (not itself), keeps the list device-local, refuses others', async () => {
		const net = fakeNet({ '10.0.0.6:4200/api/replication/ping': pingOf(), '10.0.0.7:4200/api/replication/ping': { hello: 1 },
			'10.0.0.23:4200/api/replication/ping': pingOf({ instanceId: 'iA' }) })
		const store = memStore()
		const snaps = []
		const c = createCluster({ persistence: store, selfPing: async () => SELF, fetchJson: net.fetchJson, onChange: (s) => snaps.push(s),
			localAddress: async () => '' }) // WO-732: the link-back finds no route (smoke-wo732 covers it)
		assert.equal((await c.add({ address: 'nope nope' })).status, 400)
		assert.equal((await c.add({ address: '10.0.0.7' })).status, 404, 'answers, but not as HighAsCG')
		assert.equal((await c.add({ address: '10.0.0.9' })).status, 404, 'nobody there')
		assert.equal((await c.add({ address: '10.0.0.23' })).status, 400, 'this server itself')
		const r = await c.add({ address: '10.0.0.6' })
		c.stop()
		assert.equal(r.status, 201)
		assert.equal(r.body.peer.id, 'boxB')
		assert.equal(r.body.peer.online, true)
		assert.equal(r.body.peer.program_channels, 2)
		assert.equal(r.body.peer.media_parity, 'same')
		const linkedAt = store.m.get('clusterPeers')[0].linked_at
		assert.ok(linkedAt > 0, 'WO-732: an operator link records when')
		assert.deepEqual(store.m.get('clusterPeers'), [{ id: 'boxB', host: '10.0.0.6', port: 4200, name: 'boxB', added_at: store.m.get('clusterPeers')[0].added_at, device_key: '', linked_at: linkedAt }])
		assert.equal(r.body.peer.device_key, undefined, 'the key stays on the server; the view says identity: false')
		assert.equal(r.body.peer.identity, false)
		assert.equal(snaps.at(-1).peers.length, 1, 'onChange carries the new list')
		assert.equal(snaps.at(-1).self.id, 'boxA')
		assert.equal((await c.add({ address: '10.0.0.6' })).status, 200, 'adding again updates, no duplicate')
		c.stop()
		assert.equal(c.snapshot().peers.length, 1)
	})

	it('reloads the saved list, marks a silent peer offline and keeps it; media parity follows the peer', async () => {
		let media = { slug: 'show', signature: 's2', fileCount: 4 }
		let up = true
		const net = fakeNet({ '10.0.0.6:4200/api/replication/ping': () => (up ? pingOf({ projectMedia: media }) : undefined) })
		const fetchJson = async (h, p, path) => {
			const r = await net.fetchJson(h, p, path)
			return r.json === undefined ? { ok: false, status: 0, json: null, error: 'ECONNREFUSED' } : r
		}
		const c = createCluster({ persistence: memStore([{ id: 'boxB', host: '10.0.0.6', port: 4200, name: 'Backup', added_at: 1 }]), selfPing: async () => SELF, fetchJson })
		await c.poll()
		assert.equal(c.snapshot().peers[0].name, 'Backup')
		assert.equal(c.snapshot().peers[0].media_parity, 'differs')
		media = { slug: 'other', signature: 's2', fileCount: 4 }
		await c.poll()
		assert.equal(c.snapshot().peers[0].media_parity, 'other-show')
		up = false
		await c.poll()
		const p = c.snapshot().peers[0]
		assert.equal(p.online, false)
		assert.equal(p.error, 'ECONNREFUSED')
		assert.equal(p.version, '2026.05.20', 'the last known facts stay')
		assert.ok(c.remove('boxB'))
		assert.equal(c.remove('boxB'), false)
	})

	it('reads the peer device view through a real HTTP peer (cached) and scans past itself', async () => {
		let views = 0
		const srv = http.createServer((req, res) => {
			res.setHeader('Content-Type', 'application/json')
			if (req.url === '/api/replication/ping') return res.end(JSON.stringify(pingOf()))
			if (req.url === '/api/device-view') return res.end(JSON.stringify({ ok: true, graph: { devices: [], edges: [] }, n: ++views }))
			res.statusCode = 404
			res.end('{}')
		})
		servers.push(srv)
		await new Promise((r) => srv.listen(0, '127.0.0.1', r))
		const port = srv.address().port
		assert.equal((await getJson('127.0.0.1', port, '/api/replication/ping')).json.selfId, 'boxB')
		let t = 1000
		const c = createCluster({ persistence: memStore(), selfPing: async () => SELF, now: () => t, hosts: () => [] })
		assert.equal((await c.add({ address: `127.0.0.1:${port}` })).status, 201)
		c.stop()
		assert.equal((await c.deviceView('boxB')).body.n, 1)
		assert.equal((await c.deviceView('boxB')).body.n, 1, 'cached')
		t += 20000
		assert.equal((await c.deviceView('boxB')).body.n, 2, 'refetched after 15 s')
		assert.equal((await c.deviceView('nope')).status, 404)
		const net = fakeNet({ '10.0.0.5:4200/api/replication/ping': pingOf({ instanceId: 'iA' }), '10.0.0.8:4200/api/replication/ping': pingOf({ hostname: 'boxC' }) })
		const s = createCluster({ persistence: memStore(), selfPing: async () => SELF, fetchJson: net.fetchJson, hosts: () => ['10.0.0.5', '10.0.0.8', '10.0.0.9'] })
		assert.deepEqual((await s.scan()).map((f) => f.hostname), ['boxC'], 'self and silent hosts skipped')
	})

	it('routes are registered and answer through the registry', async () => {
		const routes = new RouteRegistry()
		require('../../src/api/routes-cluster').register(routes)
		const c = createCluster({ persistence: memStore(), selfPing: async () => SELF, fetchJson: fakeNet({}).fetchJson })
		const ctx = { _cluster: c, _clusterMaster: { view: () => ({ epoch: 0, master: '' }) } }
		const get = await routes.dispatch('GET', '/api/cluster', '', ctx)
		assert.equal(get.status, 200)
		assert.equal(JSON.parse(get.body).self.id, 'boxA')
		assert.equal(JSON.parse(get.body).master.epoch, 0, 'P3a: the master view rides along')
		assert.equal((await routes.dispatch('POST', '/api/cluster/peers', JSON.stringify({ address: '10.0.0.99' }), ctx)).status, 404)
		assert.equal((await routes.dispatch('DELETE', '/api/cluster/peers/boxZ', '', ctx)).status, 404)
		assert.equal((await routes.dispatch('GET', '/api/cluster/peers/boxZ/device-view', '', ctx)).status, 404)
		const router = fs.readFileSync(path.join(ROOT, 'src/api/router.js'), 'utf8')
		assert.match(router, /require\('\.\/routes-cluster'\)\.register\(routes\)/)
	})
})

describe('WO-670 P2b send media (trust = both linked, signed SSH key)', () => {
	const crypto = require('node:crypto')
	const { acceptSshKey, sendMedia, fingerprint, canonical } = require('../../src/cluster/cluster-media')
	const pair = () => {
		const k = crypto.generateKeyPairSync('ed25519')
		return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }), priv: k.privateKey }
	}
	const A = pair()
	const B = pair()
	const signA = (msg) => crypto.sign(null, Buffer.from(msg), A.priv).toString('base64')
	const verify = (pem, msg, sig) => {
		try {
			return crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(sig, 'base64'))
		} catch {
			return false
		}
	}
	const SSH = 'ssh-ed25519 ' + 'A'.repeat(68) + ' highascg-replication@boxA'

	it('linking records the device key; a cloned identity is refused', async () => {
		const net = fakeNet({ '10.0.0.6:4200/api/replication/ping': pingOf(), '10.0.0.6:4200/api/cluster/identity': { device_key: B.pub },
			'10.0.0.7:4200/api/replication/ping': pingOf({ selfId: 'clone', instanceId: 'iX' }), '10.0.0.7:4200/api/cluster/identity': { device_key: A.pub } })
		const store = memStore()
		const c = createCluster({ persistence: store, selfPing: async () => SELF, fetchJson: net.fetchJson, selfKey: A.pub })
		const r = await c.add({ address: '10.0.0.6' })
		assert.equal(r.body.peer.identity, true)
		assert.equal(store.m.get('clusterPeers')[0].device_key, B.pub.trim())
		assert.equal(c.byDeviceKey(B.pub).id, 'boxB')
		assert.equal(c.byDeviceKey(A.pub), null)
		const clone = await c.add({ address: '10.0.0.7' })
		c.stop()
		assert.equal(clone.status, 409)
		assert.match(clone.body.error, /cloned install/)
	})

	it('the receiver installs the key only for a linked sender, signed, for itself, fresh', () => {
		let t = 1_000_000
		const installed = []
		const cluster = { byDeviceKey: (pem) => (pem === A.pub ? { id: 'boxA', device_key: A.pub } : null) }
		const deps = { cluster, selfKey: B.pub, verify, now: () => t, install: (key, o) => (installed.push([key, o.fromHost]), { ok: true }) }
		const req = (o = {}) => {
			const b = { from_key: A.pub, to: fingerprint(B.pub), ssh_public_key: SSH, ts: t, ...o }
			return { ...b, sig: o.sig ?? signA(canonical(b)) }
		}
		assert.equal(acceptSshKey(req({ from_key: B.pub }), '10.0.0.5', deps).status, 403, 'not linked here')
		assert.equal(acceptSshKey(req({ to: fingerprint(A.pub) }), '10.0.0.5', deps).status, 400, 'meant for another server')
		assert.equal(acceptSshKey(req({ ts: t - 120000 }), '10.0.0.5', deps).status, 400, 'stale')
		assert.equal(acceptSshKey(req({ ssh_public_key: 'rm -rf /' }), '10.0.0.5', deps).status, 400, 'not a key')
		const forged = req()
		forged.ssh_public_key = 'ssh-ed25519 ' + 'B'.repeat(68)
		assert.equal(acceptSshKey(forged, '10.0.0.5', deps).status, 403, 'signature does not cover a swapped key')
		assert.equal(installed.length, 0, 'nothing installed by any refused request')
		const ok = acceptSshKey(req(), '::ffff:10.0.0.5', deps)
		assert.equal(ok.status, 200)
		assert.deepEqual(installed, [[SSH, '10.0.0.5']], 'installed, from= the caller')
	})

	it('the sender: trust first, then rsync push with progress; unlinked receiver → clear message', async () => {
		const states = []
		const peer = { id: 'boxB', name: 'boxB', host: '10.0.0.6', port: 4200, device_key: B.pub }
		let send = null
		const cluster = { saved: (id) => (id === 'boxB' ? peer : null), mediaSend: () => send, setMediaSend: (_id, s) => ((send = s), states.push(s.state)), poll: async () => {} }
		let reply = { ok: true, status: 200, json: { ok: true } }
		const posts = []
		const pushes = []
		const deps = {
			cluster, selfKey: A.pub, sign: signA, sshKey: () => SSH, now: () => 5,
			post: async (h, p, path, body) => (posts.push([h, path, body]), reply),
			project: async () => ({ name: 'show' }),
			plan: () => ({ slug: 'show', relPaths: ['media/projects/show/'] }),
			rsync: async (dir, host, rel, o) => (pushes.push([dir, host, rel]), o.onProgress({ percent: 50 }), { ok: true, files: 1 }),
		}
		assert.equal((await sendMedia('nope', deps)).status, 404)
		reply = { ok: false, status: 403, json: { error: 'not linked here' } }
		const refused = await sendMedia('boxB', deps)
		assert.equal(refused.status, 409)
		assert.match(refused.body.error, /has not linked this server/)
		assert.equal(pushes.length, 0, 'no rsync without the receiver\'s trust')
		const body = posts[0][2]
		assert.ok(verify(A.pub, canonical(body), body.sig), 'the key request is signed by this device')
		assert.equal(body.to, fingerprint(B.pub))
		reply = { ok: true, status: 200, json: { ok: true } }
		const r = await sendMedia('boxB', deps)
		assert.equal(r.status, 202)
		await new Promise((res) => setImmediate(res))
		assert.deepEqual(pushes, [['push', '10.0.0.6', ['media/projects/show/']]])
		assert.deepEqual(states, ['sending', 'sending', 'done'])
		send = { state: 'sending' }
		assert.equal((await sendMedia('boxB', deps)).status, 409, 'one send at a time')
		send = null
		peer.device_key = ''
		assert.equal((await sendMedia('boxB', deps)).status, 400, 'linked before P2b: relink')
	})
})
