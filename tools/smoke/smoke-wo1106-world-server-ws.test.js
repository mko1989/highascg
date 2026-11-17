'use strict'

/**
 * WO-1106 — the world pages' socket (modules/game-world/server/world-ws.js), offline with a fake `ws` module, fake
 * sockets and fake timers (no port is opened):
 *   A15  a page with > 256 KB waiting is terminated (the send reports false); no pong by the next 15 s ping → terminated
 *   A18  the last game gone → `{ t: 'off' }` + close 4403 to every page, the hub's tick stops; a rejected socket counts
 *        toward the 20-socket cap until it has closed; the ping sweep closes pages when no game runs any more
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-ws-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')

const { attachWorldWs, MAX_SOCKETS, MAX_BUFFERED, PING_MS } = require('../../modules/game-world/server/world-ws')
const { createHub } = require('../../modules/game-world/server/world-hub')

function fakeWs() {
	const ws = new EventEmitter()
	Object.assign(ws, {
		readyState: 1,
		bufferedAmount: 0,
		got: [],
		pings: 0,
		code: null,
		terminated: false,
		send: (s) => ws.got.push(JSON.parse(s)),
		ping: () => ws.pings++,
		close(code) {
			if (ws.readyState !== 1) return
			ws.code = code
			ws.readyState = 2 // CLOSING: the peer has not answered yet
		},
		finish() {
			if (ws.readyState === 3) return
			ws.readyState = 3
			ws.emit('close')
		},
		terminate() {
			ws.terminated = true
			ws.finish()
		},
	})
	return ws
}
function setup() {
	const reg = { v: 1, games: new Map(), hub: null }
	const game = { on: true }
	const adapter = { id: 'rc', entities: () => [{ k: 'car', id: 1, p: [0, 0, 0], yaw: 0, c: '#ff0000', n: 'a', f: 0 }], viewers: () => [], send() {}, board: () => ({ phase: 'race' }) }
	reg.games.set('rc', { id: 'rc', title: 'RC', models: {}, room: () => (game.on ? adapter : null), host: () => ({ status: 200, body: {} }) })
	const ivals = new Map()
	let n = 0
	const timers = { setInterval: (fn, ms) => (ivals.set(++n, { fn, ms }), n), clearInterval: (id) => ivals.delete(id) }
	const hub = createHub({ registry: reg, timers, now: () => 5000, defer: (fn) => fn() })
	hub.sync()
	const http = new EventEmitter()
	const made = []
	const WebSocket = {
		OPEN: 1,
		Server: class {
			handleUpgrade(_req, _sock, _head, cb) {
				const ws = fakeWs()
				made.push(ws)
				cb(ws)
			}
			close() {}
		},
	}
	const svc = { state: () => ({ on: game.on, v: 1, games: [] }) }
	const wsh = attachWorldWs(http, { config: {} }, { hub, service: svc, registry: reg, WebSocket, timers })
	const upgrade = () => {
		const sock = { status: null, write: (s) => (sock.status = Number(String(s).split(' ')[1])), destroy() {} }
		http.emit('upgrade', { url: '/api/game/world/ws', headers: {} }, sock, Buffer.alloc(0))
		return sock.status ? { status: sock.status } : made.at(-1)
	}
	const pingTick = () => [...ivals.values()].filter((x) => x.ms === PING_MS).forEach((x) => x.fn())
	return { reg, game, hub, wsh, upgrade, pingTick, ivals, adapter }
}

test('A15: a page that stopped reading (> 256 KB waiting) is terminated and the send reports false', () => {
	const { hub, wsh, upgrade } = setup()
	const ws = upgrade()
	assert.equal(ws.got[0].t, 'hello')
	hub.tick()
	assert.ok(ws.got.some((m) => m.t === 'wv'), 'a reading page is fed')
	ws.bufferedAmount = MAX_BUFFERED + 1
	const before = ws.got.length
	for (let i = 0; i < 5; i++) hub.tick() // the next board is due
	assert.equal(ws.got.length, before, 'nothing more queued')
	assert.equal(ws.terminated, true)
	assert.equal(wsh.count(), 0)
	assert.equal(hub.stats().worldPages, 0, 'the hub forgot the page')
	wsh.close()
	hub.dispose()
})

test('A15: ping every 15 s; no pong by the next ping → terminated; the ping timer stops with the last socket', () => {
	const { hub, wsh, upgrade, pingTick, ivals } = setup()
	const a = upgrade()
	const b = upgrade()
	assert.equal([...ivals.values()].filter((x) => x.ms === PING_MS).length, 1, 'one sweep timer for all sockets')
	pingTick()
	assert.equal(a.pings, 1)
	assert.equal(b.pings, 1)
	a.emit('pong')
	pingTick()
	assert.equal(a.terminated, false, 'answered: still here')
	assert.equal(a.pings, 2)
	assert.equal(b.terminated, true, 'no pong for a whole period: terminated')
	assert.equal(wsh.count(), 1)
	a.finish()
	assert.equal([...ivals.values()].filter((x) => x.ms === PING_MS).length, 0, 'no socket, no timer')
	wsh.close()
	hub.dispose()
})

test('A18: the last game gone → off + 4403 to every page, the tick stops', () => {
	const { hub, wsh, upgrade, game } = setup()
	const pages = [upgrade(), upgrade()]
	assert.equal(hub.running(), true)
	game.on = false
	hub.detach('rc')
	for (const ws of pages) {
		assert.deepEqual(ws.got.at(-1), { t: 'off' })
		assert.equal(ws.code, 4403)
	}
	assert.equal(hub.running(), false, 'no page, no room: the tick stopped')
	assert.equal(hub.stats().worldPages, 0)
	wsh.close()
	hub.dispose()
})

test('A18: the ping sweep closes pages when no game runs (no detach seen)', () => {
	const { hub, wsh, upgrade, game, pingTick } = setup()
	const ws = upgrade()
	game.on = false
	pingTick()
	assert.deepEqual(ws.got.at(-1), { t: 'off' })
	assert.equal(ws.code, 4403)
	wsh.close()
	hub.dispose()
})

test(`A18: rejected sockets count toward the ${MAX_SOCKETS}-socket cap until they have closed`, () => {
	const { hub, wsh, upgrade, game, pingTick } = setup()
	game.on = false
	const rejected = []
	for (let i = 0; i < MAX_SOCKETS; i++) rejected.push(upgrade())
	assert.ok(rejected.every((ws) => ws.code === 4403 && ws.readyState === 2), 'told off, still closing')
	assert.equal(wsh.count(), MAX_SOCKETS)
	assert.equal(upgrade().status, 503, 'the next upgrade is refused while they close')
	rejected[0].finish()
	assert.equal(wsh.count(), MAX_SOCKETS - 1)
	pingTick()
	pingTick()
	assert.equal(wsh.count(), 0, 'a peer that never finishes the close is terminated by the sweep')
	wsh.close()
	hub.dispose()
})
