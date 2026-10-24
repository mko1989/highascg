'use strict'

/**
 * WO-723 — owner 24.10: "It doesn't need to be a tick box. It gets resolved in config. But when devices are
 * connected there should be a choice … which server should send, receive". server-duties.js resolves what this
 * server does from its config and the linked servers; server-senders.js holds the "Sent by" / "Received by" choice,
 * resolves it the same way on every server and keeps the linked servers in agreement. Plus: the sandbox signs with
 * its own device key, never the live box's.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')

const duties = require('../../src/cluster/server-duties')
const { resolve, createSenders, createSendersSync, KINDS, REFUSED_RETRY_MS } = require('../../src/cluster/server-senders')
const { RouteRegistry } = require('../../src/api/route-registry')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const A = 'a'.repeat(16)
const B = 'b'.repeat(16)
const C = 'c'.repeat(16)
const memStore = (init = {}) => {
	const m = new Map(Object.entries(init))
	return { get: (k) => m.get(k), set: (k, v) => m.set(k, JSON.parse(JSON.stringify(v))), m }
}
/** A's view of a cluster: peers [{ fp, online, tracking }]. */
const viewOf = (self, peers, { master = '', tracking = false } = {}) => ({ self: { fp: self, name: self[0] }, peers, master, tracking })

describe('WO-723 resolve: who sends, the same answer on every server', () => {
	it('a single server does everything; an explicit choice wins, even for an offline server', () => {
		for (const k of KINDS) assert.equal(resolve(k, { by: '' }, viewOf(A, [])).here, true, `${k}: alone`)
		const peers = [{ fp: B, online: false }]
		assert.deepEqual(resolve('lighting', { by: B }, viewOf(A, peers)), { who: B, auto: false, here: false }, 'chosen B, B offline: never doubled')
		assert.deepEqual(resolve('lighting', { by: A }, viewOf(A, peers)), { who: A, auto: false, here: true })
		assert.equal(resolve('lighting', { by: C }, viewOf(A, [])).auto, true, 'an unknown server → Auto')
		assert.equal(resolve('lighting', { by: B }, viewOf(A, [])).here, true, 'unlinked everything → this server again')
	})

	it('Auto: lighting / PTZ on the one server doing tracking, else the master, else the lowest fingerprint; input everywhere', () => {
		const both = (fn) => [fn(A, [{ fp: B, online: true, tracking: false }], false), fn(B, [{ fp: A, online: true, tracking: false }], false)]
		// B tracks
		const a = resolve('lighting', { by: '' }, viewOf(A, [{ fp: B, online: true, tracking: true }]))
		const b = resolve('lighting', { by: '' }, viewOf(B, [{ fp: A, online: true, tracking: false }], { tracking: true }))
		assert.deepEqual([a.who, a.here, b.who, b.here], [B, false, B, true], 'the tracking server sends; exactly one')
		// nobody tracks, B is master
		const [ma, mb] = both((self, peers) => resolve('ptz', { by: '' }, viewOf(self, peers, { master: B })))
		assert.deepEqual([ma.here, mb.here], [false, true], 'the master')
		// nobody tracks, no master → lowest fingerprint (A)
		const [la, lb] = both((self, peers) => resolve('lighting', { by: '' }, viewOf(self, peers)))
		assert.deepEqual([la.here, lb.here], [true, false], 'lowest fingerprint')
		// an offline peer does not count
		assert.equal(resolve('lighting', { by: '' }, viewOf(B, [{ fp: A, online: false, tracking: true }])).here, true)
		// lighting input: every server
		const i = resolve('artnet_in', { by: '' }, viewOf(A, [{ fp: B, online: true, tracking: true }]))
		assert.deepEqual(i, { who: '*', auto: true, here: true })
		assert.equal(resolve('artnet_in', { by: B }, viewOf(A, [{ fp: B, online: true }])).here, false, 'chosen: only that one')
	})
})

