'use strict'

/**
 * WO-1106 (salad slice) — the Stage Salad page's own fixes, its ES modules run in node:
 *   A36: world-join.js gives the visitors renderer a per-floor height (stage top over the stage, hall elsewhere).
 *   A4:  a `welcome` (a new socket) resets the visitors (wst off), re-sends `wq`, and drops what was queued.
 *   A32: a pre-load queue overflow drops the queue, asks for a fresh view (`wq` re) and waits for the next `wst`.
 *   §7b: a new socket clears the clock samples (as RC B43): pre-sleep samples never skew server time.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { pathToFileURL } = require('url')
const { registerHooks } = require('node:module')
const F = require('./lib/salad-fixtures')

/* net.js imports the RC kit as ./kit/ (served by salad-static.js from modules/rc-game/client) */
const KIT = pathToFileURL(path.join(F.SALAD, '..', 'rc-game', 'client') + path.sep).href
registerHooks({
	resolve(spec, ctx, next) {
		if (spec.startsWith('./kit/') && ctx.parentURL && ctx.parentURL.includes('/stage-salad/client/')) return next(KIT + spec.slice(6), ctx)
		return next(spec, ctx)
	},
})

const load = (f) => import(pathToFileURL(path.join(F.SALAD, 'client', f)).href)
const WST = { t: 'wst', v: 1, on: true, client: '/game/world/visitors.js', models: {}, scale: 0.1, safe: false, games: [] }
const wv = (n) => ({ t: 'wv', v: 1, ts: n, e: [] })

/** A fake renderer module + a join whose import resolves when `go()` is called. */
async function makeJoin(venue = F.venue()) {
	const { createWorldJoin } = await load('world-join.js')
	const sent = []
	const vis = { got: [], opts: null, ingest: (m) => (vis.got.push(m), true), setQuality: () => ({ t: 'wq', n: 12 }), wq: () => ({ t: 'wq', n: 12 }),
		update() {}, dispose: () => (vis.disposed = true) }
	let go
	const ready = new Promise((r) => (go = r))
	const G = { venue, world: { scene: {}, quality: 'mid', camera: { position: { y: 1 } } } }
	const wj = createWorldJoin(G, { send: (m) => sent.push(m), importer: () => ready.then(() => ({ createVisitors: (_T, _s, o) => ((vis.opts = o), vis) })) })
	const loaded = async () => (go(), await ready, await new Promise((r) => setImmediate(r)))
	return { wj, sent, vis, loaded, G }
}

test('A36: the renderer\'s floorY is the stage top over the stage, the hall floor elsewhere', async () => {
	const { floorYAt } = await load('venue.js')
	const v = F.venue()
	const [x0, z0, x1, z1] = v.stage.rect
	assert.equal(floorYAt(v, (x0 + x1) / 2, (z0 + z1) / 2), v.stage.y)
	assert.equal(floorYAt(v, 0, 0), v.hall.y)
	assert.equal(floorYAt(null, 0, 0), 0)
	const { wj, vis, loaded } = await makeJoin(v)
	wj.onMessage({ ...WST })
	await loaded()
	assert.equal(vis.opts.floorY((x0 + x1) / 2, (z0 + z1) / 2), v.stage.y, 'a car over the stage gets its shadow on the stage')
	assert.equal(vis.opts.floorY(0, 0), v.hall.y)
})

test('A4: `welcome` with a renderer → wst off into it, `wq` re-sent, and the session still sees the welcome', async () => {
	const { wj, sent, vis, loaded } = await makeJoin()
	wj.onMessage({ ...WST })
	await loaded()
	wj.onMessage(wv(1))
	const n = sent.length
	assert.equal(wj.onMessage({ t: 'welcome', id: 3 }), false, 'session.js handles the welcome too')
	assert.deepEqual(vis.got.at(-1), { t: 'wst', v: 1, on: false }, 'stale visitors / patches cleared')
	assert.deepEqual(sent.slice(n), [{ t: 'wq', n: 12 }], 'the new socket learns the quality tier')
	assert.equal(vis.disposed, undefined, 'the renderer is kept for the fresh view')
	wj.onMessage(wv(2))
	assert.equal(vis.got.at(-1).t, 'wst', 'a wv before the new socket\'s wst is dropped')
	wj.onMessage({ ...WST })
	wj.onMessage(wv(3))
	assert.deepEqual(vis.got.slice(-2).map((m) => m.t), ['wst', 'wv'], 'the fresh view draws')
})

