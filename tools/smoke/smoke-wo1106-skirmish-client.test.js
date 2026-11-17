'use strict'

/**
 * WO-1106 — Stage Skirmish browser client fixes (modules/toy-skirmish/client; work/work-orders/
 * 1106_WO_review_fix_list_wo1099_1105_and_older.md), the real modules in node with fakes for the page:
 *   A4   welcome → the visitors renderer is reset (wst off) and the quality `wq` re-sent; `wv` waits for a fresh wst;
 *        a slick patch past its `until` slows nothing
 *   A11  the stun's knock-back is its own 1.2 u displacement over 0.3 s, slid along walls
 *   A32  a pre-load queue overflow drops the queue, asks for a fresh view once (`wq` re) and waits for the next wst
 *   B35  a disconnected player is no remote soldier (not drawn, not in any ray)
 *   B54  a state brings back every pickup it does not list as gone
 *   B56  a new scene rev in the lobby fetches the scene again (not in a match, not twice)
 *   B58  another weapon fires 250 ms after the last shot at the earliest (the server's raise gap)
 *   B59  the own spread seed goes out with `fire`
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const REPO = path.join(__dirname, '..', '..')
const SK = path.join(REPO, 'modules', 'toy-skirmish', 'client')
const KIT = pathToFileURL(path.join(REPO, 'modules', 'rc-game', 'client') + path.sep).href
registerHooks({
	resolve(spec, ctx, next) {
		if (spec.startsWith('./kit/') && ctx.parentURL && ctx.parentURL.includes('/toy-skirmish/client/'))
			return next(KIT + spec.slice(6), ctx)
		return next(spec, ctx)
	},
})
const load = (f) => import(pathToFileURL(path.join(SK, f)).href)

let WJ, SE, CO, P, GR, GA, AV
before(async () => {
	WJ = await load('world-join.js')
	SE = await load('session.js')
	CO = await load('combat.js')
	P = await load('protocol.js')
	GR = await load('grid.js')
	GA = await load('game.js')
	AV = await load('arena-view.js')
})

const S = 0.1
const WST = { t: 'wst', v: 1, on: true, client: '/game/world/visitors.js' }

/** A fake visitors renderer + the world-join under test (the import resolves when `release()` is called). */
function worldJoin({ patches = [] } = {}) {
	const sent = []
	const vis = { got: [], disposed: false, ingest: (m) => vis.got.push(m), setQuality: () => ({ t: 'wq', n: 20 }), wq: () => ({ t: 'wq', n: 20 }),
		patches: () => patches, update() {}, dispose: () => (vis.disposed = true) }
	let release
	const loaded = new Promise((res) => (release = res))
	const G = { s: S, meId: 1, my: { x: 0, z: 0, vx: 0, vz: 0, yaw: 0 }, arena: { y: 0 }, world: { scene: {}, quality: 'high', camera: { position: { y: 1 } } },
		hud: { banner() {}, toast() {} }, net: { serverNow: () => 1000 } }
	const wj = WJ.createWorldJoin(G, { send: (m) => sent.push(m), importer: () => loaded.then(() => ({ createVisitors: () => vis })) })
	return { G, wj, vis, sent, release: async () => (release(), await loaded, await new Promise((r) => setImmediate(r))) }
}

