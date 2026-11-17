'use strict'

/**
 * WO-1106 games-2 — Stage Salad room (modules/stage-salad/server/salad-room.js):
 *   B60 follow-up  the host's `start` and `stop` end every flight still in the air on every client (`end` k out), as the
 *                  buzzer and presenter-safe already do — before, the server forgot them silently and they flew on screen.
 *   B34            a dropped player resumes with its `welcome` token (rc-resume.js through salad-kit): the same id,
 *                  name, colour, slot and score; the reload restarts; a wrong token is a normal join (counted as bad);
 *                  the old half-open socket is closed (4410); a kicked token is void; `full` never hits a resuming player;
 *                  200 reload cycles keep one entry.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeRoom } = require('./lib/salad-fixtures')

const DEG = Math.PI / 180
let N = 0
/** A high slow lob from c's slot (≈ 3 s in the air). */
const lob = (R, c) => {
	const slot = R.room.ctx.venue().slots[R.of(c, 'welcome').at(-1).you.slot]
	R.room.handle(c, { t: 'fire', n: ++N, veg: 'potato', a: [slot.yaw + 0.3, 65 * DEG], p: 0.9 })
	return R.of(c, 'shot').at(-1)
}

for (const action of ['start', 'stop']) {
	test(`B60 follow-up: host \`${action}\` ends a practice flight in the air on every client (k out), nothing lands afterwards`, () => {
		const R = makeRoom()
		const a = R.join('Ann')
		const b = R.join('Ben')
		const shot = lob(R, a)
		R.clk.advance(300)
		assert.equal(R.room.shots.active(), 1)
		assert.equal(R.room.host(action).ok, true)
		const ends = R.of(b, 'end').filter((m) => m.id === shot.id && m.n === shot.n)
		assert.equal(ends.length, 1, 'the other guests hear it too')
		assert.equal(ends[0].k, 'out')
		assert.equal(ends[0].pts, undefined, 'never scored')
		assert.equal(R.room.shots.active(), 0)
		const n = R.all.length
		R.clk.advance(5000)
		assert.equal(R.all.slice(n).filter((m) => m.t === 'end').length, 0, 'no second `end` for it')
		R.room.dispose()
	})
}

/* ---------- B34: resume ---------- */

const REPLACED_CODE = 4410 // rc-resume.js
const welcomeOf = (R, c) => R.of(c, 'welcome').at(-1)
const toRound = (R) => {
	R.room.host('start')
	R.clk.advance(3500)
	assert.equal(R.room.state().phase, 'round')
}
const leave = (R, c) => (c.stop(), R.room.disconnect(c))

test('B34 Salad: the token resumes the same player mid-round (id, name, colour, slot, score); the reload restarts', () => {
	const R = makeRoom()
	const a = R.join('Ann', { color: '#ff5533' })
	const b = R.join('Ben')
	const w = welcomeOf(R, a)
	assert.match(w.resume, new RegExp(`^${w.id}\\.[A-Za-z0-9_-]{22}$`))
	toRound(R)
	const p = R.room.ctx.players.get(w.id)
	p.score = 5
	p.streak = 2
	leave(R, a)
	R.clk.advance(4000)
	assert.equal(JSON.stringify(R.room.state()).includes(w.resume.split('.')[1]), false, 'never in a state')
	const back = R.join('Somebody', { resume: w.resume, color: '#000000' })
	const bw = welcomeOf(R, back)
	assert.equal(bw.resumed, true)
	assert.equal(bw.id, w.id)
	assert.deepEqual(bw.you, w.you, 'name, colour, team and slot as before')
	const me = R.of(back, 'me').at(-1)
	assert.equal(me.score, 5)
	assert.ok(me.ready >= R.clk.now() + 1600, 'the reload starts again (the longest vegetable\'s)')
	assert.equal(R.room.state().players.filter((q) => !q.bot).length, 2, 'no second entry')
	assert.equal(lob(R, back), undefined, 'still reloading: refused')
	R.clk.advance(1700)
	assert.ok(lob(R, back), 'then it throws again (its shot counter starts over)')
	assert.ok(b)
	R.room.dispose()
})

test('B34 Salad: a half-open old socket is closed (4410); a wrong token is a normal join counted as bad; a kicked token is void', () => {
	const R = makeRoom()
	const a = R.join('Ann')
	const w = welcomeOf(R, a)
	const back = R.join('Ann', { resume: w.resume })
	assert.equal(welcomeOf(R, back).id, w.id)
	assert.equal(a.closed, REPLACED_CODE)
	R.room.disconnect(a)
	assert.equal(R.room.state().players.find((q) => q.id === w.id).connected, true, 'the old socket\'s close drops nobody')
	const eve = { name: 'Eve' }
	R.room.connect(eve)
	assert.equal(R.room.handle(eve, { t: 'join', name: 'Eve', resume: `${w.id}.${'C'.repeat(22)}` }), 'bad')
	assert.notEqual(welcomeOf(R, eve).id, w.id)
	R.room.host('kick', { id: w.id })
	const k = { name: 'Ann' }
	R.room.connect(k)
	assert.equal(R.room.handle(k, { t: 'join', name: 'Ann', resume: w.resume }), undefined, 'a stale token is not bad')
	assert.notEqual(welcomeOf(R, k).id, w.id)
	assert.equal(welcomeOf(R, k).resumed, undefined)
	R.room.dispose()
})

test('B34 Salad: a full room never refuses its own resuming player; a joiner still takes the longest-gone seat', () => {
	const R = makeRoom({ maxPlayers: 3 })
	const [a, b, c] = ['Ann', 'Ben', 'Cid'].map((n) => R.join(n))
	toRound(R)
	leave(R, c)
	R.clk.advance(1000)
	const cBack = R.join('Cid', { resume: welcomeOf(R, c).resume })
	assert.equal(R.of(cBack, 'full').length, 0)
	assert.equal(welcomeOf(R, cBack).id, welcomeOf(R, c).id)
	leave(R, b)
	const d = R.join('Dot')
	assert.equal(R.of(d, 'full').length, 0, 'takes Ben\'s seat')
	const bLate = R.join('Ben', { resume: welcomeOf(R, b).resume })
	assert.equal(R.of(bLate, 'full').length, 1, 'its seat went with its entry')
	assert.ok(a)
	R.room.dispose()
})

test('B34 Salad: 200 reload cycles with the token keep one entry', () => {
	const R = makeRoom()
	let cur = R.join('Ann')
	const { id, resume } = welcomeOf(R, cur)
	toRound(R)
	for (let i = 0; i < 200; i++) {
		if (i % 2) leave(R, cur)
		else cur.stop()
		cur = R.join('Ann', { resume })
		assert.equal(welcomeOf(R, cur).id, id)
	}
	assert.equal(R.room.ctx.players.size, 1)
	R.room.dispose()
})
