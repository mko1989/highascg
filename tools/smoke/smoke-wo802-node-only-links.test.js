'use strict'

/**
 * WO-802 — linking is node ↔ node only; a client talks to its own node. Server side:
 * - the Devices "Edit" relay (src/cluster/cluster-relay.js): only linked servers, only /api/, never /api/system, the
 *   WebSocket or a relay of a relay; status and body pass through (a real HTTP peer below);
 * - every removal (cluster-peers.js onRemove) ends what the server was part of: the master claim that named it
 *   (cluster-master.js `dropped`), a claim for an unlinked master is neither taken nor kept, the epoch floor keeps the
 *   next claim made here ahead; the fan-out is refreshed at once (routes-cluster.js); shared-show per-server state is
 *   pruned and an unlinked master's follower keeps its own edits.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const { createRelay, relayPath, queryText, rawRequest } = require('../../src/cluster/cluster-relay')
const { createMaster } = require('../../src/cluster/cluster-master')
const { fingerprint } = require('../../src/cluster/cluster-media')
const { lan } = require('./lib/cluster-lan')
const { createShowCluster } = require('../e2e/shared-show-harness')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const PEER = { id: 'boxB', host: '10.0.0.2', port: 4200, name: 'Box B' }
const linkedOnly = { saved: (id) => (id === PEER.id ? PEER : null) }

describe('WO-802 relay: a client reaches a linked server only through its own node', () => {
	it('relayPath: /api/ only; never /api/system, the WebSocket, a relay again, or ..', () => {
		assert.deepEqual(relayPath('api/device-view'), { path: '/api/device-view' })
		assert.deepEqual(relayPath('api/cluster/peers/boxA/device-view'), { path: '/api/cluster/peers/boxA/device-view' })
		for (const bad of ['api/system/power/shutdown', 'api/system', 'api/ws', 'api/cluster/peers/x/relay/api/state', 'index.html', 'api/../etc', 'api/%2e%2e/x', '%E0%A4%A'])
			assert.ok(relayPath(bad).error, `refused: ${bad}`)
		assert.equal(queryText({ refresh: '1', a: ['x', 'y'] }), '?refresh=1&a=x&a=y')
		assert.equal(queryText({}), '')
	})

	it('only to a server linked here; method, path, query and body go through as they are', async () => {
		const sent = []
		const relay = createRelay({
			cluster: linkedOnly,
			request: async (...a) => (sent.push(a), { status: 207, contentType: 'application/json', body: Buffer.from('{"x":1}') }),
		})
		const r = await relay({ method: 'POST', id: 'boxB', tail: 'api/settings', query: { force: '1' }, body: '{"a":2}' })
		assert.equal(r.status, 207)
		assert.equal(String(r.body), '{"x":1}')
		assert.deepEqual(sent, [['POST', '10.0.0.2', 4200, '/api/settings?force=1', '{"a":2}']])
		await relay({ method: 'GET', id: 'boxB', tail: 'api/device-view', query: {}, body: 'ignored' })
		assert.deepEqual(sent[1], ['GET', '10.0.0.2', 4200, '/api/device-view', undefined], 'a GET carries no body')
		assert.equal((await relay({ method: 'GET', id: 'boxC', tail: 'api/state' })).status, 404, 'not linked here')
		assert.equal((await relay({ method: 'GET', id: 'boxB', tail: 'api/system/update/status' })).status, 403)
		assert.equal((await relay({ method: 'PUT', id: 'boxB', tail: 'api/state' })).status, 405)
		assert.equal(sent.length, 2, 'refusals never reach the peer')
	})

	it('a real HTTP peer: status, body and errors pass through; no answer → 502 naming the server', async () => {
		const seen = []
		const srv = http.createServer((req, res) => {
			let b = ''
			req.on('data', (c) => (b += c))
			req.on('end', () => {
				seen.push(`${req.method} ${req.url} ${b}`)
				res.writeHead(req.method === 'DELETE' ? 404 : 200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ method: req.method, url: req.url }))
			})
		})
		await new Promise((r) => srv.listen(0, '127.0.0.1', r))
		const peer = { id: 'p', host: '127.0.0.1', port: srv.address().port, name: 'stub' }
		const relay = createRelay({ cluster: { saved: (id) => (id === 'p' ? peer : null) } })
		try {
			const g = await relay({ method: 'GET', id: 'p', tail: 'api/replication/ping', query: {} })
			assert.equal(g.status, 200)
			assert.deepEqual(JSON.parse(String(g.body)), { method: 'GET', url: '/api/replication/ping' })
			const p = await relay({ method: 'POST', id: 'p', tail: 'api/device-view', query: {}, body: '{"addDestination":{}}' })
			assert.equal(p.status, 200)
			const d = await relay({ method: 'DELETE', id: 'p', tail: 'api/cluster/peers/x', query: {} })
			assert.equal(d.status, 404, 'an error status is passed on, not turned into 200')
			assert.deepEqual(seen, ['GET /api/replication/ping ', 'POST /api/device-view {"addDestination":{}}', 'DELETE /api/cluster/peers/x '])
		} finally {
			await new Promise((r) => srv.close(r))
		}
		const gone = await relay({ method: 'GET', id: 'p', tail: 'api/state', query: {} })
		assert.equal(gone.status, 502)
		assert.match(JSON.parse(gone.body).error, /^stub: no answer/)
		assert.equal((await rawRequest('GET', '127.0.0.1', 1, '/api/x', undefined, 500)).status, 0)
	})

	it('the routes: GET / POST / DELETE …/relay/* registered, and no earlier route swallows them', () => {
		const { routes } = require('../../src/api/router')
		const first = (m, p) => routes.routes.find((r) => r.method === m && r.regex.test(p))?.path
		for (const m of ['GET', 'POST', 'DELETE'])
			assert.equal(first(m, '/api/cluster/peers/boxB/relay/api/device-view'), '/api/cluster/peers/:id/relay/*', m)
		assert.equal(first('DELETE', '/api/cluster/peers/boxB'), '/api/cluster/peers/:id', 'unlink is still unlink')
	})
})

// ── master claim ──────────────────────────────────────────────────────────────────────────────────────────────────

const verify = (pem, msg, sig) => {
	try {
		return crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(String(sig), 'base64'))
	} catch {
		return false
	}
}

/** Fully linked servers whose peer lists can change (`unlink`): the real cluster-master.js on each. */
function masters(names) {
	const keys = {}
	for (const n of names) {
		const k = crypto.generateKeyPairSync('ed25519')
		keys[n] = { pub: k.publicKey.export({ type: 'spki', format: 'pem' }).trim(), priv: k.privateKey }
	}
	const lists = Object.fromEntries(names.map((n) => [n, names.filter((x) => x !== n).map((x) => ({ id: x, host: x, port: 4200, name: x, device_key: keys[x].pub }))]))
	const nodes = {}
	for (const n of names) {
		const m = new Map()
		const c = {
			list: () => lists[n],
			saved: (id) => lists[n].find((p) => p.id === id) || null,
			byDeviceKey: (pem) => lists[n].find((p) => p.device_key === String(pem).trim()) || null,
			snapshot: () => ({ peers: lists[n].map((p) => ({ id: p.id, online: true, last_seen: Date.now() })) }),
		}
		nodes[n] = createMaster({
			cluster: c,
			persistence: { get: (k) => m.get(k), set: (k, v) => m.set(k, v) },
			selfKey: keys[n].pub,
			sign: (msg) => crypto.sign(null, Buffer.from(msg), keys[n].priv).toString('base64'),
			verify,
			fetchJson: async (host) => ({ ok: true, status: 200, json: { claim: nodes[host].claim() } }),
			post: async (host, port, p, body) => {
				const r = nodes[host].accept(body)
				return { ok: r.status === 200, status: r.status, json: r.body }
			},
		})
	}
	/** a and b drop each other (both sides, as WO-732's unlink does); each runs `dropped` as cluster-peers' onRemove. */
	function unlink(a, b) {
		for (const [x, y] of [[a, b], [b, a]]) {
			const saved = lists[x].find((p) => p.id === y)
			lists[x] = lists[x].filter((p) => p.id !== y)
			nodes[x].dropped(saved)
		}
	}
	return { nodes, unlink, fp: (n) => fingerprint(keys[n].pub) }
}