test('A4: `welcome` while the renderer loads → the old socket\'s queue is dropped', async () => {
	const { wj, vis, loaded } = await makeJoin()
	wj.onMessage({ ...WST })
	wj.onMessage(wv(1))
	wj.onMessage({ t: 'welcome', id: 4 })
	wj.onMessage({ ...WST, games: ['x'] })
	wj.onMessage(wv(2))
	await loaded()
	assert.deepEqual(vis.got.map((m) => [m.t, m.ts ?? m.games?.[0]]), [['wst', 'x'], ['wv', 2]])
})

test('A32: a full pre-load queue → dropped, `wq` re asked once, wv ignored until the next wst starts afresh', async () => {
	const { wj, sent, vis, loaded } = await makeJoin()
	wj.onMessage({ ...WST })
	for (let i = 0; i < 63; i++) wj.onMessage(wv(i))
	assert.equal(sent.length, 0)
	wj.onMessage(wv(100)) // the 65th message
	assert.deepEqual(sent, [{ t: 'wq', re: true }])
	for (let i = 0; i < 10; i++) wj.onMessage(wv(200 + i))
	assert.equal(sent.length, 1, 'asked once')
	wj.onMessage({ ...WST, games: ['fresh'] })
	wj.onMessage(wv(300))
	await loaded()
	assert.deepEqual(vis.got.map((m) => [m.t, m.ts ?? m.games?.[0]]), [['wst', 'fresh'], ['wv', 300]], 'only the fresh view')
})

test('B64: host taps — one request at a time, but the presenter-safe always goes; the note says what really happens', async () => {
	const { createBusyGate } = await load('dom.js')
	const gate = createBusyGate()
	let release
	const slow = gate.run(() => new Promise((r) => (release = r)))
	assert.equal(gate.busy(), true)
	assert.equal(await gate.run(async () => 'other'), null, 'an ordinary tap while busy is skipped')
	assert.equal(await gate.run(async () => 'safe', true), 'safe', 'the safe tap goes through')
	release('first')
	assert.equal(await slow, 'first')
	assert.equal(gate.busy(), false)
	await assert.rejects(gate.run(async () => {
		throw new Error('x')
	}))
	assert.equal(gate.busy(), false, 'a failing request never leaves the panel stuck')
	const src = require('fs').readFileSync(path.join(F.SALAD, 'client', 'host.js'), 'utf8')
	assert.match(src, /action: 'safe', on \}[^\n]*, true\)/, 'the safe click is urgent')
	assert.doesNotMatch(src, /Flights in the air finish/, 'the server clears them (B64): the note may not promise they finish')
})

test('B63: non-finite inputs — a NaN launch ends at once, a NaN collider is no contact, a 2-entry screen p makes no wall', () => {
	const S = F.shared()
	const V = S.veggies.vegOf('potato')
	const v = F.venue()
	for (const bad of [[NaN, 1, 0], [Infinity, 0, 0]]) {
		const r = S.flight.simulate(V, { i: 0, p: [0, 1.5, 0], v: bad }, v)
		assert.equal(r.k, 'out', `v ${bad}: ends (simulate returns)`)
		assert.ok(r.p.every(Number.isFinite))
	}
	assert.equal(S.flight.simulate(V, { i: 0, p: [NaN, 1.5, 0], v: [0, 1, -5] }, v).k, 'out')
	for (const col of [{ k: 'sph', c: [NaN, 1, 0], r: 0.2 }, { k: 'box', min: [NaN, 0, 0], max: [1, 1, 1] }, { k: 'obox', c: [0, 1], ax: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], h: [1, 1, 1] },
		{ k: 'cap', a: [0, NaN, 0], b: [0, 1, 0], r: 0.2 }, { k: 'box', min: [0, 0, 0], max: [NaN, NaN, NaN] }]) {
		assert.equal(S.flight.contact(col, [0, 1, 0], 0.05), null, JSON.stringify(col))
	}
	assert.ok(S.flight.contact({ k: 'sph', c: [0, 1, 0], r: 0.2 }, [0, 1.1, 0], 0.05), 'a real contact still counts')
	const good = S.flight.simulate(V, { i: 0, p: [0, 1.5, 0], v: [0, 2, -6] }, v)
	const broken = S.venue.buildVenue(F.SCENE, { ...F.LIVE, screens: [...F.LIVE.screens, { id: 'x', p: [0, 2], rot: [0, 0, 0], size: [4, 2] }] })
	assert.equal(broken.colliders.filter((c) => c.tag === 'wall').length, 1, 'the 2-entry screen is skipped')
	const r = S.flight.simulate(V, { i: 0, p: [0, 1.5, 0], v: [0, 2, -6] }, broken)
	assert.deepEqual([r.k, r.tag, Math.round(r.t * 100)], [good.k, good.tag, Math.round(good.t * 100)], 'flights fly as before')
})

