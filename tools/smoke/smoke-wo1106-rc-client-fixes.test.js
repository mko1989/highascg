'use strict'

/**
 * WO-1106 — review fix list, RC client slice (modules/rc-game/client): B35 (disconnected racers), B42 (item press on
 * high-refresh screens), B46 (mid-race rejoin), B43 (clock samples across a reconnect), B44 / A35 (bot hits + slick
 * patches), B45 (host refresh), B47 / B48 (spectator full card, bfcache), B49 (head binding), B50 (tunnel floor
 * normal), A4 / A32 (Game World join on reconnect, pre-load queue).
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const F = require('./lib/rc-client-fixtures.js')

const RC = path.join(__dirname, '..', '..', 'modules', 'rc-game', 'client')
const read = (f) => fs.readFileSync(path.join(RC, f), 'utf8')

let SESS, LOOP, IN, ST, PH, TM, ITEMS
before(async () => {
	SESS = await F.load('session.js')
	LOOP = await F.load('loop.js')
	IN = await F.load('interp.js')
	ST = await F.load('standings.js')
	PH = await F.load('physics.js')
	TM = await F.load('track-math.js')
	ITEMS = await F.load('items.js')
})

/** Anything: every property is a no-op function that returns undefined (HUD, audio, world views). */
const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : any()), apply: () => undefined })
const modelStub = () => ({ group: { visible: false }, update() {}, dispose() {} })

describe('WO-1106 B35 a disconnected racer is not drawn, hit or followed', () => {
	function sessionG() {
		const G = {
			spectator: true,
			meId: 1,
			me: { id: 1 },
			phase: 'race',
			remotes: new Map(),
			race: new ST.RaceTracker(null),
			items: new ITEMS.ItemState(),
			ctl: { setTrack() {}, toGrid() {}, gameOff() {} },
			hud: any(),
			director: { notify() {} },
			world: { scene: { add() {}, remove() {} } },
			s: 1,
		}
		/* a remote already known (createCarModel needs a DOM canvas): same name / colour → kept by syncRemotes */
		G.remotes.set(2, { id: 2, name: 'B', color: '#ff0000', buf: new IN.SnapshotBuffer(), model: modelStub(), pose: null, seen: false, fx: 0, spinAdd: 0 })
		return G
	}
	const players = (connected) => [
		{ id: 1, name: 'Me', color: '#00ff00', connected: true, racing: true },
		{ id: 2, name: 'B', color: '#ff0000', connected, racing: true },
	]
	const feed = (r, t0) => {
		for (let i = 0; i < 6; i++) r.buf.push(t0 + i * 50, { id: 2, p: [i * 0.1, 0, 0], yaw: 0, v: 2, st: 0, fx: 0 })
	}

	it('connected → a pose for collisions; connected:false → hidden, no pose, no collision; back → fresh buffer', () => {
		const G = sessionG()
		SESS.onMessage(G, { t: 'state', state: { phase: 'race', players: players(true) } })
		const r = G.remotes.get(2)
		feed(r, 1000)
		assert.equal(LOOP.remoteCars(G, 1200, 1200, 0.016, 1.2).length, 1, 'a live remote collides')
		assert.equal(r.model.group.visible, true)

		SESS.onMessage(G, { t: 'state', state: { phase: 'race', players: players(false) } })
		assert.equal(LOOP.remoteCars(G, 1250, 1250, 0.016, 1.25).length, 0, 'the frozen ghost is no obstacle')
		assert.equal(r.model.group.visible, false, 'not drawn')
		assert.equal(r.pose, null, 'the director (carOf) and the minimap skip it')

		SESS.onMessage(G, { t: 'state', state: { phase: 'race', players: players(true) } })
		assert.equal(r.off, false)
		assert.equal(r.seen, false, 'back online: placed fresh (no lap-tracker jump)')
		assert.equal(LOOP.remoteCars(G, 1300, 1300, 0.016, 1.3).length, 0, 'the stale pre-drop snapshots are gone')
	})
})

