'use strict'

/**
 * WO-712 R2 — one signed "call another linked server" primitive (src/cluster/cluster-call.js) and its allow-list
 * (src/cluster/cluster-call-actions.js). Two in-process servers with test ed25519 keys (never the box's device key,
 * never the persistence file): a signed call is taken; every rejection (unlinked, wrong `to`, stale, replay, bad sig,
 * accept_remote off, unknown action); each action reaches its local handler; a follower hands look.take and its zone
 * `look:` to the master; POST /api/cluster/call is reachable through the real router, also while enforceAuth is on.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { createClusterCall, callText, stableJson, MAX_SKEW_MS, NONCE_MS } = require('../../src/cluster/cluster-call')
const { createCallActions } = require('../../src/cluster/cluster-call-actions')
const { fingerprint } = require('../../src/cluster/cluster-media')
const { runAction, parseAction } = require('../../src/tracking/zone-actions')
const auth = require('../../src/server/auth')

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

/**
 * names → servers; `links[n]` = who n linked (default everyone else). Each node: { call, actions, logs, accept }.
 * `actions[n]` overrides that server's allow-list; the default records each run.
 */
function servers(names, opts = {}) {
	const clock = { t: 5_000_000 }
	const keys = Object.fromEntries(names.map((n) => [n, keyPair()]))
	const nodes = {}
	const ran = []
	for (const n of names) {
		const peers = (opts.links?.[n] || names.filter((x) => x !== n)).map((x) => ({
			id: x,
			host: x,
			port: 4200,
			name: `srv-${x}`,
			device_key: keys[x].pub.trim(),
		}))
		const logs = []
		const node = { logs, accept: true, master: opts.master?.[n] || '' }
		node.call = createClusterCall({
			cluster: { saved: (id) => peers.find((p) => p.id === id) || null, list: () => peers },
			selfKey: keys[n].pub,
			sign: (msg) => crypto.sign(null, Buffer.from(msg), keys[n].priv).toString('base64'),
			verify,
			now: () => clock.t,
			log: (lvl, msg) => logs.push(`${lvl} ${msg}`),
			post: async (host, port, p, body) => {
				assert.equal(p, '/api/cluster/call')
				const r = await nodes[host].call.handle(JSON.parse(JSON.stringify(body))) // over the wire: JSON only
				return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.body }
			},
			acceptsRemote: () => node.accept,
			masterId: () => node.master,
			actions: opts.actions?.[n] || {
				ping: async (args, from) => (ran.push([n, 'ping', args, from.id]), { status: 200, body: { ok: true, on: n } }),
			},
		})
		nodes[n] = node
	}
	return { nodes, keys, clock, ran, fp: (n) => fingerprint(keys[n].pub) }
}

/** A hand-built signed body from `n` to `to` (for the rejections). */
function signed(s, n, to, over = {}) {
	const b = {
		action: 'ping',
		args: { x: 1 },
		from: s.fp(n),
		to: s.fp(to),
		ts: s.clock.t,
		nonce: crypto.randomBytes(16).toString('hex'),
		...over,
	}
	return {
		...b,
		sig: crypto.sign(null, Buffer.from(callText(b)), s.keys[n].priv).toString('base64'),
		...(over.sig ? { sig: over.sig } : {}),
	}
}

