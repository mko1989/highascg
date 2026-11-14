'use strict'

/**
 * Screen timers, owner 14.11 (on show): the screen showed 10 s left when the inspector read 00:00; a timer must be
 * preparable on the preview channel; counting on below zero must be an option.
 *  - every CG payload that (re)creates or restyles a timer states the record's count (screen-timer-clock.js)
 *  - a timer moves between a screen's program and preview channel with its count and visibility (moveTimerBus)
 *  - `overrun: false` stops the template and the server count at 00:00
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { createScreenTimersHarness } = require('./lib/screen-timers-test-harness')
const clock = require('../../src/engine/screen-timer-clock')

const { reset } = createScreenTimersHarness()
const payloadOf = (line) => JSON.parse(line.replace(/^CG \S+ (?:ADD 0 "countdown\/countdown" 1|UPDATE 0) "?/, '').replace(/"$/, '').replace(/\\"/g, '"'))
const at = (ms, fn) => {
	const real = Date.now
	Date.now = () => ms
	try {
		return fn()
	} finally {
		Date.now = real
	}
}

test('remainingNow: stopped = duration, running counts from cmdAt, paused is frozen, overrun off clamps at 0', () => {
	const rec = { config: { mode: 'duration', durationSec: 60 }, lastCmd: 'start', cmdAt: 1000, remainingSec: null }
	assert.equal(clock.remainingNow(rec, 11000), 50)
	assert.equal(clock.remainingNow(rec, 71000), -10, 'counts on below zero by default')
	assert.equal(clock.remainingNow({ ...rec, config: { ...rec.config, overrun: false } }, 71000), 0)
	assert.equal(clock.remainingNow({ ...rec, lastCmd: 'pause', remainingSec: 12.5 }, 99999), 12.5)
	assert.equal(clock.remainingNow({ ...rec, lastCmd: 'reset' }, 99999), 60)
	assert.equal(clock.remainingNow({ ...rec, remainingSec: 30 }, 11000), 20, 'a resumed timer counts from its paused value')
	assert.deepStrictEqual(clock.resumeFields(rec, 11000), { cmd: 'start', remainingSec: 50 })
	assert.deepStrictEqual(clock.resumeFields({ ...rec, lastCmd: 'pause', remainingSec: 7 }, 5), { syncRemainingSec: 7 })
	assert.deepStrictEqual(clock.resumeFields({ ...rec, lastCmd: 'reset' }, 5), {})
	assert.deepStrictEqual(clock.resumeFields({ ...rec, config: { mode: 'clock' } }, 5), { cmd: 'start' })
})

test('restyling a running timer re-states the count; a re-ADD starts the fresh instance where the record is', () => {
	const st = reset()
	at(1000, () => {
		st.assignTimerToScreen({ timerId: 't', config: { mode: 'duration', durationSec: 300 }, screenIdx: 0, channel: 2 })
		st.recordTimerCmd('t', 'start')
	})
	at(11000, () => {
		const moved = payloadOf(st.assignTimerToScreen({ timerId: 't', config: { posX: 10 }, screenIdx: 0, channel: 2 }).lines[0])
		assert.equal(moved.cmd, 'start')
		assert.equal(moved.remainingSec, 290, 'the screen is told where the record is, not left on its own count')
		assert.ok(!('durationSec' in moved))
		const added = payloadOf(st.linesForReAdd(2)[0])
		assert.equal(added.cmd, 'start')
		assert.equal(added.remainingSec, 290)
	})
	at(20000, () => st.recordTimerPause('t', 281))
	assert.equal(payloadOf(st.linesForReAdd(2)[0]).syncRemainingSec, 281, 'a paused timer comes back frozen, not at the full time')
})

test('moveTimerBus: clear on the old channel, ADD on the other with count + visibility; assign then updates it there', () => {
	const st = reset()
	at(1000, () => {
		st.assignTimerToScreen({ timerId: 'a', config: { mode: 'duration', durationSec: 100 }, screenIdx: 0, channel: 2 })
		st.assignTimerToScreen({ timerId: 'b', config: {}, screenIdx: 0, channel: 3 }) // 3-980 is taken
		st.setTimerVisible({ timerId: 'a', screenIdx: 0, visible: true, opacity: 0.5 })
		st.recordTimerCmd('a', 'start')
	})
	const r = at(5000, () => st.moveTimerBus({ timerId: 'a', screenIdx: 0, bus: 'prv', channel: 3 }))
	assert.equal(r.lines[0], 'CG 2-980 CLEAR')
	assert.match(r.lines[1], /^CG 3-981 ADD 0 "countdown\/countdown" 1 /)
	assert.equal(payloadOf(r.lines[1]).remainingSec, 96)
	assert.equal(r.lines[2], 'MIXER 3-981 OPACITY 0.5')
	const entry = st.listScreenTimers().find((t) => t.timerId === 'a').screens['0']
	assert.deepStrictEqual({ channel: entry.channel, layer: entry.layer, bus: entry.bus }, { channel: 3, layer: 981, bus: 'prv' })
	assert.deepStrictEqual(st.moveTimerBus({ timerId: 'a', screenIdx: 0, bus: 'prv', channel: 3 }).lines, [], 'already there')
	assert.match(st.assignTimerToScreen({ timerId: 'a', config: { posX: 5 }, screenIdx: 0, channel: 3 }).lines[0], /^CG 3-981 UPDATE /)
	const back = st.moveTimerBus({ timerId: 'a', screenIdx: 0, bus: 'pgm', channel: 2 })
	assert.equal(back.lines[0], 'CG 3-981 CLEAR')
	assert.ok(!('bus' in st.listScreenTimers().find((t) => t.timerId === 'a').screens['0']))
	assert.throws(() => st.moveTimerBus({ timerId: 'nope', screenIdx: 0, bus: 'prv', channel: 3 }), /not on screen/)
})

test('routes: /api/timers/bus resolves the preview channel; assign follows the bus; Start on a running timer keeps its anchor', async () => {
	reset()
	delete require.cache[require.resolve('../../src/api/routes-screen-timers')]
	const routes = require('../../src/api/routes-screen-timers')
	const st = require('../../src/engine/screen-timers')
	const sent = []
	const updates = []
	const ctx = {
		config: {},
		amcp: {
			batchSendChunked: async (lines) => sent.push(...lines),
			raw: async (l) => sent.push(l),
			cg: { cgUpdate: async (ch, layer, _s, payload) => updates.push([ch, layer, JSON.parse(payload)]) },
		},
	}
	const { getChannelMap } = require('../../src/config/routing')
	const map = getChannelMap(ctx.config)
	const pgm = map.programCh(1)
	const prv = map.previewCh(1)
	const post = async (p, b) => JSON.parse((await routes.handlePost(p, JSON.stringify(b), ctx)).body)
	assert.equal((await post('/api/timers/assign', { timerId: 't', config: { mode: 'duration', durationSec: 60 }, screenIdx: 0 })).channel, pgm)
	const bad = await post('/api/timers/bus', { timerId: 't', screenIdx: 0, bus: 'side' })
	assert.equal(bad.ok, false)
	if (Number.isFinite(prv)) {
		const moved = await post('/api/timers/bus', { timerId: 't', screenIdx: 0, bus: 'prv' })
		assert.equal(moved.channel, prv)
		assert.ok(sent.includes(`CG ${pgm}-980 CLEAR`))
		assert.equal((await post('/api/timers/assign', { timerId: 't', config: { posX: 3 }, screenIdx: 0 })).channel, prv, 'no second producer on program')
		assert.equal(Object.keys(st.listScreenTimers()[0].screens).length, 1)
	}
	await post('/api/timers/cmd', { timerId: 't', cmd: 'start' })
	const anchor = st.listScreenTimers()[0].cmdAt
	assert.equal(updates.at(-1)[2].remainingSec, 60, 'Start names the seconds to count from')
	const real = Date.now
	Date.now = () => anchor + 4000
	try {
		await post('/api/timers/cmd', { timerId: 't', cmd: 'start' })
	} finally {
		Date.now = real
	}
	assert.equal(st.listScreenTimers()[0].cmdAt, anchor, 'a second Start does not restart the record')
	assert.equal(updates.at(-1)[2].remainingSec, 56, '…it re-states the count to the screen')
})

test('template: overrun off stops at 00:00; sync / start-while-running put the screen on the server count', () => {
	const el = () => ({ style: {}, classList: { add() {}, remove() {} }, textContent: '' })
	const timer = el()
	global.document = { querySelector: (sel) => (sel === '.countdown-timer' ? timer : el()) }
	global.window = {}
	const real = { now: Date.now, si: global.setInterval }
	global.setInterval = () => 1
	let now = 1_000_000
	Date.now = () => now
	try {
		delete require.cache[require.resolve('../../template/countdown/countdown-engine.js')]
		const { CountdownEngine } = require('../../template/countdown/countdown-engine.js')
		CountdownEngine.init()
		const update = global.window.update
		update(JSON.stringify({ mode: 'duration', durationSec: 10, cmd: 'start', remainingSec: 10 }))
		now += 12000
		update('{}')
		assert.equal(timer.textContent, '-00:00:02', 'default: counts on below zero')
		update(JSON.stringify({ overrun: false }))
		assert.equal(timer.textContent, '00:00', 'overrun off holds 00:00')
		update(JSON.stringify({ overrun: true, cmd: 'start', remainingSec: 30 }))
		assert.equal(timer.textContent, '00:30', 'Start on a running timer follows the server count')
		update(JSON.stringify({ cmd: 'pause' }))
		update(JSON.stringify({ syncRemainingSec: 45 }))
		assert.equal(timer.textContent, '00:45')
		update(JSON.stringify({ cmd: 'start' }))
		now += 5000
		update('{}')
		assert.equal(timer.textContent, '00:40', 'resumes from the synced value')
		update(JSON.stringify({ posX: 5, timerFontSize: 9 }))
		assert.equal(timer.textContent, '00:40', 'a restyle without durationSec does not restart it')
	} finally {
		Date.now = real.now
		global.setInterval = real.si
		delete global.document
		delete global.window
	}
})

test('a cleared preview channel gets its parked timers back (caspar-channel-clear.js)', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/engine/caspar-channel-clear.js'), 'utf8')
	assert.match(src, /isPreviewCasparChannel\(self\?\.config, ch\)[^\n]*\n[^\n]*\n[^\n]*linesForReAdd\(ch\)/)
})