describe('WO-723 the choice store and its sync', () => {
	it('set validates, persists, notifies; merge keeps the newer per kind', () => {
		let t = 1000
		const store = memStore()
		const s = createSenders({ persistence: store, now: () => t })
		const seen = []
		s.onChange((v) => seen.push(v.lighting.by))
		assert.throws(() => s.set('dmx', ''), (e) => e.status === 400 && /unknown kind/.test(e.message))
		assert.throws(() => s.set('lighting', 'not-a-fp'), (e) => e.status === 400)
		assert.deepEqual(seen, [])
		s.set('lighting', B)
		assert.deepEqual(store.m.get('clusterSenders').lighting, { by: B, at: 1000 })
		s.set('lighting', '')
		assert.equal(s.get().lighting.at, 1001, 'a second change in the same ms still moves forward')
		assert.equal(s.merge({ lighting: { by: A, at: 900 } }), false, 'older: ignored')
		assert.equal(s.merge({ lighting: { by: A, at: 2000 }, ptz: { by: 'junk', at: 3000 } }), true)
		assert.deepEqual(s.get().lighting, { by: A, at: 2000 })
		assert.deepEqual(s.get().ptz, { by: '', at: 3000 }, 'a malformed fingerprint arrives as Auto')
		assert.deepEqual(seen, [B, '', A])
	})

	it('sync: each online server is sent the set once; a refusal is asked again slowly; no answer at the next poll', async () => {
		let t = 0
		const calls = []
		let answer = { ok: true, status: 200 }
		const peers = [{ id: 'p', name: 'P', online: true }]
		let set = { lighting: { by: '', at: 1 } }
		const logs = []
		const sync = createSendersSync({
			peers: () => peers,
			get: () => set,
			call: async (id, action, args) => (calls.push([id, action, args.senders.lighting.at]), answer),
			log: (lvl, m) => logs.push(m),
			now: () => t,
		})
		await sync.tick()
		await sync.tick()
		assert.deepEqual(calls, [['p', 'cluster.senders', 1]], 'once per set')
		set = { lighting: { by: '', at: 2 } }
		answer = { ok: false, status: 400, json: { error: 'unknown action "cluster.senders"' } } // an older server
		await sync.tick()
		await sync.tick()
		assert.equal(calls.length, 2, 'a refusal is not repeated every poll')
		assert.equal(logs.length, 1)
		assert.match(sync.refused('p'), /unknown action/)
		// found on the two-box test: the first send went out before the other server linked back (403 "not linked
		// here") — that refusal is not final, so it is asked again once REFUSED_RETRY_MS has passed
		t += REFUSED_RETRY_MS + 1
		answer = { ok: true, status: 200 }
		await sync.tick()
		assert.equal(calls.length, 3, 'asked again after the slow wait, and accepted')
		assert.equal(sync.refused('p'), '')
		set = { lighting: { by: '', at: 3 } }
		answer = { ok: false, status: 0, error: 'ECONNREFUSED' }
		await sync.tick()
		await sync.tick()
		assert.equal(calls.length, 5, 'no answer: tried again at the next poll')
		answer = { ok: false, status: 403, json: { error: 'not linked here' } }
		set = { lighting: { by: '', at: 4 } }
		await sync.tick()
		assert.equal(calls.length, 6)
		peers[0].online = false
		await sync.tick()
		peers[0].online = true
		answer = { ok: true, status: 200 }
		await sync.tick()
		assert.equal(calls.length, 7, 'back online: sent again at once, refusal or not')
	})

	it('two servers agree: a choice made on A reaches B, and exactly one of them sends', async () => {
		const mk = (self, other) => {
			const d = duties.createServerDuties({ persistence: memStore() })
			d.provide({ cluster: () => ({ self: { fp: self, name: self[0] }, peers: [{ id: other[0], fp: other, name: other[0], online: true, duties: { tracking: false } }], master: '' }) })
			return d
		}
		const a = mk(A, B)
		const b = mk(B, A)
		assert.deepEqual([a.has('lighting'), b.has('lighting')], [true, false], 'Auto: the lowest fingerprint, on both')
		const sync = createSendersSync({
			peers: () => [{ id: 'b', name: 'B', online: true }],
			get: () => a.senders.get(),
			call: async (id, action, args) => (b.senders.merge(args.senders), { ok: true, status: 200 }),
		})
		a.senders.set('lighting', B)
		await sync.tick()
		assert.deepEqual([a.has('lighting'), b.has('lighting')], [false, true], 'chosen on A: B sends, A stops')
		assert.equal(b.sendersView().senders.lighting.who_name, 'b')
	})
})

