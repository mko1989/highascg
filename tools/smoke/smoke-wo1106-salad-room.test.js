'use strict'

/**
 * WO-1106 (salad slice) — Stage Salad room fixes (modules/stage-salad/server/salad-room.js, salad-shots.js):
 *   B60: at the buzzer the open flights are cleared after the last tick — each gets an `end` (k out) BEFORE `results`,
 *        and nothing scores after `results`.
 *   B64: the presenter-safe clears the flights the same way (every client hears the `end`).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeRoom } = require('./lib/salad-fixtures')

const DEG = Math.PI / 180
let N = 0
/** A high slow lob from c's slot (≈ 3 s in the air). */
const lob = (R, c) => {
	const slot = R.room.ctx.venue().slots[R.of(c, 'welcome')[0].you.slot]
	R.room.handle(c, { t: 'fire', n: ++N, veg: 'potato', a: [slot.yaw + 0.3, 65 * DEG], p: 0.9 })
	return R.of(c, 'shot').at(-1)
}

test('B60: a vegetable in the air at the buzzer ends (k out) before `results`; nothing scores afterwards', () => {
	const R = makeRoom()
	const a = R.join('Ann')
	R.room.host('round', { secs: 30 })
	R.room.host('start')
	R.clk.advance(3000 + 30000 - 500)
	const shot = lob(R, a)
	R.clk.advance(500)
	assert.equal(R.room.snapshot().phase, 'results')
	const idx = R.all.findIndex((m) => m.t === 'results')
	const end = R.all.findIndex((m) => m.t === 'end' && m.id === shot.id && m.n === shot.n)
	assert.ok(end >= 0 && end < idx, 'the flight\'s `end` comes before `results`')
	assert.equal(R.all[end].k, 'out')
	assert.equal(R.all[end].pts, undefined)
	assert.equal(R.room.shots.active(), 0, 'no flight left on the server')
	R.clk.advance(5000)
	assert.equal(R.all.slice(idx).filter((m) => m.t === 'end').length, 0, 'nothing lands after the results')
	R.room.dispose()
})

test('B64: presenter-safe → every open flight gets its `end` (k out) and the server keeps none', () => {
	const R = makeRoom()
	const a = R.join('Ann')
	const b = R.join('Ben')
	const shot = lob(R, a)
	R.clk.advance(300)
	assert.equal(R.room.shots.active(), 1)
	assert.equal(R.room.host('safe', { on: true }).ok, true)
	const ends = R.of(b, 'end').filter((m) => m.id === shot.id && m.n === shot.n)
	assert.equal(ends.length, 1, 'the other guests hear it too')
	assert.equal(ends[0].k, 'out')
	assert.ok(ends[0].at > shot.ts && ends[0].at <= shot.ts + 400)
	assert.equal(R.room.shots.active(), 0)
	R.room.dispose()
})

test('B34: a full room held by dropped players — a joining guest takes the seat of the one gone longest', () => {
	const R = makeRoom({ maxPlayers: 4 })
	const g = ['A', 'B', 'C', 'D'].map((n) => R.join(n))
	R.room.host('round', { secs: 60 })
	R.room.host('start')
	R.clk.advance(3500)
	const id = (c) => R.of(c, 'welcome')[0].id
	g[1].stop(), R.room.disconnect(g[1])
	R.clk.advance(1000)
	g[2].stop(), R.room.disconnect(g[2])
	assert.equal(R.room.snapshot().players.length, 4, 'mid-round the dropped keep their entries (the scores stay on the board)')
	const e = R.join('E')
	assert.equal(R.of(e, 'full').length, 0, 'not refused')
	assert.equal(R.of(e, 'welcome').length, 1)
	let ids = R.room.snapshot().players.map((p) => p.id)
	assert.ok(!ids.includes(id(g[1])) && ids.includes(id(g[2])), 'B (gone longest) made room, C kept')
	const f = R.join('F')
	ids = R.room.snapshot().players.map((p) => p.id)
	assert.equal(R.of(f, 'welcome').length, 1)
	assert.ok(!ids.includes(id(g[2])))
	assert.equal(new Set(R.room.snapshot().players.map((p) => p.slot)).size, 4, 'every player its own sling')
	assert.deepEqual(R.of(R.join('G'), 'full'), [{ t: 'full' }], 'connected players are never pushed out')
	R.room.dispose()
})

test('B36: a joined spectator that goes silent is closed (4408) and frees its seat; a pinging one stays', () => {
	const R = makeRoom()
	const quiet = R.join('Eye', { spectator: true }, { silent: true })
	const live = R.join('Eye2', { spectator: true })
	assert.equal(R.room.snapshot().spectators, 2)
	R.clk.advance(12000)
	assert.equal(quiet.closed, 4408)
	assert.equal(live.closed, undefined)
	assert.equal(R.room.snapshot().spectators, 1)
	live.stop()
	R.room.dispose()
})

test('B36: at most 4 game sockets per remote address (loopback = a proxy: not capped); a closed one frees its place', (t) => {
	const { EventEmitter } = require('events')
	const fs = require('fs'), os = require('os'), path = require('path')
	const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-salad-room-'))
	t.after(() => fs.rmSync(TMP, { recursive: true, force: true }))
	const { createSaladGame, MAX_PER_ADDRESS } = require('../../modules/stage-salad/server/salad-game')
	assert.equal(MAX_PER_ADDRESS, 4)
	const g = createSaladGame({ lanIps: () => ['192.0.2.1'], readTracking: async () => null,
		bakerDeps: { loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null }, cacheDir: TMP } })
	g.host({ action: 'enable' })
	t.after(() => g.disable())
	const sock = () => {
		const ws = new EventEmitter()
		Object.assign(ws, { readyState: 1, bufferedAmount: 0, send() {} })
		ws.close = (code) => {
			if (ws.readyState === 3) return
			ws.readyState = 3
			ws.code = code
			ws.emit('close')
		}
		return ws
	}
	const req = (ip) => ({ socket: { remoteAddress: ip } })
	const mine = Array.from({ length: 5 }, () => sock())
	mine.forEach((ws) => g.attach(ws, req('::ffff:192.0.2.50')))
	assert.deepEqual(mine.map((ws) => ws.code), [undefined, undefined, undefined, undefined, 1013])
	const other = sock()
	g.attach(other, req('192.0.2.51'))
	assert.equal(other.code, undefined, 'another device is not affected')
	mine[0].close(1000)
	const again = sock()
	g.attach(again, req('192.0.2.50'))
	assert.equal(again.code, undefined, 'a closed socket frees its place (the same address with or without ::ffff:)')
	const local = Array.from({ length: 6 }, () => sock())
	local.forEach((ws) => g.attach(ws, req('127.0.0.1')))
	assert.ok(local.every((ws) => ws.code === undefined), 'loopback (a proxy in front) is not capped')
	const unknown = Array.from({ length: 6 }, () => sock())
	unknown.forEach((ws) => g.attach(ws))
	assert.ok(unknown.every((ws) => ws.code === undefined), 'no address known: no cap')
	assert.equal(g.socketCount(), 4 + 1 + 6 + 6)
})
