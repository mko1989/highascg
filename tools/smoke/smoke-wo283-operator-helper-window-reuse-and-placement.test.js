'use strict'

/**
 * Smoke — WO-283: opening a foreign window (DeckLink setup, NVIDIA, file browser, web browser) ON
 * TOP of the shaped operator kiosk.
 *
 * Split from tools/smoke/smoke-wo283-operator-helper-window.test.js (which keeps the
 * nextHelperState/decideRestoreOnExit state-machine, restore-on-crash decision table, appear-budget
 * and give-up-reason-code coverage) to stay under the 480-line file cap. This half covers:
 *
 *   - classifying a real browser window vs a "Close Firefox" profile-lock modal
 *   - reusing an already-running helper window instead of launching a second process (the
 *     2026-07-20 reported failure)
 *   - the commandExists()/lookupCommandPath() root cause (shelling out to /usr/bin/command, a
 *     shell builtin that does not exist on disk)
 *   - an end-to-end pure crash sequence through the state machine
 *   - the WO-283 follow-up: the helper must never be placed on top of a PGM screen consumer
 *
 * Pure logic only: NO X server, no xdotool, no python helper, no spawned GUI.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	nextHelperState,
	decideRestoreOnExit,
	classifyHelperWindows,
	STATE,
	openOperatorHelperWindow,
	closeOperatorHelperWindow,
	getOperatorHelperState,
} = require('../../src/system/operator-helper-window')
const { lookupCommandPath } = require('../../src/utils/x-display-session-runtime')
const {
	resolveHelperWindowRect,
	listProgramConsumerRects,
	resolveOperatorMonitorRect,
	resolveOperatorDisplayRect,
	rectsIntersect,
} = require('../../src/utils/x-display-session-layout')

describe('WO-283 profile-lock dialog classification', () => {
	it('separates a real browser window from a "Close Firefox" modal', () => {
		const c = classifyHelperWindows([
			{ id: '1', name: 'Mozilla Firefox' },
			{ id: '2', name: 'Close Firefox' },
		])
		assert.deepEqual(c.usable.map((w) => w.id), ['1'])
		assert.deepEqual(c.blocked.map((w) => w.id), ['2'])
	})

	it('recognises the profile-in-use wording Firefox actually uses', () => {
		for (const name of ['Close Firefox', 'Firefox is already running', 'Profile in use', 'Restart Firefox']) {
			const c = classifyHelperWindows([{ id: '9', name }])
			assert.equal(c.blocked.length, 1, `"${name}" must be recognised as a profile-lock dialog`)
			assert.equal(c.usable.length, 0)
		}
	})

	it('accepts bare id strings (an untitled window is usable, not a lock dialog)', () => {
		const c = classifyHelperWindows(['4242'])
		assert.deepEqual(c.usable, [{ id: '4242', name: '' }])
		assert.deepEqual(c.blocked, [])
	})

	it('ignores junk entries rather than inventing windows', () => {
		const c = classifyHelperWindows([null, undefined, '', { name: 'no id' }])
		assert.deepEqual(c.usable, [])
		assert.deepEqual(c.blocked, [])
		assert.deepEqual(classifyHelperWindows(/** @type {any} */ (null)), { usable: [], blocked: [] })
	})
})

