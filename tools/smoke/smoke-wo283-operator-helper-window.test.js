'use strict'

/**
 * Smoke — WO-283: opening a foreign window (DeckLink setup, NVIDIA, file browser, web browser) ON
 * TOP of the shaped operator kiosk.
 *
 * The dangerous part of this feature is not the launch — `/api/system/gui-launch` already spawns
 * these apps fine. It is that opening one SUSPENDS the shape overlay's kiosk top-assert, and if
 * that suspend is never undone the operator is left staring at a GUI that will not come back to
 * the front. So this file hammers the two pure decisions that own the undo:
 *
 *   1. `nextHelperState`      — idle → opening → open → restoring → idle, and every refusal that
 *                               keeps the machine from desyncing (double-press, late exit).
 *   2. `decideRestoreOnExit`  — the watchdog's per-tick "restore now?" call, including the crash
 *                               and kill -9 cases the WO calls out by name.
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
	HELPER_ACTIONS,
	WATCHDOG_APPEAR_TICKS,
	WATCHDOG_INTERVAL_MS,
	WATCHDOG_EARLY_EXIT_GRACE_TICKS,
	openOperatorHelperWindow,
	closeOperatorHelperWindow,
	getOperatorHelperState,
} = require('../../src/system/operator-helper-window')
const { lookupCommandPath } = require('../../src/utils/x-display-session-runtime')

/** A watchdog sample at the moment the helper is up and healthy. */
const HEALTHY = {
	state: STATE.OPEN,
	childExited: false,
	windowPresent: true,
	everSawWindow: true,
	restoreDone: false,
	ticks: 3,
}

describe('WO-283 helper state machine', () => {
	it('walks the happy path idle → opening → open → restoring → idle', () => {
		let s = STATE.IDLE

		const open = nextHelperState(s, 'open_requested')
		assert.equal(open.ok, true)
		assert.equal(open.state, STATE.OPENING)
		// The suspend MUST precede the spawn, or the helper maps under a re-raising kiosk.
		assert.deepEqual(open.actions, ['suspend_kiosk_top', 'spawn_helper'])
		s = open.state

		const raised = nextHelperState(s, 'window_raised')
		assert.equal(raised.ok, true)
		assert.equal(raised.state, STATE.OPEN)
		assert.deepEqual(raised.actions, ['promote_helper'])
		s = raised.state

		const gone = nextHelperState(s, 'helper_gone')
		assert.equal(gone.ok, true)
		assert.equal(gone.state, STATE.RESTORING)
		// Resume the top-assert BEFORE re-activating, so the re-activate lands on a kiosk that is
		// already allowed back to the top of its layer.
		assert.deepEqual(gone.actions, ['resume_kiosk_top', 'reactivate_kiosk'])
		s = gone.state

		const done = nextHelperState(s, 'restore_done')
		assert.equal(done.ok, true)
		assert.equal(done.state, STATE.IDLE)
		assert.deepEqual(done.actions, [])
	})

	it('REFUSES a second open while one is already up (no stacked helpers, no racing restores)', () => {
		for (const busy of [STATE.OPENING, STATE.OPEN, STATE.RESTORING]) {
			const r = nextHelperState(busy, 'open_requested')
			assert.equal(r.ok, false, `open_requested must be refused in ${busy}`)
			assert.equal(r.state, busy, 'a refused open must not move the state')
			assert.deepEqual(r.actions, [], 'a refused open must not fire side effects')
			assert.match(r.reason, /^busy_/)
		}
	})

	it('a failed spawn undoes the suspend immediately — the kiosk never stays demoted', () => {
		const f = nextHelperState(STATE.OPENING, 'launch_failed')
		assert.equal(f.ok, true)
		assert.equal(f.state, STATE.RESTORING)
		assert.deepEqual(f.actions, ['resume_kiosk_top', 'reactivate_kiosk'])
	})

	it('accepts helper_gone from OPENING — a helper can die before it ever maps a window', () => {
		const r = nextHelperState(STATE.OPENING, 'helper_gone')
		assert.equal(r.ok, true)
		assert.equal(r.state, STATE.RESTORING)
		assert.deepEqual(r.actions, ['resume_kiosk_top', 'reactivate_kiosk'])
	})

	it('ignores a late helper_gone once already idle (exit event racing the watchdog)', () => {
		const r = nextHelperState(STATE.IDLE, 'helper_gone')
		assert.equal(r.ok, false)
		assert.equal(r.state, STATE.IDLE)
		assert.deepEqual(r.actions, [])
	})

	it('refuses restore_done outside RESTORING and rejects unknown events', () => {
		assert.equal(nextHelperState(STATE.OPEN, 'restore_done').ok, false)
		const u = nextHelperState(STATE.OPEN, 'nonsense')
		assert.equal(u.ok, false)
		assert.match(u.reason, /^unknown_event_/)
		assert.deepEqual(u.actions, [])
	})

	it('exposes exactly the launcher actions the API allow-lists', () => {
		assert.deepEqual(
			[...HELPER_ACTIONS].sort(),
			['desktop_video_updater', 'desktopvideo_setup', 'file-manager', 'firefox', 'nvidia-settings'],
		)
	})
})

