'use strict'

/**
 * WO-1099 — house lights, the server half, the same in all three games (RC, Stage Skirmish, Stage Salad): the host action
 * `{ action: 'house', on }` (400 when `on` is not a boolean, like `lights` / `wall`; 409 while disabled), `house` in the
 * decorated state (default true, a plain boolean of the service — it outlives disable / enable like the two others),
 * and the room's switch only broadcasts it: a joined spectator socket gets a `state` with the new value. Sandbox games
 * (synthetic project, temp cache, no ctx: no lights / pictures) — never the box's node. Every session is disabled again.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1099-house-'))
const { createRcGame } = require('../../modules/rc-game/server/rc-game')
const { createSkGame } = require('../../modules/toy-skirmish/server/sk-game')
const { createSaladGame } = require('../../modules/stage-salad/server/salad-game')

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

const bakerDeps = (name) => ({ loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null },
	cacheDir: path.join(TMP, name) })

/** A socket stand-in: open, records every JSON message the game sends. */
function fakeSocket() {
	const ws = new EventEmitter()
	ws.readyState = 1
	ws.bufferedAmount = 0
	ws.sent = []
	ws.send = (s) => ws.sent.push(JSON.parse(s))
	ws.close = () => {
		ws.readyState = 3
		ws.emit('close')
	}
	return ws
}

const GAMES = [
	['rc', () => createRcGame({ lanIps: () => ['192.0.2.1'], bakerDeps: bakerDeps('rc') })],
	['sk', () => createSkGame({ lanIps: () => ['192.0.2.1'], bakerDeps: bakerDeps('sk') })],
	['salad', () => createSaladGame({ lanIps: () => ['192.0.2.1'], readTracking: async () => null, bakerDeps: bakerDeps('salad') })],
]

for (const [id, make] of GAMES) {
	test(`${id}: host action house — 409 disabled, default on, 400 on a non-boolean, flips and broadcasts`, async () => {
		const g = make()
		try {
			assert.equal(g.host({ action: 'house', on: false }).status, 409, 'nothing to switch while disabled')
			assert.equal(g.host({ action: 'enable' }).status, 200)
			assert.equal(g.state().house, true, 'default: the room lit (nothing changes for existing users)')
			for (const on of ['no', 0, 1, null, undefined, 'false']) {
				const r = g.host({ action: 'house', on })
				assert.equal(r.status, 400, `on = ${JSON.stringify(on)}`)
				assert.match(r.body.error, /`on` must be true or false/)
				assert.equal(r.body.state.house, true, 'a refused switch changes nothing')
			}
			const ws = fakeSocket()
			g.attach(ws)
			ws.emit('message', Buffer.from(JSON.stringify({ t: 'join', name: 'Watcher', color: '#ffffff', spectator: true })), false)
			const welcome = ws.sent.find((m) => m.t === 'welcome')
			assert.ok(welcome, `a welcome (got ${ws.sent.map((m) => m.t).join(',')})`)
			assert.equal(welcome.state.house, true, 'the welcome carries it (players and spectators apply it from there)')
			const n0 = ws.sent.length
			const off = g.host({ action: 'house', on: false })
			assert.equal(off.status, 200, JSON.stringify(off.body))
			assert.equal(off.body.state.house, false)
			assert.equal(g.state().house, false)
			const st = ws.sent.slice(n0).filter((m) => m.t === 'state')
			assert.ok(st.length >= 1 && st.at(-1).state.house === false, 'the room broadcast the new state')
			assert.equal(g.state().lights, false, 'no ctx: lights stay as they were (house is its own switch)')
			g.host({ action: 'disable' })
			g.host({ action: 'enable' })
			assert.equal(g.state().house, false, 'lives as long as the service, like lights / wall')
			assert.equal(g.host({ action: 'house', on: true }).body.state.house, true)
		} finally {
			g.host({ action: 'disable' })
		}
		assert.equal(g.isEnabled(), false)
	})
}

test('the three services and rooms carry the switch the same way (source)', () => {
	const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'modules', f), 'utf8')
	for (const f of ['rc-game/server/rc-game.js', 'toy-skirmish/server/sk-game.js', 'stage-salad/server/salad-game.js']) {
		const s = read(f)
		assert.match(s, /let house = true/, f)
		assert.match(s, /action === 'lights' \|\| action === 'wall' \|\| action === 'house'/, f)
		assert.match(s, /wall: video \? video\.isOn\(\) : false, house/, f)
	}
	for (const f of ['rc-game/server/rc-room.js', 'toy-skirmish/server/sk-room.js', 'stage-salad/server/salad-room.js'])
		assert.match(read(f), /case 'wall':\n\t+case 'house':/, f)
})
