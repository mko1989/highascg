'use strict'

/**
 * WO-601 (found porting the screen-timer inspector) — a settings save re-assigns the timer with the WHOLE merged
 * config (web saveTimerConfigPatch, Godot screen_timer_panel.gd). Only a CHANGED durationSec may re-anchor the
 * countdown: a position/colour save used to restart a running timer from its full duration and reset a paused
 * one's frozen remainingSec (box: pause at 297.99 s → px save → 300).
 */

const test = require('node:test')
const assert = require('node:assert')
const { createScreenTimersHarness } = require('./lib/screen-timers-test-harness')

const { reset } = createScreenTimersHarness()

const record = (st, id) => st.listScreenTimers().find((t) => t.timerId === id)

test('paused timer: same-duration save keeps the frozen remaining time; a new duration replaces it', () => {
	const st = reset()
	st.assignTimerToScreen({ timerId: 't1', name: 'T', config: { mode: 'duration', durationSec: 300 }, screenIdx: 0, channel: 1 })
	st.recordTimerCmd('t1', 'start')
	st.recordTimerPause('t1', 297.99)
	st.assignTimerToScreen({ timerId: 't1', config: { mode: 'duration', durationSec: 300, posX: 100, posY: 50 }, screenIdx: 0, channel: 1 })
	assert.equal(record(st, 't1').remainingSec, 297.99, 'position save must not reset the pause')
	assert.equal(record(st, 't1').config.posX, 100)
	st.assignTimerToScreen({ timerId: 't1', config: { mode: 'duration', durationSec: 120 }, screenIdx: 0, channel: 1 })
	assert.equal(record(st, 't1').remainingSec, 120, 'Set Time still lands on a paused timer')
})

test('running timer: same-duration save keeps its anchor; a new duration re-anchors', () => {
	const st = reset()
	const realNow = Date.now
	try {
		Date.now = () => 1000
		st.assignTimerToScreen({ timerId: 't2', name: 'T', config: { mode: 'duration', durationSec: 300 }, screenIdx: 0, channel: 1 })
		st.recordTimerCmd('t2', 'start')
		assert.equal(record(st, 't2').cmdAt, 1000)
		Date.now = () => 6000
		st.assignTimerToScreen({ timerId: 't2', config: { mode: 'duration', durationSec: 300, position: 'top-left' }, screenIdx: 0, channel: 1 })
		assert.equal(record(st, 't2').cmdAt, 1000, 'position save must not restart the countdown')
		st.assignTimerToScreen({ timerId: 't2', config: { mode: 'duration', durationSec: 60 }, screenIdx: 0, channel: 1 })
		assert.equal(record(st, 't2').cmdAt, 6000, 'Set Time re-anchors a running timer (2d279709)')
	} finally {
		Date.now = realNow
	}
})