describe('WO-1106 B46 a mid-race rejoin is not racing', () => {
	it('session takes racing from the own state entry; no catch-up for it', async () => {
		const IP = await F.load('item-play.js')
		const G = {
			spectator: true,
			meId: 7,
			me: { id: 7 },
			phase: 'lobby',
			remotes: new Map(),
			race: new ST.RaceTracker(null),
			items: new ITEMS.ItemState(),
			ctl: { setTrack() {}, toGrid() {}, gameOff() {} },
			hud: any(),
			world: { scene: { add() {}, remove() {} } },
		}
		SESS.onMessage(G, { t: 'state', state: { phase: 'race', startAt: 1, players: [{ id: 7, name: 'Late', color: '#00ff00', connected: true, racing: false }] } })
		assert.equal(G.myRacing, false)
		G.car = { catchup: 0 }
		IP.updateCatchup(G, 6, 6)
		assert.equal(G.car.catchup, 0, 'no catch-up bonus for a car that is not in the race')
		SESS.onMessage(G, { t: 'state', state: { phase: 'race', startAt: 1, players: [{ id: 7, name: 'Late', color: '#00ff00', connected: true, racing: true }] } })
		assert.equal(G.myRacing, true)
		IP.updateCatchup(G, 6, 6)
		assert.ok(G.car.catchup > 0, 'a racer still gets it')
	})

	it('the HUD shows no position / lap for it (loop.js updateHud)', () => {
		assert.match(read('loop.js'), /const racing = !G\.spectator && !!rc && \(G\.phase === 'race' \|\| G\.phase === 'countdown'\) && G\.myRacing !== false/)
	})
})

describe('WO-1106 B42 an item press survives frames without a physics step', () => {
	let saved
	before(() => (saved = globalThis.window))
	after(() => (globalThis.window = saved))

	it('a press read in a 0-step frame (120 Hz) is used by the next step', () => {
		let frameFn = null
		globalThis.window = { requestAnimationFrame: (f) => (frameFn = f) }
		const T = TM.prepareTrack(F.ovalTrack(), 1)
		const env = PH.createEnv(T, [{ id: 'hall', y: 0, rect: [-20, -15, 20, 15] }], [])
		const sent = []
		const items = new ITEMS.ItemState()
		items.held = 'turbo'
		let steps = 0
		let pressNext = false
		const G = {
			spectator: false,
			meId: 1,
			me: { id: 1 },
			phase: 'race',
			startAt: 0,
			T,
			env,
			car: PH.createCar(TM.gridPose(T, 0)),
			myModel: modelStub(),
			remotes: new Map(),
			race: new ST.RaceTracker(T),
			bests: new Map(),
			items,
			input: { read: () => ({ throttle: 0, brake: 0, steer: 0, drift: false, use: pressNext && !(pressNext = false) }) },
			stepper: { advance: (dt, fn) => { for (let i = 0; i < steps; i++) fn(1 / 60); return 0 } },
			net: { status: 'joined', serverNow: () => 5000, sendEvent: (m) => (sent.push(m), true), sendState() {}, clock: { rtt: 0 } },
			hud: any(),
			audio: any(),
			world: any(),
			director: { notify() {}, update: () => ({ eye: [0, 1, 0], target: [0, 0, 0] }) },
		}
		LOOP.startLoop(G)
		pressNext = true
		steps = 0
		frameFn(1000) // the press is read here, but this frame runs no physics step
		assert.equal(sent.length, 0)
		steps = 1
		frameFn(1008)
		assert.ok(sent.some((m) => m.t === 'use'), 'the held item was used on the next step')
		assert.equal(G.items.held, null)
	})
})

