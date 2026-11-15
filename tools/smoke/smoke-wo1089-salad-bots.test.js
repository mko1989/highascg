'use strict'

/**
 * WO-1089 — Stage Salad bots (modules/stage-salad/server/salad-bots.js; contract §10): their aim is the solver's ideal
 * plus humanlike error — yaw / power drawn from a normal distribution whose spread never goes below the level's floor
 * (and grows with distance), so no level is ever perfect; harder levels hit more often; they fire through the SAME
 * referee (every bot fire passes its checks — no bot privilege), never faster than the reload, not in presenter-safe,
 * at half pace in the lobby; a full round per level with the puppet walking gives a plausible hit rate.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { server, makeRoom, snapOf, PUPPET } = require('./lib/salad-fixtures')

const { LEVELS, MAX_BOTS } = server('salad-bots.js')
const DEG = Math.PI / 180

function roomWithBots({ n = 4, level = 'normal', seed = 21, walk = true } = {}) {
	const R = makeRoom({ seed })
	let y = -2
	let dir = -1
	R.clk.timers.setInterval(() => {
		if (walk) y += dir * 0.08
		if (y < -8 || y > -1) dir = -dir
		R.room.ingestTracking(snapOf([{ ...PUPPET, x: 11, y }]))
	}, 100)
	R.clk.advance(1000)
	const watch = R.join('Watcher', { spectator: true })
	R.room.host('bots', { n })
	R.room.host('botlevel', { level })
	// every bot fire through the referee is recorded with its verdict
	const verdicts = []
	const fire = R.room.shots.fire
	R.room.shots.fire = (p, m, t) => {
		const r = fire(p, m, t)
		verdicts.push({ pid: p.id, bot: p.bot, t: t ?? R.clk.now(), r, veg: m.veg })
		return r
	}
	return { ...R, watch, verdicts }
}

test('aim error: spread never below the level floor, grows with distance; no level is perfect', () => {
	for (const level of Object.keys(LEVELS)) {
		const R = roomWithBots({ n: MAX_BOTS, level, walk: false })
		const bots = [...R.room.ctx.players.values()].filter((p) => p.bot)
		bots.forEach((p, i) => (p.slot = i < 4 ? i : 10 + i)) // half in the front arc, half in the back arc
		const errs = { near: [], far: [] }
		for (let k = 0; k < 600; k++) {
			const p = bots[k % bots.length]
			const pl = R.room.bots.plan(p)
			assert.ok(pl, `${level}: a plan`)
			const e = Math.atan2(Math.sin(pl.a[0] - pl.ideal.yaw), Math.cos(pl.a[0] - pl.ideal.yaw)) / DEG
			assert.ok(Number.isFinite(e) && pl.p >= 0.15 && pl.p <= 1)
			;(R.room.ctx.venue().slots[p.slot].row === 0 ? errs.near : errs.far).push(e)
			assert.notEqual(e, 0, 'never the exact solution')
		}
		const sd = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)
		const floor = LEVELS[level].yawDeg
		assert.ok(sd(errs.near) > floor * 0.8, `${level} near σ ${sd(errs.near).toFixed(2)}° ≥ floor ${floor}°`)
		assert.ok(sd(errs.far) > sd(errs.near) * 0.95, `${level} farther = wider (${sd(errs.near).toFixed(2)} → ${sd(errs.far).toFixed(2)})`)
		assert.ok(sd(errs.near) < floor * 2.5 + 3, `${level}: still aiming at the stage`)
		R.room.dispose()
	}
	assert.ok(LEVELS.easy.yawDeg > LEVELS.normal.yawDeg && LEVELS.normal.yawDeg > LEVELS.hard.yawDeg && LEVELS.hard.yawDeg >= 1)
})

test('a full round per level vs the walking puppet: never perfect, harder hits more, every bot fire passes the referee', () => {
	const rate = {}
	for (const level of Object.keys(LEVELS)) {
		const R = roomWithBots({ n: 6, level, seed: 33 })
		R.room.host('round', { secs: 60 })
		R.room.host('start')
		R.clk.advance(3000 + 60000 + 200)
		const res = R.of(R.watch, 'results')[0]
		assert.ok(res, `${level}: results`)
		const shots = res.order.reduce((s, p) => s + p.shots, 0)
		const hits = res.order.reduce((s, p) => s + p.hits, 0)
		rate[level] = hits / shots
		assert.ok(shots >= 6 * 10, `${level}: ${shots} shots`)
		assert.ok(rate[level] < 0.9, `${level}: never perfect (${hits}/${shots})`)
		const bad = R.verdicts.filter((v) => !v.r.ok)
		assert.deepEqual(bad, [], `${level}: no bot fire refused`)
		const byBot = new Map()
		for (const v of R.verdicts) {
			const last = byBot.get(v.pid)
			if (last) assert.ok(v.t - last >= 800 - 60, 'never faster than the quickest reload')
			byBot.set(v.pid, v.t)
		}
		R.room.dispose()
	}
	assert.ok(rate.easy < rate.hard, JSON.stringify(rate))
	assert.ok(rate.easy > 0.02 && rate.hard > 0.1, `plausible: ${JSON.stringify(rate)}`)
})

test('presenter-safe stops bots; the lobby is half pace; kick lowers the wanted count', () => {
	const R = roomWithBots({ n: 4 })
	R.clk.advance(30000)
	const lobby = R.verdicts.length
	R.room.host('start')
	R.clk.advance(3000)
	const at = R.verdicts.length
	R.clk.advance(30000)
	const round = R.verdicts.length - at
	assert.ok(round > lobby * 1.4, `lobby ${lobby} vs round ${round} in 30 s`)
	R.room.host('safe', { on: true })
	const before = R.verdicts.length
	R.clk.advance(10000)
	assert.equal(R.verdicts.length, before, 'nothing fired while safe')
	assert.ok([...R.room.ctx.players.values()].every((p) => !p.bot || p.pull === 0), 'bands slack')
	R.room.host('safe', { on: false })
	const bot = [...R.room.ctx.players.values()].find((p) => p.bot)
	assert.equal(R.room.host('kick', { id: bot.id }).ok, true)
	assert.equal(R.room.snapshot().bots, 3)
	assert.equal(R.room.snapshot().players.filter((p) => p.bot).length, 3)
	assert.equal(R.room.host('bots', { n: 0 }).ok, true)
	assert.equal(R.room.snapshot().players.filter((p) => p.bot).length, 0)
	R.room.dispose()
})
