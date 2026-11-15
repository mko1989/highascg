'use strict'

/**
 * WO-1089 Stage Salad — browser client, wire format and socket (modules/stage-salad/client/protocol.js, net.js;
 * contract work/notes/stage-salad-contract.md §9):
 *  - builders emit exactly the contract's keys (angles in radians, rounded; pull clamped; names / colours cleaned);
 *  - decode validates every server message and returns null for junk (bad JSON, unknown types, missing / wrong-typed
 *    fields, unknown vegetables, a `hit` without a part); a bad tuple inside `w` is dropped, the rest kept;
 *  - the socket (fake WebSocket + fake timers): join on open, ping → clock, fire only while joined, aim throttled to
 *    ≤ 10/s with the last (release) aim never lost, `full` / `off` / 4403 / kick stop the retries, reconnect backoff,
 *    the /instance/<id>/ prefix in the socket URL.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const REPO = path.join(__dirname, '..', '..')
const DIR = path.join(REPO, 'modules', 'stage-salad', 'client')
const KIT = pathToFileURL(path.join(REPO, 'modules', 'rc-game', 'client') + path.sep).href
registerHooks({
	resolve(spec, ctx, next) {
		if (spec.startsWith('./kit/') && ctx.parentURL && ctx.parentURL.includes('/stage-salad/client/')) return next(KIT + spec.slice(6), ctx)
		return next(spec, ctx)
	},
})
const load = (f) => import(pathToFileURL(path.join(DIR, f)).href)

let P, N

before(async () => {
	P = await load('protocol.js')
	N = await load('net.js')
})

const J = (o) => JSON.stringify(o)

describe('WO-1089 Salad client: builders', () => {
	it('join / aim / fire / ping / video carry exactly the contract keys', () => {
		assert.deepEqual(P.joinMsg('  Ann\u0007ie  ', '#ABCDEF'), { t: 'join', name: 'Annie', color: '#abcdef', spectator: false })
		assert.deepEqual(P.joinMsg('', 'red', true), { t: 'join', name: 'Player', color: '#ffffff', spectator: true })
		assert.equal(P.joinMsg('x'.repeat(40), '#000000').name.length, P.MAX_NAME)
		assert.deepEqual(P.aimMsg(0.123456, -0.2, 1.7), { t: 'aim', a: [0.1235, -0.2], p: 1 })
		assert.deepEqual(P.aimMsg(0, 0, -3).p, 0)
		const f = P.fireMsg(41.9, 'carrot', -1.47641, 0.38397, 0.73219)
		assert.deepEqual(f, { t: 'fire', n: 41, veg: 'carrot', a: [-1.4764, 0.384], p: 0.7322 })
		assert.deepEqual(Object.keys(f).sort(), ['a', 'n', 'p', 't', 'veg'])
		assert.deepEqual(P.pingMsg(5), { t: 'ping', c: 5 })
		assert.deepEqual(P.videoMsg(1), { t: 'video', on: true })
		assert.equal(P.encode(f), J(f))
	})

	it('phase / canFire / streak multiplier', () => {
		assert.equal(P.phaseOf({ phase: 'round' }), 'round')
		assert.equal(P.phaseOf({ phase: 'nope' }), 'lobby')
		assert.equal(P.canFire({ phase: 'lobby' }), true)
		assert.equal(P.canFire({ phase: 'round' }), true)
		assert.equal(P.canFire({ phase: 'round', safe: true }), false)
		assert.equal(P.canFire({ phase: 'countdown' }), false)
		assert.equal(P.canFire({ phase: 'results' }), false)
		assert.deepEqual([0, 1, 2, 3, 5, 9].map(P.streakMult), [1, 1, 1.25, 1.5, 2, 2])
	})
})

describe('WO-1089 Salad client: decode', () => {
	it('accepts every server message type', () => {
		const st = { enabled: true, phase: 'lobby', players: [] }
		assert.deepEqual(P.decode(J({ t: 'welcome', id: 3, you: { id: 3, slot: 0 }, state: st })), { t: 'welcome', id: 3, you: { id: 3, slot: 0 }, state: st })
		assert.deepEqual(P.decode(J({ t: 'full' })), { t: 'full' })
		assert.deepEqual(P.decode(J({ t: 'off' })), { t: 'off' })
		assert.deepEqual(P.decode(J({ t: 'state', state: st })), { t: 'state', state: st })
		const w = P.decode(J({ t: 'w', ts: 1000, av: [[0, 10.1, 0.639, 3.5, -1.57, 1.75, 4]], sl: [[2, -1.4, 0.4, 0.5]] }))
		assert.deepEqual(w.av, [{ tid: 0, x: 10.1, y: 0.639, z: 3.5, yaw: -1.57, height: 1.75, f: 4 }])
		assert.deepEqual(w.sl, [{ id: 2, yaw: -1.4, pitch: 0.4, pull: 0.5 }])
		const shot = P.decode(J({ t: 'shot', id: 2, n: 7, veg: 'peas', o: [0.59, 1.491, 4.349], a: [-1.476, 0.314], p: 0.7, ts: 5000, seed: 123 }))
		assert.deepEqual(shot, { t: 'shot', id: 2, n: 7, veg: 'peas', o: [0.59, 1.491, 4.349], a: [-1.476, 0.314], p: 0.7, ts: 5000, seed: 123 })
		const end = P.decode(J({ t: 'end', id: 2, n: 7, i: 3, k: 'hit', p: [10, 1.9, 3.4], at: 5900, tid: 0, part: 'head', pts: 150.4, streak: 2, bank: true }))
		assert.deepEqual(end, { t: 'end', id: 2, n: 7, i: 3, k: 'hit', p: [10, 1.9, 3.4], at: 5900, tid: 0, part: 'head', pts: 150, streak: 2, bank: true })
		assert.deepEqual(P.decode(J({ t: 'end', id: 2, n: 7, i: 0, k: 'land', p: [10, 2, 3], at: 1, tag: 'umbrella', tid: 0 })).tag, 'umbrella')
		assert.equal(P.decode(J({ t: 'dodge', tid: 0, kind: 'step', from: 1, until: 2, dx: [0.4, 0] })).kind, 'step')
		assert.equal(P.decode(J({ t: 'umbrella', tid: 0, from: 1, until: 2 })).t, 'umbrella')
		assert.deepEqual(P.decode(J({ t: 'me', ready: 9000, streak: 2.7, score: 40 })), { t: 'me', ready: 9000, streak: 2, score: 40 })
		assert.deepEqual(P.decode(J({ t: 'countdown', startAt: 77 })), { t: 'countdown', startAt: 77 })
		const res = P.decode(J({ t: 'results', order: [{ id: 2, name: 'A', score: 10, hits: 1, shots: 2, best: 1 }, 'junk'], teams: null, winner: { id: 2 } }))
		assert.equal(res.order.length, 1)
		assert.deepEqual(res.winner, { id: 2 })
		assert.deepEqual(P.decode(J({ t: 'pong', c: 1, s: 2 })), { t: 'pong', c: 1, s: 2 })
		assert.ok(P.decode(J({ t: 'lx', f: [] })))
		assert.ok(P.decode(J({ t: 'lxfull', on: false })))
	})

	it('rejects junk', () => {
		const bad = [
			'not json',
			'[]',
			'null',
			J({}),
			J({ t: 'nope' }),
			J({ t: 'welcome', id: 1 }),
			J({ t: 'welcome', id: -1, state: {} }),
			J({ t: 'state', state: [] }),
			J({ t: 'w' }),
			J({ t: 'shot', id: 2, n: 1, veg: 'banana', o: [0, 0, 0], a: [0, 0], p: 1, ts: 1 }),
			J({ t: 'shot', id: 2, n: 1, veg: 'tomato', o: [0, 0], a: [0, 0], p: 1, ts: 1 }),
			J({ t: 'shot', id: 2, n: 1, veg: 'tomato', o: [0, 0, 0], a: [0, 'x'], p: 1, ts: 1 }),
			J({ t: 'shot', id: 2, n: 1, veg: 'tomato', o: [0, 0, 0], a: [0, 0], p: 1 }),
			J({ t: 'end', id: 2, n: 1, k: 'boom', p: [0, 0, 0], at: 1 }),
			J({ t: 'end', id: 2, n: 1, k: 'hit', p: [0, 0, 0], at: 1 }),
			J({ t: 'end', id: 2, n: 1, k: 'hit', p: [0, 0, 0], at: 1, part: 'nose' }),
			J({ t: 'end', id: 2, k: 'land', p: [0, 0, 0], at: 1 }),
			J({ t: 'dodge', tid: 0, kind: 'jump', from: 1, until: 2 }),
			J({ t: 'dodge', tid: 0, kind: 'duck', from: 2, until: 1 }),
			J({ t: 'umbrella', tid: 0, from: 1 }),
			J({ t: 'me', streak: 1 }),
			J({ t: 'countdown' }),
			J({ t: 'results', order: 'x' }),
			J({ t: 'pong', c: 1 }),
			J({ t: 'lx' }),
		]
		for (const b of bad) assert.equal(P.decode(b), null, b)
	})

	it('drops bad tuples inside w and keeps the rest; flags masked', () => {
		const w = P.decode(J({ t: 'w', ts: 1, av: [[0, 1, 2, 3, 0, 1.7, 255], [1, 'x', 2, 3, 0, 1.7, 0], [2, 1, 2, 3, 0, 9, 0], 'junk'], sl: [[1, 0, 0, 3], [2, 0], null] }))
		assert.deepEqual(w.av.map((a) => [a.tid, a.f]), [[0, 15]])
		assert.deepEqual(w.sl, [{ id: 1, yaw: 0, pitch: 0, pull: 1 }])
		assert.equal(P.decode(J({ t: 'w', ts: 1, sl: [] })).av, null, 'no av = avatars unchanged')
	})
})

/* ---------- the socket with a fake WebSocket and fake timers ---------- */
function rig() {
	const sockets = []
	const timers = new Map()
	let tid = 0
	let now = 1000
	class FakeWS {
		constructor(url) {
			this.url = url
			this.sent = []
			this.readyState = 0
			sockets.push(this)
		}
		send(s) {
			this.sent.push(JSON.parse(s))
		}
		close() {
			this.readyState = 3
		}
		open() {
			this.readyState = 1
			this.onopen?.()
		}
		recv(o) {
			this.onmessage?.({ data: JSON.stringify(o) })
		}
		shut(code) {
			this.readyState = 3
			this.onclose?.({ code })
		}
	}
	const statuses = []
	const msgs = []
	const env = {
		url: 'ws://box/api/game/salad/ws',
		WebSocket: FakeWS,
		now: () => now,
		setTimeout: (f, ms) => (timers.set(++tid, { f, ms, every: false }), tid),
		clearTimeout: (id) => timers.delete(id),
		setInterval: (f, ms) => (timers.set(++tid, { f, ms, every: true }), tid),
		clearInterval: (id) => timers.delete(id),
		onMessage: (m) => msgs.push(m),
		onStatus: (s) => statuses.push(s),
	}
	const net = new N.SaladNet(env)
	return {
		net,
		sockets,
		timers,
		statuses,
		msgs,
		advance: (ms) => (now += ms),
		fireTimeouts: () => {
			for (const [id, t] of [...timers]) if (!t.every) (timers.delete(id), t.f())
		},
	}
}

