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
			const ids = await xds.findGuiWindowIds(action, { excludeTitle: OPERATOR_TITLE_MARKER })
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
			const { openOperatorHelperWindow } = require('./operator-helper-window')
			const res = await openOperatorHelperWindow(info?.action || id, ctx.config, { log })
			if (res && res.ok === false) throw new Error(res.reason || 'launch_refused')
		},
		log,
	})
	log('info', '[Helper coord] multi-helper taskbar ENABLED — coordinator now owns the kiosk shape flag')
	return _singleton
}

/** Test/reset hook. */
function _resetHelperCoordinator() {
	_singleton = null
}

module.exports = {
	isMultiHelperTaskbarEnabled,
	getHelperCoordinator,
	OPERATOR_TITLE_MARKER,
	_resetHelperCoordinator,
}
