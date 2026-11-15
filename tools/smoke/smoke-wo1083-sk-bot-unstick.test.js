'use strict'

/**
 * WO-1083 follow-up — Stage Skirmish bots never freeze in a cell off the passable mask. The bot's look-ahead walks to
 * any point with exact clearance, so it can stop in a cell whose centre a soldier does not fit; sk-grid findPath
 * refuses such a start, and before the fix the bot stood there for the rest of the match (the WO-1081 bots smoke: 2 of
 * 4 bots froze once the 3 cm occ band of WO-1082 reshaped the default hall's arena). Here, on a hand-made arena (toy
 * scale 0.1) with one block: every clear point next to it whose cell is off the mask, a bot put there walks away and
 * reaches its patrol goal.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { createSkRoom } = require('../../modules/toy-skirmish/server/sk-room')
const R = require('../../modules/toy-skirmish/server/sk-rules')
const G = require('../../modules/toy-skirmish/server/sk-grid')

const U = 0.1
const ARENA = { id: 'one', name: 'One block', floor: 'hall', y: 0, rect: [0, 0, 6, 6],
	blocks: [{ x: 3, z: 3, w: 0.8, d: 0.5, h: 0.08, yaw: 0, c: 0 }],
	spawns: [[0.6, 0.6], [5.4, 0.6], [0.6, 5.4], [5.4, 5.4]].map(([x, z]) => ({ x, z, yaw: 0, team: 0 })), pickups: [] }
const SCENE = { rev: 'unstick', scale: U, floors: [{ id: 'hall', y: 0, rect: [0, 0, 6, 6] }], occ: [], arenas: [ARENA] }

function makeClock() {
	let t0 = 5_000_000
	let seq = 0
	const timers = new Map()
	return {
		now: () => t0,
		timers: {
			setTimeout: (fn, ms) => (timers.set(++seq, { fn, at: t0 + ms, every: 0 }), seq),
			setInterval: (fn, ms) => (timers.set(++seq, { fn, at: t0 + ms, every: ms }), seq),
			clearTimeout: (id) => timers.delete(id),
			clearInterval: (id) => timers.delete(id),
		},
		advance(ms) {
			const end = t0 + ms
			for (;;) {
				let next = null
				for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x]
				if (!next) break
				t0 = next[1].at
				if (next[1].every) next[1].at += next[1].every
				else timers.delete(next[0])
				next[1].fn()
			}
			t0 = end
		},
	}
}

test('a bot stopped in a cell off the passable mask walks on (it used to freeze there for good)', (t) => {
	const clock = makeClock()
	const room = createSkRoom({ now: clock.now, timers: clock.timers, rng: R.mulberry32(2), send: () => {} })
	room.setScene(SCENE)
	t.after(() => room.dispose())
	const X = room.ctx
	room.host('bots', { n: 1 })
	const bot = [...X.players.values()].find((p) => p.bot)
	const r = R.SOLDIER.radius * U
	// every clear point around the block (1 cm steps) whose cell is off the mask
	const spots = []
	for (let x = 2.3; x <= 3.7; x += 0.01) {
		for (let z = 2.5; z <= 3.5; z += 0.01) {
			const q = G.cellIndex(X.grid, x, z)
			if (q >= 0 && !X.mask[q] && G.clearAt(X.grid, x, z, r * 1.05)) spots.push([x, z])
		}
	}
	assert.ok(spots.length > 20, `clear points off the mask exist next to a block (${spots.length})`)
	for (const at of spots.filter((_, i) => i % Math.ceil(spots.length / 12) === 0)) {
		Object.assign(bot, { pos: at.slice(), alive: true })
		Object.assign(bot.ai, { path: null, goal: null, replanAt: 0 })
		let walked = 0
		for (let k = 0; k < 30; k++) {
			const was = bot.pos.slice()
			clock.advance(100)
			walked += Math.hypot(bot.pos[0] - was[0], bot.pos[1] - was[1])
		}
		assert.ok(walked > 5 * U, `from (${at.map((v) => v.toFixed(2))}) it walked ${(walked / U).toFixed(1)} u in 3 s`)
		assert.ok(G.clearAt(X.grid, bot.pos[0], bot.pos[1], r * 0.98), 'and never into the block')
	}
})