describe('WO-712 R2 cluster call: wire + receiver checks', () => {
	it('a signed call is taken, runs the action once and logs "[cluster] remote <action> from <peer name>"', async () => {
		const s = servers(['A', 'B'])
		const r = await s.nodes.A.call.call('B', 'ping', { b: 2, a: 1 })
		assert.equal(r.status, 200)
		assert.deepEqual(r.json, { ok: true, on: 'B' })
		assert.deepEqual(s.ran, [['B', 'ping', { b: 2, a: 1 }, 'A']])
		assert.deepEqual(s.nodes.B.logs, ['info [cluster] remote ping from srv-A'])
		assert.equal(s.nodes.A.call.me, s.fp('A'))
	})

	it('signed text: fixed field order, args as sorted JSON (key order does not matter, any change does)', () => {
		const b = { action: 'x', args: { b: [1, { d: 2, c: 3 }], a: 'q' }, from: 'f', to: 't', ts: 9, nonce: 'n' }
		assert.equal(callText(b), callText({ ...b, args: { a: 'q', b: [1, { c: 3, d: 2 }] } }))
		assert.equal(
			callText(b),
			JSON.stringify(['highascg-call-1', 'x', 'f', 't', 9, 'n', '{"a":"q","b":[1,{"c":3,"d":2}]}'])
		)
		for (const k of ['action', 'from', 'to', 'ts', 'nonce'])
			assert.notEqual(callText(b), callText({ ...b, [k]: k === 'ts' ? 10 : 'other' }), k)
		assert.notEqual(callText(b), callText({ ...b, args: { a: 'q', b: [1, { c: 3, d: 2 }], e: 0 } }))
		assert.equal(stableJson({ u: undefined, z: null }), '{"z":null}')
	})

	it('rejections: unlinked sender, wrong to, stale ts, replayed nonce, bad sig, accept_remote off, unknown action, malformed', async () => {
		const s = servers(['A', 'B', 'C'], { links: { B: ['A'] } }) // B linked A only; C knows B
		const B = s.nodes.B.call
		const expect = async (body, status, error) => {
			const r = await B.handle(body)
			assert.equal(r.status, status, `${error}: ${JSON.stringify(r.body)}`)
			assert.match(r.body.error, error)
		}
		await expect(signed(s, 'C', 'B'), 403, /not linked here/)
		assert.equal((await s.nodes.C.call.call('B', 'ping')).status, 403, 'through the sender too')
		await expect(signed(s, 'A', 'C'), 400, /for another server/)
		await expect(signed(s, 'A', 'B', { ts: s.clock.t - MAX_SKEW_MS - 1 }), 400, /stale/)
		await expect(signed(s, 'A', 'B', { ts: s.clock.t + MAX_SKEW_MS + 1 }), 400, /stale/)
		assert.equal(
			(await B.handle(signed(s, 'A', 'B', { ts: s.clock.t - MAX_SKEW_MS }))).status,
			200,
			'exactly 60 s is still fresh'
		)
		const once = signed(s, 'A', 'B')
		assert.equal((await B.handle(once)).status, 200)
		await expect(once, 409, /replayed/)
		s.clock.t += MAX_SKEW_MS
		await expect(once, 409, /replayed/) // still remembered while its ts could pass
		s.clock.t += NONCE_MS
		await expect(once, 400, /stale/) // forgotten only once the ts check refuses it anyway
		const forged = signed(s, 'A', 'B')
		await expect({ ...forged, sig: signed(s, 'C', 'B', { nonce: forged.nonce }).sig }, 403, /bad signature/) // C's key, A's name
		await expect({ ...signed(s, 'A', 'B'), args: { x: 2 } }, 403, /bad signature/) // args changed after signing
		const unsignedNonce = signed(s, 'A', 'B')
		await expect({ ...unsignedNonce, sig: 'AAAA' }, 403, /bad signature/)
		assert.equal((await B.handle(unsignedNonce)).status, 200, 'a refused forgery does not burn the real nonce')
		s.nodes.B.accept = false
		await expect(signed(s, 'A', 'B'), 403, /^this server refuses remote actions$/)
		s.nodes.B.accept = true
		await expect(signed(s, 'A', 'B', { action: 'amcp.raw' }), 400, /unknown action "amcp.raw"/)
		await expect(signed(s, 'A', 'B', { action: 'constructor' }), 400, /unknown action/)
		await expect({ ...signed(s, 'A', 'B'), nonce: 'zz' }, 400, /malformed/)
		await expect({ ...signed(s, 'A', 'B'), args: [1] }, 400, /args must be an object/)
		await expect(null, 400, /malformed/)
		assert.equal(s.ran.length, 3, 'only the three good calls ran')
	})

	it('callMaster: goes to the master id, refuses when there is no other master', async () => {
		const s = servers(['A', 'B'], { master: { A: 'B' } })
		assert.equal((await s.nodes.A.call.callMaster('ping', { m: 1 })).status, 200)
		assert.deepEqual(s.ran, [['B', 'ping', { m: 1 }, 'A']])
		const r = await s.nodes.B.call.callMaster('ping', {})
		assert.equal(r.status, 409)
		assert.equal((await s.nodes.A.call.call('nope', 'ping')).status, 404)
	})
})