describe('WO-802 master claim after an unlink', () => {
	it('the master unlinked while others stay: the claim goes; it is not taken back from a peer that still holds it', async () => {
		const k = masters(['A', 'B', 'C'])
		await k.nodes.C.set({ master: 'A' }) // signed by C, so B would still trust it after A leaves
		assert.equal(k.nodes.B.view().master_id, 'A')
		k.unlink('A', 'B')
		assert.equal(k.nodes.B.claim(), null, 'B follows no one')
		assert.equal(k.nodes.B.view().epoch, 0)
		assert.equal(k.nodes.C.view().master_id, 'A', 'C is still linked to A and keeps it')
		await k.nodes.B.tick()
		assert.equal(k.nodes.B.claim(), null, 'pulled from C: its master is not linked to B')
		assert.equal(k.nodes.B.accept(k.nodes.C.claim()).status, 409, 'pushed: refused the same way')
		await k.nodes.B.set({ master: 'self' })
		assert.equal(k.nodes.B.claim().epoch, 2, 'the next claim made here beats the epoch the cluster had')
		assert.equal(k.nodes.C.view().master_id, 'B', 'and C takes it')
	})

	it('another server unlinked: the claim stays, the view no longer lists it in the succession', async () => {
		const k = masters(['A', 'B', 'C'])
		await k.nodes.A.set({ master: 'self' })
		k.unlink('B', 'C')
		assert.equal(k.nodes.B.view().master_id, 'A')
		assert.deepEqual(k.nodes.B.view().succession.map((s) => s.id), ['A', 'self'], 'C (unlinked) is not shown')
		assert.equal(k.nodes.B.claim().succession.length, 3, 'the signed claim itself is untouched')
	})

	it('the last server unlinked by any path: the claim goes', async () => {
		const k = masters(['A', 'B'])
		await k.nodes.A.set({ master: 'self' })
		k.unlink('A', 'B')
		assert.equal(k.nodes.A.claim(), null)
		assert.equal(k.nodes.B.claim(), null)
	})
})

