'use strict'

/**
 * WO-712 R3 — exchange (src/cluster/cluster-exchange.js): the Auto snapshot goes from the server with the `auto` duty
 * to the linked servers that do not do Auto, which re-broadcast it tagged with its source; the overlay's buttons go
 * back over POST /api/cluster/send. Two in-process servers with test ed25519 keys over the real signed call
 * (cluster-call.js `info` list), never the box's device key or the node persistence file (server-duties writes its
 * scratch file under node --test).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { createClusterCall } = require('../../src/cluster/cluster-call')
const { createExchange, HEARTBEAT_MS, EXPIRE_MS } = require('../../src/cluster/cluster-exchange')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
const verify = (pem, msg, sig) => {
	try {
		return crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(String(sig), 'base64'))
	} catch {
		return false
	}
}
const keyPair = () => {
	const k = crypto.generateKeyPairSync('ed25519')
	return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: k.privateKey }
}
const flush = () => new Promise((r) => setImmediate(r))

/**
 * Server T (tracking: auto on) and M (media: auto off), linked both ways. Each: { call, ex, ws[], logs[], duties }.
 * `peerDuties` = what T's poll last saw of M (online + duties), editable per test.
 */
function pair() {
	const clock = { t: 9_000_000 }
	const keys = { T: keyPair(), M: keyPair() }
	const nodes = {}
	for (const n of ['T', 'M']) {
		const other = n === 'T' ? 'M' : 'T'
		const saved = [{ id: other, host: other, port: 4200, name: `srv-${other}`, device_key: keys[other].pub.trim() }]
		const node = {
			ws: [],
			logs: [],
			accept: true,
			duties: { auto: n === 'T' },
			seen: { online: true, duties: { auto: n !== 'T' } },
			posts: 0,
		}
		node.ex = createExchange({
			peers: () => [{ id: other, name: `srv-${other}`, ...node.seen }],
			has: (d) => !!node.duties[d],
			call: (id, action, args, o) => node.call.call(id, action, args, o), // node.call is set just below
			broadcast: (type, data) => node.ws.push([type, data]),
			now: () => clock.t,
			log: (lvl, msg) => node.logs.push(`${lvl} ${msg}`),
		})
		node.call = createClusterCall({
			cluster: { saved: (id) => saved.find((p) => p.id === id) || null, list: () => saved },
			selfKey: keys[n].pub,
			sign: (msg) => crypto.sign(null, Buffer.from(msg), keys[n].priv).toString('base64'),
			verify,
			now: () => clock.t,
			log: (lvl, msg) => node.logs.push(`${lvl} ${msg}`),
			post: async (host, port, p, body) => {
				node.posts++
				if (node.hold) await node.hold
				const r = await nodes[host].call.handle(JSON.parse(JSON.stringify(body))) // over the wire: JSON only
				return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.body }
			},
			acceptsRemote: () => node.accept,
			masterId: () => '',
			info: node.ex.info,
			actions: { 'tracking.auto.pin': async (args) => ({ status: 200, body: { pinned: args } }) },
		})
		nodes[n] = node
	}
	return { ...nodes, clock }
}

const SNAP = { persons: [{ key: 'w:1', slot: 1 }], pool: [{ id: 'h1' }], home: { active: false, after_s: 8 } }

