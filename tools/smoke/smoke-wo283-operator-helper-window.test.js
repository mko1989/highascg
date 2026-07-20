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
	STATE,
	HELPER_ACTIONS,
	WATCHDOG_APPEAR_TICKS,
} = require('../../src/system/operator-helper-window')

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

	it('restores immediately when the helper CRASHES before mapping anything', () => {
		const crashed = {
			state: STATE.OPENING,
			childExited: true,
			windowPresent: false,
			everSawWindow: false,
			restoreDone: false,
			ticks: 1,
		}
		assert.deepEqual(decideRestoreOnExit(crashed), { restore: true, reason: 'helper_died_before_mapping' })
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