describe('WO-1106 B43 the clock forgets pre-sleep samples on a new socket', () => {
	it('after a reconnect the first new pong sets the offset (an old low-RTT sample does not win)', async () => {
		const NET = await F.load('net.js')
		const e = F.fakeNetEnv(NET)
		e.net.connect('Ola', '#ff5533')
		const a = e.sockets[0]
		a.open()
		const ping0 = a.sent.find((m) => m.t === 'ping')
		a.recv({ t: 'pong', c: ping0.c, s: ping0.c + 100000 }) // RTT 0: the best sample there can be
		const before = e.net.clock.offset
		a.drop(4408) // the phone slept: the server's clock ran on, the page's did not
		e.advance(500)
		const b = e.sockets[1]
		b.open()
		assert.equal(e.net.clock.synced, false, 'samples cleared on open')
		assert.equal(e.net.clock.offset, before, 'the offset stays the best guess until the first pong')
		const ping1 = b.sent.find((m) => m.t === 'ping')
		e.advance(40)
		b.recv({ t: 'pong', c: ping1.c, s: ping1.c + 20 + 160000 })
		assert.ok(Math.abs(e.net.clock.offset - 160000) < 1, `offset ${e.net.clock.offset} follows the new socket`)
	})
})

describe('WO-1106 B44 / A35 bot-brain: pulse hits go out, slick patches slow bots', () => {
	let B, WFX
	before(async () => {
		B = await F.load('bot-brain.js')
		WFX = await F.load('world-fx.js')
	})
	const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647)
	const world = (patches) => {
		const T = TM.prepareTrack(F.ovalTrack(12, 7, 140, 0, 3))
		return { T, env: PH.createEnv(T, F.BIG_FLOORS, []), ...(patches ? { patches } : {}) }
	}
	const racing = (bot, t0) =>
		bot.onMessage({ t: 'state', state: { phase: 'race', trackId: 'oval', laps: 3, startAt: t0 - 2000, players: [{ id: 1, slot: 0, racing: true }] } }, t0)
	const join = (bot, t0) => bot.onMessage({ t: 'welcome', id: 1, you: { id: 1, slot: 0 }, state: { phase: 'lobby', players: [{ id: 1, slot: 0 }] } }, t0)

	it('B44: a pulse that hits the bot between two steps is reported by the next step (once)', () => {
		const w = world()
		const bot = B.createBot({ rng: seeded(3), skill: 1 })
		const t0 = 5_000_000
		join(bot, t0)
		racing(bot, t0)
		let t = t0
		for (let i = 0; i < 5; i++) bot.step(w, (t += 33), 2)
		const c = bot.G.car
		bot.onMessage({ t: 'fx', k: 'pulse', id: 9, p: [c.x, c.y, c.z] }, t)
		const msgs = bot.step(w, (t += 33), 2)
		assert.ok(msgs.some((m) => m.t === 'hit' && m.by === 9), `hit reported: ${JSON.stringify(msgs.map((m) => m.t))}`)
		assert.ok(!bot.step(w, t + 33, 2).some((m) => m.t === 'hit'), 'not twice')
	})

	it('A35: world.patches under the bot → wslick; absent / expired → the very same drive', () => {
		const t0 = 5_000_000
		const run = (patchesOf) => {
			const bot = B.createBot({ rng: seeded(11), skill: 1 })
			join(bot, t0)
			racing(bot, t0)
			let t = t0
			let slick = 0
			for (let i = 0; i < 90; i++) {
				const c = bot.G.car
				const w = world(c ? patchesOf(c, t) : null)
				bot.step(w, (t += 33), 2)
				slick += bot.G.car.wslick || 0
			}
			return { car: bot.G.car, slick }
		}
		const none = run(() => null)
		const under = run((c, t) => [{ x: c.x, y: c.y, z: c.z, r: 0.5, until: t + 10000 }])
		const stale = run((c, t) => [{ x: c.x, y: c.y, z: c.z, r: 0.5, until: t - 1 }])
		assert.equal(none.slick, 0)
		assert.ok(under.slick > 0, 'the patch made the bot slick')
		assert.equal(stale.slick, 0, 'an expired patch is ignored')
		assert.equal(JSON.stringify([stale.car.x, stale.car.z]), JSON.stringify([none.car.x, none.car.z]), 'expired = no patch')
		assert.notEqual(JSON.stringify([under.car.x, under.car.z]), JSON.stringify([none.car.x, none.car.z]), 'slower on a patch')
	})

	it('A4: slickUnder ignores a patch whose `until` is not after the server time (no time → as before)', () => {
		const c = { x: 0, y: 0, z: 0 }
		const p = [{ x: 0, y: 0, z: 0, r: 0.3, until: 1000 }]
		assert.equal(WFX.slickUnder(c, p, 999), 1)
		assert.equal(WFX.slickUnder(c, p, 1000), 0)
		assert.equal(WFX.slickUnder(c, p, 5000), 0)
		assert.equal(WFX.slickUnder(c, p), 1, 'no server time given')
		assert.equal(WFX.slickUnder(c, [{ x: 0, z: 0, r: 0.3 }], 5000), 1, 'a patch without `until` stays as before')
	})
})

