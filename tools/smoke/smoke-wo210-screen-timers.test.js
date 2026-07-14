/**
 * Smoke tests for screen timers (WO-210).
 * Tests: slot allocation, reuse after unassign, idempotency, visibility toggle,
 * linesForReAdd output, persistence round-trip.
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')

// Mock persistence to make tests isolated
const persistence = {
	_storage: {},
	get(key) {
		return this._storage[key] !== undefined ? this._storage[key] : null
	},
	set(key, value) {
		if (value == null) {
			delete this._storage[key]
		} else {
			this._storage[key] = value
		}
	},
	clear() {
		this._storage = {}
	},
}

// Override the real persistence with our mock
const Module = require('module')
const originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
	if (id === '../utils/persistence') {
		return persistence
	}
	return originalRequire.apply(this, arguments)
}

let screenTimers = require('../../src/engine/screen-timers')

function resetScreenTimersModule() {
	persistence.clear()
	delete require.cache[require.resolve('../../src/engine/screen-timers')]
	screenTimers = require('../../src/engine/screen-timers')
	screenTimers.loadRegistry()
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

test('assignTimerToScreen idempotency', () => {
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

	// Assign same timer to same screen again — should be idempotent
	const r2 = screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1 (updated)',
		config: { durationSec: 120 },
		screenIdx: 0,
		channel: 1,
	})
	assert.strictEqual(r2.layer, 980, 'Layer should remain 980')
	assert.strictEqual(r2.lines.length, 0, 'Idempotent assign should return no new lines')
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

test('listScreenTimers returns deep copies', () => {
	resetScreenTimersModule()

	// Assign timer
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: { durationSec: 60 },
		screenIdx: 0,
		channel: 1,
	})

	// Get list and mutate it
	const list1 = screenTimers.listScreenTimers()
	list1[0].name = 'MUTATED'

	// Get list again — should not be mutated
	const list2 = screenTimers.listScreenTimers()
	assert.strictEqual(list2[0].name, 'Timer 1', 'Second list should not reflect mutation')
})

test('persistence round-trip', () => {
	resetScreenTimersModule()

	// Assign timer
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: { durationSec: 60 },
		screenIdx: 0,
		channel: 1,
	})

	// Check persisted data
	const stored = persistence.get('screenTimers')
	assert(stored && typeof stored === 'object', 'Should persist as object')
	assert('timer1' in stored, 'Should have timer1 key')
	assert.strictEqual(stored.timer1.name, 'Timer 1')

	// Create new module instance and load registry — should restore from persistence
	delete require.cache[require.resolve('../../src/engine/screen-timers')]
	const screenTimers2 = require('../../src/engine/screen-timers')
	const list = screenTimers2.listScreenTimers()
	assert.strictEqual(list.length, 1, 'Should restore from persistence')
	assert.strictEqual(list[0].timerId, 'timer1')
})

test('CG ADD line format contains JSON payload', () => {
	resetScreenTimersModule()

	const config = { durationSec: 60, mode: 'countdown' }
	const result = screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config,
		screenIdx: 0,
		channel: 1,
	})

	const cgAddLine = result.lines.find((l) => l.startsWith('CG'))
	assert(cgAddLine, 'Should have CG ADD line')
	assert(cgAddLine.includes('countdown/countdown'), 'Should reference countdown template')
	assert(cgAddLine.includes('durationSec'), 'Should include config in JSON payload')
})

test('linesForLookVisibility returns OPACITY lines only for timers on that channel and mentioned in map', () => {
	resetScreenTimersModule()

	// Assign timers on two different channels
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

	// Apply visibility map for channel 1, mentioning only timer1
	const visibilityMap = { timer1: false }
	const lines = screenTimers.linesForLookVisibility(1, visibilityMap)

	// Should have exactly 1 line (MIXER for timer1 on channel 1)
	assert.strictEqual(lines.length, 1, 'Should return 1 MIXER line for channel 1 only')
	assert(lines[0].startsWith('MIXER 1-980 OPACITY 0'), 'Should have OPACITY 0 for timer1')

	// Check that registry was updated
	const list = screenTimers.listScreenTimers()
	const timer1Record = list.find((r) => r.timerId === 'timer1')
	assert.strictEqual(timer1Record.screens['0'].visible, false, 'Registry should be updated with visible=false')

	// timer2 should not be affected
	const timer2Record = list.find((r) => r.timerId === 'timer2')
	assert.strictEqual(timer2Record.screens['1'].visible, true, 'timer2 should remain unaffected (visible=true)')
})

test('linesForLookVisibility returns empty array for null/undefined/non-object map', () => {
	resetScreenTimersModule()

	// Assign a timer
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// Test with null
	const linesNull = screenTimers.linesForLookVisibility(1, null)
	assert.strictEqual(linesNull.length, 0, 'Should return empty array for null')

	// Test with undefined
	const linesUndef = screenTimers.linesForLookVisibility(1, undefined)
	assert.strictEqual(linesUndef.length, 0, 'Should return empty array for undefined')

	// Test with non-object
	const linesString = screenTimers.linesForLookVisibility(1, 'not an object')
	assert.strictEqual(linesString.length, 0, 'Should return empty array for non-object')

	// Test with empty object
	const linesEmpty = screenTimers.linesForLookVisibility(1, {})
	assert.strictEqual(linesEmpty.length, 0, 'Should return empty array for empty object (no timers mentioned)')
})