describe('WO-723 resolved duties', () => {
	const linkedTo = (d, peer, tracking = false) =>
		d.provide({ tracking: () => tracking, cluster: () => ({ self: { fp: A, name: 'A' }, peers: peer ? [peer] : [], master: '' }) })

	it('a single box resolves everything on (today), and R1-stored ticks are ignored except accept_remote', () => {
		const store = memStore({ serverDuties: { lighting: false, zones: false, accept_remote: false } })
		const d = duties.createServerDuties({ persistence: store })
		const g = d.get()
		for (const n of ['zones', 'auto', 'presenters', 'lighting', 'ptz', 'artnet_in']) assert.equal(g[n], true, n)
		assert.equal(g.tracking, false)
		assert.equal(g.accept_remote, false, 'the one stored setting survives')
		assert.deepEqual(Object.keys(g), duties.NAMES)
	})

	it('a linked server doing tracking takes zones / Auto / presenters; doing it here keeps them', () => {
		const d = duties.createServerDuties({ persistence: memStore() })
		const seen = []
		d.onChange((next, prev) => seen.push([prev.zones, next.zones]))
		linkedTo(d, { id: 'b', fp: B, name: 'B', online: true, duties: { tracking: true } })
		assert.deepEqual([d.has('zones'), d.has('auto'), d.has('presenters'), d.has('lighting')], [false, false, false, false])
		assert.deepEqual(seen, [[true, false]], 'one notification for the change')
		linkedTo(d, { id: 'b', fp: B, name: 'B', online: true, duties: { tracking: true } }, true)
		assert.equal(d.has('zones'), true, 'both track: each runs its own')
		linkedTo(d, { id: 'b', fp: B, name: 'B', online: true, duties: { detection: true } }, false)
		assert.equal(d.has('zones'), true, 'an older server (no `tracking` in its duties) counts as not tracking')
		const n = seen.length
		d.refresh()
		assert.equal(seen.length, n, 'refresh without a change notifies nobody')
	})

	it('only accept_remote can be set; a resolved duty answers 400', () => {
		const d = duties.createServerDuties({ persistence: memStore() })
		assert.throws(() => d.set({ lighting: false }), (e) => e.status === 400 && /resolved from this server's config/.test(e.message))
		assert.throws(() => d.set({ nope: true }), (e) => e.status === 400 && /unknown setting/.test(e.message))
		assert.throws(() => d.set({ accept_remote: 'no' }), (e) => e.status === 400)
		assert.equal(d.set({ accept_remote: false }).accept_remote, false)
	})

	it('has() reads the last resolution (it sits in the DMX send path) and re-resolves after REFRESH_MS', () => {
		let t = 0
		let calls = 0
		const d = duties.createServerDuties({ persistence: memStore(), now: () => t })
		d.provide({ cluster: () => (calls++, { self: { fp: A, name: 'A' }, peers: [], master: '' }) })
		const n = calls
		for (let i = 0; i < 100; i++) d.has('lighting')
		assert.equal(calls, n, '100 packets, no re-resolution')
		t = 1500
		d.has('lighting')
		assert.equal(calls, n + 1)
	})
})

describe('WO-723 routes and wiring', () => {
	it('GET / POST /api/server/duties and /api/server/senders through the registry; changes broadcast', async () => {
		const routes = new RouteRegistry()
		require('../../src/api/routes-server-duties').register(routes)
		const sent = []
		const ctx = { _wsBroadcast: (type, body) => sent.push(type) }
		duties.provide({ cluster: () => ({ self: { fp: A, name: 'A' }, peers: [{ id: 'b', fp: B, name: 'B', online: true, duties: {} }], master: '' }) })
		try {
			const g = JSON.parse((await routes.dispatch('GET', '/api/server/duties', '', ctx)).body)
			assert.deepEqual(Object.keys(g), duties.NAMES)
			const bad = await routes.dispatch('POST', '/api/server/duties', JSON.stringify({ patch: { zones: false } }), ctx)
			assert.equal(bad.status, 400)
			const v = JSON.parse((await routes.dispatch('GET', '/api/server/senders', '', ctx)).body)
			assert.deepEqual(v.servers.map((s) => [s.fp, s.self]), [[A, true], [B, false]])
			assert.equal(v.servers[1].refused, '', 'in sync')
			assert.deepEqual(Object.keys(v.senders), KINDS)
			for (const body of [{ kind: 'lighting', by: C }, { kind: 'dmx', by: '' }])
				assert.equal((await routes.dispatch('POST', '/api/server/senders', JSON.stringify(body), ctx)).status, 400, JSON.stringify(body))
			const ok = await routes.dispatch('POST', '/api/server/senders', JSON.stringify({ kind: 'lighting', by: B }), ctx)
			assert.equal(ok.status, 200)
			const after = JSON.parse(ok.body).senders.lighting
			assert.deepEqual([after.by, after.here, after.who_name], [B, false, 'B'])
			assert.equal(duties.has('lighting'), false)
			assert.ok(sent.includes('server:senders') && sent.includes('server:duties'), sent.join())
			await routes.dispatch('POST', '/api/server/senders', JSON.stringify({ kind: 'lighting', by: '' }), ctx)
		} finally {
			duties.provide({ cluster: () => null })
		}
		const unlinked = JSON.parse((await routes.dispatch('GET', '/api/server/senders', '', ctx)).body)
		assert.deepEqual(unlinked.servers, [], 'no linked servers: the pickers stay hidden')
	})

	it('the receiver merges a linked server\'s set (info action, not locked by accept_remote); wiring pins', () => {
		const { sendersReceived } = require('../../src/api/routes-cluster')
		assert.equal(sendersReceived({}, {}).status, 400)
		const r = sendersReceived({}, { senders: { ptz: { by: B, at: Date.now() + 1000 } } })
		assert.equal(r.status, 200)
		assert.equal(r.body.changed, true)
		assert.equal(duties.senders().get().ptz.by, B)
		duties.senders().set('ptz', '')
		const rc = read('src/api/routes-cluster.js')
		assert.match(rc, /info: \{ \.\.\.exchangeOf\(ctx\)\.info, 'cluster\.senders': \(args\) => sendersReceived\(ctx, args\) \},/)
		assert.match(rc, /duties\.refresh\(\) \/\/ WO-723: who does what follows the peers' pings\n\t\tawait sendersSyncOf\(ctx\)\.tick\(\)/)
		assert.match(rc, /duties\.provide\(\{ cluster: \(\) => dutiesView\(ctx\) \}\)/)
		assert.match(rc, /duties: p\.duties, refused: refused\(p\.id\) \}/, 'a refusal reaches the picker')
		assert.match(rc, /ctx\._dutiesBroadcast\?\.\(\) \/\/ a server that refused/)
		assert.match(read('src/cluster/cluster-peers.js'), /fp: key \? require\('\.\/cluster-media'\)\.fingerprint\(key\) : ''/)
		assert.match(read('src/tracking/detect-service.js'), /duties\.provide\?\.\(\{ tracking: wanted \}\)/)
		assert.match(read('src/tracking/detect-service.js'), /const wanted = \(\) => !stopped && det\.enabled && cams\.length > 0/)
	})

	it('the lighting input stops listening while another server is chosen to receive it', () => {
		const base = require('../../src/artnet/dmx-border-receiver-base')
		const Cls = base.DmxBorderReceiverBase || base
		const me = { appCtx: { config: { dmx: {} } } }
		duties.provide({ cluster: () => ({ self: { fp: A, name: 'A' }, peers: [{ id: 'b', fp: B, name: 'B', online: true, duties: {} }], master: '' }) })
		try {
			assert.equal(Cls.prototype._isMasterDmxEnabled.call(me), true, 'Auto: every server listens')
			duties.senders().set('artnet_in', B)
			assert.equal(Cls.prototype._isMasterDmxEnabled.call(me), false)
		} finally {
			duties.senders().set('artnet_in', '')
			duties.provide({ cluster: () => null })
		}
	})

	it('the sandbox signs with its own device key (HIGHASCG_DEVICE_IDENTITY_PATH), never the live one', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo723-id-'))
		try {
			const file = path.join(dir, 'device-identity.json')
			const out = cp.execFileSync(process.execPath, ['-e', "const i=require('./src/system/device-identity'); i.getDevicePublicKeyPem(); console.log(i.DEVICE_IDENTITY_PATH)"], {
				cwd: ROOT,
				env: { ...process.env, HIGHASCG_DEVICE_IDENTITY_PATH: file },
				encoding: 'utf8',
			})
			assert.equal(out.trim(), file)
			assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).publicKeyPem, 'the key was made there')
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
		assert.match(read('tools/e2e/sandbox-server.js'), /HIGHASCG_DEVICE_IDENTITY_PATH: path\.join\(root, 'device-identity\.json'\)/)
	})
})

describe('WO-723 the R1 tick block is gone', () => {
	it('no "THIS SERVER DOES" block; pickers only where the senders are set', () => {
		assert.equal(fs.existsSync(path.join(ROOT, 'godot/client/features/devices/server_duties_block.gd')), false)
		assert.doesNotMatch(read('godot/client/features/devices/cluster_panel.gd'), /DutiesBlock/)
		for (const [file, kind] of [
			['godot/client/features/previs/tracking/follow_output.gd', 'lighting'],
			['godot/client/features/previs/tracking/ptz_section.gd', 'ptz'],
			['godot/client/features/live/border_artnet_section.gd', 'artnet_in'],
		])
			assert.match(read(file), new RegExp(`SenderPicker\\.make\\("${kind}"`), file)
	})
})

