'use strict'

/**
 * WO-1125 — the shared player-control rules (modules/rc-game/server/rc-ctl.js, work/notes/game-self-service-contract.md
 * §3), pure, on an injected clock with a fake room view and a recording host(): the refusal matrix (host / seat / bad /
 * paused / running / slow), the mapping onto the host bodies in order (a host refusal comes back as `bad` + its text),
 * `stop` only from the results (a no-op in the lobby), the rate limit (> 4 in 2 s per socket, never a close), the info
 * log line, the `self` host action (default off, a state push only on a change) and the operator `held` note.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createGameCtl, seatOf, intIn, LEVELS, RATE_N, RATE_MS, IDLE } = require('../../modules/rc-game/server/rc-ctl')

function setup(o = {}) {
	let t = 1_000_000
	const sent = []
	const bodies = []
	const logs = []
	const pushes = []
	const A = { id: 1 }
	const B = { id: 2 }
	const S = { id: 3 }
	const view = {
		phase: 'lobby',
		paused: false,
		safe: false,
		conns: [{ conn: A, pid: 1, spectator: false, joined: true }, { conn: B, pid: 2, spectator: false, joined: true }, { conn: S, pid: 3, spectator: true, joined: true }],
		players: new Map([[1, { id: 1, name: 'Ana', connected: true }], [2, { id: 2, name: 'Bo', connected: false }]]),
	}
	const ctl = createGameCtl({
		game: 'rc-game',
		now: () => t,
		log: (level, msg) => logs.push([level, msg]),
		send: (conn, m) => sent.push([conn, m]),
		host: (b) => (bodies.push(b), o.refuse && o.refuse(b) ? { status: 409, body: { ok: false, error: o.refuse(b) } } : { status: 200, body: { ok: true } }),
		world: () => (o.closed ? null : view),
		keys: { laps: (v) => (intIn(v, 1, 20) != null ? [{ action: 'laps', laps: v }] : null), track: (v) => (typeof v === 'string' ? [{ action: 'track', trackId: v }] : null) },
		bots: (n, level) => [{ action: 'bots', n }, ...(level ? [{ action: 'botlevel', level }] : [])],
	})
	const last = () => sent[sent.length - 1]?.[1]
	const step = (ms) => (t += ms)
	return { ctl, view, sent, bodies, logs, pushes, A, B, S, last, step }
}

test('self is off by default: every ctl is refused with `host`, nothing reaches the game', () => {
	const s = setup()
	assert.equal(s.ctl.self(), false)
	s.ctl.handle(s.A, { t: 'ctl', a: 'start' })
	assert.deepEqual(s.last(), { t: 'ctl', ok: false, a: 'start', error: 'host' })
	assert.equal(s.bodies.length, 0)
})

test('hostSelf: boolean only; a change pushes the state once; held follows disable / enable', () => {
	const s = setup()
	let pushes = 0
	const state = () => ({ self: s.ctl.self() })
	assert.equal(s.ctl.hostSelf({ action: 'self', on: 'yes' }, state, () => pushes++).status, 400)
	const r = s.ctl.hostSelf({ action: 'self', on: true }, state, () => pushes++)
	assert.deepEqual([r.status, r.body.ok, r.body.state.self, pushes], [200, true, true, 1])
	s.ctl.hostSelf({ action: 'self', on: true }, state, () => pushes++)
	assert.equal(pushes, 1, 'unchanged → no push')
	assert.equal(s.ctl.held(), false)
	s.ctl.note('disable')
	assert.equal(s.ctl.held(), true)
	s.ctl.note('laps')
	assert.equal(s.ctl.held(), true, 'other actions leave it')
	s.ctl.note('enable')
	assert.equal(s.ctl.held(), false)
})

test('refusal matrix: spectator / gone player / unknown conn → seat; bad shapes → bad; paused / safe → paused; running → running', () => {
	const s = setup()
	s.ctl.hostSelf({ on: true }, () => ({}), () => {})
	const ask = (conn, m) => (s.ctl.handle(conn, { t: 'ctl', ...m }), s.step(RATE_MS), s.last())
	assert.equal(ask(s.S, { a: 'start' }).error, 'seat', 'a spectator')
	assert.equal(ask(s.B, { a: 'start' }).error, 'seat', 'a player whose socket dropped (listed, not connected)')
	assert.equal(ask({ id: 9 }, { a: 'start' }).error, 'seat', 'not in the room')
	for (const m of [{ a: 'nope' }, { a: 'bots', n: -1 }, { a: 'bots', n: 1.5 }, { a: 'bots', n: 2, level: 'mad' }, { a: 'set', k: 'target', v: 'x' },
		{ a: 'set', k: 'constructor', v: 1 }, { a: 'set', k: 'laps', v: 0 }, { a: 'set', k: 'laps', v: 21 }, { a: 'set', k: 'laps', v: '3' }, { a: 'set' }]) {
		assert.equal(ask(s.A, m).error, 'bad', JSON.stringify(m))
	}
	s.view.paused = true
	assert.equal(ask(s.A, { a: 'start' }).error, 'paused')
	s.view.paused = false
	s.view.safe = true
	assert.equal(ask(s.A, { a: 'bots', n: 1 }).error, 'paused', 'salad presenter safe')
	s.view.safe = false
	for (const phase of ['countdown', 'race', 'match', 'round']) {
		s.view.phase = phase
		assert.equal(ask(s.A, { a: 'start' }).error, 'running', phase)
		assert.equal(ask(s.A, { a: 'stop' }).error, 'running', `${phase}: stop never ends a running round`)
		assert.equal(ask(s.A, { a: 'set', k: 'laps', v: 3 }).error, 'running', phase)
	}
	assert.equal(s.bodies.length, 0, 'no refused ctl reached the game')
	assert.ok(s.sent.every(([, m]) => m.t === 'ctl'))
})

test('allowed: mapped onto the host bodies in order, ok to the sender, one info line; stop only from the results', () => {
	const s = setup()
	s.ctl.hostSelf({ on: true }, () => ({}), () => {})
	const ask = (m) => (s.ctl.handle(s.A, { t: 'ctl', ...m }), s.step(RATE_MS), s.last())
	assert.deepEqual(ask({ a: 'start' }), { t: 'ctl', ok: true, a: 'start' })
	assert.deepEqual(ask({ a: 'bots', n: 3, level: 'normal' }), { t: 'ctl', ok: true, a: 'bots' })
	assert.deepEqual(ask({ a: 'set', k: 'track', v: 'stage-oval' }), { t: 'ctl', ok: true, a: 'set' })
	assert.deepEqual(ask({ a: 'stop' }), { t: 'ctl', ok: true, a: 'stop' }, 'lobby: a no-op answered ok')
	s.view.phase = 'results'
	assert.deepEqual(ask({ a: 'stop' }), { t: 'ctl', ok: true, a: 'stop' })
	assert.deepEqual(ask({ a: 'start' }), { t: 'ctl', ok: true, a: 'start' }, 'play again from the results')
	assert.deepEqual(s.bodies, [{ action: 'start' }, { action: 'bots', n: 3 }, { action: 'botlevel', level: 'normal' }, { action: 'track', trackId: 'stage-oval' },
		{ action: 'stop' }, { action: 'start' }])
	assert.deepEqual(s.logs, [
		['info', '[rc-game] Ana (#1): start'],
		['info', '[rc-game] Ana (#1): bots 3 normal'],
		['info', '[rc-game] Ana (#1): set track stage-oval'],
		['info', '[rc-game] Ana (#1): stop'],
		['info', '[rc-game] Ana (#1): start'],
	])
	assert.deepEqual(LEVELS, ['easy', 'normal', 'hard'])
	assert.deepEqual([...IDLE], ['lobby', 'results'])
})

test('a host refusal comes back as `bad` with its text; later bodies are not sent; nothing logged', () => {
	const s = setup({ refuse: (b) => (b.action === 'bots' ? 'bots 0–9' : '') })
	s.ctl.hostSelf({ on: true }, () => ({}), () => {})
	s.ctl.handle(s.A, { t: 'ctl', a: 'bots', n: 30, level: 'hard' })
	assert.deepEqual(s.last(), { t: 'ctl', ok: false, a: 'bots', error: 'bad', msg: 'bots 0–9' })
	assert.deepEqual(s.bodies, [{ action: 'bots', n: 30 }])
	assert.equal(s.logs.length, 0)
})

test('rate limit: the 5th ctl inside 2 s from one socket is `slow`; another socket is not affected; the window slides', () => {
	const s = setup()
	s.ctl.hostSelf({ on: true }, () => ({}), () => {})
	for (let i = 0; i < RATE_N; i++) {
		s.ctl.handle(s.A, { t: 'ctl', a: 'set', k: 'laps', v: 3 })
		assert.equal(s.last().ok, true, `#${i + 1}`)
		s.step(100)
	}
	s.ctl.handle(s.A, { t: 'ctl', a: 'set', k: 'laps', v: 3 })
	assert.deepEqual(s.last(), { t: 'ctl', ok: false, a: 'set', error: 'slow' })
	assert.equal(s.bodies.length, RATE_N)
	s.view.players.set(2, { id: 2, name: 'Bo', connected: true })
	s.ctl.handle(s.B, { t: 'ctl', a: 'start' })
	assert.equal(s.last().ok, true, 'per socket')
	s.step(RATE_MS)
	s.ctl.handle(s.A, { t: 'ctl', a: 'start' })
	assert.equal(s.last().ok, true, 'after 2 s quiet')
	const off = setup()
	for (let i = 0; i < RATE_N; i++) off.ctl.handle(off.A, { t: 'ctl', a: 'start' })
	off.ctl.handle(off.A, { t: 'ctl', a: 'start' })
	assert.equal(off.last().error, 'slow', 'counted before the self check: a refused flood is still slowed')
})

test('seatOf: joined, seated, connected, not a bot', () => {
	const s = setup()
	assert.equal(seatOf(s.view, s.A).name, 'Ana')
	assert.equal(seatOf(s.view, s.S), null)
	assert.equal(seatOf({ conns: [{ conn: s.A, pid: 1, joined: true }], players: new Map([[1, { id: 1, bot: true }]]) }, s.A), null)
	assert.equal(seatOf({ conns: [{ conn: s.A, pid: 1, joined: false }], players: new Map([[1, { id: 1 }]]) }, s.A), null)
	assert.equal(seatOf(null, s.A), null)
	const closed = setup({ closed: true })
	closed.ctl.hostSelf({ on: true }, () => ({}), () => {})
	closed.ctl.handle(closed.A, { t: 'ctl', a: 'start' })
	assert.equal(closed.last().error, 'seat', 'no room: nobody is seated')
})
