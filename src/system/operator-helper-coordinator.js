'use strict'

/**
 * WO-317 — coordinator: the stateful glue between the pure registry, the pure planner, the
 * side-effecting applier, and the shape overlay's kiosk-top-assert flag.
 *
 * This is where the multi-window taskbar behaviour actually lives, but every side effect is
 * injected, so the whole decision/ordering logic is offline-testable:
 *   - setShapeHelperOpen(bool)  — drives operator-shape-overlay.setOperatorShapeHelperOpen
 *   - applyPlan(steps)          — operator-helper-applier.executePlan bound to the live X env
 *   - resolveWindowContext(id)  — resolves helperWid/kioskWid/consumerWid/scripts/rect for a helper
 *   - planAction(decision, ctx) — operator-helper-window-plan.planHelperWindowAction
 *
 * THE LOAD-BEARING INVARIANT (the reason this replaces WO-283's boolean): the shape overlay flag is
 * recomputed from `shouldSuspendKioskTopAssert(registry)` after EVERY registry mutation — open,
 * mapped, parked, raised, gone. So:
 *   - opening a second helper keeps the flag suspended (both unparked) — no flip-flop;
 *   - parking the last raised helper RESUMES the kiosk top-assert (holes clean again) even though a
 *     helper is still running;
 *   - a helper that CRASHES WHILE PARKED cannot wedge the flag true — markHelperGone recomputes and,
 *     since a parked helper contributed nothing, the flag is unchanged; a helper that crashes while
 *     RAISED correctly resumes the kiosk. This is the WO-283 restore-on-crash property, per-helper.
 */

const {
	createHelperRegistry,
	registerHelper,
	markHelperMapped,
	markHelperGone,
	setHelperParked,
	listHelpers,
	shouldSuspendKioskTopAssert,
	decideRaise,
} = require('./operator-helper-registry')

/**
 * @param {{
 *   setShapeHelperOpen: (open: boolean) => void,
 *   applyPlan: (steps: object[]) => Promise<{ ok: boolean, failed: string|null }>,
 *   resolveWindowContext: (id: string, info: object) => Promise<object>,
 *   planAction: (decision: object, ctx: object) => { action: string, steps: object[], complete: boolean, warnings: string[] },
 *   launchHelper?: (id: string, info: object) => Promise<void>,
 *   log?: (level: string, msg: string) => void,
 * }} deps
 */
function createHelperCoordinator(deps) {
	const log = deps.log || (() => {})
	const reg = createHelperRegistry()
	let lastFlag = false

	/** Recompute the shape flag from the refcount; only push it when it actually changes. */
	function syncShapeFlag() {
		const next = shouldSuspendKioskTopAssert(reg)
		if (next === lastFlag) return
		lastFlag = next
		try {
			deps.setShapeHelperOpen(next)
		} catch (e) {
			log('warn', `[Helper coord] shape flag push failed: ${e?.message || e}`)
		}
	}

	/**
	 * The operator asked to open/toggle a helper (taskbar click, or an open request). Runs the
	 * decide → resolve → plan → apply → update pipeline.
	 * @param {string} id
	 * @param {object} [info]
	 * @returns {Promise<{ action: string, ok: boolean, warnings: string[], reason?: string }>}
	 */
	async function handleAction(id, info = {}) {
		const decision = decideRaise(reg, id)
		if (decision.action === 'launch') {
			registerHelper(reg, id, info)
			syncShapeFlag() // 'launching' does not suspend yet — but register before any await
			if (deps.launchHelper) {
				try {
					await deps.launchHelper(id, info)
				} catch (e) {
					markHelperGone(reg, id)
					syncShapeFlag()
					return { action: 'launch', ok: false, warnings: [`launch failed: ${e?.message || e}`] }
				}
			}
			return { action: 'launch', ok: true, warnings: [], reason: decision.reason }
		}

		// raise or park: resolve the live window context, plan, apply.
		const ctx = await deps.resolveWindowContext(id, reg.helpers[id]?.info || info)
		const plan = deps.planAction(decision, ctx)
		for (const w of plan.warnings) log('warn', `[Helper coord] ${decision.action} ${id}: ${w}`)
		const res = await deps.applyPlan(plan.steps)
		if (res.ok) {
			// Reflect the new stacking in the registry so the refcount + next toggle are correct.
			setHelperParked(reg, id, decision.action === 'park')
		} else {
			log('warn', `[Helper coord] ${decision.action} ${id} did not fully apply (failed at ${res.failed})`)
		}
		syncShapeFlag()
		return { action: decision.action, ok: res.ok, warnings: plan.warnings, reason: decision.reason }
	}

	return {
		/** The watchdog mapped a helper's window. */
		onHelperMapped(id, windowId) {
			markHelperMapped(reg, id, windowId)
			syncShapeFlag()
		},
		/** The watchdog saw a helper vanish (closed or crashed). */
		onHelperGone(id) {
			markHelperGone(reg, id)
			syncShapeFlag()
		},
		handleAction,
		/** Taskbar model. */
		taskbar() {
			return listHelpers(reg)
		},
		/** todos27.07.26: the WO-283 "Back to GUI" restore re-asserts the kiosk over EVERYTHING —
		 * reflect that here or the next chip click toggles the wrong way ('park' on an already
		 * hidden helper). Marks every unparked open helper parked and recomputes the flag. */
		parkAllOpen() {
			for (const h of Object.values(reg.helpers)) {
				if (h.state === 'open' && !h.parked) h.parked = true
			}
			syncShapeFlag()
		},
		/** Test/inspection hooks. */
		_registry: reg,
		_shapeFlag: () => lastFlag,
	}
}

module.exports = { createHelperCoordinator }