describe('WO-283 reuse an already-running helper (the reported failure)', () => {
	/** Build injectable deps so nothing touches X, the overlay, or a real process. */
	function harness({ existingWindows = [] } = {}) {
		const calls = { spawned: 0, promoted: 0, suspend: [], raiseKiosk: 0 }
		return {
			calls,
			deps: {
				findGuiWindowIds: async () => existingWindows,
				spawnGuiDetached: () => {
					calls.spawned += 1
					return '/usr/bin/fake-helper'
				},
				promoteGuiWindowsAboveKiosk: async () => {
					calls.promoted += 1
					return true
				},
				setKioskTopAssert: (open) => calls.suspend.push(open),
				raiseOperatorGuiBrowser: async () => {
					calls.raiseKiosk += 1
					return { ok: true }
				},
				watchdogIntervalMs: 10_000, // never fires inside the test
			},
		}
	}

	it('promotes the EXISTING window instead of launching a second process', async () => {
		// This is the operator's 2026-07-20 case: a Firefox was already running on the fixed operator
		// profile, so launching another produced a "Close Firefox" modal and no window at all.
		const h = harness({ existingWindows: [{ id: '33554477', name: 'Mozilla Firefox' }] })
		const r = await openOperatorHelperWindow('firefox', {}, { log: () => {}, deps: h.deps })
		try {
			assert.equal(r.ok, true)
			assert.equal(r.reused, true, 'must report that it reused a window')
			assert.equal(r.state, STATE.OPEN, 'reuse goes straight to OPEN — there is nothing to wait for')
			assert.equal(h.calls.spawned, 0, 'NO second process may be launched')
			assert.equal(h.calls.promoted, 1, 'the existing window must still be raised above the kiosk')
			assert.deepEqual(h.calls.suspend, [true], 'the top-assert must still be suspended for the helper')
		} finally {
			await closeOperatorHelperWindow({}, { log: () => {}, deps: h.deps })
		}
	})

	it('still restores normally after a reuse (no child process to watch)', async () => {
		const h = harness({ existingWindows: [{ id: '1', name: 'Mozilla Firefox' }] })
		await openOperatorHelperWindow('firefox', {}, { log: () => {}, deps: h.deps })
		await closeOperatorHelperWindow({}, { log: () => {}, deps: h.deps })
		assert.equal(getOperatorHelperState().state, STATE.IDLE)
		assert.deepEqual(h.calls.suspend, [true, false], 'the suspend must be undone even though nothing was spawned')
		assert.equal(h.calls.raiseKiosk, 1, 'the kiosk must be re-activated')
	})

	it('LAUNCHES when nothing is open — reuse must not break the normal path', async () => {
		const h = harness({ existingWindows: [] })
		const r = await openOperatorHelperWindow('firefox', {}, { log: () => {}, deps: h.deps })
		try {
			assert.equal(r.ok, true)
			assert.equal(r.reused, undefined)
			assert.equal(r.state, STATE.OPENING, 'a fresh launch waits for its window')
			assert.equal(h.calls.spawned, 1)
		} finally {
			await closeOperatorHelperWindow({}, { log: () => {}, deps: h.deps })
		}
	})

	it('does NOT reuse a profile-lock modal as if it were a browser window', async () => {
		// A leftover "Close Firefox" dialog must not satisfy the reuse check — that would hand the
		// operator a modal and call it success.
		const h = harness({ existingWindows: [{ id: '48234541', name: 'Close Firefox' }] })
		const r = await openOperatorHelperWindow('firefox', {}, { log: () => {}, deps: h.deps })
		try {
			assert.equal(r.reused, undefined, 'a modal is not a reusable helper window')
			assert.equal(h.calls.spawned, 1, 'it must go ahead and launch a real window')
		} finally {
			await closeOperatorHelperWindow({}, { log: () => {}, deps: h.deps })
		}
	})
})

describe('WO-283 root cause: executable lookup must not depend on /usr/bin/command', () => {
	it('finds a binary that exists on PATH', () => {
		// The original bug: commandExists() shelled out to `/usr/bin/command`, but `command` is a
		// SHELL BUILTIN and /usr/bin/command does not exist on this box. Every probe threw ENOENT, so
		// commandExists('xdotool') was false, findGuiWindowIds returned [] on every tick, and the
		// helper window was never detected no matter what was on screen.
		const shell = lookupCommandPath('sh')
		assert.ok(shell, 'sh must be found on PATH')
		assert.match(shell, /\/sh$/)
		require('node:fs').accessSync(shell, require('node:fs').constants.X_OK)
	})

	it('accepts an absolute path and rejects a missing one', () => {
		assert.equal(lookupCommandPath('/bin/sh'), '/bin/sh')
		assert.equal(lookupCommandPath('/definitely/not/here'), null)
		assert.equal(lookupCommandPath('highascg-no-such-binary-xyz'), null)
	})

	it('rejects a non-executable file and empty input', () => {
		assert.equal(lookupCommandPath('/etc/hostname'), null, 'a readable but non-executable file is not a command')
		assert.equal(lookupCommandPath(''), null)
		assert.equal(lookupCommandPath(/** @type {any} */ (null)), null)
	})
})