describe('WO-1106 A4 / A32 world-join: reconnect reset, pre-load queue overflow', () => {
	let WJ
	before(async () => (WJ = await F.load('world-join.js')))
	const WST = (n = 1) => ({ t: 'wst', v: 1, on: true, client: '/game/world/visitors.js', n })
	function harness() {
		const sent = []
		const ingested = []
		let resolve
		const vis = {
			ingest: (m) => ingested.push(m),
			setQuality: (q) => ({ t: 'wq', n: q === 'low' ? 6 : 20 }),
			update() {},
			patches: () => [{ x: 0, y: 0, z: 0, r: 1, until: 1000 }],
			dispose() {},
		}
		const G = { world: { quality: 'high', scene: {}, camera: { position: { y: 1 } } }, car: { x: 0, y: 0, z: 0 }, hud: any() }
		const wj = WJ.createWorldJoin(G, { send: (m) => sent.push(m), load: () => new Promise((r) => (resolve = () => r({ createVisitors: () => vis }))) })
		return { G, wj, sent, ingested, finish: async () => (resolve(), await new Promise((r) => setImmediate(r))) }
	}
	const wv = (i) => ({ t: 'wv', i })

	it('A4: a welcome (new socket) clears the visitors and re-sends wq; the first welcome does nothing', async () => {
		const h = harness()
		h.wj.onMessage({ t: 'welcome', id: 1, state: {} })
		assert.equal(h.sent.length, 0)
		h.wj.onMessage(WST())
		await h.finish()
		assert.deepEqual(h.sent, [{ t: 'wq', n: 20 }])
		h.ingested.length = 0
		h.wj.onMessage({ t: 'welcome', id: 1, state: {} })
		assert.deepEqual(h.ingested, [{ t: 'wst', v: 1, on: false }], 'wst off: every visitor and patch goes')
		assert.deepEqual(h.sent, [{ t: 'wq', n: 20 }, { t: 'wq', n: 20 }], 'the cap on the new socket')
	})

	it('A4: an expired slick patch does not make the car slick', async () => {
		const h = harness()
		h.wj.onMessage(WST())
		await h.finish()
		h.wj.frame(999, 0.016)
		assert.equal(h.G.car.wslick, 1)
		h.wj.frame(1000, 0.016)
		assert.equal(h.G.car.wslick, 0, '`until` not after the server time')
	})

	it('A32: no overflow → replayed in order; overflow → dropped, `wq re` once, wv ignored until the next wst', async () => {
		const a = harness()
		a.wj.onMessage(WST())
		for (let i = 0; i < 10; i++) a.wj.onMessage(wv(i))
		await a.finish()
		assert.deepEqual(a.ingested.map((m) => m.t + (m.i ?? '')), ['wst', ...Array.from({ length: 10 }, (_, i) => `wv${i}`)])
		assert.deepEqual(a.sent, [{ t: 'wq', n: 20 }], 'no resync asked')

		const b = harness()
		b.G.world.quality = 'low'
		b.wj.onMessage(WST(1))
		for (let i = 0; i < 100; i++) b.wj.onMessage(wv(i))
		assert.deepEqual(b.sent, [{ t: 'wq', n: 6, re: true }], 'once, with the cap of the quality tier')
		b.wj.onMessage(WST(2)) // the server serves the view afresh: a new wst, then every add
		b.wj.onMessage(wv(200))
		await b.finish()
		const got = b.ingested.map((m) => (m.t === 'wst' ? `wst${m.n}` : `wv${m.i}`))
		assert.deepEqual(got, ['wst2', 'wv200'], 'nothing from the broken queue, the fresh view in order')

		const c = harness()
		c.wj.onMessage(WST(1))
		for (let i = 0; i < 70; i++) c.wj.onMessage(wv(i))
		await c.finish() // loaded before the fresh wst came: nothing half-done is drawn
		assert.deepEqual(c.ingested, [])
		c.wj.onMessage(wv(71))
		assert.deepEqual(c.ingested, [], 'wv still waits for the wst')
		c.wj.onMessage(WST(3))
		c.wj.onMessage(wv(72))
		assert.deepEqual(c.ingested.map((m) => m.t + (m.n ?? m.i)), ['wst3', 'wv72'])
	})

	it('A4: a welcome while the renderer loads drops the old socket\'s queue (the new view starts with its wst)', async () => {
		const h = harness()
		h.wj.onMessage(WST(1))
		h.wj.onMessage(wv(1))
		h.wj.onMessage({ t: 'welcome', id: 1, state: {} })
		h.wj.onMessage(wv(2)) // a straggler before the new wst
		h.wj.onMessage(WST(2))
		h.wj.onMessage(wv(3))
		await h.finish()
		assert.deepEqual(h.ingested.map((m) => m.t + (m.n ?? m.i)), ['wst2', 'wv3'])
	})
})

