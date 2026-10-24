'use strict'

/**
 * WO-732 P1 — one link, both sides. Two (or three) real cluster-peers instances on an in-memory network: linking makes
 * the other server link back, unlinking unlinks both, a half link is repaired on a poll (at most every HEAL_MS), an
 * unlink the other server missed leaves a tombstone so its repair drops its side, a server that needs sign-in shows
 * the link as one-way, and an older server (no `clusterLinked` in its ping) is asked once.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createCluster, linkedFingerprints, HEAL_MS, TOMBSTONE_KEY } = require('../../src/cluster/cluster-peers')
const { fingerprint } = require('../../src/cluster/cluster-media')

const ROOT = path.join(__dirname, '..', '..')
const refused = { ok: false, status: 0, json: null, error: 'ECONNREFUSED' }
const ok = (json, status = 200) => ({ ok: status < 300, status, json })

/** Servers on a fake LAN: each runs the real cluster code; requests go through the same routing as routes-cluster.js. */
function lan() {
	const nodes = new Map()
	let t = 1_800_000_000_000
	const clock = { now: () => t, advance: (ms) => (t += ms) }
	const reach = (h, p) => {
		const n = nodes.get(`${h}:${p}`)
		return n && n.up ? n : null
	}
	function server(name, host, o = {}) {
		const m = new Map()
		const store = { get: (k) => m.get(k), set: (k, v) => m.set(k, v), m }
		const key = `-----KEY ${name}-----`
		const n = { name, host, port: 4200, key, store, up: true, auth: !!o.auth, old: !!o.old, calls: [] }
		n.ping = () => ({ appId: 'highascg', selfId: name, hostname: name, instanceId: `i-${name}`, appVersion: 'x',
			...(n.old ? {} : { clusterLinked: linkedFingerprints(store) }) })
		n.c = createCluster({
			persistence: store,
			selfKey: key,
			selfPing: async () => n.ping(),
			selfPort: () => 4200,
			now: clock.now,
			hosts: () => [],
			fetchJson: async (h, p, url) => {
				const peer = reach(h, p)
				if (!peer) return refused
				if (url === '/api/replication/ping') return ok(peer.ping())
				if (url === '/api/cluster/identity') return ok({ device_key: peer.key })
				return ok({ error: 'not found' }, 404)
			},
			request: async (method, h, p, url, body) => {
				const peer = reach(h, p)
				if (!peer) return refused
				peer.calls.push(`${method} ${url}`)
				if (peer.auth) return ok({ error: 'Unauthorized' }, 401)
				if (method === 'POST' && url === '/api/cluster/peers') {
					const b = peer.old ? { address: body.address } : body // an older server ignores link_back
					const r = await peer.c.add(b)
					return ok(r.body, r.status)
				}
				const del = /^\/api\/cluster\/peers\/([^?]+)(\?link_back=0)?$/.exec(url)
				if (method === 'DELETE' && del) {
					const r = await peer.c.unlink(decodeURIComponent(del[1]), { linkBack: !del[2] })
					return r.ok ? ok(r) : ok({ error: 'no such server' }, 404)
				}
				return ok({ error: 'not found' }, 404)
			},
			localAddress: async (h, p) => (reach(h, p) ? host : ''),
		})
		nodes.set(`${host}:4200`, n)
		return n
	}
	const ids = (n) => n.c.snapshot().peers.map((p) => p.id).sort()
	const peerOf = (n, id) => n.c.snapshot().peers.find((p) => p.id === id)
	const stopAll = () => nodes.forEach((n) => n.c.stop())
	return { server, clock, ids, peerOf, stopAll }
}

