'use strict'

/**
 * WO-1081 Stage Skirmish — browser client, wire format and socket (modules/toy-skirmish/client/protocol.js, net.js;
 * contract work/notes/skirmish-game-contract.md §7):
 *  - builders emit exactly the contract's keys; positions rounded to 1 mm at the toy scale 0.1 (≥ 3 significant digits
 *    of a u), finer below; names / colours cleaned; JSON round trip;
 *  - decode validates every server message type and drops malformed / unknown frames; `w` tuples → objects (an optional
 *    6th element = held weapon);
 *  - the socket (fake WebSocket + fake timers, nothing left running): join on open, ping → clock, state throttling and
 *    keepalive, events only while joined, `pick` per id throttled, `full` / `off` / 4403 / kick stop the retries,
 *    reconnect with backoff, the /instance/<id>/ prefix in the socket URL.
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

let P, N

before(async () => {
	P = await load('protocol.js')
	N = await load('net.js')
})

const digits = (v) => (String(v).split('.')[1] || '').length

describe('WO-1081 Skirmish client: builders', () => {
	it('emit exactly the contract keys', () => {
		assert.deepEqual(Object.keys(P.joinMsg('A', '#FF0000')).sort(), ['color', 'name', 'spectator', 't'])
		assert.deepEqual(Object.keys(P.stateMsg(1, 2, 0.5, true, 'pea', 0.1)).sort(), ['mv', 'p', 't', 'w', 'yaw'])
		assert.deepEqual(Object.keys(P.fireMsg('pea', 3, [1, 2], 0.1, 0.1)).sort(), ['n', 'p', 't', 'w', 'yaw'])
		assert.deepEqual(Object.keys(P.hitMsg(3, 7, 2)).sort(), ['id', 'k', 'n', 't'])
		assert.deepEqual(Object.keys(P.boomMsg(3, [1, 2], 0.1)).sort(), ['n', 'p', 't'])
		assert.deepEqual(P.pickMsg(4), { t: 'pick', id: 4 })
		assert.deepEqual(P.pingMsg(12), { t: 'ping', c: 12 })
		assert.deepEqual(P.videoMsg(1), { t: 'video', on: true })
	})

	it('round positions to 1 mm at scale 0.1, finer below', () => {
		assert.equal(P.posDecimals(1), 3)
		assert.equal(P.posDecimals(0.1), 3)
		assert.equal(P.posDecimals(0.05), 4)
		assert.equal(P.posDecimals(0.01), 4)
		assert.equal(P.posDecimals(0.001), 5)
		const m = P.stateMsg(-4.4751234, 6.4859876, 1.23456, 0, 'rattler', 0.1)
		assert.deepEqual(m.p, [-4.475, 6.486])
		assert.equal(m.yaw, 1.235)
		assert.equal(m.mv, 0)
		assert.equal(m.w, 'rattler')
		// ≥ 3 significant digits of a u (0.01 m at scale 0.1): 1 mm steps
		assert.ok(Math.abs(m.p[0] - -4.4751234) <= 0.0005)
		assert.equal(P.stateMsg(0, 0, 0, 1, 'bogus', 0.1).w, 'pea')
		const f = P.fireMsg('scatter', 9.7, [0.12345, 0.98765], 2.718281, 0.1)
		assert.equal(f.n, 9)
		assert.ok(digits(f.yaw) <= 4)
		assert.deepEqual(f.p, [0.123, 0.988])
		assert.equal(P.hitMsg(1, 2, 99).k, 8)
		assert.equal(P.hitMsg(1, 2, 0).k, 1)
	})

	it('clean names and colours; JSON round trip', () => {
		assert.equal(P.sanitizeName('  Al\u0000\u0007ice  '), 'Alice')
		assert.equal(P.sanitizeName(''), 'Player')
		assert.equal(Array.from(P.sanitizeName('x'.repeat(40))).length, 16)
		assert.equal(P.validColor('#AbCdEf'), '#abcdef')
		assert.equal(P.validColor('red'), null)
		assert.equal(P.joinMsg('B', 'nope').color, '#ffffff')
		const m = P.stateMsg(1.5, -2.25, 0.5, 1, 'thumper', 0.1)
		assert.deepEqual(JSON.parse(P.encode(m)), m)
	})
})

describe('WO-1081 Skirmish client: decode', () => {
	const d = (o) => P.decode(JSON.stringify(o))
	it('accepts every server type', () => {
		assert.equal(d({ t: 'welcome', id: 3, state: {} }).id, 3)
		assert.deepEqual(d({ t: 'full' }), { t: 'full' })
		assert.deepEqual(d({ t: 'off', x: 1 }), { t: 'off' })
		assert.ok(d({ t: 'state', state: { phase: 'match' } }))
		const w = d({ t: 'w', ts: 1000, a: [[1, 0.5, -0.5, 1.2, 3], [2, 1, 1, 0, 0, 'scatter'], ['bad'], [3, 'x', 0, 0, 0]] })
		assert.deepEqual(w.a, [
			{ id: 1, x: 0.5, z: -0.5, yaw: 1.2, f: 3, w: null },
			{ id: 2, x: 1, z: 1, yaw: 0, f: 0, w: 'scatter' },
		])
		const sh = d({ t: 'shot', id: 1, w: 'scatter', n: 4, p: [1, 2], yaw: 0.3, ts: 99, seed: -1 })
		assert.equal(sh.seed, 4294967295)
		assert.equal(d({ t: 'dmg', id: 1, by: 2, w: 'pea', hp: 50, ar: 10 }).hp, 50)
		assert.equal(d({ t: 'kill', id: 1, w: 'pea' }).by, 1)
		assert.deepEqual(d({ t: 'spawn', id: 1, p: [1, 2], yaw: 1, until: 5 }), { t: 'spawn', id: 1, p: [1, 2], yaw: 1, until: 5 })
		assert.equal(d({ t: 'boom', by: 1, n: 2, p: [0, 0] }).n, 2)
		assert.deepEqual(d({ t: 'me', hp: 80, ar: 5, w: { pea: -1, rattler: 12.7, bogus: 3, scatter: 'x' }, surge: 0 }).w, { pea: -1, rattler: 12 })
		assert.equal(d({ t: 'pk', id: 2, by: 1, until: 77 }).until, 77)
		assert.equal(d({ t: 'countdown', startAt: 5 }).startAt, 5)
		const r = d({ t: 'results', mode: 'tdm', order: [{ id: 1 }, 'x'], teams: [3, 'a'] })
		assert.deepEqual([r.mode, r.order.length, r.teams], ['tdm', 1, [3, 0]])
		assert.ok(d({ t: 'pong', c: 1, s: 2 }))
		assert.ok(d({ t: 'lx', f: [] }))
		assert.ok(d({ t: 'lxfull', on: false }))
	})

	it('drops malformed and unknown frames', () => {
		for (const bad of ['', 'nope', '[]', '{"t":5}', '{"t":"zzz"}']) assert.equal(P.decode(bad), null, bad)
		assert.equal(d({ t: 'welcome', state: {} }), null)
		assert.equal(d({ t: 'w', a: [] }), null)
		assert.equal(d({ t: 'shot', id: 1, w: 'laser', p: [0, 0], yaw: 0 }), null)
		assert.equal(d({ t: 'shot', id: 1, w: 'pea', p: [0], yaw: 0 }), null)
		assert.equal(d({ t: 'dmg', id: 1 }), null)
		assert.equal(d({ t: 'spawn', id: 1, p: 'x' }), null)
		assert.equal(d({ t: 'me', w: {} }), null)
		assert.equal(d({ t: 'pk', id: 1 }), null)
		assert.equal(d({ t: 'results', order: 3 }), null)
		assert.equal(d({ t: 'lx' }), null)
		assert.equal(P.phaseOf({ phase: 'weird' }), 'lobby')
		assert.equal(P.phaseOf({ phase: 'countdown' }), 'countdown')
	})
})

/* ---------- the socket with a fake WebSocket and fake timers ---------- */
function env() {
	let t = 0
	let nextId = 1
	const timers = new Map()
	const sockets = []
	class FakeWS {
		constructor(url) {
			this.url = url
			this.readyState = 0
			this.sent = []
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
	const add = (f, ms, every) => {
		const id = nextId++
		timers.set(id, { f, at: t + ms, every })
		return id
	}
	const statuses = []
	const msgs = []
	const e = {
		url: 'ws://x/api/game/sk/ws',
		WebSocket: FakeWS,
		now: () => t,
		setTimeout: (f, ms) => add(f, ms, 0),
		clearTimeout: (id) => timers.delete(id),
		setInterval: (f, ms) => add(f, ms, ms),
		clearInterval: (id) => timers.delete(id),
		onStatus: (s) => statuses.push(s),
		onMessage: (m) => msgs.push(m),
	}
	const advance = (ms) => {
		const end = t + ms
		for (;;) {
			let best = null
			for (const [id, tm] of timers) if (tm.at <= end && (!best || tm.at < best[1].at)) best = [id, tm]
			if (!best) break
			t = best[1].at
			if (best[1].every) best[1].at += best[1].every
			else timers.delete(best[0])
			best[1].f()
		}
		t = end
	}
	return { e, sockets, timers, statuses, msgs, advance, last: () => sockets[sockets.length - 1] }
}

describe('WO-1081 Skirmish client: socket', () => {
	it('builds the socket URL (also under /instance/<id>/)', () => {
		assert.equal(N.wsUrlFor({ protocol: 'http:', host: 'box:4200', pathname: '/game/sk/' }), 'ws://box:4200/api/game/sk/ws')
		assert.equal(N.wsUrlFor({ protocol: 'https:', host: 'b', pathname: '/instance/a1/game/sk/' }), 'wss://b/instance/a1/api/game/sk/ws')
	})

	it('joins, pings, throttles state, sends events only while joined, stops cleanly', () => {
		const E = env()
		const n = new N.SkNet(E.e)
		n.connect('Ann', '#ff0000', false)
		const ws = E.last()
		assert.equal(n.sendEvent(P.fireMsg('pea', 1, [0, 0], 0)), false) // not open yet
		ws.open()
		assert.deepEqual(ws.sent[0], { t: 'join', name: 'Ann', color: '#ff0000', spectator: false })
		assert.equal(ws.sent[1].t, 'ping')
		ws.recv({ t: 'pong', c: ws.sent[1].c, s: 50000 })
		assert.ok(Math.abs(n.serverNow() - 50000) < 1)
		assert.equal(n.sendState(P.stateMsg(0, 0, 0, 0, 'pea')), false) // not joined yet
		assert.equal(n.sendEvent(P.fireMsg('pea', 1, [0, 0], 0)), false)
		ws.recv({ t: 'welcome', id: 7, state: { phase: 'lobby' } })
		assert.equal(n.status, 'joined')
		assert.equal(E.msgs[0].t, 'welcome')
		const st = (x) => P.stateMsg(x, 0, 0, 1, 'pea')
		assert.equal(n.sendState(st(1)), true)
		assert.equal(n.sendState(st(2)), false) // < 55 ms
		E.advance(60)
		assert.equal(n.sendState(st(2)), true)
		E.advance(60)
		assert.equal(n.sendState(st(2)), false) // unchanged, before the keepalive
		E.advance(1000)
		assert.equal(n.sendState(st(2)), true) // keepalive
		assert.equal(n.sendEvent(P.pickMsg(3)), true)
		assert.equal(n.sendEvent(P.pickMsg(3)), false) // same id within 400 ms
		assert.equal(n.sendEvent(P.pickMsg(4)), true)
		E.advance(401)
		assert.equal(n.sendEvent(P.pickMsg(3)), true)
		const before = ws.sent.filter((m) => m.t === 'ping').length
		E.advance(5000)
		assert.ok(ws.sent.filter((m) => m.t === 'ping').length > before)
		n.close()
		assert.equal(E.timers.size, 0)
		assert.equal(n.status, 'idle')
	})

	it('reconnects with backoff; full / off / 4403 / kick stop it', () => {
		const E = env()
		const n = new N.SkNet(E.e)
		n.connect('Bo', '#00ff00')
		E.last().open()
		E.last().shut(1006)
		assert.equal(n.status, 'closed')
		assert.equal(E.sockets.length, 1)
		E.advance(N.BACKOFF_MS[0])
		assert.equal(E.sockets.length, 2)
		E.last().shut(1006)
		E.advance(N.BACKOFF_MS[0])
		assert.equal(E.sockets.length, 2) // second wait is longer
		E.advance(N.BACKOFF_MS[1])
		assert.equal(E.sockets.length, 3)
		E.last().open()
		E.last().recv({ t: 'full' })
		assert.equal(n.status, 'full')
		E.last().shut(1000)
		E.advance(20000)
		assert.equal(E.sockets.length, 3)
		assert.equal(E.timers.size, 0)

		const E2 = env()
		const n2 = new N.SkNet(E2.e)
		n2.connect('C', '#0000ff')
		E2.last().open()
		E2.last().shut(N.OFF_CODE)
		assert.equal(n2.status, 'off')
		E2.advance(20000)
		assert.equal(E2.sockets.length, 1)

		const E3 = env()
		const n3 = new N.SkNet(E3.e)
		n3.connect('D', '#0000ff')
		E3.last().open()
		E3.last().shut(N.KICK_CODE)
		assert.equal(n3.status, 'kicked')
		E3.advance(20000)
		assert.equal(E3.sockets.length, 1)
		assert.equal(E3.timers.size, 0)
	})

	it('hands binary frames (LED wall pictures) to onBinary', () => {
		const E = env()
		const got = []
		const n = new N.SkNet({ ...E.e, onBinary: (d) => got.push(d) })
		n.connect('E', '#ffffff', true)
		E.last().open()
		assert.equal(E.last().sent[0].spectator, true)
		E.last().onmessage({ data: new ArrayBuffer(4) })
		assert.equal(got.length, 1)
		n.close()
	})
})