describe('WO-712 R2 allow-list: each action runs the local handler', () => {
	function stubCtx() {
		const seen = []
		const director = Object.fromEntries(
			['pin', 'slot', 'home'].map((op) => [op, (d) => (seen.push([op, d]), { status: 200, body: { op } })])
		)
		const ctx = {
			trackingAuto: director,
			fixtureService: {
				recallLook: (id, ms) => (seen.push(['recall', id, ms]), id === 'L1' ? { fixtures: 2, fade_ms: ms } : null),
			},
		}
		const deps = {
			isFollower: () => false,
			callMaster: async (a, args) => (
				seen.push(['master', a, args]),
				{ ok: true, status: 200, json: { ok: true, by: 'master' } }
			),
			takeLook: async (b) => (seen.push(['take', b]), { status: 200, headers: {}, body: '{"ok":true}' }),
			runAction: async (a) => (
				seen.push(['zone', a]),
				{ ok: true, detail: `companion ${a.page}/${a.row}/${a.col} → 200` }
			),
		}
		return { ctx, deps, seen }
	}

	it('the allow-list is exactly the six R2 actions', () => {
		const { ctx, deps } = stubCtx()
		assert.deepEqual(Object.keys(createCallActions(ctx, deps)).sort(), [
			'companion.press',
			'fixtures.look',
			'look.take',
			'tracking.auto.home',
			'tracking.auto.pin',
			'tracking.auto.slot',
		])
	})

	it('look.take → handleTakeLook (program / preview); 400 without sceneId', async () => {
		const { ctx, deps, seen } = stubCtx()
		const a = createCallActions(ctx, deps)
		assert.deepEqual(await a['look.take']({ sceneId: 's1' }), { status: 200, body: { ok: true } })
		assert.deepEqual(await a['look.take']({ sceneId: 's2', target: 'preview' }), { status: 200, body: { ok: true } })
		assert.equal((await a['look.take']({})).status, 400)
		assert.deepEqual(seen, [
			['take', { sceneId: 's1', target: 'program' }],
			['take', { sceneId: 's2', target: 'preview' }],
		])
	})

	it('look.take on a follower: program goes to the master (once: a relayed take is not handed on); preview stays local', async () => {
		const { ctx, deps, seen } = stubCtx()
		deps.isFollower = () => true
		const a = createCallActions(ctx, deps)
		assert.deepEqual(await a['look.take']({ sceneId: 's1' }), { status: 200, body: { ok: true, by: 'master' } })
		await a['look.take']({ sceneId: 's2', target: 'preview' })
		await a['look.take']({ sceneId: 's3', relayed: true })
		assert.deepEqual(seen, [
			['master', 'look.take', { sceneId: 's1', target: 'program', relayed: true }],
			['take', { sceneId: 's2', target: 'preview' }],
			['take', { sceneId: 's3', target: 'program' }],
		])
	})

	it('tracking.auto.pin / slot / home → the director routes; 503 when the tracking module is off', async () => {
		const { ctx, deps, seen } = stubCtx()
		const a = createCallActions(ctx, deps)
		assert.deepEqual(await a['tracking.auto.pin']({ key: 'p1', slot: 2 }), { status: 200, body: { op: 'pin' } })
		assert.deepEqual(await a['tracking.auto.slot']({ slot: 2, heads: 0 }), { status: 200, body: { op: 'slot' } })
		assert.deepEqual(await a['tracking.auto.home']({ now: true }), { status: 200, body: { op: 'home' } })
		assert.deepEqual(seen, [
			['pin', { key: 'p1', slot: 2 }],
			['slot', { slot: 2, heads: 0 }],
			['home', { now: true }],
		])
		const off = createCallActions({}, deps)
		assert.equal((await off['tracking.auto.pin']({ key: 'p1', slot: 2 })).status, 503)
	})

	it('fixtures.look → the looks recall route (fade clamp, 404, 400, 503)', async () => {
		const { ctx, deps, seen } = stubCtx()
		const a = createCallActions(ctx, deps)
		assert.deepEqual(await a['fixtures.look']({ id: 'L1', fade_ms: 9e9 }), {
			status: 200,
			body: { fixtures: 2, fade_ms: 600000 },
		})
		assert.equal((await a['fixtures.look']({ id: 'nope' })).status, 404)
		assert.equal((await a['fixtures.look']({})).status, 400)
		assert.deepEqual(seen, [
			['recall', 'L1', 600000],
			['recall', 'nope', 0],
		])
		assert.equal((await createCallActions({}, deps)['fixtures.look']({ id: 'L1' })).status, 503)
	})

	it('companion.press { page, row, column } → the zone action Companion press; 400 on bad numbers', async () => {
		const { ctx, deps, seen } = stubCtx()
		const a = createCallActions(ctx, deps)
		assert.deepEqual(await a['companion.press']({ page: 4, row: 0, column: 7 }), {
			status: 200,
			body: { ok: true, detail: 'companion 4/0/7 → 200' },
		})
		assert.equal((await a['companion.press']({ page: 4, row: 0 })).status, 400)
		assert.deepEqual(seen, [['zone', { type: 'companion', page: 4, row: 0, col: 7 }]])
	})

	it('end to end: a signed look.take from A lands on B handleTakeLook', async () => {
		const { ctx, deps, seen } = stubCtx()
		const s = servers(['A', 'B'], { actions: { B: createCallActions(ctx, deps) } })
		const r = await s.nodes.A.call.call('B', 'look.take', { sceneId: 'scene_7' })
		assert.equal(r.status, 200)
		assert.deepEqual(seen, [['take', { sceneId: 'scene_7', target: 'program' }]])
		assert.deepEqual(s.nodes.B.logs, ['info [cluster] remote look.take from srv-A'])
	})
})