describe('WO-283 crash sequence end-to-end (pure)', () => {
	it('a segfaulting helper drives the machine all the way back to idle', () => {
		// open
		let s = nextHelperState(STATE.IDLE, 'open_requested')
		assert.equal(s.state, STATE.OPENING)
		// window appears
		s = nextHelperState(s.state, 'window_raised')
		assert.equal(s.state, STATE.OPEN)
		// SIGSEGV: window vanishes, child exit observed
		const d = decideRestoreOnExit({
			state: s.state,
			childExited: true,
			windowPresent: false,
			everSawWindow: true,
			restoreDone: false,
			ticks: 5,
		})
		assert.equal(d.restore, true)
		// the watchdog's restore path fires the SAME undo as a clean close
		s = nextHelperState(s.state, 'helper_gone')
		assert.deepEqual(s.actions, ['resume_kiosk_top', 'reactivate_kiosk'])
		s = nextHelperState(s.state, 'restore_done')
		assert.equal(s.state, STATE.IDLE)
	})
})

/* ------------------------------------------------------------------------------------------- *
 * WO-283 follow-up: the helper must never cover a PGM screen consumer.
 *
 * Both the helper (promoted by WO-283) and the PGM screen consumers (always-on-top by default since
 * 2026-07-19) live in the EWMH ABOVE layer, so raise order no longer protects program output — the
 * helper is deliberately raised and focused, so it wins. Placement is therefore the protection.
 * These rects mirror the measured box: operator GUI DP-5 1920x1080+3072+0, program DP-0
 * 3072x1728+0+0.
 * ------------------------------------------------------------------------------------------- */

/** The measured layout of this box. */
const BOX_LAYOUT = {
	screens: {
		1: { x: 0, y: 0, width: 3072, height: 1728, sysId: 'DP-0' },
		2: { x: 3072, y: 0, width: 1920, height: 1080, sysId: 'DP-5' },
	},
	multiview: {},
}
/** DP-5 (port 2) declared as the operator monitor — the Device View checkbox. */
const BOX_CONFIG = { casparServer: { screen_2_operator_monitor: true, screen_2_system_id: 'DP-5' } }

function rectContains(outer, inner) {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	)
}