describe('WO-1106 B45 host refresh: one at a time, the scene only on a new rev', () => {
	it('singleFlight: ticks during a slow run start nothing; an action asks for one more run after it', async () => {
		const { singleFlight } = await F.load('host.js')
		let runs = 0
		let release
		const gate = () => new Promise((r) => (release = r))
		const refresh = singleFlight(async () => {
			runs++
			await gate()
		})
		const first = refresh()
		refresh()
		refresh()
		assert.equal(runs, 1, 'no second fetch while the first is in flight')
		const act = refresh({ again: true })
		assert.equal(act, first)
		release()
		await new Promise((r) => setImmediate(r))
		assert.equal(runs, 2, 'the action gets a fresh answer after the stale one')
		release()
		await act
		assert.equal(runs, 2)
		const next = refresh()
		assert.equal(runs, 3, 'free again')
		release()
		await next
	})

	it('host.js uses it and refetches /scene only when the state rev differs', () => {
		const src = read('host.js')
		assert.match(src, /const refresh = singleFlight\(refreshOnce\)/)
		assert.match(src, /if \(on && state\.sceneRev !== sceneRev\) \{\n\t\t\tconst s = await apiGet\('\/scene'\)/)
		assert.doesNotMatch(src, /!tracks\.length\)\) \{/, 'no refetch on every tick while a scene has no tracks')
	})
})