describe('WO-283 restore-on-crash decision', () => {
	it('holds while the helper is alive and on screen', () => {
		assert.deepEqual(decideRestoreOnExit(HEALTHY), { restore: false, reason: 'helper_window_alive' })
	})

	it('a live WINDOW outranks a dead child (thunar forks; the launcher exits at once)', () => {
		const forked = { ...HEALTHY, childExited: true, windowPresent: true }
		assert.deepEqual(decideRestoreOnExit(forked), { restore: false, reason: 'helper_window_alive' })
	})

	it('restores when the operator closes the helper normally', () => {
		const closed = { ...HEALTHY, childExited: true, windowPresent: false }
		assert.deepEqual(decideRestoreOnExit(closed), { restore: true, reason: 'helper_closed' })
	})

	it('restores on kill -9 — window gone, exit event never seen', () => {
		const killed = { ...HEALTHY, childExited: false, windowPresent: false }
		assert.deepEqual(decideRestoreOnExit(killed), { restore: true, reason: 'helper_window_gone' })
	})

	it('restores quickly when the helper CRASHES before mapping anything', () => {
		// Once the short grace has passed (see WATCHDOG_EARLY_EXIT_GRACE_TICKS — it exists so a
		// forking launcher is not read as a crash), a dead child that mapped nothing IS a crash and
		// must not sit out the full appear budget.
		const crashed = {
			state: STATE.OPENING,
			childExited: true,
			windowPresent: false,
			everSawWindow: false,
			restoreDone: false,
			ticks: WATCHDOG_EARLY_EXIT_GRACE_TICKS,
		}
		assert.deepEqual(decideRestoreOnExit(crashed), { restore: true, reason: 'helper_died_before_mapping' })
		assert.ok(WATCHDOG_EARLY_EXIT_GRACE_TICKS < WATCHDOG_APPEAR_TICKS, 'a crash must restore well before the timeout')
	})

	it('waits out the appear window for a slow starter, then gives up', () => {
		const starting = {
			state: STATE.OPENING,
			childExited: false,
			windowPresent: false,
			everSawWindow: false,
			restoreDone: false,
			ticks: 1,
		}
		assert.deepEqual(decideRestoreOnExit(starting), { restore: false, reason: 'waiting_for_window' })
		// Still waiting on the last tick before the deadline...
		assert.equal(decideRestoreOnExit({ ...starting, ticks: WATCHDOG_APPEAR_TICKS - 1 }).restore, false)
		// ...and restores once it is reached, so a helper that never appears cannot strand the GUI.
		assert.deepEqual(decideRestoreOnExit({ ...starting, ticks: WATCHDOG_APPEAR_TICKS }), {
			restore: true,
			reason: 'helper_never_appeared',
		})
	})

	it('is idempotent — a restore already run is never run twice', () => {
		const twice = { ...HEALTHY, childExited: true, windowPresent: false, restoreDone: true }
		assert.deepEqual(decideRestoreOnExit(twice), { restore: false, reason: 'already_restored' })
	})

	it('never restores from idle/restoring (nothing was suspended, or it is already in flight)', () => {
		for (const state of [STATE.IDLE, STATE.RESTORING]) {
			const s = { ...HEALTHY, state, childExited: true, windowPresent: false }
			assert.deepEqual(decideRestoreOnExit(s), { restore: false, reason: 'not_open' })
		}
	})

	it('honours an injected appear deadline (the watchdog owns the cadence, not this function)', () => {
		const s = {
			state: STATE.OPENING,
			childExited: false,
			windowPresent: false,
			everSawWindow: false,
			restoreDone: false,
			ticks: 2,
			maxAppearTicks: 2,
		}
		assert.deepEqual(decideRestoreOnExit(s), { restore: true, reason: 'helper_never_appeared' })
	})
})