describe('WO-712 R2 zone look: on a follower goes to the master', () => {
	/** F follows M: F's zone look → signed look.take → M runs handleTakeLook. */
	function pair() {
		const takes = []
		const mActions = createCallActions(
			{},
			{
				isFollower: () => false,
				callMaster: async () => assert.fail('the master never relays'),
				takeLook: async (b) => (takes.push(b), { status: 200, body: '{"ok":true}' }),
			}
		)
		const s = servers(['F', 'M'], { master: { F: 'M' }, actions: { M: mActions } })
		const ctx = {
			config: {},
			_clusterMaster: { view: () => ({ is_master: false, master_id: 'M', epoch: 3 }) },
			_cluster: { snapshot: () => ({ peers: [{ id: 'M', online: true }] }) },
			_clusterCall: s.nodes.F.call,
		}
		return { s, ctx, takes }
	}

	it('real wiring (routes-cluster isClusterFollower + callOf on the ctx): look:<id> → master; @preview stays local', async () => {
		const { s, ctx, takes } = pair()
		const local = []
		const deps = { takeLook: async (b) => (local.push(b), { status: 200 }) }
		assert.deepEqual(await runAction(parseAction('look:scene_7'), ctx, deps), {
			ok: true,
			detail: 'look scene_7 → master',
		})
		assert.deepEqual(takes, [{ sceneId: 'scene_7', target: 'program' }])
		assert.deepEqual(local, [], 'the follower does not take program itself')
		assert.deepEqual(await runAction(parseAction('look:scene_8@preview'), ctx, deps), {
			ok: true,
			detail: 'look scene_8 → preview',
		})
		assert.deepEqual(local, [{ sceneId: 'scene_8', target: 'preview' }])
		assert.deepEqual(s.nodes.M.logs, ['info [cluster] remote look.take from srv-F'])
	})

	it('the master refusing (accept_remote off) shows in the zone detail', async () => {
		const { s, ctx } = pair()
		s.nodes.M.accept = false
		const r = await runAction(parseAction('look:scene_7'), ctx, { takeLook: async () => assert.fail('not local') })
		assert.deepEqual(r, { ok: false, detail: 'look scene_7 → master (403 this server refuses remote actions)' })
	})

	it('standalone (no cluster ever started) and the master itself take locally, as before', async () => {
		const local = []
		const deps = { takeLook: async (b) => (local.push(b), { status: 200 }) }
		assert.deepEqual(await runAction(parseAction('look:a'), {}, deps), { ok: true, detail: 'look a → program' })
		const { ctx } = pair()
		ctx._clusterMaster = { view: () => ({ is_master: true, master_id: 'self', epoch: 3 }) }
		assert.deepEqual(await runAction(parseAction('look:b'), ctx, deps), { ok: true, detail: 'look b → program' })
		const { ctx: gone } = pair()
		gone._cluster = { snapshot: () => ({ peers: [{ id: 'M', online: false }] }) } // master offline: not following
		assert.deepEqual(await runAction(parseAction('look:c'), gone, deps), { ok: true, detail: 'look c → program' })
		assert.deepEqual(local, [
			{ sceneId: 'a', target: 'program' },
			{ sceneId: 'b', target: 'program' },
			{ sceneId: 'c', target: 'program' },
		])
	})
})