describe('WO-712 R3 exchange: sender', () => {
	it('sends to an online linked server whose duties say auto: false — not offline, not an older server, not one doing Auto', async () => {
		const s = pair()
		assert.equal(s.T.ex.offer('tracking.auto', SNAP), 1)
		await flush()
		assert.equal(s.T.posts, 1)
		for (const seen of [
			{ online: false, duties: { auto: false } },
			{ online: true, duties: null },
			{ online: true, duties: { auto: true } },
		]) {
			const t = pair()
			t.T.seen = seen
			assert.equal(t.T.ex.offer('tracking.auto', SNAP), 0, JSON.stringify(seen))
			assert.equal(t.T.posts, 0)
		}
	})

	it('a server without the auto duty offers nothing', () => {
		const s = pair()
		s.T.duties.auto = false
		assert.equal(s.T.ex.offer('tracking.auto', SNAP), 0)
		assert.equal(s.T.ex.offer('nope', SNAP), 0, 'unknown topic')
	})

	it('on change, and every heartbeat while unchanged — not at the 5 Hz look rate', async () => {
		const s = pair()
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		for (let i = 0; i < 20; i++) {
			s.clock.t += 200
			s.T.ex.offer('tracking.auto', SNAP)
			await flush()
		}
		assert.equal(s.T.posts, 1, '4 s unchanged: no resend')
		s.clock.t += HEARTBEAT_MS - 4000
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		assert.equal(s.T.posts, 2, 'heartbeat')
		s.T.ex.offer('tracking.auto', { ...SNAP, pool: [] })
		await flush()
		assert.equal(s.T.posts, 3, 'changed')
	})

	it('one call in flight per peer; only the newest waiting data is sent after it', async () => {
		const s = pair()
		let release
		s.T.hold = new Promise((r) => (release = r))
		s.T.ex.offer('tracking.auto', SNAP)
		s.T.ex.offer('tracking.auto', { ...SNAP, home: { active: true } })
		s.T.ex.offer('tracking.auto', { ...SNAP, home: { active: true, after_s: 3 } })
		assert.equal(s.T.posts, 1)
		s.T.hold = null
		release()
		for (let i = 0; i < 5; i++) await flush()
		assert.equal(s.T.posts, 2, 'the middle one was dropped')
		assert.deepEqual(s.M.ws.at(-1)[1].home, { active: true, after_s: 3 })
	})

	it('a refusing peer is logged once, and once more when it takes calls again; the call itself stays quiet', async () => {
		const s = pair()
		s.M.duties.auto = true // M says it does Auto itself → 409
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		s.clock.t += HEARTBEAT_MS
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		assert.equal(s.T.posts, 2)
		assert.deepEqual(s.T.logs, ['warn [cluster] exchange exchange.tracking_auto → srv-M: this server does auto itself'])
		s.M.duties.auto = false
		s.clock.t += HEARTBEAT_MS
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		assert.equal(s.T.logs.length, 2)
		assert.match(s.T.logs[1], /^info .*srv-M: taking it again$/)
	})
})

describe('WO-712 R3 exchange: receiver', () => {
	it('re-broadcasts WS tracking:auto tagged with its source, once per change; no journal line per call', async () => {
		const s = pair()
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		assert.deepEqual(s.M.ws, [['tracking:auto', { ...SNAP, source: { id: 'T', name: 'srv-T' } }]])
		s.clock.t += HEARTBEAT_MS
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		assert.equal(s.M.ws.length, 1, 'a heartbeat with the same data is not re-broadcast')
		assert.deepEqual(s.M.logs, [], 'information: no "[cluster] remote …" line')
		assert.deepEqual(s.M.ex.latest('tracking.auto'), { ...SNAP, source: { id: 'T', name: 'srv-T' } })
	})

	it('accept_remote off still receives (it presses nothing), but still refuses actions', async () => {
		const s = pair()
		s.M.accept = false
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		assert.equal(s.M.ws.length, 1)
		const r = await s.T.call.call('M', 'tracking.auto.pin', { key: 'w:1', slot: 2 })
		assert.equal(r.status, 403)
	})

	it('a server that does Auto itself refuses (409) and broadcasts nothing; bad data is 400', async () => {
		const s = pair()
		s.M.duties.auto = true
		const r = await s.M.ex.info['exchange.tracking_auto']({ data: SNAP }, { id: 'T', name: 'srv-T' })
		assert.equal(r.status, 409)
		s.M.duties.auto = false
		for (const data of [null, [1], 'x']) {
			assert.equal((await s.M.ex.info['exchange.tracking_auto']({ data }, { id: 'T', name: 'srv-T' })).status, 400)
		}
		assert.deepEqual(s.M.ws, [])
	})

	it('a source not heard from for 15 s is dropped and re-broadcast empty once (the overlay hides)', async () => {
		const s = pair()
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		s.clock.t += EXPIRE_MS
		s.M.ex.expire()
		assert.equal(s.M.ws.length, 1, 'exactly 15 s: still current')
		s.clock.t += 1
		s.M.ex.expire()
		s.M.ex.expire()
		assert.equal(s.M.ws.length, 2)
		assert.deepEqual(s.M.ws[1], [
			'tracking:auto',
			{ persons: [], pool: [], source: { id: 'T', name: 'srv-T' }, gone: true },
		])
		assert.equal(s.M.ex.latest('tracking.auto'), null)
		assert.deepEqual(s.M.ex.view(), { 'tracking.auto': null, sources: [] })
	})

	it('GET view lists the current source with its age', async () => {
		const s = pair()
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		s.clock.t += 1200
		const v = s.M.ex.view()
		assert.equal(v['tracking.auto'].source.name, 'srv-T')
		assert.deepEqual(v.sources, [{ topic: 'tracking.auto', source: { id: 'T', name: 'srv-T' }, age_ms: 1200 }])
	})
})