describe('WO-1106 Skirmish client: the Game World join (A4 / A32 / A11)', () => {
	it('A4: welcome resets the renderer (wst off), re-sends wq, and wv waits for the fresh wst', async () => {
		const W = worldJoin()
		W.wj.onMessage(WST)
		await W.release()
		W.wj.onMessage({ t: 'wv', v: 1, a: 1 })
		assert.deepEqual(W.vis.got.map((m) => m.t), ['wst', 'wv'])
		W.sent.length = 0
		assert.equal(W.wj.onMessage({ t: 'welcome', id: 1, state: {} }), false, 'session.js still handles the welcome')
		assert.deepEqual(W.vis.got.at(-1), { t: 'wst', v: 1, on: false }, 'the old visitors are cleared')
		assert.deepEqual(W.sent, [{ t: 'wq', n: 20 }], 'the quality tier again (the server forgot it with the socket)')
		W.wj.onMessage({ t: 'wv', v: 1, a: 2 })
		assert.equal(W.vis.got.length, 3, 'a wv of the old view is not ingested')
		W.wj.onMessage(WST)
		W.wj.onMessage({ t: 'wv', v: 1, a: 3 })
		assert.deepEqual(W.vis.got.slice(3).map((m) => m.t), ['wst', 'wv'])
	})

	it('A4: a slick patch past its `until` slows nothing', async () => {
		const W = worldJoin({ patches: [{ x: 0, y: 0, z: 0, r: 1, until: 900 }] })
		W.wj.onMessage(WST)
		await W.release()
		assert.deepEqual(W.wj.wish({ mx: 1, mz: 0 }, 1000), { mx: 1, mz: 0 }, 'expired (900 < 1000)')
		assert.deepEqual(W.wj.wish({ mx: 1, mz: 0 }, 800), { mx: 0.75, mz: 0 }, 'live: × 0.75')
	})

	it('A32: a queue overflow drops the queue, asks once for a fresh view and waits for the next wst', async () => {
		const W = worldJoin()
		W.wj.onMessage(WST)
		for (let i = 0; i < 70; i++) W.wj.onMessage({ t: 'wv', v: 1, i })
		assert.deepEqual(W.sent, [{ t: 'wq', re: true }], 'one re request')
		W.wj.onMessage({ t: 'wst', ...WST, safe: true })
		W.wj.onMessage({ t: 'wv', v: 1, i: 'fresh' })
		await W.release()
		assert.deepEqual(W.vis.got.map((m) => m.i ?? m.t), ['wst', 'fresh'], 'only the fresh view: never a half queue')
		assert.equal(W.vis.got[0].safe, true)
	})

	it('A11: the stun knocks 1.2 u over 0.3 s along its direction, slid along walls', async () => {
		const W = worldJoin()
		W.wj.onMessage({ t: 'xfx', k: 'stun', id: 1, dur: 0.8, dir: [3, 4] })
		const st = W.G.my
		for (let i = 0; i < 30; i++) W.wj.knock(st, 1 / 60, null, S)
		assert.ok(Math.abs(Math.hypot(st.x, st.z) - 1.2 * S) < 1e-9, `1.2 u (${Math.hypot(st.x, st.z) / S} u)`)
		assert.ok(Math.abs(st.x / st.z - 0.75) < 1e-9, 'along dir')
		const half = worldJoin()
		half.wj.onMessage({ t: 'xfx', k: 'stun', id: 1, dur: 0.8, dir: [1, 0] })
		for (let i = 0; i < 9; i++) half.wj.knock(half.G.my, 1 / 60, null, S)
		assert.ok(Math.abs(half.G.my.x - 0.6 * S) < 1e-9, 'half of it after 0.15 s')
		const wall = GR.buildArenaGrid({ floor: 'x', y: 0, rect: [-3, -3, 3, 3], blocks: [{ x: 0.1, z: 0, w: 0.06, d: 1, h: 0.1, yaw: 0, c: 0 }] }, [], S)
		const w = worldJoin()
		w.wj.onMessage({ t: 'xfx', k: 'stun', id: 1, dur: 0.8, dir: [1, 0] })
		for (let i = 0; i < 30; i++) w.wj.knock(w.G.my, 1 / 60, wall, S)
		assert.ok(w.G.my.x < 0.07 - 0.018 + 1e-6 && w.G.my.x > 0.03, `stopped by the wall at ${w.G.my.x}`)
		const soft = worldJoin()
		soft.wj.onMessage({ t: 'xfx', k: 'stun', id: 1, dur: 0.8, dir: [1, 0], soft: true })
		soft.wj.knock(soft.G.my, 1 / 60, null, S)
		assert.equal(soft.G.my.x, 0, 'a soft stun only shows')
	})
})

