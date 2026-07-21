'use strict'

/**
 * WO-317 — the pure command planner that turns a registry decision into concrete process steps.
 *
 * The value of pinning this offline: the ORDER and the CHOICE OF TOOL are load-bearing and were
 * both learned the hard way in WO-283. This box's xdotool (3.20160805.1) has no `windowstate`, so
 * ABOVE-promotion MUST go through the python EWMH helper; a plan that emitted `xdotool windowstate`
 * would be a silent no-op on this machine. Parking must refocus the kiosk or it never reclaims the
 * fullscreen layer. These tests make those mistakes fail loudly instead of silently on the glass.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	planRaise,
	planPark,
	planHelperWindowAction,
} = require('../../src/system/operator-helper-window-plan')

const bins = (steps) => steps.map((s) => `${s.bin} ${s.args.join(' ')}`)

test('raise goes through the python promoter, NOT xdotool windowstate (no such verb on this box)', () => {
	const steps = planRaise({ helperWid: '0x1400003', promoteScript: '/x/highascg-window-above.py' })
	const line = bins(steps)
	assert.ok(line.some((l) => l.startsWith('python3 /x/highascg-window-above.py 0x1400003')), 'must promote via python')
	assert.ok(!line.some((l) => /windowstate/.test(l)), 'windowstate would silently no-op here')
})

test('raise focuses LAST — the kiosk only yields the fullscreen layer once the helper is focused', () => {
	const steps = planRaise({
		helperWid: '0x1400003',
		promoteScript: '/x/highascg-window-above.py',
		rect: { x: 3072, y: 0, width: 3840, height: 2160 },
	})
	const line = bins(steps)
	const promoteAt = line.findIndex((l) => /highascg-window-above/.test(l))
	const activateAt = line.findIndex((l) => /windowactivate/.test(l))
	assert.ok(promoteAt >= 0 && activateAt >= 0)
	assert.ok(activateAt > promoteAt, 'focus must come after promotion')
	assert.equal(activateAt, line.length - 1, 'focus is the final step')
})

test('raise confines the helper to the operator rect (never overhang onto the program head)', () => {
	const steps = planRaise({
		helperWid: '0x1400003',
		promoteScript: '/x/above.py',
		rect: { x: 3072, y: 0, width: 3840, height: 2160 },
	})
	const line = bins(steps)
	assert.ok(line.some((l) => l === 'xdotool windowmove 0x1400003 3072 0'))
	assert.ok(line.some((l) => l === 'xdotool windowsize 0x1400003 3840 2160'))
})

test('raise with no promoter degrades to a bare (clamped) raise and flags it', () => {
	const steps = planRaise({ helperWid: '0x1400003', promoteScript: '' })
	assert.ok(bins(steps).some((l) => l === 'xdotool windowraise 0x1400003'))
	assert.ok(steps.some((s) => s.optional && /clamp/i.test(s.note || '')), 'the degraded path must be marked')
})

test('park removes ABOVE + lowers below the CONSUMER, then refocuses the kiosk', () => {
	const steps = planPark({
		helperWid: '0xHELP',
		kioskWid: '0xKIOSK',
		consumerWid: '0xCASPAR',
		parkScript: '/x/highascg-window-below.py',
	})
	const line = bins(steps)
	assert.ok(
		line.some((l) => l === 'python3 /x/highascg-window-below.py 0xHELP --below 0xCASPAR'),
		'must lower beneath the Caspar consumer, not just to the bottom',
	)
	const lowerAt = line.findIndex((l) => /highascg-window-below/.test(l))
	const kioskAt = line.findIndex((l) => /windowactivate 0xKIOSK/.test(l))
	assert.ok(kioskAt > lowerAt, 'the kiosk refocus must come AFTER the helper is lowered')
	assert.equal(kioskAt, line.length - 1, 'refocusing the kiosk is the last thing park does')
})

test('park without a known consumer still lowers, just without a sibling reference', () => {
	const steps = planPark({ helperWid: '0xHELP', kioskWid: '0xKIOSK', parkScript: '/x/below.py' })
	assert.ok(bins(steps).some((l) => l === 'python3 /x/below.py 0xHELP'), 'no --below when consumer unknown')
	assert.ok(bins(steps).some((l) => /windowactivate 0xKIOSK/.test(l)), 'kiosk still refocused')
})

test('planHelperWindowAction flags an INCOMPLETE park when the kiosk id is missing', () => {
	const plan = planHelperWindowAction(
		{ action: 'park' },
		{ helperWid: '0xHELP', parkScript: '/x/below.py' },
	)
	assert.equal(plan.action, 'park')
	assert.equal(plan.complete, false, 'a park that cannot refocus the kiosk is not complete')
	assert.ok(plan.warnings.some((w) => /kiosk/.test(w)), 'the reason must be stated for the journal')
})

test('planHelperWindowAction flags a raise with no promoter (would be clamped under the kiosk)', () => {
	const plan = planHelperWindowAction({ action: 'raise' }, { helperWid: '0xHELP', promoteScript: '' })
	assert.equal(plan.complete, false)
	assert.ok(plan.warnings.some((w) => /clamp/i.test(w)))
})

test('a complete raise reports complete with no warnings', () => {
	const plan = planHelperWindowAction(
		{ action: 'raise' },
		{ helperWid: '0xHELP', promoteScript: '/x/above.py', rect: { x: 0, y: 0, width: 1920, height: 1080 } },
	)
	assert.equal(plan.complete, true)
	assert.deepEqual(plan.warnings, [])
	assert.ok(plan.steps.length >= 2)
})

test('launch produces no restack steps (the window does not exist yet)', () => {
	const plan = planHelperWindowAction({ action: 'launch' }, { helperWid: null })
	assert.deepEqual(plan.steps, [])
	assert.equal(plan.complete, true, 'launch is a valid no-restack decision, not a failure')
})

test('an unknown action is refused, not silently turned into commands', () => {
	const plan = planHelperWindowAction({ action: 'wobble' }, { helperWid: '0xHELP' })
	assert.deepEqual(plan.steps, [])
	assert.equal(plan.complete, false)
	assert.ok(plan.warnings.some((w) => /unknown action/.test(w)))
})

test('a missing helper id never yields a command that would act on the wrong window', () => {
	assert.deepEqual(planRaise({ helperWid: null, promoteScript: '/x/above.py' }), [])
	assert.deepEqual(planPark({ helperWid: '', kioskWid: '0xK', parkScript: '/x/b.py' }), [])
})

test('the two runtime scripts referenced by the planner actually exist and parse', () => {
	const fs = require('fs')
	const path = require('path')
	const { execFileSync } = require('child_process')
	for (const name of ['highascg-window-above.py', 'highascg-window-below.py']) {
		const p = path.join(__dirname, '../../tools/runtime', name)
		assert.ok(fs.existsSync(p), `${name} must exist`)
		// py_compile proves it parses without needing a live X display.
		execFileSync('python3', ['-m', 'py_compile', p])
	}
})