test('B62: sound starts muted, the AudioContext is made only by the unmute, nothing plays while it is suspended', async () => {
	const made = []
	class FakeAC {
		constructor() {
			this.state = 'suspended'
			this.sampleRate = 8000
			this.currentTime = 0
			this.destination = {}
			made.push(this)
		}
		resume() {
			this.resumed = true
		}
		createBuffer(_c, n) {
			return { getChannelData: () => new Float32Array(n) }
		}
		createGain() {
			this.nodes = (this.nodes || 0) + 1
			return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({}) }
		}
		createOscillator() {
			return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }
		}
	}
	const had = globalThis.window
	globalThis.window = { AudioContext: FakeAC }
	try {
		const { createAudio } = await load('audio.js')
		const A = createAudio()
		assert.equal(A.muted, true)
		A.play('tick')
		assert.equal(made.length, 0, 'no context before the unmute gesture')
		A.setMuted(false)
		assert.equal(made.length, 1)
		assert.equal(made[0].resumed, true, 'resumed inside the gesture')
		A.play('tick')
		assert.equal(made[0].nodes, undefined, 'still suspended: no nodes queue up')
		made[0].state = 'running'
		A.play('tick')
		assert.equal(made[0].nodes, 1)
	} finally {
		globalThis.window = had
	}
	const src = require('fs').readFileSync(path.join(F.SALAD, 'client', 'game.js'), 'utf8')
	assert.doesNotMatch(src, /storeGet\('muted'/, 'the page never restores "sound on" at load (no gesture there)')
	assert.match(src, /setMuted\(init \? true : !G\.audio\.muted\)/)
})

/** Every geometry / material under root, each with a `disposed` flag set by three's dispose event. */
function watch(root, skip = () => false) {
	const all = new Set()
	const walk = (o) => {
		if (skip(o)) return
		for (const x of [o.geometry, ...[].concat(o.material || [])]) if (x && !all.has(x)) (all.add(x), x.addEventListener('dispose', () => (x.disposed = true)))
		for (const c of o.children) walk(c)
	}
	walk(root)
	return all
}

test('B61: a slingshot frees its own geometries / materials, never the shared vegetable meshes', async () => {
	const THREE = await import('three')
	const { createSlingshot } = await load('slingshot-model.js')
	const s = createSlingshot(THREE, { color: '#ff0000', slotYaw: 0.2 })
	s.setVeg('peas')
	const isVeg = (o) => typeof o.name === 'string' && o.name.startsWith('veg:')
	const own = watch(s.group, isVeg)
	const veg = new Set()
	s.group.traverse((o) => isVeg(o) && [o.geometry, ...[].concat(o.material || [])].forEach((x) => x && veg.add(x)))
	for (const x of veg) x.addEventListener('dispose', () => (x.disposed = true))
	assert.ok(own.size > 15, `a slingshot owns many buffers (${own.size})`)
	assert.ok(veg.size > 3)
	s.dispose()
	assert.deepEqual([...own].filter((x) => !x.disposed).map((x) => x.type), [], 'all its own freed')
	assert.deepEqual([...veg].filter((x) => x.disposed).map((x) => x.type), [], 'the cached vegetables kept')
})