describe('WO-802 every removal reaches routes-cluster.js', () => {
	it('onRemove fires for an unlink here, an unlink from there, and the repair that drops an unlinked server', async () => {
		const gone = { a: [], b: [] }
		const net = lan()
		const a = net.server('boxA', '10.0.0.1', { onRemove: (s) => gone.a.push(s.id) })
		const b = net.server('boxB', '10.0.0.2', { onRemove: (s) => gone.b.push(s.id) })
		await a.c.add({ address: '10.0.0.2' })
		await a.c.unlink('boxB')
		assert.deepEqual(gone, { a: ['boxB'], b: ['boxA'] }, 'here and there')
		await a.c.add({ address: '10.0.0.2' })
		b.up = false
		await a.c.unlink('boxB') // B misses it
		b.up = true
		net.clock.advance(require('../../src/cluster/cluster-peers').HEAL_MS)
		await b.c.poll()
		assert.deepEqual(gone.b, ['boxA', 'boxA'], 'the repair that drops it counts too')
		net.stopAll()
	})

	it('routes-cluster.js: the removal drops the claim and refreshes the fan-out now', () => {
		const src = read('src/api/routes-cluster.js')
		assert.ok(src.includes('onRemove: (saved) => removed(ctx, saved), // WO-802'))
		const fn = src.slice(src.indexOf('function removed(ctx, saved) {'), src.indexOf('/** WO-723: what server-duties'))
		assert.ok(fn.includes('ctx._clusterMaster?.dropped(saved)'))
		assert.ok(fn.includes('ctx._clusterFanout?.refresh()'), 'the poll stops with an empty list: the fan-out must not wait for it')
	})
})

describe('WO-802 shared show after an unlink', () => {
	it('the master stops listing an unlinked server; that server, with no claim, keeps its own edits', async () => {
		const c = createShowCluster(['a', 'b', 'c'])
		c.link()
		c.master('a')
		c.share(true)
		await c.settle()
		assert.deepEqual(Object.keys(c.node('a').show.view().peers).sort(), ['b', 'c'])
		c.unlink('a', 'b')
		c.node('b').claim = null // what cluster-master.js `dropped` does on b (tested above)
		assert.deepEqual(Object.keys(c.node('a').show.view().peers), ['c'], 'b is gone from the master’s view')
		c.node('b').edit((p) => { p.name = 'edited on b after the unlink' })
		await c.settle()
		assert.equal(c.node('b').project.name, 'edited on b after the unlink', 'not reverted to a master it left')
		assert.equal(c.node('b').backups.filter((x) => x.tag !== 'before-share').length, 0, 'no conflict file')
		assert.equal(c.node('b').show.view().role, 'alone')
	})
})
