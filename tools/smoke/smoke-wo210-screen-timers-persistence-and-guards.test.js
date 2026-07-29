/**
 * Smoke tests for screen timers (WO-210) — persistence, look-visibility fan-out, BAND GUARD
 * coverage, config merge, and CSS presence.
 *
 * Split from tools/smoke/smoke-wo210-screen-timers.test.js (which keeps slot allocation, reuse,
 * idempotency, visibility toggle/fadeFrames, linesForReAdd, and recordTimerCmd/recordTimerPause)
 * to stay under the 480-line file cap. Shared persistence-mock harness lives in
 * tools/smoke/lib/screen-timers-test-harness.js.
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { createScreenTimersHarness } = require('./lib/screen-timers-test-harness')

const { persistence, requireFresh, reset } = createScreenTimersHarness()
let screenTimers = reset()

function resetScreenTimersModule() {
	screenTimers = reset()
}

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
	const screenTimers2 = requireFresh()
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

test('BAND GUARD: setTimerVisible skips entries with layer outside 980-989', () => {
	resetScreenTimersModule()

	// Assign a timer normally (gets layer 980)
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// Manually corrupt the registry entry to have layer 10 (violates band)
	screenTimers.loadRegistry()
	const registry = screenTimers.loadRegistry()
	// Access internal structure via listScreenTimers
	let list = screenTimers.listScreenTimers()
	const timerRecord = list.find(r => r.timerId === 'timer1')
	assert(timerRecord && timerRecord.screens['0'], 'Timer should be in registry')

	// Manually mutate the persistence to simulate corrupted data
	const stored = persistence.get('screenTimers')
	stored.timer1.screens['0'].layer = 10
	persistence.set('screenTimers', stored)

	// Reload module to pick up corrupted data
	screenTimers = requireFresh()

	// Now try to call setTimerVisible — should return no lines due to band violation
	const result = screenTimers.setTimerVisible({
		timerId: 'timer1',
		screenIdx: 0,
		visible: false,
	})
	assert.strictEqual(result.lines.length, 0, 'Should return no lines for layer outside 980-989')
})

test('BAND GUARD: linesForReAdd skips entries with layer outside 980-989', () => {
	resetScreenTimersModule()

	// Assign a timer
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// Corrupt the registry entry
	const stored = persistence.get('screenTimers')
	stored.timer1.screens['0'].layer = 500 // Invalid layer
	persistence.set('screenTimers', stored)

	// Reload module
	screenTimers = requireFresh()

	// Now try linesForReAdd — should return no lines for corrupted entry
	const lines = screenTimers.linesForReAdd()
	assert.strictEqual(lines.length, 0, 'Should return no lines for corrupted layer')
})

test('BAND GUARD: linesForLookVisibility skips entries with layer outside 980-989', () => {
	resetScreenTimersModule()

	// Assign a timer
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// Corrupt the registry entry
	const stored = persistence.get('screenTimers')
	stored.timer1.screens['0'].layer = 999 // Invalid layer
	persistence.set('screenTimers', stored)

	// Reload module
	screenTimers = requireFresh()

	// Call linesForLookVisibility with visibility map
	const lines = screenTimers.linesForLookVisibility(1, { timer1: true })
	assert.strictEqual(lines.length, 0, 'Should return no lines for corrupted layer')
})

test('BAND GUARD: unassignTimer skips entries with layer outside 980-989', () => {
	resetScreenTimersModule()

	// Assign a timer
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: {},
		screenIdx: 0,
		channel: 1,
	})

	// Corrupt the registry entry
	const stored = persistence.get('screenTimers')
	stored.timer1.screens['0'].layer = 979 // Just below valid band
	persistence.set('screenTimers', stored)

	// Reload module
	screenTimers = requireFresh()

	// Try to unassign — should return no lines
	const result = screenTimers.unassignTimer({
		timerId: 'timer1',
		screenIdx: 0,
	})
	assert.strictEqual(result.lines.length, 0, 'Should return no lines for layer outside 980-989')
})

test('config merge on re-assign to same screen', () => {
	resetScreenTimersModule()

	// Assign timer to screen 0
	screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1',
		config: { durationSec: 60, mode: 'duration' },
		screenIdx: 0,
		channel: 1,
	})

	// Verify initial config in registry
	let list = screenTimers.listScreenTimers()
	let timerRecord = list.find(r => r.timerId === 'timer1')
	assert.strictEqual(timerRecord.config.durationSec, 60)
	assert.strictEqual(timerRecord.config.mode, 'duration')

	// Re-assign same timer to same screen with new config
	const r2 = screenTimers.assignTimerToScreen({
		timerId: 'timer1',
		name: 'Timer 1 (updated)',
		config: { mode: 'clock', targetTime: '18:00:00' },
		screenIdx: 0,
		channel: 1,
	})
	assert.strictEqual(r2.layer, 980, 'Layer should remain the same')
	assert(r2.lines.length > 0, 'Re-assign should emit CG UPDATE line')

	// Verify config was merged in registry
	list = screenTimers.listScreenTimers()
	timerRecord = list.find(r => r.timerId === 'timer1')
	assert.strictEqual(timerRecord.config.durationSec, 60, 'durationSec should be preserved from original')
	assert.strictEqual(timerRecord.config.mode, 'clock', 'mode should be updated')
	assert.strictEqual(timerRecord.config.targetTime, '18:00:00', 'targetTime should be updated')
})

test('CSS: new timer panel classes exist in stylesheet', () => {
	// WO-221 T221.C: timer-control-panel__* rules moved from 07b-audio-mixer-modal-shell.css
	// to 07b2-timer-control-panel.css (behavior-preserving mechanical split).
	const cssPath = path.join(__dirname, '../../client/styles/07b2-timer-control-panel.css')
	const cssContent = fs.readFileSync(cssPath, 'utf-8')

	// Check for presence of new CSS classes
	// WO-381: the dock lost its create button and screen-assignment dropdown (owner: "the adding
	// of the timers shouldnt be there at all"), so `timer-control-panel__new-timer-btn` and
	// `timer-control-panel__screen-select` went with them; the editable readout
	// (`__timer-display--editable` + `__timer-input`) is the control that replaced them here.
	const requiredClasses = [
		'timer-control-panel__timer-row',
		'timer-control-panel__timer-display',
		'timer-control-panel__timer-display--editable',
		'timer-control-panel__timer-input',
		'timer-control-panel__screen-chip',
		'timer-control-panel__chip-toggle',
		'timer-control-panel__chip-unassign',
		'timer-control-panel__list',
		'timer-control-panel__settings',
	]

	for (const className of requiredClasses) {
		assert(cssContent.includes(className), `CSS should contain class: ${className}`)
	}
})