describe('WO-283 appear budget (2026-07-20 regression: 6s was too short)', () => {
	it('gives a cold start at least 20s before giving up', () => {
		// The operator's Firefox never appeared inside the old 8-tick/6s budget. A cold browser start
		// on a fresh profile, nvidia-settings enumerating GPUs and the DeckLink setup GUI all beat 6s
		// regularly, so the budget must be generous — this asserts the WALL CLOCK, not the tick count,
		// because the tick count is meaningless without the interval.
		const budgetMs = WATCHDOG_APPEAR_TICKS * WATCHDOG_INTERVAL_MS
		assert.ok(
			budgetMs >= 20_000,
			`appear budget is ${budgetMs}ms — too short for a cold Firefox/nvidia-settings start`,
		)
	})

	it('keeps crash-restore fast even though the appear budget is long', () => {
		// The long budget must NOT slow down the case the WO cares about: a helper that actually died
		// has to give the kiosk back promptly, not 30s later.
		const crashMs = WATCHDOG_EARLY_EXIT_GRACE_TICKS * WATCHDOG_INTERVAL_MS
		assert.ok(crashMs <= 5000, `crash restore would take ${crashMs}ms — too slow`)
		assert.ok(crashMs < WATCHDOG_APPEAR_TICKS * WATCHDOG_INTERVAL_MS)
	})

	it('a forking launcher is not mistaken for a crash during the grace window', () => {
		// thunar (and any `sh -c ... &` wrapper) exits immediately while its window is still mapping.
		// Before the grace it looked exactly like a startup crash and restored on the first tick.
		const forkedAndExited = {
			state: STATE.OPENING,
			childExited: true,
			windowPresent: false,
			everSawWindow: false,
			restoreDone: false,
			ticks: 1,
		}
		assert.deepEqual(decideRestoreOnExit(forkedAndExited), {
			restore: false,
			reason: 'waiting_after_child_exit',
		})
		// ...but a child that is still gone once the grace expires IS a crash.
		assert.deepEqual(decideRestoreOnExit({ ...forkedAndExited, ticks: WATCHDOG_EARLY_EXIT_GRACE_TICKS }), {
			restore: true,
			reason: 'helper_died_before_mapping',
		})
	})
})

describe('WO-283 give-up reason codes (the 2026-07-20 failure was undiagnosable)', () => {
	const NEVER_APPEARED = {
		state: STATE.OPENING,
		childExited: false,
		windowPresent: false,
		everSawWindow: false,
		restoreDone: false,
		ticks: WATCHDOG_APPEAR_TICKS,
	}

	it('names a profile lock separately from a plain timeout', () => {
		// Same observable symptom (no window, budget expired), completely different cause and fix:
		// "the app is slow/broken" vs "Firefox showed a Close Firefox modal because the profile was
		// already in use". The journal must not conflate them.
		assert.deepEqual(decideRestoreOnExit(NEVER_APPEARED), { restore: true, reason: 'helper_never_appeared' })
		assert.deepEqual(decideRestoreOnExit({ ...NEVER_APPEARED, profileLocked: true }), {
			restore: true,
			reason: 'helper_profile_locked',
		})
	})

	it('every terminal reason is a distinct, greppable code', () => {
		const reasons = new Set(
			[
				{ ...NEVER_APPEARED },
				{ ...NEVER_APPEARED, profileLocked: true },
				{ ...NEVER_APPEARED, childExited: true },
				{ state: STATE.OPEN, childExited: true, windowPresent: false, everSawWindow: true, restoreDone: false, ticks: 5 },
				{ state: STATE.OPEN, childExited: false, windowPresent: false, everSawWindow: true, restoreDone: false, ticks: 5 },
			].map((s) => decideRestoreOnExit(s).reason),
		)
		assert.deepEqual(
			[...reasons].sort(),
			[
				'helper_closed',
				'helper_died_before_mapping',
				'helper_never_appeared',
				'helper_profile_locked',
				'helper_window_gone',
			],
			'each give-up path must report its OWN reason — a shared code is what made the live failure need forensics',
		)
	})
})

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