test('B61: avatar reactions free the umbrella, stars and hat; an expired hat frees its material', async () => {
	const THREE = await import('three')
	const { createReactions, HAT_MS } = await load('avatar-react.js')
	const model = { upper: new THREE.Group(), legs: new THREE.Group() }
	const r = createReactions(THREE, model)
	const pose = { x: 0, y: 0, z: 0, yaw: 0, height: 1.75 }
	const cab = { id: 'cabbage', color: '#7cc44e', r: 0.09, splat: true }
	r.onHit({ part: 'head', veg: cab, p: [0, 1.65, 0.1], v: [0, 0, 1] }, pose, 1000)
	const shared = new Set()
	const all = watch(model.upper)
	const hatMat = [...all].find((x) => x.isMaterial && x.color?.getHex() === 0x7cc44e && x.side === THREE.DoubleSide && x.emissive?.getHex() === 0x1c3010)
	assert.ok(hatMat, 'the cabbage hat is on')
	r.update(0.016, 1000 + HAT_MS + 1, false)
	assert.equal(hatMat.disposed, true, 'the expired hat\'s material freed')
	r.onHit({ part: 'head', veg: cab, p: [0, 1.65, 0.1], v: [0, 0, 1] }, pose, 20000)
	const now = watch(model.upper)
	for (const x of now) if (x.isBufferGeometry && (x.type === 'SphereGeometry' && x.parameters.radius === 1 || x.type === 'OctahedronGeometry')) shared.add(x)
	r.dispose()
	const left = [...now].filter((x) => !x.disposed && !shared.has(x))
	assert.deepEqual(left.map((x) => x.type), [], 'everything it owns freed')
	assert.ok([...shared].every((x) => !x.disposed), 'the module\'s shared ball / star geometries kept')
})

test('B61: burst bits pushed out by the cap free their material', async () => {
	const THREE = await import('three')
	const { createProjectileView } = await load('projectiles.js')
	const scene = new THREE.Scene()
	const view = createProjectileView(THREE, scene)
	view.burst([0, 1, 0], '#ff0000', 0, 72)
	const first = [...view.group.children].map((m) => m.material)
	for (const m of first) m.addEventListener('dispose', () => (m.disposed = true))
	view.burst([0, 1, 0], '#ff0000', 0, 10)
	assert.equal(view.group.children.length, 72, 'the cap holds')
	assert.equal(first.filter((m) => m.disposed).length, 10, 'the 10 pushed out are freed')
})

test('§7b: after a reconnect the first new pong sets the clock offset (an old low-RTT sample does not win)', async () => {
	const N = await load('net.js')
	let now = 0
	const sockets = []
	class FakeWS {
		constructor() {
			this.sent = []
			sockets.push(this)
		}
		send(x) {
			this.sent.push(JSON.parse(x))
		}
		close() {}
		open() {
			this.readyState = 1
			this.onopen()
		}
	}
	const nop = () => 0
	const net = new N.SaladNet({ url: 'ws://box/api/game/salad/ws', WebSocket: FakeWS, now: () => now, setTimeout: nop, clearTimeout: nop, setInterval: nop, clearInterval: nop, onMessage() {}, onStatus() {} })
	const pong = (ws, rtt, offset) => {
		const c = ws.sent.find((m) => m.t === 'ping').c
		now += rtt
		ws.onmessage({ data: JSON.stringify({ t: 'pong', c, s: c + rtt / 2 + offset }) })
	}
	net.connect('Ola', '#ff5533')
	sockets[0].open()
	pong(sockets[0], 0, 100000) // RTT 0: the best sample there can be
	sockets[0].onclose({ code: 1006 }) // the phone slept: the server's clock ran on, the page's did not
	net._open()
	sockets[1].open()
	assert.equal(net.synced, false, 'samples cleared on open')
	pong(sockets[1], 40, 160000)
	assert.ok(Math.abs(net.clock.offset - 160000) < 1, `offset ${net.clock.offset} follows the new socket`)
})
