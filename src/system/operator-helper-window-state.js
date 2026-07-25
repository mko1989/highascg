'use strict'

/** @readonly */
const STATE = /** @type {const} */ ({
	IDLE: 'idle',
	OPENING: 'opening',
	OPEN: 'open',
	RESTORING: 'restoring',
})

/** Watchdog cadence.
 *
 * 40 ticks * 750ms = 30s for a helper to map its first window. This was 8 ticks (6s) and 6s IS NOT
 * ENOUGH: a cold Firefox start on a fresh profile, nvidia-settings enumerating GPUs, and the
 * Blackmagic DeckLink setup GUI all routinely take longer than that on this box, and the operator
 * saw the kiosk snap back before the app had drawn anything. The long budget costs nothing in the
 * cases that matter, because "hasn't appeared YET" is the only path that waits it out — a helper
 * that actually DIED is caught by the childExited branch of decideRestoreOnExit and restores in
 * about a second, so `kill -9` / segfault recovery stays as responsive as it was. @readonly */
const WATCHDOG_INTERVAL_MS = 750
const WATCHDOG_APPEAR_TICKS = 40

/** Grace before "the child exited and nothing is mapped yet" counts as a crash. Launchers that fork
 * and exit immediately (thunar, and any `sh -c … &` wrapper) legitimately look identical to a crash
 * for the first moment. 4 ticks = 3s: still a fast crash-restore, but no longer a race the forking
 * launchers lose. @readonly */
const WATCHDOG_EARLY_EXIT_GRACE_TICKS = 4

/** Titles Firefox uses when a SECOND instance is pointed at an in-use profile. It puts up a modal
 * ("Close Firefox") instead of a browser window — the exact failure the operator hit on 2026-07-20.
 * Matching these lets the watchdog say `profile_locked` instead of timing out mutely. @readonly */
const PROFILE_LOCK_TITLE_RE = /close firefox|already running|profile (?:is )?(?:in use|missing)|restart firefox/i

/* ------------------------------------------------------------------------------------------- *
 * PURE LOGIC (offline-tested: tools/smoke/smoke-wo283-operator-helper-window.test.js)
 * ------------------------------------------------------------------------------------------- */

/**
 * PURE. The idle → opening → open → restoring → idle state machine, plus the side effects each
 * transition owes. Unknown events are refused rather than silently ignored, so a double-press or a
 * late exit callback can never desync the real X state from `state`.
 *
 * @param {string} state current state (one of STATE)
 * @param {string} event one of: open_requested | window_raised | launch_failed | close_requested |
 *                       helper_gone | restore_done
 * @returns {{ state: string, actions: string[], ok: boolean, reason?: string }}
 *   `actions` are the side effects the caller must run, in order:
 *     suspend_kiosk_top | spawn_helper | promote_helper | resume_kiosk_top | reactivate_kiosk
 */
function nextHelperState(state, event) {
	switch (event) {
		case 'open_requested':
			// Refuse rather than stack a second helper: two helpers would race the same restore.
			if (state !== STATE.IDLE) return { state, actions: [], ok: false, reason: `busy_${state}` }
			return { state: STATE.OPENING, actions: ['suspend_kiosk_top', 'spawn_helper'], ok: true }

		case 'window_raised':
			if (state !== STATE.OPENING) return { state, actions: [], ok: false, reason: `not_opening_${state}` }
			return { state: STATE.OPEN, actions: ['promote_helper'], ok: true }

		case 'launch_failed':
			// The spawn threw — undo the suspend immediately, the kiosk must not stay demoted.
			if (state !== STATE.OPENING) return { state, actions: [], ok: false, reason: `not_opening_${state}` }
			return { state: STATE.RESTORING, actions: ['resume_kiosk_top', 'reactivate_kiosk'], ok: true }

		case 'close_requested':
		case 'helper_gone':
			// Accepted from OPENING too: a helper can die before it ever maps a window.
			if (state !== STATE.OPENING && state !== STATE.OPEN)
				return { state, actions: [], ok: false, reason: `not_open_${state}` }
			return { state: STATE.RESTORING, actions: ['resume_kiosk_top', 'reactivate_kiosk'], ok: true }

		case 'restore_done':
			if (state !== STATE.RESTORING) return { state, actions: [], ok: false, reason: `not_restoring_${state}` }
			return { state: STATE.IDLE, actions: [], ok: true }

		default:
			return { state, actions: [], ok: false, reason: `unknown_event_${event}` }
	}
}