describe('WO-712 R3 auto routes on a server without the auto duty', () => {
	const duties = require('../../src/cluster/server-duties')
	const { handleAuto, createAutoBroadcast, OFF } = require('../../src/tracking/auto-routes')
	const director = { snapshot: () => SNAP }

	it('GET /api/tracking/auto answers OFF; the WS sends OFF once; back on, the snapshot again', () => {
		const ws = []
		const ctx = { _wsBroadcast: (t, d) => ws.push([t, d]) }
		const b = createAutoBroadcast()
		try {
			duties.set({ auto: false })
			assert.deepEqual(JSON.parse(handleAuto(director, { method: 'GET', path: '/api/tracking/auto' }).body), OFF)
			b.tick(director, ctx, 1000)
			b.tick(director, ctx, 1400)
			assert.deepEqual(ws, [['tracking:auto', OFF]])
			duties.set({ auto: true })
			b.tick(director, ctx, 1800)
			assert.deepEqual(ws.at(-1), ['tracking:auto', SNAP])
			assert.deepEqual(JSON.parse(handleAuto(director, { method: 'GET', path: '/api/tracking/auto' }).body), SNAP)
		} finally {
			duties.set({ auto: true })
		}
	})

	it('a look is offered to the exchange only while servers are linked (ctx._cluster), never starting the service', () => {
		const offered = []
		const ctx = { _wsBroadcast: () => {}, _clusterExchange: { offer: (t, d) => offered.push([t, d]) } }
		const b = createAutoBroadcast()
		b.tick(director, ctx, 1000)
		assert.deepEqual(offered, [], 'no linked servers: nothing')
		ctx._cluster = {}
		b.tick(director, ctx, 1400)
		assert.deepEqual(offered, [['tracking.auto', SNAP]], 'every look (the exchange decides what to send)')
	})
})

describe('WO-712 R3 routes', () => {
	it('POST /api/cluster/send and GET /api/cluster/exchange through the real router; send needs the normal auth', async () => {
		const { routeRequest } = require('../../src/api/router')
		const s = pair()
		s.T.ex.offer('tracking.auto', SNAP)
		await flush()
		const ctx = { _clusterCall: s.M.call, _clusterExchange: s.M.ex, config: {} }
		const ex = await routeRequest('GET', '/api/cluster/exchange', '', ctx, { headers: {} })
		assert.equal(ex.status, 200)
		assert.equal(JSON.parse(ex.body)['tracking.auto'].source.id, 'T')
		const body = JSON.stringify({ peer: 'T', action: 'tracking.auto.pin', args: { key: 'w:1', slot: 4 } })
		const r = await routeRequest('POST', '/api/cluster/send', body, ctx, { headers: {} })
		assert.equal(r.status, 200)
		assert.deepEqual(JSON.parse(r.body), { pinned: { key: 'w:1', slot: 4 } })
		const none = await routeRequest('POST', '/api/cluster/send', JSON.stringify({ peer: 'Z', action: 'x' }), ctx, {
			headers: {},
		})
		assert.equal(none.status, 404)
		const authed = { ...ctx, config: { security: { enforceAuth: true, apiToken: 'wo712-r3-token' } } }
		assert.equal((await routeRequest('POST', '/api/cluster/send', body, authed, { headers: {} })).status, 401)
		assert.equal((await routeRequest('GET', '/api/cluster/exchange', '', authed, { headers: {} })).status, 401)
	})

	it("wiring: the call gets the exchange info list; auto-routes offers each look; PTZ setup ignores another server's snapshot", () => {
		assert.match(read('src/api/routes-cluster.js'), /info: exchangeOf\(ctx\)\.info,/)
		assert.match(
			read('src/tracking/auto-routes.js'),
			/if \(ctx\._cluster\) require\('\.\.\/api\/routes-cluster'\)\.exchangeOf\(ctx\)\.offer\('tracking\.auto', snap\)/
		)
		assert.match(
			read('godot/client/features/previs/tracking/ptz_section.gd'),
			/type == "tracking:auto" and data is Dictionary and not \(data as Dictionary\)\.has\("source"\)/
		)
		assert.match(read('godot/client/features/previs/tracking/auto_overlay_model.gd'), /"\/api\/cluster\/send"/)
		assert.match(read('godot/client/features/previs/tracking/auto_overlay.gd'), /var p := M.press\(data, path, body\)/)
	})
})
