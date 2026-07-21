/**
 * operator-helper-registry.js — WO-317: generalize the single-helper state machine (WO-283) to
 * manage N helpers (file browser, web browser, nvidia-settings, decklink setup, etc.) with
 * independent per-helper state, parked/raised positioning, and a per-helper refcount replacing
 * the single boolean `helperOpen`.
 *
 * PURE LOGIC: no I/O, no timers, no external effects. Full offline testability. The applier that
 * actually calls xdotool is NOT in scope.
 *
 * HELPER STATE MACHINE (per id):
 *   'launching' -> registered but no window mapped yet (watchdog polls for the window)
 *   'open'      -> window is mapped and visible/managed
 *   (gone)      -> removed from registry entirely, no lingering state
 *
 * PARKED STATE: a 'open' helper can be parked (sitting BELOW the Caspar consumer, invisible over
 * video holes) or raised (ABOVE the kiosk, operator-visible and usable). The registry tracks this
 * per-helper so the applier can manage stacking independently.
 *
 * KIOSK TOP-ASSERT REFCOUNT: The overlay's top-assert (_NET_WM_STATE_ABOVE re-raise on every
 * payload) must be suspended ONLY while any helper is open AND not parked. Unlike WO-283's
 * boolean, this is now a count: `shouldSuspendKioskTopAssert()` returns true only if at least
 * one unparked open helper exists. The kiosk resumption guarantee is that it re-asserts only when
 * the LAST unparked helper is gone.
 *
 * CRASH SAFETY: a helper that dies while parked must be removed cleanly and must not leave
 * shouldSuspendKioskTopAssert stuck true. This is the WO-283 "restore-on-crash" property,
 * generalised per-helper: `markHelperGone()` is the only transition that removes; it is called
 * by the watchdog when a helper's window vanishes or a timeout fires, and MUST be idempotent.
 *
 * UNKNOWN ID HANDLING: All functions gracefully handle missing/unknown ids without throwing.
 * The taskbar must never crash on a registry state mismatch.
 */

'use strict'

/**
 * PURE. Create an empty registry.
 * @returns {{ helpers: {} }}
 */
function createHelperRegistry() {
	return { helpers: {} }
}

/**
 * PURE. Register a new helper or reset an existing one to 'launching' state. The helper is now
 * being started; the watchdog will poll for its window.
 * @param {object} reg registry (modified in place)
 * @param {string} id helper id (e.g. 'file_browser', 'web_browser')
 * @param {object} info metadata (e.g. { action: 'file-manager', ... })
 */
function registerHelper(reg, id, info) {
	if (!id) return
	reg.helpers[id] = {
		id,
		info: info || {},
		state: 'launching',
		windowId: null,
		parked: false,
	}
}

/**
 * PURE. A window for this helper has been mapped. Transition to 'open' state.
 * @param {object} reg
 * @param {string} id
 * @param {string|number} windowId the X window ID (string or number, stored as-is)
 */
function markHelperMapped(reg, id, windowId) {
	if (!id) return
	const h = reg.helpers[id]
	if (!h) return
	h.state = 'open'
	h.windowId = windowId
}

/**
 * PURE. The helper is gone (window disappeared, timeout, etc.). Remove it from the registry.
 * Idempotent: calling on an already-gone id is a no-op.
 * @param {object} reg
 * @param {string} id
 */
function markHelperGone(reg, id) {
	if (!id) return
	delete reg.helpers[id]
}

/**
 * PURE. Set the parked state for a helper. A parked helper sits BELOW the Caspar consumer
 * (invisible over video holes); raised = ABOVE the kiosk (operator-visible).
 * No-op if the helper is not found or is not in 'open' state.
 * @param {object} reg
 * @param {string} id
 * @param {boolean} parked true = below caspar, false = above kiosk
 */
function setHelperParked(reg, id, parked) {
	if (!id) return
	const h = reg.helpers[id]
	if (!h || h.state !== 'open') return
	h.parked = Boolean(parked)
}

/**
 * PURE. List all helpers in stable, deterministic order (sorted by id). Returns copies so the
 * caller cannot mutate registry state accidentally.
 * @param {object} reg
 * @returns {Array<{ id: string, state: string, windowId: string|number|null, parked: boolean, info: object }>}
 */
function listHelpers(reg) {
	return Object.keys(reg.helpers)
		.sort()
		.map((id) => {
			const h = reg.helpers[id]
			return {
				id: h.id,
				state: h.state,
				windowId: h.windowId,
				parked: h.parked,
				info: { ...h.info }, // shallow copy
			}
		})
}

/**
 * PURE. Count how many helpers are currently open OR launching (i.e. not yet gone).
 * @param {object} reg
 * @returns {number}
 */
function helperOpenCount(reg) {
	return Object.keys(reg.helpers).length
}

/**
 * PURE. Refcount: should the kiosk's top-assert be suspended? TRUE only if at least one helper
 * is open AND not parked. This replaces WO-283's single boolean `helperOpen`.
 *
 * Correctness: the kiosk re-asserts only when this returns false AND it WAS true (i.e. the LAST
 * unparked helper is gone). A helper that dies while parked must not wedge this true — hence
 * `markHelperGone()` is the only path that removes.
 * @param {object} reg
 * @returns {boolean}
 */
function shouldSuspendKioskTopAssert(reg) {
	for (const h of Object.values(reg.helpers)) {
		if (h.state === 'open' && !h.parked) return true
	}
	return false
}

/**
 * PURE. Taskbar decision: what should happen if the operator clicks this helper's entry?
 * Returns a decision object with an action and optionally a reason; never throws on unknown ids.
 *
 * - unknown/missing id -> {action:'launch'} (let the operator try)
 * - not open/launching -> {action:'launch'}
 * - open and parked -> {action:'raise'} (bring to front)
 * - open and raised (not parked) -> {action:'park'} (toggle: send to back)
 *
 * @param {object} reg
 * @param {string} id
 * @returns {{ action: 'launch'|'raise'|'park', reason?: string }}
 */
function decideRaise(reg, id) {
	if (!id) return { action: 'launch', reason: 'unknown_id' }
	const h = reg.helpers[id]
	if (!h) return { action: 'launch', reason: 'not_registered' }
	if (h.state !== 'open') return { action: 'launch', reason: 'not_open' }
	if (h.parked) return { action: 'raise', reason: 'currently_parked' }
	return { action: 'park', reason: 'currently_raised' }
}

module.exports = {
	createHelperRegistry,
	registerHelper,
	markHelperMapped,
	markHelperGone,
	setHelperParked,
	listHelpers,
	helperOpenCount,
	shouldSuspendKioskTopAssert,
	decideRaise,
}