describe('WO-1106 B47 / B48 game.js: spectator refused as full, back from the bfcache', () => {
	it('B47: a full spectator page shows its own card and reconnects as a spectator (button and by itself)', async () => {
		const GAME = await F.load('game.js')
		const timers = []
		const saved = [globalThis.setTimeout, globalThis.clearTimeout]
		globalThis.setTimeout = (f, ms) => (timers.push({ f, ms }), timers.length)
		globalThis.clearTimeout = () => {}
		try {
			const shown = []
			const connects = []
			const G = {
				spectator: true,
				hud: any(),
				screens: { show: (t, b, actions) => shown.push({ t, actions }), hide() {} },
				net: { clock: {}, connect: (...a) => connects.push(a) },
			}
			GAME.onStatus(G, 'full')
			assert.equal(shown.length, 1)
			assert.doesNotMatch(shown[0].t, /race is full/, 'not the drivers card')
			assert.deepEqual(shown[0].actions.map((a) => a.label), ['Try again'])
			shown[0].actions[0].onClick()
			assert.deepEqual(connects, [['Spectator', '#ffffff', true]], 'Try again reconnects as a spectator')
			assert.ok(timers.length >= 1 && timers[0].ms > 0, 'and it retries by itself')
			timers[0].f()
			assert.equal(connects.length, 2)
		} finally {
			;[globalThis.setTimeout, globalThis.clearTimeout] = saved
		}
	})

	it('B48: pagehide disposes the stage fx only on a real unload (not when the page goes into the bfcache)', () => {
		const src = read('game.js')
		assert.match(src, /addEventListener\('pagehide', \(e\) => \{\n\t\tif \(!e\.persisted\) G\.fx\?\.dispose\(\)\n\t\}\)/)
		assert.doesNotMatch(src, /'pagehide', \(\) => G\.fx\?\.dispose\(\)/)
	})
})

describe('WO-1106 B49 head-follow stops scanning for a head the GLB lacks', () => {
	it('at most a few whole-scene scans after a load; a rescan (scene GLB in) binds again', async () => {
		const THREE = await import('three')
		const HF = await F.load('head-follow.js')
		let scans = 0
		const nodes = []
		const scene = { traverse: (f) => (scans++, nodes.forEach(f)) }
		const hf = HF.createHeadFollow(THREE, scene)
		hf.load([{ id: 'h1', d: [0, -1, 0], pan: { o: [0, 1, 0], a: [0, 1, 0] } }])
		for (let t = 0; t < 600_000; t += 16) hf.tick(t) // ten minutes of frames, the head's node never there
		assert.ok(scans > 0 && scans <= 5, `${scans} scans`)
		const pan = new THREE.Object3D()
		pan.userData = { rcHead: 'h1', rcAxis: 'pan' }
		pan.parent = scene
		nodes.push(pan)
		hf.rescan()
		hf.tick(600_000)
		assert.equal(hf.stats().bound, 1, 'bound right after the scene load')
		const after = scans
		for (let t = 600_000; t < 700_000; t += 16) hf.tick(t)
		assert.equal(scans, after, 'bound: no more scans')
	})

	it('game.js tells the stage fx when the scene GLB is in', () => {
		assert.match(read('game.js'), /G\.screens\.loading\(null\)\n\t\t\tG\.fx\?\.sceneLoaded\?\.\(\)/)
		assert.match(read('stage-fx.js'), /sceneLoaded\(\) \{\n\t\t\tif \(!disposed\) follow\.rescan\(\)/)
	})
})

describe('WO-1106 B50 tunnel cut: the floor test does not depend on vertex normals', () => {
	it('the patched shaders read no `normal`; the fragment derives the face normal from dFdx / dFdy', async () => {
		const THREE = await import('three')
		const CUT = await F.load('tunnel-cut.js')
		/* the baked scene GLB is positions only (src/stage/glb-write.js flat) */
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3))
		const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial())
		CUT.applyCut(mesh)
		const sh = { uniforms: {}, vertexShader: 'void main() {\n#include <project_vertex>\n}', fragmentShader: 'void main() {\n}' }
		mesh.material.onBeforeCompile(sh)
		assert.doesNotMatch(sh.vertexShader, /\bnormal\b/, 'no normal attribute read')
		assert.doesNotMatch(sh.fragmentShader, /vRcUp/)
		assert.match(sh.fragmentShader, /float rcUp = abs\(normalize\(cross\(dFdx\(p\), dFdy\(p\)\)\)\.y\);/)
		assert.match(sh.fragmentShader, /if \(rcUp > 0\.7 && h < 0\.004\) continue;/)
		/* the derivative is taken first in rcInCut, called at the top of main(): uniform control flow */
		assert.match(sh.fragmentShader, /void main\(\) \{\n\tif \(rcInCut\(vRcWorld\)\) discard;/)
	})
})