describe('WO-732 P1 mutual link', () => {
	it('linking one server links both; the view says it is linked back', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		const r = await a.c.add({ address: '10.0.0.2' })
		assert.equal(r.status, 201)
		assert.deepEqual(r.body.link_back, { ok: true, error: '' })
		assert.deepEqual(net.ids(a), ['boxB'])
		assert.deepEqual(net.ids(b), ['boxA'], 'B lists A without anyone clicking on B')
		assert.equal(b.store.m.get('clusterPeers')[0].host, '10.0.0.1', 'B links A by the address A reaches it from')
		assert.equal(b.store.m.get('clusterPeers')[0].device_key, a.key, 'B recorded A’s identity (signed calls work both ways)')
		assert.deepEqual(b.calls, ['POST /api/cluster/peers'])
		assert.deepEqual(a.calls, [], 'B did not call back: link_back false')
		await a.c.poll()
		await b.c.poll()
		assert.equal(net.peerOf(a, 'boxB').linked_back, true)
		assert.equal(net.peerOf(b, 'boxA').linked_back, true)
		assert.equal(net.peerOf(a, 'boxB').link_back_error, '')
		net.stopAll()
	})

	it('unlinking on either server unlinks both', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		await a.c.add({ address: '10.0.0.2' })
		const r = await b.c.unlink('boxA')
		assert.deepEqual(r, { ok: true, link_back: { ok: true, error: '' } })
		assert.deepEqual(net.ids(a), [])
		assert.deepEqual(net.ids(b), [])
		assert.deepEqual(await a.c.unlink('boxB'), { ok: false }, 'nothing left to unlink')
		net.stopAll()
	})

	it('a half link (the WO-670 one-sided link, as found live) is repaired on a poll, at most every HEAL_MS', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		await a.c.add({ address: '10.0.0.2', link_back: false }) // A lists B, nobody asked B
		assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], []])
		await a.c.poll()
		assert.equal(net.peerOf(a, 'boxB').linked_back, false, 'seen one-way')
		net.clock.advance(HEAL_MS)
		await a.c.poll()
		assert.deepEqual(net.ids(b), ['boxA'], 'repaired')
		await a.c.poll()
		assert.equal(net.peerOf(a, 'boxB').linked_back, true)
		const n = b.calls.length
		await a.c.poll()
		assert.equal(b.calls.length, n, 'a linked peer is not asked again')
		net.stopAll()
	})

	it('an unlink the other server missed: its repair is refused and it drops its side; linking again clears that', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		await a.c.add({ address: '10.0.0.2' })
		b.up = false
		const r = await a.c.unlink('boxB')
		assert.equal(r.link_back.ok, false)
		assert.equal(a.store.m.get(TOMBSTONE_KEY)[0].fp, fingerprint(b.key))
		b.up = true
		net.clock.advance(HEAL_MS)
		await b.c.poll()
		assert.deepEqual([net.ids(a), net.ids(b)], [[], []], 'B dropped A instead of linking again')
		const again = await a.c.add({ address: '10.0.0.2' })
		assert.equal(again.body.link_back.ok, true, 'an operator link clears the tombstone')
		assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], ['boxA']])
		net.stopAll()
	})

	it('right after an unlink a racing repair is refused; an operator link on the other side survives its own repair', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		await a.c.add({ address: '10.0.0.2' })
		await a.c.unlink('boxB')
		const race = await a.c.add({ address: '10.0.0.2', link_back: false })
		assert.equal(race.status, 409)
		assert.equal(race.body.unlinked, true)
		const r = await b.c.add({ address: '10.0.0.1' })
		assert.equal(r.body.link_back.ok, false, 'refused within 2 × HEAL_MS of the unlink')
		net.clock.advance(HEAL_MS)
		await b.c.poll()
		assert.deepEqual(net.ids(b), ['boxA'], 'the operator’s link is kept')
		net.clock.advance(HEAL_MS)
		await b.c.poll()
		assert.deepEqual([net.ids(a), net.ids(b)], [['boxB'], ['boxA']], 'and linked both ways once the guard ran out')
		net.stopAll()
	})

	it('a server that needs sign-in: linked here, shown one-way with the reason', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		net.server('boxB', '10.0.0.2', { auth: true })
		const r = await a.c.add({ address: '10.0.0.2' })
		assert.equal(r.status, 201)
		assert.equal(r.body.link_back.ok, false)
		assert.match(r.body.link_back.error, /needs sign-in: link this server there/)
		await a.c.poll()
		assert.equal(net.peerOf(a, 'boxB').linked_back, false)
		assert.match(net.peerOf(a, 'boxB').link_back_error, /sign-in/)
		net.stopAll()
	})

	it('an older server (no clusterLinked) takes the link back through its plain add, and is asked once', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2', { old: true })
		await a.c.add({ address: '10.0.0.2' })
		assert.deepEqual(net.ids(b), ['boxA'])
		await a.c.poll()
		net.clock.advance(HEAL_MS * 3)
		await a.c.poll()
		assert.deepEqual(b.calls, ['POST /api/cluster/peers'], 'no repeat: its link state cannot be read')
		assert.equal(net.peerOf(a, 'boxB').linked_back, true, 'its add answered OK')
		net.stopAll()
	})

	it('three servers: each link is made once and every server lists the other two', async () => {
		const net = lan()
		const a = net.server('boxA', '10.0.0.1')
		const b = net.server('boxB', '10.0.0.2')
		const c = net.server('boxC', '10.0.0.3')
		await a.c.add({ address: '10.0.0.2' })
		await a.c.add({ address: '10.0.0.3' })
		await b.c.add({ address: '10.0.0.3' })
		assert.deepEqual([net.ids(a), net.ids(b), net.ids(c)], [['boxB', 'boxC'], ['boxA', 'boxC'], ['boxA', 'boxB']])
		net.stopAll()
	})

	it('wiring: the routes unlink through unlink(), the ping lists the linked servers, the port comes from config', () => {
		const routes = fs.readFileSync(path.join(ROOT, 'src/api/routes-cluster.js'), 'utf8')
		assert.ok(routes.includes("await clusterOf(ctx).unlink(params.id, { linkBack: String(query?.link_back ?? '') !== '0' })"))
		assert.ok(routes.includes('selfPort: () => ctx.config?.server?.httpPort'))
		const ping = fs.readFileSync(path.join(ROOT, 'src/api/routes-replication-get.js'), 'utf8')
		assert.ok(ping.includes("clusterLinked: require('../cluster/" + "cluster-peers').linkedFingerprints(")) // concat: not a require
	})
})
