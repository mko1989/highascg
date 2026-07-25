/**
 * Smoke tests for screen timers (WO-210) — slot allocation & timer commands.
 * Tests: slot allocation, reuse after unassign, idempotency, visibility toggle (incl. fadeFrames),
 * linesForReAdd output, recordTimerCmd/recordTimerPause round-trip.
 *
 * Split from a single oversized file to stay under the 480-line file cap; continues in
 * tools/smoke/smoke-wo210-screen-timers-persistence-and-guards.test.js (persistence round-trip,
 * CG ADD line format, linesForLookVisibility, BAND GUARD coverage, config merge, CSS presence).
 * Shared persistence-mock harness lives in tools/smoke/lib/screen-timers-test-harness.js.
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createScreenTimersHarness } = require('./lib/screen-timers-test-harness')

const { persistence, requireFresh, reset } = createScreenTimersHarness()
let screenTimers = reset()

function resetScreenTimersModule() {
	screenTimers = reset()
}

test('loadRegistry - returns a map', () => {
	resetScreenTimersModule()
	const registry = screenTimers.loadRegistry()
	assert(registry instanceof Map, 'loadRegistry should return a Map')
})

test('slot allocation - lowest free slot on channel', () => {
	resetScreenTimersModule()

	// Assign first timer to screen 0 (channel 1)
	const result1 = screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: { durationSec: 60 },
		screenIdx: 0,
		channel: 1,
	})
	assert.strictEqual(result1.layer, 980, 'First slot should be 980')
	assert(result1.lines.length > 0, 'Should return CG ADD and MIXER lines')

	// Assign second timer to same channel — should get slot 981
	const result2 = screenTimers.assignTimerToScreen({
		timerId: 'timer2',
		name: 'Timer 2',
		config: { durationSec: 30 },
		screenIdx: 1,
		channel: 1,
	})
	assert.strictEqual(result2.layer, 981, 'Second slot on same channel should be 981')

	// Assign third timer to different channel (2) — should get slot 980 again
	const result3 = screenTimers.assignTimerToScreen({
		timerId: 'timer3',
		name: 'Timer 3',
		config: {},
		screenIdx: 2,
		channel: 2,
	})
	assert.strictEqual(result3.layer, 980, 'First slot on different channel should be 980')
})

test('slot reuse after unassign', () => {
	resetScreenTimersModule()

	// Assign timer1 to slot 980
	const r1 = screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})
	assert.strictEqual(r1.layer, 980)

	// Assign timer2 to slot 981
	const r2 = screenTimers.assignTimerToScreen({
		timerId: 'timer2',
		name: 'Timer 2',
		config: {},
		screenIdx: 1,
		channel: 1,
	})
	assert.strictEqual(r2.layer, 981)

	// Unassign timer1
	const uRes = screenTimers.unassignTimer({ timerId: 'timer1', screenIdx: 0 })
	assert.strictEqual(uRes.lines.length, 1, 'Unassign should return CG CLEAR line')
	assert(uRes.lines[0].includes('CLEAR'), 'Line should be CG CLEAR')

	// Now slot 980 should be free; assign timer3
	const r3 = screenTimers.assignTimerToScreen({
		timerId: 'timer3',
		name: 'Timer 3',
		config: {},
		screenIdx: 2,
		channel: 1,
	})
	assert.strictEqual(r3.layer, 980, 'Reused slot should be 980')
})

test('assignTimerToScreen idempotency with config update', () => {
	resetScreenTimersModule()

	// Assign timer to screen 0, channel 1
	const r1 = screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: { durationSec: 60 },
		screenIdx: 0,
		channel: 1,
	})
	assert.strictEqual(r1.layer, 980)
	assert(r1.lines.length > 0, 'First assign should return lines')
	assert(r1.lines.some(l => l.startsWith('CG')), 'First assign should have CG line')

	// Assign same timer to same screen again with config update
	// Should be idempotent in layer assignment but emit CG UPDATE for config change
	const r2 = screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1 (updated)',
		config: { durationSec: 120 },
		screenIdx: 0,
		channel: 1,
	})
	assert.strictEqual(r2.layer, 980, 'Layer should remain 980')
	assert(r2.lines.length > 0, 'Re-assign with config change should return CG UPDATE line')
	assert(r2.lines.some(l => l.includes('UPDATE')), 'Should emit CG UPDATE when config changes')
})

test('setTimerVisible - visibility toggle line format', () => {
	resetScreenTimersModule()

	// Assign a timer
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// Toggle visibility off
	const offResult = screenTimers.setTimerVisible({
		timerId: 'timer1',
		screenIdx: 0,
		visible: false,
	})
	assert.strictEqual(offResult.lines.length, 1, 'Should return one MIXER line')
	assert(offResult.lines[0].startsWith('MIXER 1-980 OPACITY 0'), 'Line format should match MIXER pattern')

	// Toggle visibility on
	const onResult = screenTimers.setTimerVisible({
		timerId: 'timer1',
		screenIdx: 0,
		visible: true,
	})
	assert.strictEqual(onResult.lines.length, 1)
	assert(onResult.lines[0].startsWith('MIXER 1-980 OPACITY 1'), 'Line format should match MIXER pattern')
})

test('WO-226 T226.1: setTimerVisible fadeFrames produces MIXER OPACITY <v> <frames> linear', () => {
	resetScreenTimersModule()

	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// fadeFrames > 0 → fade form
	const fadeOut = screenTimers.setTimerVisible({ timerId: 'timer1', screenIdx: 0, visible: false, fadeFrames: 25 })
	assert.strictEqual(fadeOut.lines.length, 1)
	assert.strictEqual(fadeOut.lines[0], 'MIXER 1-980 OPACITY 0 25 linear', 'fade-out line should carry frames + linear tween')

	const fadeIn = screenTimers.setTimerVisible({ timerId: 'timer1', screenIdx: 0, visible: true, fadeFrames: 25 })
	assert.strictEqual(fadeIn.lines[0], 'MIXER 1-980 OPACITY 1 25 linear', 'fade-in line should carry frames + linear tween')

	// fadeFrames omitted or 0 → unchanged instant-cut form (back-compat)
	const omitted = screenTimers.setTimerVisible({ timerId: 'timer1', screenIdx: 0, visible: false })
	assert.strictEqual(omitted.lines[0], 'MIXER 1-980 OPACITY 0', 'default (no fadeFrames) should stay instant-cut form')

	const zero = screenTimers.setTimerVisible({ timerId: 'timer1', screenIdx: 0, visible: true, fadeFrames: 0 })
	assert.strictEqual(zero.lines[0], 'MIXER 1-980 OPACITY 1', 'fadeFrames:0 should stay instant-cut form')

	// out-of-range fadeFrames clamps into 0-500 rather than producing an unbounded fade
	const clamped = screenTimers.setTimerVisible({ timerId: 'timer1', screenIdx: 0, visible: false, fadeFrames: 9999 })
	assert.strictEqual(clamped.lines[0], 'MIXER 1-980 OPACITY 0 500 linear', 'fadeFrames should clamp to 500 max')
})

test('WO-226 T226.1: BAND GUARD still applies to setTimerVisible with fadeFrames', () => {
	resetScreenTimersModule()

	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// Corrupt the registry entry to violate the band
	const stored = persistence.get('screenTimers')
	stored.timer1.screens['0'].layer = 5
	persistence.set('screenTimers', stored)

	screenTimers = requireFresh()

	const result = screenTimers.setTimerVisible({ timerId: 'timer1', screenIdx: 0, visible: true, fadeFrames: 25 })
	assert.strictEqual(result.lines.length, 0, 'Band guard should suppress lines even when fadeFrames is set')
})

test('linesForReAdd - returns CG ADD and MIXER lines for all records', () => {
	resetScreenTimersModule()

	// Assign two timers
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: { durationSec: 60 },
		screenIdx: 0,
		channel: 1,
	})

	screenTimers.assignTimerToScreen({
		timerId: 'timer2',
		name: 'Timer 2',
		config: { durationSec: 30 },
		screenIdx: 1,
		channel: 1,
	})

	// Set one to invisible
	screenTimers.setTimerVisible({ timerId: 'timer1', screenIdx: 0, visible: false })

	// Get restore lines
	const lines = screenTimers.linesForReAdd()

	// Should have 4 lines: 2 timers × (CG ADD + MIXER OPACITY)
	assert.strictEqual(lines.length, 4, 'Should have 4 lines: 2 CG ADD + 2 MIXER OPACITY')

	// Check that lines contain CG ADD and MIXER
	const cgAddLines = lines.filter((l) => l.startsWith('CG'))
	const mixerLines = lines.filter((l) => l.startsWith('MIXER'))
	assert.strictEqual(cgAddLines.length, 2, 'Should have 2 CG ADD lines')
	assert.strictEqual(mixerLines.length, 2, 'Should have 2 MIXER lines')

	// Check that the invisible timer has OPACITY 0
	assert(lines.some((l) => l.includes('MIXER 1-980 OPACITY 0')), 'Invisible timer should have OPACITY 0')
	assert(lines.some((l) => l.includes('MIXER 1-981 OPACITY 1')), 'Visible timer should have OPACITY 1')
})

test('linesForReAdd with channel filter', () => {
	resetScreenTimersModule()

	// Assign timers on two channels
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	screenTimers.assignTimerToScreen({
		timerId: 'timer2',
		name: 'Timer 2',
		config: {},
		screenIdx: 1,
		channel: 2,
	})

	// Get restore lines for channel 1 only
	const lines = screenTimers.linesForReAdd(1)

	// Should have 2 lines for channel 1 only
	assert.strictEqual(lines.length, 2, 'Should have 2 lines for channel 1 (CG ADD + MIXER)')
	assert(lines.every((l) => l.includes('1-980')), 'All lines should reference channel 1 layer 980')
})

test('unassignTimer removes record when last screen removed', () => {
	resetScreenTimersModule()

	// Assign timer to one screen
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// List should contain timer1
	let list = screenTimers.listScreenTimers()
	assert.strictEqual(list.length, 1, 'Should have 1 timer')
	assert.strictEqual(list[0].timerId, 'timer1')

	// Unassign from the only screen
	screenTimers.unassignTimer({ timerId: 'timer1', screenIdx: 0 })

	// List should be empty
	list = screenTimers.listScreenTimers()
	assert.strictEqual(list.length, 0, 'Should have 0 timers after unassigning from only screen')
})

test('recordTimerCmd records command and timestamp', () => {
	resetScreenTimersModule()

	// Create a timer record by assigning it
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// Record a command
	const before = Date.now()
	screenTimers.recordTimerCmd('timer1', 'start')
	const after = Date.now()

	// Check the record
	const list = screenTimers.listScreenTimers()
	assert.strictEqual(list[0].lastCmd, 'start', 'lastCmd should be "start"')
	assert(list[0].cmdAt >= before && list[0].cmdAt <= after, 'cmdAt should be within reasonable time range')
})

test('FIX-5 (2026-07-15 review, timers finding 3): recordTimerPause round-trip', () => {
	resetScreenTimersModule()

	// Create a timer record by assigning it
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: { durationSec: 300 },
		screenIdx: 0,
		channel: 1,
	})

	// Pause with a server-computed frozen remaining value
	screenTimers.recordTimerPause('timer1', 123.4)

	let list = screenTimers.listScreenTimers()
	let record = list.find((r) => r.timerId === 'timer1')
	assert.strictEqual(record.lastCmd, 'pause', 'lastCmd should be "pause"')
	assert.strictEqual(record.remainingSec, 123.4, 'remainingSec should round-trip through listScreenTimers')
	assert(Number.isFinite(record.cmdAt), 'cmdAt should be set')

	// Persists to disk (mocked persistence) — reload the module and confirm it survives
	const screenTimers2 = requireFresh()
	const list2 = screenTimers2.listScreenTimers()
	const record2 = list2.find((r) => r.timerId === 'timer1')
	assert.strictEqual(record2.remainingSec, 123.4, 'remainingSec should persist across module reload')

	// A negative/non-finite value clamps to null (never a stale negative freeze)
	screenTimers2.recordTimerPause('timer1', -5)
	let list3 = screenTimers2.listScreenTimers()
	assert.strictEqual(list3.find((r) => r.timerId === 'timer1').remainingSec, 0, 'negative remaining clamps to 0')

	screenTimers2.recordTimerPause('timer1', NaN)
	let list4 = screenTimers2.listScreenTimers()
	assert.strictEqual(list4.find((r) => r.timerId === 'timer1').remainingSec, null, 'non-finite remaining stores as null')

	// 'reset' clears remainingSec so the next start begins fresh from the configured duration.
	screenTimers2.recordTimerPause('timer1', 55)
	screenTimers2.recordTimerCmd('timer1', 'reset')
	let list5 = screenTimers2.listScreenTimers()
	assert.strictEqual(list5.find((r) => r.timerId === 'timer1').remainingSec, null, 'reset clears remainingSec')
	assert.strictEqual(list5.find((r) => r.timerId === 'timer1').lastCmd, 'reset', 'lastCmd should be "reset"')

	// 'start' leaves a previously frozen remainingSec untouched (it's the resume basis).
	screenTimers2.recordTimerPause('timer1', 77)
	screenTimers2.recordTimerCmd('timer1', 'start')
	let list6 = screenTimers2.listScreenTimers()
	const record6 = list6.find((r) => r.timerId === 'timer1')
	assert.strictEqual(record6.remainingSec, 77, 'start should not clear the resume-basis remainingSec')
	assert.strictEqual(record6.lastCmd, 'start', 'lastCmd should be "start"')
})