describe('WO-283 follow-up: helper placement keeps PGM clear', () => {
	it('targets the operator monitor, via the SAME SSOT the kiosk and confinement use', () => {
		const monitor = resolveOperatorMonitorRect(BOX_CONFIG, BOX_LAYOUT)
		const placed = resolveHelperWindowRect(BOX_CONFIG, BOX_LAYOUT)

		assert.equal(placed.ok, true)
		assert.equal(placed.reason, 'operator_monitor')
		// Not merely "on DP-5" — derived from resolveOperatorMonitorRect, so there is no second
		// opinion about which screen is the operator's.
		assert.deepEqual(placed.monitor, monitor)
		assert.equal(placed.monitor.sysId, 'DP-5')
		assert.ok(rectContains(monitor, placed.rect), 'helper rect must sit inside the operator monitor')
	})

	it('produces a rect that does not intersect ANY program consumer rect', () => {
		const placed = resolveHelperWindowRect(BOX_CONFIG, BOX_LAYOUT)
		const program = listProgramConsumerRects(BOX_CONFIG, BOX_LAYOUT)

		assert.equal(program.length, 1, 'DP-0 is the one program head here')
		assert.equal(program[0].sysId, 'DP-0')
		for (const p of program) {
			assert.equal(rectsIntersect(placed.rect, p), false, `helper must not cover program head ${p.sysId}`)
		}
	})

	it('is SIZED, not just moved — an unsized window spills onto the program head', () => {
		const placed = resolveHelperWindowRect(BOX_CONFIG, BOX_LAYOUT)
		const program = listProgramConsumerRects(BOX_CONFIG, BOX_LAYOUT)

		assert.ok(placed.rect.width > 0 && placed.rect.height > 0)
		assert.ok(placed.rect.width <= 1920 && placed.rect.height <= 1080)
		// A browser remembering a 3072-wide geometry, moved to the operator origin but NOT resized,
		// reaches back over DP-0. This is the case `windowsize` exists to kill.
		const unsized = { x: placed.rect.x, y: placed.rect.y, width: 3072, height: 1728 }
		assert.equal(rectsIntersect(unsized, program[0]), false, 'sanity: this one spills right, not onto DP-0')
		// …and one that opened at the default 0,0 (what actually happened) is squarely on PGM.
		assert.equal(rectsIntersect({ x: 0, y: 0, width: 1280, height: 720 }, program[0]), true)
	})

	it('the OLD placement source resolves to the PGM head — this was the bug', () => {
		// resolveOperatorDisplayRect's documented fallback is "multiview when enabled, else the FIRST
		// PGM SCREEN CONSUMER HEAD". promoteGuiWindowsAboveKiosk used it, so with no operator monitor
		// configured it moved the helper ONTO program output. Pinned here so nobody wires it back.
		const legacy = resolveOperatorDisplayRect({}, BOX_LAYOUT)
		assert.equal(legacy.sysId, 'DP-0', 'the legacy fallback really is the program head')

		const program = listProgramConsumerRects({}, BOX_LAYOUT)
		assert.ok(
			program.some((p) => rectsIntersect(legacy, p)),
			'…and it intersects a program consumer, which is exactly what must never happen',
		)
	})

	it('REFUSES to place (rather than guessing) when no operator monitor is configured', () => {
		const placed = resolveHelperWindowRect({}, BOX_LAYOUT)
		assert.equal(placed.ok, false)
		assert.equal(placed.reason, 'no_operator_monitor')
		assert.equal(placed.rect, null, 'a guessed rect is how a browser ended up on PGM')
		// The caller still learns what is at risk, so it can log it. With no operator monitor declared
		// nothing is excluded, so BOTH heads are treated as program output — the conservative reading,
		// and the reason refusing to place is the only safe answer here.
		assert.equal(placed.programRects.length, 2)
	})

	it('REFUSES when the operator monitor itself overlaps a program consumer', () => {
		// Mis-wired layout: the operator monitor and a program consumer claim the same pixels.
		const layout = {
			screens: {
				1: { x: 0, y: 0, width: 1920, height: 1080, sysId: 'DP-0' },
				2: { x: 0, y: 0, width: 1920, height: 1080, sysId: 'DP-5' },
			},
			multiview: {},
		}
		const placed = resolveHelperWindowRect(BOX_CONFIG, layout)
		assert.equal(placed.ok, false)
		assert.match(placed.reason, /^overlaps_program_consumer_/)
		assert.equal(placed.rect, null)
	})

	it('does not count the operator/multiview head as program output', () => {
		// The Caspar consumer on the operator head is the operator_gui one, which
		// operator-shape-overlay.py pins BELOW the kiosk and makes input-dead. Treating it as PGM
		// would make every placement refuse, and the helper would never be confined at all.
		const program = listProgramConsumerRects(BOX_CONFIG, BOX_LAYOUT)
		assert.equal(
			program.some((p) => p.sysId === 'DP-5'),
			false,
			'the operator head must not appear in the program list',
		)
	})

	it('rectsIntersect uses half-open edges, so touching edges do not count as covering', () => {
		const a = { x: 0, y: 0, width: 100, height: 100 }
		assert.equal(rectsIntersect(a, { x: 100, y: 0, width: 100, height: 100 }), false, 'edge-to-edge is not overlap')
		assert.equal(rectsIntersect(a, { x: 99, y: 0, width: 100, height: 100 }), true, 'one pixel of overlap counts')
		assert.equal(rectsIntersect(a, { x: 0, y: 100, width: 100, height: 100 }), false)
		assert.equal(rectsIntersect(a, null), false)
	})
})
