'use strict'

/**
 * WO-1106 — the RC game service (modules/rc-game/server/rc-game.js) with a fake baker and fake sockets:
 *   A5   the world adapter's send() says false when the socket skipped it (closed / over 256 KB), true when sent
 *   A23  `bots` level must be an own key of LEVELS (`constructor` → 400; rc-room-bots.setCount ignores it)
 *   B36  ≤ 4 game sockets per remote address (loopback / unknown not counted); a close frees the place
 *   B37  an unchanged scene rev is not re-applied to the room / bots on every `/scene` GET
 *   B52  disable drops the baker's last bake
 *   B53  100.64/10 addresses never reach the public joinUrls
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createRcGame, MAX_PER_ADDRESS, remoteAddress } = require('../../modules/rc-game/server/rc-game')
const { createRoomBots } = require('../../modules/rc-game/server/rc-room-bots')
const { setRcGameEnabled } = require('../../modules/rc-game/server/rc-public')

const TRACK = { id: 'stage-oval', length: 40, checkpoints: [0, 15, 30, 45], points: [] }

function fakeBaker() {
	const b = { r: 'none-aaaa', gets: 0, drops: 0 }
	b.rev = () => b.r
	b.get = () => (b.gets++, Promise.resolve({ rev: b.r, json: { tracks: [TRACK], bounds: null }, text: '{}' }))
	b.drop = () => b.drops++
	return b
}

function game(t, o = {}) {
	const baker = fakeBaker()
	const g = createRcGame({ baker, lanIps: () => o.ips || ['192.0.2.7'], loadBots: () => new Promise(() => {}), log: () => {} })
	t.after(() => {
		g.disable()
		setRcGameEnabled(false)
	})
	return { g, baker }
}

function sock(buffered = 0) {
	const ws = new EventEmitter()
	Object.assign(ws, { readyState: 1, bufferedAmount: buffered, sent: [], code: null })
	ws.send = (s) => ws.sent.push(JSON.parse(s))
	ws.close = (code) => (ws.code = code)
	return ws
}
const flush = () => new Promise((r) => setImmediate(r))

test('A5: adapter.send → true when handed to the socket, false when skipped (backpressure, closed, send throws); bots true', async (t) => {
	const { g } = game(t)
	g.enable()
	const a = g.worldAdapter()
	const ok = sock()
	assert.equal(a.send(ok, { t: 'wst', on: true }), true)
	assert.equal(ok.sent.length, 1)
	assert.equal(a.send(sock(256 * 1024 + 1), { t: 'wst' }), false, 'over the send buffer')
	const shut = sock()
	shut.readyState = 3
	assert.equal(a.send(shut, { t: 'wst' }), false, 'not open')
	const bad = sock()
	bad.send = () => {
		throw new Error('gone')
	}
	assert.equal(a.send(bad, { t: 'wst' }), false, 'send threw')
	const got = []
	assert.equal(a.send({ botSink: (m) => got.push(m) }, { t: 'xfx' }), true, 'a bot conn always takes it')
	assert.equal(got.length, 1)
})

test('A23: `bots` level `constructor` → 400 (not a 200 and a throwing add()); setCount ignores a non-own level', async (t) => {
	const { g } = game(t)
	g.enable()
	for (const level of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
		const r = g.host({ action: 'bots', count: 1, level })
		assert.equal(r.status, 400, level)
	}
	assert.equal(g.host({ action: 'bots', count: 1, level: 'hard' }).status, 200)

	const brain = () => ({ id: null, onMessage(m) {
		if (m.t === 'welcome') this.id = m.id
	}, step: () => [] })
	let n = 0
	const conns = new Set()
	const bots = createRoomBots({ load: () => Promise.resolve([{ createBot: brain }, [{}, {}, {}]]), timers: { setInterval: () => 1, clearInterval: () => {} },
		connect: (c) => conns.add(c), disconnect: (c) => conns.delete(c), handle: (c, m) => m.t === 'join' && c.botSink({ t: 'welcome', id: ++n }) })
	await bots.preload()
	assert.doesNotThrow(() => bots.setCount(2, 'constructor'))
	assert.equal(bots.level(), 'normal')
	assert.equal(bots.count(), 2)
	bots.dispose()
})

test('B36: ≤ 4 sockets per remote address; loopback and unknown addresses are not counted; a close frees a place', async (t) => {
	const { g } = game(t)
	g.enable()
	assert.equal(MAX_PER_ADDRESS, 4)
	const req = (a) => ({ socket: { remoteAddress: a } })
	const phone = Array.from({ length: 4 }, () => sock())
	phone.forEach((ws, i) => g.attach(ws, req(i % 2 ? '192.168.1.50' : '::ffff:192.168.1.50')))
	assert.ok(phone.every((ws) => ws.code === null))
	const fifth = sock()
	g.attach(fifth, req('192.168.1.50'))
	assert.equal(fifth.code, 1013, 'the fifth socket from one address is refused')
	const other = sock()
	g.attach(other, req('192.168.1.51'))
	assert.equal(other.code, null)
	const local = Array.from({ length: 6 }, () => sock())
	local.forEach((ws, i) => g.attach(ws, i % 3 === 0 ? req('127.0.0.1') : i % 3 === 1 ? req('::1') : undefined))
	assert.ok(local.every((ws) => ws.code === null), 'loopback / unknown: only the overall cap')
	assert.equal(g.socketCount(), 4 + 1 + 6)
	phone[0].emit('close')
	const again = sock()
	g.attach(again, req('192.168.1.50'))
	assert.equal(again.code, null, 'a closed socket frees its place')
	assert.equal(remoteAddress(req('::ffff:10.0.0.9')), '10.0.0.9')
	assert.equal(remoteAddress(req('::ffff:127.0.0.1')), null)
})

test('B37: an unchanged scene rev is applied to the room once — not again on every /scene GET', async (t) => {
	const { g, baker } = game(t)
	g.enable()
	await flush()
	const room = g.room()
	assert.equal(room.state().trackId, TRACK.id, 'the first bake reached the room')
	let applied = 0
	const orig = room.setScene
	room.setScene = (s) => (applied++, orig(s))
	for (let i = 0; i < 5; i++) await g.scene()
	await g.sceneWithLive?.()
	assert.ok(baker.gets >= 6)
	assert.equal(applied, 0, 'same rev: nothing re-applied')
	baker.r = 'none-bbbb'
	await g.scene()
	assert.equal(applied, 1, 'a new rev is applied')
	await g.scene()
	assert.equal(applied, 1)
	g.disable()
	g.enable()
	await flush()
	assert.equal(g.room().state().trackId, TRACK.id, 'a new session gets the scene again')
})

test('B52: disable drops the last bake; B53: no 100.64/10 address in the public joinUrls', async (t) => {
	const { g, baker } = game(t, { ips: ['100.100.1.2', '192.168.1.5', '100.63.0.1', '100.127.255.1', '100.128.0.1'] })
	g.enable()
	await flush()
	assert.deepEqual(g.state().joinUrls, ['192.168.1.5', '100.63.0.1', '100.128.0.1'].map((ip) => `http://${ip}:4200/game/rc/`))
	g.disable()
	assert.equal(baker.drops, 1)
})
