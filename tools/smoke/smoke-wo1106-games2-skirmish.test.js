'use strict'

/**
 * WO-1106 games-2 — Stage Skirmish (modules/toy-skirmish/server/sk-room.js, sk-game.js):
 *   B56 (server half)  a previs edit (a new scene rev) reaches the players with no host page open: the room's 1 Hz
 *                      housekeeping lets the service check the rev every REV_CHECK_MS (not per message) — a new rev
 *                      rebakes and the lobby's state carries the new `sceneRev`.
 *   B34                a dropped player resumes with its `welcome` token (rc-resume.js through sk-kit): the same id,
 *                      name, colour, team and score, respawned through the normal path; a wrong token is a normal join
 *                      (counted as bad); the old half-open socket is closed (4410); a kicked token is void; a ghost
 *                      keeps its seat (a joiner to a full room takes the longest-gone one's); 200 cycles keep one entry.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { EventEmitter } = require('events')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { createSkGame, REV_CHECK_MS } = require('../../modules/toy-skirmish/server/sk-game')
const { createSkRoom } = require('../../modules/toy-skirmish/server/sk-room')
const R = require('../../modules/toy-skirmish/server/sk-rules')
const REPLACED_CODE = 4410 // rc-resume.js

function makeClock(t0 = 5_000_000) {
	let t = t0
	let seq = 0
	const timers = new Map()
	const add = (fn, ms, every) => (timers.set(++seq, { fn, at: t + Math.max(0, Number(ms) || 0), every }), seq)
	return {
		now: () => t,
		timers: {
			setTimeout: (fn, ms) => add(fn, ms, 0),
			setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms)),
			clearTimeout: (id) => timers.delete(id),
			clearInterval: (id) => timers.delete(id),
		},
		pending: () => timers.size,
		advance(ms) {
			const end = t + ms
			for (;;) {
				let next = null
				for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at || (x.at === next[1].at && id < next[0]))) next = [id, x]
				if (!next) break
				t = next[1].at
				if (next[1].every) next[1].at += next[1].every
				else timers.delete(next[0])
				next[1].fn()
			}
			t = end
		},
	}
}

/** A socket as the `ws` package hands it to the game: send / close / events; `got(t)` = the parsed messages of type t. */
function fakeWs() {
	const ws = new EventEmitter()
	Object.assign(ws, { readyState: 1, bufferedAmount: 0, sent: [], closedWith: null })
	ws.send = (s) => ws.sent.push(s)
	ws.close = (code) => {
		if (ws.closedWith != null) return
		ws.closedWith = code ?? 1000
		ws.readyState = 3
		ws.emit('close', code)
	}
	ws.msg = (m) => ws.emit('message', Buffer.from(JSON.stringify(m)), false)
	ws.got = (t) => ws.sent.map((s) => JSON.parse(s)).filter((m) => !t || m.t === t)
	return ws
}

const flush = async (n = 20) => {
	for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}


/** A baker whose rev the test turns (an operator's previs edit); get() bakes an empty hall (no arenas). */
function fakeBaker() {
	const b = { cur: 'rev-1', revCalls: 0 }
	b.rev = () => (b.revCalls++, b.cur)
	b.get = async () => {
		const json = { rev: b.cur, scale: 0.1, floors: [], occ: [], bounds: { min: [-3, 0, -3], max: [3, 3, 3] } }
		return { rev: b.cur, json, text: JSON.stringify(json), glb: Buffer.alloc(0), gz: null }
	}
	return b
}

test('B56: a new scene rev reaches a joined player in the lobby with nobody calling state(); checked every 5 s, not per message', async (t) => {
	const clock = makeClock()
	const baker = fakeBaker()
	const game = createSkGame({ now: clock.now, timers: clock.timers, baker, log: () => {}, lanIps: () => [] })
	t.after(() => game.disable())
	game.host({ action: 'enable' })
	await flush()
	const ws = fakeWs()
	game.attach(ws)
	ws.msg({ t: 'join', name: 'Ann', color: '#ff5533' })
	assert.equal(ws.got('welcome')[0].state.sceneRev, 'rev-1')
	baker.cur = 'rev-2' // the operator edits the previs; no host page, no /state GET
	const calls = baker.revCalls
	for (let i = 0; i < 2 * REV_CHECK_MS / 1000; i++) {
		ws.msg({ t: 'ping', c: 0 })
		clock.advance(1000)
		await flush()
	}
	const states = ws.got('state').map((m) => m.state.sceneRev)
	assert.ok(states.includes('rev-2'), `the new rev was broadcast (${states.join(', ')})`)
	assert.ok(baker.revCalls - calls <= 3, `the rev is looked at every ${REV_CHECK_MS} ms (${baker.revCalls - calls} looks in 10 s, 10 pings)`)
	assert.equal(ws.closedWith, null)
})

/* ---------- B34: resume ---------- */

const ARENA = {
	id: 'box', name: 'Box', floor: 'hall', y: 0, rect: [-2, -2, 2, 2], blocks: [],
	spawns: [[-1.5, -1.5], [0, -1.5], [1.5, -1.5], [-1.5, 0.6], [1.5, 0.6], [0, 1.6]].map(([x, z]) => ({ x, z, yaw: 0, team: z < 0 ? 0 : 1 })),
	pickups: [],
}
const SCENE = { rev: 'b34', scale: 0.1, floors: [{ id: 'hall', y: 0, rect: [-3, -3, 3, 3] }], occ: [], arenas: [ARENA] }