/**
 * PURE. The restore-on-crash decision, evaluated once per watchdog tick. Deliberately NOT "the
 * child process exited" — that alone is both too eager (thunar forks and the launcher exits while
 * the window lives on) and too lax (a `kill -9`ed app whose exit event we missed). The mapped X
 * window is the ground truth; the child exit only decides how fast we trust its absence.
 *
 * Every terminal reason is a distinct code, so the journal answers "why did it give up?" without
 * anyone having to reconstruct the X state after the fact (which is exactly what the 2026-07-20
 * failure cost).
 *
 * @param {{ state: string, childExited: boolean, windowPresent: boolean, everSawWindow: boolean,
 *           restoreDone: boolean, ticks: number, maxAppearTicks?: number,
 *           earlyExitGraceTicks?: number, profileLocked?: boolean }} s
 * @returns {{ restore: boolean, reason: string }}
 */
function decideRestoreOnExit(s) {
	const maxAppearTicks = Number.isFinite(s.maxAppearTicks) ? Number(s.maxAppearTicks) : WATCHDOG_APPEAR_TICKS
	const graceTicks = Number.isFinite(s.earlyExitGraceTicks)
		? Number(s.earlyExitGraceTicks)
		: WATCHDOG_EARLY_EXIT_GRACE_TICKS
	if (s.restoreDone) return { restore: false, reason: 'already_restored' }
	if (s.state !== STATE.OPENING && s.state !== STATE.OPEN) return { restore: false, reason: 'not_open' }
	// A live window outranks a dead child: the launcher/forking app is allowed to have exited.
	if (s.windowPresent) return { restore: false, reason: 'helper_window_alive' }
	if (s.everSawWindow) {
		return { restore: true, reason: s.childExited ? 'helper_closed' : 'helper_window_gone' }
	}
	// Never mapped anything. A dead child usually means it crashed on startup — but a launcher that
	// forks and exits looks identical for the first instant, so give it a short grace before
	// declaring a crash. Genuine crashes still restore in ~3s, far inside the appear budget.
	if (s.childExited) {
		if (s.ticks < graceTicks) return { restore: false, reason: 'waiting_after_child_exit' }
		return { restore: true, reason: 'helper_died_before_mapping' }
	}
	if (s.ticks >= maxAppearTicks) {
		// Distinguish "slow/broken app" from "we asked Firefox to reuse a locked profile and it put
		// up a modal instead of a window" — completely different fixes, so completely different code.
		return { restore: true, reason: s.profileLocked ? 'helper_profile_locked' : 'helper_never_appeared' }
	}
	return { restore: false, reason: 'waiting_for_window' }
}

/**
 * PURE. Split the helper windows we found into ones the operator can actually work in, and
 * profile-lock/error modals that merely LOOK like a window appeared.
 *
 * @param {Array<string|{ id: string, name?: string }>} windows
 * @returns {{ usable: {id: string, name: string}[], blocked: {id: string, name: string}[] }}
 */
function classifyHelperWindows(windows) {
	const usable = []
	const blocked = []
	for (const w of Array.isArray(windows) ? windows : []) {
		const entry = typeof w === 'string' ? { id: w, name: '' } : { id: String(w?.id ?? ''), name: String(w?.name ?? '') }
		if (!entry.id) continue
		if (entry.name && PROFILE_LOCK_TITLE_RE.test(entry.name)) blocked.push(entry)
		else usable.push(entry)
	}
	return { usable, blocked }
}

module.exports = {
	STATE,
	WATCHDOG_INTERVAL_MS,
	WATCHDOG_APPEAR_TICKS,
	WATCHDOG_EARLY_EXIT_GRACE_TICKS,
	nextHelperState,
	decideRestoreOnExit,
	classifyHelperWindows,
}