describe('WO-1106 Skirmish client: shots (B58 / B59)', () => {
	function shooter() {
		const sent = []
		const G = { my: { x: 0, z: 0, yaw: 0 }, alive: true, meId: 1, phase: 'lobby', arena: { y: 0 }, s: S, held: 'pea', spent: 0,
			grid: GR.buildArenaGrid({ floor: 'x', y: 0, rect: [-3, -3, 3, 3], blocks: [] }, [], S), me: { w: { pea: -1, rattler: 60 } },
			nextShot: (() => { let n = 0; return () => ++n })(), ownShots: new Set(), remotes: new Map(), rockets: [], state: { players: [] },
			net: { sendEvent: (m) => (sent.push(m), true), serverNow: () => 5000 }, audio: { play() {} }, ctl: { hold() {} },
			skfx: { flash() {}, tracer() {}, sparks() {} } }
		return { G, sent }
	}

	it('B59: fireMsg carries a uint32 seed only; tryFire sends its own', () => {
		assert.equal(P.fireMsg('pea', 1, [0, 0], 0, S, 4294967295).seed, 4294967295)
		for (const seed of [undefined, -1, 1.5, 4294967296]) assert.equal('seed' in P.fireMsg('pea', 1, [0, 0], 0, S, seed), false)
		const { G, sent } = shooter()
		assert.equal(CO.tryFire(G, true, 1000), true)
		assert.ok(Number.isInteger(sent[0].seed) && sent[0].seed >= 0 && sent[0].seed <= 0xffffffff)
	})

	it('B58: a switched weapon fires 250 ms after the last shot at the earliest', () => {
		const { G, sent } = shooter()
		assert.equal(CO.tryFire(G, true, 1000), true)
		G.held = 'rattler'
		assert.equal(CO.tryFire(G, true, 1100), false, '100 ms: still raising (the rattler interval alone would allow it)')
		assert.equal(CO.tryFire(G, true, 1250), true)
		assert.equal(CO.tryFire(G, true, 1340), true, 'the same weapon: its own 85 ms')
		assert.deepEqual(sent.map((m) => m.w), ['pea', 'rattler', 'rattler'])
	})
})

describe('WO-1106 Skirmish client: state (B35 / B54 / B56)', () => {
	function sessionG() {
		const calls = []
		const G = { spectator: true, meId: 9, s: S, phase: 'lobby', remotes: new Map(), world: { scene: { add() {} } }, hud: { score() {} },
			ctl: { setArena() {}, gameOff() {}, scoreInfo: () => ({}), sceneRev: (rev) => calls.push(rev) }, arena: { id: 'box' } }
		return { G, calls }
	}

	it('B35: a disconnected player is no remote soldier', () => {
		const { G } = sessionG()
		let disposed = 0
		G.remotes.set(2, { id: 2, name: 'Ann', color: '#ff5533', model: { dispose: () => disposed++ }, pose: { x: 0, z: 0 }, alive: true })
		SE.onMessage(G, { t: 'state', state: { phase: 'match', arenaId: 'box', players: [{ id: 2, name: 'Ann', color: '#ff5533', connected: false }] } })
		assert.equal(G.remotes.has(2), false, 'dropped')
		assert.equal(disposed, 1)
		assert.deepEqual(CO.soldiersFor(G, 9), [], 'nothing left to stop a shot')
	})

	it('B54: every pickup the state does not list as gone is back', () => {
		const { G } = sessionG()
		// arena-view.js draws with canvases (no DOM here): the same setTaken / available contract on a plain map
		const items = new Map([0, 1, 2].map((id) => [id, { id, until: 0 }]))
		G.arenaView = { pickups: items, setTaken: (id, until) => items.has(id) && (items.get(id).until = Number(until) || 0),
			available: (id, now) => items.has(id) && !(items.get(id).until > now) }
		assert.match(AV.createArenaView.toString(), /setTaken\(id, until\) \{[^}]*it\.until = Number\(until\) \|\| 0/, 'the real contract')
		G.arenaView.setTaken(1, 1e12)
		G.arenaView.setTaken(2, 1e12)
		SE.onMessage(G, { t: 'state', state: { phase: 'lobby', arenaId: 'box', players: [], pk: [[2, 1e12]] } })
		assert.deepEqual([0, 1, 2].map((id) => G.arenaView.available(id, 1000)), [true, true, false])
	})

	it('B56: the state\'s scene rev reaches the page; it reloads in the lobby only, once', async () => {
		const { G, calls } = sessionG()
		SE.onMessage(G, { t: 'state', state: { phase: 'lobby', arenaId: 'box', players: [], sceneRev: 'r2' } })
		assert.deepEqual(calls, ['r2'])
		const fetched = []
		const prev = globalThis.fetch
		globalThis.fetch = (url) => (fetched.push(String(url)), new Promise(() => {})) // never answers: the load stays pending
		try {
			const P2 = { sceneRev: 'r1', phase: 'match' }
			assert.equal(GA.sceneRevChanged(P2, 'r2'), false, 'a match keeps its arena (the server too)')
			assert.equal(GA.sceneRevChanged({ ...P2, phase: 'lobby' }, 'r1'), false, 'the same rev')
			const L = { ...P2, phase: 'lobby' }
			assert.equal(GA.sceneRevChanged(L, 'r2'), true)
			assert.equal(GA.sceneRevChanged(L, 'r2'), false, 'one load at a time')
			assert.deepEqual(fetched, ['/api/game/sk/scene'])
		} finally {
			globalThis.fetch = prev
		}
	})
})
