'use strict'

/**
 * WO-317 — PURE command planner for raising/parking operator helper windows.
 *
 * This turns a registry decision (operator-helper-registry.js `decideRaise`) into an ordered list
 * of concrete process invocations, WITHOUT running any of them. The applier executes the plan; the
 * ordering knowledge — which is load-bearing and was learned the hard way in WO-283 — lives here
 * where it can be tested offline against no live X server.
 *
 * The mechanism this encodes (see tools/runtime/highascg-window-above.py and
 * src/utils/x-display-session-runtime.js):
 *  - This box ships xdotool 3.20160805.1, which has NO `windowstate` verb, so ABOVE-promotion goes
 *    through the python-xlib EWMH helper, not xdotool. A plan that emits `xdotool windowstate` here
 *    would be a silent no-op on this machine — exactly the WO-283 regression.
 *  - RAISE = promote ABOVE (python) → windowraise → confine to the operator rect → windowactivate.
 *    Focus is last and load-bearing: the kiosk's FULLSCREEN state only lifts it into Openbox's
 *    fullscreen layer while focused, so handing focus to the helper drops the kiosk to ABOVE where
 *    the helper can sit on top.
 *  - PARK = the inverse. Remove ABOVE + lower the helper BELOW the Caspar consumer (python), then
 *    RE-FOCUS THE KIOSK. Refocusing the kiosk is what pulls it back up into the fullscreen layer
 *    over the now-lowered helper; skip it and the desktop keeps focus and the stack is ambiguous.
 */

/** Resolve the promote (ABOVE) helper script path candidates — matches x-display-session-runtime. */
const PROMOTE_SCRIPT = 'highascg-window-above.py'
/** The park (BELOW) inverse. */
const PARK_SCRIPT = 'highascg-window-below.py'

/**
 * @typedef {{ bin: string, args: string[], optional?: boolean, note?: string }} PlanStep
 */

/**
 * @param {unknown} v
 * @returns {string|null}
 */
function widString(v) {
	if (v === null || v === undefined) return null
	const s = String(v).trim()
	return s ? s : null
}

/**
 * Steps to bring a helper OVER the kiosk and focus it.
 *
 * @param {{
 *   helperWid: string|number,
 *   promoteScript: string,
 *   rect?: { x: number, y: number, width: number, height: number }|null,
 * }} ctx
 * @returns {PlanStep[]}
 */
function planRaise(ctx) {
	const wid = widString(ctx?.helperWid)
	const script = String(ctx?.promoteScript || '').trim()
	if (!wid) return []
	/** @type {PlanStep[]} */
	const steps = []
	if (script) {
		// The python promoter does ABOVE + raise + activate in one atomic EWMH burst.
		steps.push({ bin: 'python3', args: [script, wid], note: 'promote ABOVE + raise + focus' })
	} else {
		// No promoter resolvable: a bare raise is the best we can do, and it will be clamped to the
		// NORMAL layer under the kiosk. Emit it so the applier at least tries, marked optional.
		steps.push({ bin: 'xdotool', args: ['windowraise', wid], optional: true, note: 'no promoter — raise only, will be clamped' })
	}
	// Confine to the operator monitor so the helper never overhangs onto the program head.
	const rect = ctx?.rect
	if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0) {
		steps.push({ bin: 'xdotool', args: ['windowmove', wid, String(rect.x), String(rect.y)], optional: true })
		steps.push({
			bin: 'xdotool',
			args: ['windowsize', wid, String(rect.width), String(rect.height)],
			optional: true,
		})
	}
	// Focus last — this is what drops the kiosk out of the fullscreen layer so the helper sits on top.
	steps.push({ bin: 'xdotool', args: ['windowactivate', wid], optional: true, note: 'focus last — kiosk yields fullscreen' })
	return steps
}

/**
 * Steps to park a helper BELOW the Caspar consumer and hand focus back to the kiosk.
 *
 * The Caspar consumer wid is what the helper is lowered beneath — a bare `windowlower` is not
 * enough, because helper and consumer both live in the ABOVE layer once the helper was promoted,
 * so within-layer order is what matters. Refocusing the kiosk restores its fullscreen precedence.
 *
 * @param {{
 *   helperWid: string|number,
 *   kioskWid: string|number,
 *   consumerWid?: string|number|null,
 *   parkScript: string,
 * }} ctx
 * @returns {PlanStep[]}
 */
function planPark(ctx) {
	const wid = widString(ctx?.helperWid)
	const kiosk = widString(ctx?.kioskWid)
	const consumer = widString(ctx?.consumerWid)
	const script = String(ctx?.parkScript || '').trim()
	if (!wid) return []
	/** @type {PlanStep[]} */
	const steps = []
	if (script) {
		// The python park helper: remove ABOVE + lower below the consumer (sibling if known).
		const args = consumer ? [script, wid, '--below', consumer] : [script, wid]
		steps.push({ bin: 'python3', args, note: 'remove ABOVE + lower below consumer' })
	} else {
		steps.push({ bin: 'xdotool', args: ['windowlower', wid], optional: true, note: 'no park script — lower only' })
	}
	// Refocus the kiosk so it climbs back into the fullscreen layer over the parked helper. Without
	// a kiosk wid there is nothing to refocus, and the park is incomplete — the caller must know.
	if (kiosk) {
		steps.push({ bin: 'xdotool', args: ['windowactivate', kiosk], note: 'refocus kiosk — restores fullscreen precedence' })
	}
	return steps
}

/**
 * Turn a registry decision into a command plan.
 *
 * @param {{ action: 'launch'|'raise'|'park'|string }} decision from decideRaise()
 * @param {object} ctx window context (helperWid, kioskWid, consumerWid, promoteScript, parkScript, rect)
 * @returns {{ action: string, steps: PlanStep[], complete: boolean, warnings: string[] }}
 *   `complete` is false when a step the operation depends on could not be planned (e.g. park
 *   without a kiosk wid to refocus, or raise without a helper wid); the applier should log it.
 */
function planHelperWindowAction(decision, ctx = {}) {
	const action = String(decision?.action || '').trim()
	const warnings = []
	let steps = []
	if (action === 'raise') {
		if (!widString(ctx.helperWid)) warnings.push('raise: no helper window id')
		if (!String(ctx.promoteScript || '').trim()) warnings.push('raise: no ABOVE promoter — helper will be clamped under the kiosk')
		steps = planRaise(ctx)
	} else if (action === 'park') {
		if (!widString(ctx.helperWid)) warnings.push('park: no helper window id')
		if (!widString(ctx.kioskWid)) warnings.push('park: no kiosk window id to refocus — kiosk will not reclaim fullscreen')
		if (!widString(ctx.consumerWid)) warnings.push('park: no Caspar consumer id — lowering without a sibling reference')
		steps = planPark(ctx)
	} else if (action === 'launch') {
		// Launch is the spawn path (managed elsewhere); no restacking plan until the window maps.
		return { action, steps: [], complete: true, warnings: [] }
	} else {
		warnings.push(`unknown action "${action}"`)
	}
	const complete = steps.length > 0 && warnings.length === 0
	return { action, steps, complete, warnings }
}

module.exports = {
	PROMOTE_SCRIPT,
	PARK_SCRIPT,
	planRaise,
	planPark,
	planHelperWindowAction,
}
