'use strict'

/**
 * WO-1099 — house lights, the server half, the same in all three games (RC, Stage Skirmish, Stage Salad): the host action
 * `{ action: 'house', level }` (a number 0..1, clamped; `on` boolean kept = 1 / 0; 400 for anything else; 409 while
 * disabled), `house` in the decorated state (a number, default 1 — it outlives disable / enable like lights / wall),
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
	test(`${id}: host action house — 409 disabled, default 1, level clamped, boolean compat, 400s, broadcasts the number`, async () => {
		const g = make()
		try {
			assert.equal(g.host({ action: 'house', level: 0.5 }).status, 409, 'nothing to switch while disabled')
			assert.equal(g.host({ action: 'enable' }).status, 200)
			assert.equal(g.state().house, 1, 'default: the room lit (nothing changes for existing users)')
			for (const bad of [{ level: 'x' }, { level: '0.5' }, { level: null }, { level: NaN }, { level: true }, {}, { on: 'no' }, { on: 0 }, { on: 1 }, { on: null }]) {
				const r = g.host({ action: 'house', ...bad })
				assert.equal(r.status, 400, JSON.stringify(bad))
				assert.match(r.body.error, /`level` must be a number/)
				assert.equal(r.body.state.house, 1, 'a refused level changes nothing')
			}
			const ws = fakeSocket()
			g.attach(ws)
			ws.emit('message', Buffer.from(JSON.stringify({ t: 'join', name: 'Watcher', color: '#ffffff', spectator: true })), false)
			const welcome = ws.sent.find((m) => m.t === 'welcome')
			assert.ok(welcome, `a welcome (got ${ws.sent.map((m) => m.t).join(',')})`)
			assert.equal(welcome.state.house, 1, 'the welcome carries it (players and spectators apply it from there)')
			const n0 = ws.sent.length
			const half = g.host({ action: 'house', level: 0.5 })
			assert.equal(half.status, 200, JSON.stringify(half.body))
			assert.equal(half.body.state.house, 0.5)
			const st = ws.sent.slice(n0).filter((m) => m.t === 'state')
			assert.ok(st.length >= 1 && st.at(-1).state.house === 0.5, 'the room broadcast the number')
			assert.equal(g.state().lights, false, 'no ctx: lights stay as they were (house is its own control)')
			assert.equal(g.host({ action: 'house', level: 7 }).body.state.house, 1, 'clamped high')
			assert.equal(g.host({ action: 'house', level: -3 }).body.state.house, 0, 'clamped low')
			assert.equal(g.host({ action: 'house', level: Infinity }).body.state.house, 1, 'Infinity clamps')
			assert.equal(g.host({ action: 'house', level: 0.25 }).body.state.house, 0.25)
			assert.equal(g.host({ action: 'house', on: false }).body.state.house, 0, 'boolean compat: off = 0')
			assert.equal(g.host({ action: 'house', on: true }).body.state.house, 1, 'boolean compat: on = 1')
			assert.equal(g.host({ action: 'house', level: 0.4, on: true }).body.state.house, 0.4, 'level wins over on')
			g.host({ action: 'disable' })
			g.host({ action: 'enable' })
			assert.equal(g.state().house, 0.4, 'lives as long as the service, like lights / wall')
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
		assert.match(s, /let house = 1 /, f)
		assert.match(s, /if \(action === 'house'\) \{[\s\S]*?\} else if \(action === 'lights' \|\| action === 'wall'\) \{/, f)
		assert.match(s, /wall: video \? video\.isOn\(\) : false, house/, f)
	}
	for (const f of ['rc-game/server/rc-room.js', 'toy-skirmish/server/sk-room.js', 'stage-salad/server/salad-room.js'])
		assert.match(read(f), /case 'wall':\n\t+case 'house':/, f)
})