describe('WO-1089 Salad client: socket', () => {
	it('the socket URL keeps the /instance/<id>/ prefix', () => {
		assert.equal(N.wsUrlFor({ protocol: 'http:', host: 'h:4200', pathname: '/game/salad/' }), 'ws://h:4200/api/game/salad/ws')
		assert.equal(N.wsUrlFor({ protocol: 'https:', host: 'h', pathname: '/instance/ab-1/game/salad/' }), 'wss://h/instance/ab-1/api/game/salad/ws')
	})

	it('joins on open, pings, takes the clock, fires only while joined', () => {
		const r = rig()
		r.net.connect('Ann', '#112233')
		const ws = r.sockets[0]
		assert.equal(r.net.sendFire(P.fireMsg(1, 'tomato', 0, 0.3, 0.5)), false, 'not open yet')
		ws.open()
		assert.deepEqual(ws.sent[0], { t: 'join', name: 'Ann', color: '#112233', spectator: false })
		assert.equal(ws.sent[1].t, 'ping')
		assert.equal(r.net.sendFire(P.fireMsg(1, 'tomato', 0, 0.3, 0.5)), false, 'not joined yet')
		ws.recv({ t: 'pong', c: ws.sent[1].c, s: 50000 })
		assert.equal(r.net.synced, true)
		ws.recv({ t: 'welcome', id: 4, you: {}, state: { phase: 'lobby' } })
		assert.equal(r.net.status, 'joined')
		assert.equal(r.msgs[0].t, 'welcome')
		assert.equal(r.net.sendFire(P.fireMsg(1, 'tomato', 0, 0.3, 0.5)), true)
		assert.equal(r.net.sendFire({ t: 'aim' }), false, 'only fire frames')
		assert.equal(ws.sent.at(-1).t, 'fire')
		ws.recv({ t: 'nonsense' })
		assert.equal(r.msgs.length, 1, 'junk never reaches the game')
	})

	it('aim ≤ 10/s, unchanged aims not resent, the release never lost', () => {
		const r = rig()
		r.net.connect('Ann', '#112233')
		const ws = r.sockets[0]
		ws.open()
		ws.recv({ t: 'welcome', id: 4, you: {}, state: {} })
		const aims = () => ws.sent.filter((m) => m.t === 'aim')
		assert.equal(r.net.sendAim(0.1, 0.3, 0.2), true)
		assert.equal(r.net.sendAim(0.1, 0.3, 0.2), false, 'same aim')
		r.advance(30)
		assert.equal(r.net.sendAim(0.1, 0.3, 0.5), false, 'throttled')
		r.advance(30)
		assert.equal(r.net.sendAim(0.1, 0.3, 0), false, 'the release, throttled')
		assert.equal(r.net.flushAim(), false, 'interval not over')
		r.advance(50)
		assert.equal(r.net.flushAim(), true)
		assert.deepEqual(aims().map((m) => m.p), [0.2, 0])
		assert.equal(r.net.flushAim(), false, 'nothing pending')
	})

	it('full / off / 4403 / kick stop the retries; a plain drop reconnects with backoff', () => {
		let r = rig()
		r.net.connect('A', '#000000')
		r.sockets[0].open()
		r.sockets[0].shut(1006)
		assert.equal(r.net.status, 'closed')
		r.fireTimeouts()
		assert.equal(r.sockets.length, 2, 'reconnected')
		r.sockets[1].open()
		r.sockets[1].recv({ t: 'full' })
		r.sockets[1].shut(1000)
		r.fireTimeouts()
		assert.equal(r.net.status, 'full')
		assert.equal(r.sockets.length, 2, 'no retry after full')

		r = rig()
		r.net.connect('A', '#000000')
		r.sockets[0].open()
		r.sockets[0].shut(N.OFF_CODE)
		r.fireTimeouts()
		assert.equal(r.net.status, 'off')
		assert.equal(r.sockets.length, 1)

		r = rig()
		r.net.connect('A', '#000000')
		r.sockets[0].open()
		r.sockets[0].recv({ t: 'welcome', id: 1, you: {}, state: {} })
		r.sockets[0].shut(N.KICK_CODE)
		r.fireTimeouts()
		assert.equal(r.net.status, 'kicked')
		assert.equal(r.sockets.length, 1)

		r = rig()
		r.net.connect('A', '#000000')
		r.net.close()
		assert.equal(r.net.status, 'idle')
		assert.equal(r.timers.size, 0, 'nothing left running')
	})
})