describe('WO-712 R2 route + auth', () => {
	it('POST /api/cluster/call is reachable through the real router dispatch, also with enforceAuth on', async () => {
		const { routeRequest, routes } = require('../../src/api/router')
		const first = routes.routes.find((r) => r.method === 'POST' && r.regex.test('/api/cluster/call'))
		assert.equal(first?.path, '/api/cluster/call', 'no earlier wildcard swallows it')
		const s = servers(['A', 'B'])
		const ctx = {
			_clusterCall: s.nodes.B.call,
			config: { security: { enforceAuth: true, apiToken: 'wo712-test-token' } },
		}
		const r = await routeRequest('POST', '/api/cluster/call', JSON.stringify(signed(s, 'A', 'B')), ctx, { headers: {} })
		assert.equal(r.status, 200, r.body)
		assert.deepEqual(JSON.parse(r.body), { ok: true, on: 'B' })
		const bad = await routeRequest(
			'POST',
			'/api/cluster/call',
			JSON.stringify(signed(s, 'A', 'B', { to: 'f'.repeat(16) })),
			ctx,
			{ headers: {} }
		)
		assert.equal(bad.status, 400, 'the route, not auth, answers a bad call')
		// narrow: nothing else of the cluster API opens up
		assert.equal((await routeRequest('POST', '/api/cluster/master', '{}', ctx, { headers: {} })).status, 401)
		assert.equal((await routeRequest('GET', '/api/cluster/call', '', ctx, { headers: {} })).status, 401)
	})

	it('auth.js opens exactly POST /api/cluster/call', () => {
		assert.equal(auth.isPublicApiPath('POST', '/api/cluster/call'), true)
		for (const [m, p] of [
			['GET', '/api/cluster/call'],
			['POST', '/api/cluster/call/x'],
			['POST', '/api/cluster/master'],
			['POST', '/api/cluster/ssh-key'],
			['POST', '/api/cluster'],
		]) {
			assert.equal(auth.isPublicApiPath(m, p), false, `${m} ${p}`)
		}
	})

	it('wiring: routes-cluster registers the route; register.js exposes the director as ctx.trackingAuto', () => {
		const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
		const rc = read('src/api/routes-cluster.js')
		assert.match(
			rc,
			/routes\.post\('\/api\/cluster\/call', async \(\{ ctx, body \}\) => \{\n\t\tconst r = await callOf\(ctx\)\.handle\(parseBody\(body\)\)/
		)
		assert.match(rc, /acceptsRemote: \(\) => require\('\.\.\/cluster\/server-duties'\)\.has\('accept_remote'\)/)
		assert.match(read('src/tracking/register.js'), /Object\.assign\(ctx, \{ trackingHub: hub, trackingAuto: auto \}\)/)
	})
})