function roomSetup(t, o = {}) {
	const clock = makeClock()
	const closed = new Map()
	const room = createSkRoom({ now: clock.now, timers: clock.timers, rng: R.mulberry32(5), send: (c, m) => c.out.push(m), maxPlayers: o.maxPlayers,
		close: (c, code) => closed.set(c, code) })
	room.setScene(SCENE)
	const talking = new Set()
	const advance = (ms) => {
		for (let left = ms; left > 0; left -= 1000) {
			for (const c of talking) room.handle(c, { t: 'ping', c: 0 })
			clock.advance(Math.min(1000, left))
		}
	}
	const join = (name, extra = {}) => {
		const c = { name, out: [] }
		room.connect(c)
		c.r = room.handle(c, { t: 'join', name, color: '#ff5533', ...extra })
		talking.add(c)
		c.w = c.out.find((m) => m.t === 'welcome')
		c.full = c.out.some((m) => m.t === 'full')
		return c
	}
	const drop = (c) => (talking.delete(c), room.disconnect(c))
	const toMatch = () => {
		room.host('start')
		advance(R.RULES.countdownMs + 100)
		assert.equal(room.snapshot().phase, 'match')
	}
	t.after(() => room.dispose())
	return { clock, room, closed, join, drop, advance, toMatch, X: room.ctx }
}

test('B34 Skirmish: the token resumes the same soldier mid-match (id, name, colour, team, score) and respawns it; never in a state', (t) => {
	const S = roomSetup(t)
	const a = S.join('Ann'), b = S.join('Ben')
	assert.match(a.w.resume, new RegExp(`^${a.w.id}\\.[A-Za-z0-9_-]{22}$`))
	S.toMatch()
	const p = S.X.players.get(a.w.id)
	p.score = 7
	p.kills = 3
	S.drop(a)
	S.advance(5000)
	assert.equal(JSON.stringify(S.room.state()).includes(a.w.resume.split('.')[1]), false)
	const back = S.join('Somebody', { resume: a.w.resume, color: '#000000' })
	assert.equal(back.w.resumed, true)
	assert.equal(back.w.id, a.w.id)
	assert.deepEqual(back.w.you, a.w.you, 'name, colour and team as before')
	const me = S.room.snapshot().players.find((q) => q.id === a.w.id)
	assert.deepEqual([me.connected, me.score, me.kills], [true, 7, 3], 'the score stands')
	assert.ok(back.out.some((m) => m.t === 'spawn' && m.id === a.w.id), 'respawned through the normal spawn')
	assert.equal(S.X.players.get(a.w.id).alive, true)
	assert.equal(S.room.snapshot().players.filter((q) => !q.bot).length, 2, 'no second entry')
	assert.ok(b.w)
})

test('B34 Skirmish: a half-open old socket is closed (4410); a wrong token is a normal join counted as bad; a kicked token is void', (t) => {
	const S = roomSetup(t)
	const a = S.join('Ann')
	const back = S.join('Ann', { resume: a.w.resume })
	assert.equal(back.w.id, a.w.id)
	assert.equal(S.closed.get(a), REPLACED_CODE)
	S.room.disconnect(a) // the old socket's late close drops nobody
	assert.equal(S.room.snapshot().players.find((q) => q.id === a.w.id).connected, true)
	const wrong = S.join('Eve', { resume: `${a.w.id}.${'B'.repeat(22)}` })
	assert.equal(wrong.r, 'bad')
	assert.notEqual(wrong.w.id, a.w.id)
	S.room.host('kick', { id: a.w.id })
	const kicked = S.join('Ann', { resume: a.w.resume })
	assert.notEqual(kicked.w.id, a.w.id, 'a kicked player comes back as a new player')
	assert.equal(kicked.w.resumed, undefined)
	assert.equal(kicked.r, undefined, 'a stale token is not counted as bad')
})

test('B34 Skirmish: a ghost keeps its seat in a full room; a joiner takes the longest-gone one\'s (its token void, its score listed)', (t) => {
	const S = roomSetup(t, { maxPlayers: 3 })
	const a = S.join('Ann'), b = S.join('Ben'), c = S.join('Cid')
	S.toMatch()
	S.drop(c)
	S.advance(2000)
	const cBack = S.join('Cid', { resume: c.w.resume })
	assert.equal(cBack.full, false, '`full` never hits a resuming player')
	assert.equal(cBack.w.id, c.w.id)
	S.drop(b)
	S.advance(1000)
	S.drop(cBack)
	S.X.players.get(b.w.id).score = 4
	const d = S.join('Dot') // full room (Ann + two ghosts): takes Ben's seat, the longest gone
	assert.equal(d.full, false)
	const cAgain = S.join('Cid', { resume: c.w.resume })
	assert.equal(cAgain.w.id, c.w.id, 'the other ghost still had its seat')
	const bLate = S.join('Ben', { resume: b.w.resume })
	assert.equal(bLate.full, true, 'its seat went: the room is full for it (and its token is void)')
	assert.equal(bLate.r, undefined)
	assert.equal(S.room.snapshot().players.find((q) => q.id === b.w.id).score, 4, 'the seatless ghost stays listed with its score')
	assert.ok(a.w)
})

test('B34 Skirmish: 200 reload cycles with the token keep one entry', (t) => {
	const S = roomSetup(t)
	let cur = S.join('Ann')
	const { id, resume } = cur.w
	S.toMatch()
	for (let i = 0; i < 200; i++) {
		if (i % 2) S.drop(cur)
		cur = S.join('Ann', { resume })
		assert.equal(cur.w.id, id)
	}
	assert.equal(S.X.players.size, 1)
	assert.equal(S.room.connections(), 1)
})
