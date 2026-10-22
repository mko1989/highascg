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

const { createCluster, parseAddress, mediaParity, subnetHosts, getJson } = require('../../src/cluster/cluster-peers')
const { RouteRegistry } = require('../../src/api/route-registry')

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
		const c = createCluster({ persistence: store, selfPing: async () => SELF, fetchJson: net.fetchJson, onChange: (s) => snaps.push(s) })
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
		assert.deepEqual(store.m.get('clusterPeers'), [{ id: 'boxB', host: '10.0.0.6', port: 4200, name: 'boxB', added_at: store.m.get('clusterPeers')[0].added_at }])
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
		const ctx = { _cluster: c }
		const get = await routes.dispatch('GET', '/api/cluster', '', ctx)
		assert.equal(get.status, 200)
		assert.equal(JSON.parse(get.body).self.id, 'boxA')
		assert.equal((await routes.dispatch('POST', '/api/cluster/peers', JSON.stringify({ address: '10.0.0.99' }), ctx)).status, 404)
		assert.equal((await routes.dispatch('DELETE', '/api/cluster/peers/boxZ', '', ctx)).status, 404)
		assert.equal((await routes.dispatch('GET', '/api/cluster/peers/boxZ/device-view', '', ctx)).status, 404)
		const router = fs.readFileSync(path.join(ROOT, 'src/api/router.js'), 'utf8')
		assert.match(router, /require\('\.\/routes-cluster'\)\.register\(routes\)/)
	})
})
