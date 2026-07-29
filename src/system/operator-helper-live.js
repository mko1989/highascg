'use strict'

/**
 * WO-317 — LIVE integration: construct a helper coordinator wired to the real X subsystems, gated
 * behind `config.operatorTools.multiHelperTaskbar`.
 *
 * OFF BY DEFAULT, and deliberately so. When the flag is false (the shipped default), this module
 * returns null and NOTHING changes: the existing WO-283 single-helper path stays the sole authority
 * over the kiosk shape flag. Flipping the flag on makes the coordinator that authority instead —
 * which restacks windows on the live operator monitor, an effect that must be validated on the glass
 * with the owner watching. Two writers to setOperatorShapeHelperOpen would fight, so exactly one of
 * {WO-283 path, this coordinator} is ever active; the flag is the switch.
 *
 * The coordinator itself is pure/tested (operator-helper-coordinator.js). This file is only the
 * dependency wiring — resolve real window ids, bind the applier to the live X env, push the shape
 * flag, delegate launch to the existing spawn path. It has no offline test because every branch
 * needs a live X server; its pieces (applier.executePlan, the planner, the coordinator) are each
 * tested in isolation.
 */

const { createHelperCoordinator } = require('./operator-helper-coordinator')
const { planHelperWindowAction } = require('./operator-helper-window-plan')
const {
	executePlan,
	resolveKioskWid,
	resolveConsumerWid,
	resolveWindowBelowParker,
} = require('./operator-helper-applier')

const OPERATOR_TITLE_MARKER = 'HIGHASCG-OPERATOR-GUI'

/** @param {object} config @returns {boolean} */
function isMultiHelperTaskbarEnabled(config) {
	return config?.operatorTools?.multiHelperTaskbar === true
}

let _singleton = null

/**
 * Get (or lazily build) the live coordinator. Returns null when the feature flag is off — callers
 * (routes) must treat null as "feature disabled, fall back to the WO-283 single-helper path".
 * @param {object} ctx app context ({ config, log })
 * @returns {ReturnType<typeof createHelperCoordinator>|null}
 */
function getHelperCoordinator(ctx) {
	if (!isMultiHelperTaskbarEnabled(ctx?.config)) return null
	if (_singleton) return _singleton

	const log = (lvl, m) => {
		try {
			ctx.log?.(lvl, m)
		} catch {
			/* logging must never throw into the restack path */
		}
	}
	const xds = require('../utils/x-display-session')

	_singleton = createHelperCoordinator({
		setShapeHelperOpen: (open) => {
			const { setOperatorShapeHelperOpen } = require('./operator-shape-overlay')
			setOperatorShapeHelperOpen(open, { log })
		},
		applyPlan: (steps) => executePlan(steps, { env: xds.displaySessionEnv(), log }),
		planAction: planHelperWindowAction,
		resolveWindowContext: async (id, info) => {
			const action = info?.action || id
			const env = xds.displaySessionEnv()
			const ids = await xds.findGuiWindowIds(action, { excludeTitle: OPERATOR_TITLE_MARKER, includeHidden: true })
			const rectInfo = (() => {
				try {
					return xds.resolveHelperWindowRect(ctx.config)
				} catch {
					return { rect: null }
				}
			})()
			return {
				helperWid: Array.isArray(ids) ? ids[0] : null,
				kioskWid: await resolveKioskWid({ marker: OPERATOR_TITLE_MARKER, env }),
				consumerWid: await resolveConsumerWid({ env }),
				promoteScript: xds.resolveWindowAbovePromoter(),
				parkScript: resolveWindowBelowParker(),
				rect: rectInfo?.rect || null,
			}
		},
		launchHelper: async (id, info) => {
			// Delegate the actual spawn to the existing, live-proven path (positional signature).
			const { openOperatorHelperWindow, yieldOperatorHelperSession } = require('./operator-helper-window')
			const action = info?.action || id
			/* WO-387: that path owns ONE session and refuses `open_requested` while it is busy, which
			 * with the taskbar on meant the second window could never open (owner: "when i have zoom
			 * open ... i cant open anything else"). THIS coordinator is the multi-helper authority —
			 * its registry keeps the previous helper and the taskbar poll reaps it — so hand the
			 * single session to the newcomer instead of inheriting a refusal meant for a
			 * configuration where only one helper may exist. */
			yieldOperatorHelperSession(`taskbar launching ${action}`, log)
			const res = await openOperatorHelperWindow(action, ctx.config, { log })
			if (res && res.ok === false) throw new Error(res.reason || 'launch_refused')
			/* todos27.07.26: nothing ever called onHelperMapped, so taskbar helpers wedged in
			 * 'launching' forever (chips render disabled → "cant recall the browser"). Poll for
			 * the mapped window and tell the coordinator; give up = gone (chip disappears, a
			 * fresh click relaunches). */
			void (async () => {
				for (let i = 0; i < 40; i++) {
					await new Promise((r) => setTimeout(r, 500))
					if (!_singleton) return
					const h = _singleton._registry.helpers[id]
					if (!h) return
					if (h.state !== 'launching') return
					try {
						const ids = await xds.findGuiWindowIds(action, { excludeTitle: OPERATOR_TITLE_MARKER, includeHidden: true })
						if (Array.isArray(ids) && ids.length) {
							_singleton.onHelperMapped(id, ids[0])
							return
						}
					} catch {
						/* transient X error — keep polling */
					}
				}
				if (_singleton) _singleton.onHelperGone(id)
			})()
		},
		log,
	})
	log('info', '[Helper coord] multi-helper taskbar ENABLED — coordinator now owns the kiosk shape flag')
	return _singleton
}

/**
 * todos27.07.26: reconcile registry vs reality on every taskbar GET (the client polls at 1.5s —
 * this is the only signal that an 'open' helper's window was closed by the operator). Cheap:
 * one xdotool search per open helper.
 * @param {object} ctx
 */
async function reconcileHelperWindows(ctx) {
	const coord = getHelperCoordinator(ctx)
	if (!coord) return
	const xds = require('../utils/x-display-session')
	for (const h of coord.taskbar()) {
		if (h.state !== 'open') continue
		try {
			/* includeHidden: a minimized helper is still running — keep its chip (raising it
			 * de-iconifies via _NET_ACTIVE_WINDOW). */
			const ids = await xds.findGuiWindowIds(h.info?.action || h.id, { excludeTitle: OPERATOR_TITLE_MARKER, includeHidden: true })
			if (!Array.isArray(ids) || ids.length === 0) coord.onHelperGone(h.id)
		} catch {
			/* transient X error — do not reap on noise */
		}
	}
}

/**
 * todos27.07.26: the WO-283 restore path ("Back to GUI", crash restore) re-asserts the kiosk
 * over everything. If the multi-helper coordinator is active, its registry must reflect that —
 * every raised helper is now effectively parked — or chip toggles run backwards.
 */
function noteKioskRestored() {
	if (_singleton) _singleton.parkAllOpen()
}

/** Test/reset hook. */
function _resetHelperCoordinator() {
	_singleton = null
}

module.exports = {
	isMultiHelperTaskbarEnabled,
	getHelperCoordinator,
	reconcileHelperWindows,
	noteKioskRestored,
	OPERATOR_TITLE_MARKER,
	_resetHelperCoordinator,
}
