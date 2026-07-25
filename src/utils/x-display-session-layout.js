'use strict'

const { calculateLayoutPositions } = require('./os-layout-calculator')
const {
	readCasparSetting,
	screenConsumerEnabled,
	multiviewScreenConsumerEnabled,
	screenInteractiveEnabled,
	multiviewPhysicalPortIndex,
	multiviewInteractiveEnabled,
	operatorMonitorPortIndex,
	nvidiaSyncToDisplayPortIndex,
	resolveLayoutRectForOperatorPort,
	evaluateOperatorPointerConfineDesire,
	isOperatorPointerConfineDesired,
	resolveOperatorMonitorRect,
	resolveOperatorDisplayRect,
} = require('./x-display-session-layout-resolve')

/**
 * @typedef {{ x: number, y: number, width: number, height: number, sysId: string|null, kind: 'multiview'|'screen', index: number, interactive: boolean }} OperatorDisplayRect
 */

/**
 * PURE. Half-open rectangle overlap test — the same convention as {@link pointerInRect}, so a
 * window whose right edge exactly meets a consumer's left edge does NOT count as covering it.
 * @param {{x:number,y:number,width:number,height:number}} a
 * @param {{x:number,y:number,width:number,height:number}} b
 * @returns {boolean}
 */
function rectsIntersect(a, b) {
	if (!a || !b) return false
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * PURE. Every PGM (program) screen-consumer rect — the heads an operator helper window must never
 * cover, because they are on air.
 *
 * Excluded on purpose:
 *  - the multiview head (`multiviewPhysicalPortIndex`) — that is the operator's own screen, and the
 *    Caspar consumer sitting there is the operator_gui one that operator-shape-overlay.py already
 *    pins BELOW the kiosk and makes input-dead. It is not program output.
 *  - the resolved operator monitor head, for the same reason.
 *
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {{x:number,y:number,width:number,height:number,sysId:string|null,index:number}[]}
 */
function listProgramConsumerRects(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	const operator = resolveOperatorMonitorRect(config, plan)
	const mvPort = multiviewPhysicalPortIndex(config)
	/** @type {{x:number,y:number,width:number,height:number,sysId:string|null,index:number}[]} */
	const out = []
	for (let n = 1; n <= 8; n++) {
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n)) continue
		if (mvPort && n === mvPort) continue
		if (operator && operator.kind === 'screen' && operator.index === n) continue
		out.push({
			x: sc.x,
			y: sc.y,
			width: sc.width,
			height: sc.height,
			sysId: sc.sysId ? String(sc.sysId) : null,
			index: n,
		})
	}
	return out
}

/** Fraction of the operator monitor left as a margin on each edge when placing a helper window. */
const HELPER_WINDOW_INSET = 0.05

/**
 * PURE. Where an operator helper window (browser, file manager, nvidia-settings…) is allowed to be.
 *
 * WHY THIS EXISTS (the 2026-07-19 regression). Two changes landed the same day: WO-283 promotes the
 * helper into the EWMH ABOVE layer and focuses it (the only way to get over the permanently-ABOVE
 * kiosk), and PGM screen consumers began defaulting to always-on-top — i.e. the SAME layer. Stacking
 * alone therefore can no longer keep a helper off program output, and the old placement made it
 * worse: it positioned helpers with `resolveOperatorDisplayRect()`, whose documented fallback is
 * "multiview when enabled, ELSE THE FIRST PGM SCREEN CONSUMER HEAD" — so on a box with no operator
 * monitor configured it actively moved the helper onto PGM, and with no `windowsize` a window wider
 * than the operator head spilled onto PGM anyway.
 *
 * The fix is geometric, not stacking-based: pin the helper INSIDE the operator monitor rect, sized
 * to fit, so it physically cannot overlap a program head. `resolveOperatorMonitorRect` is the SSOT
 * the kiosk launcher (operator-gui-launcher.js) and the pointer confinement (pointer-confine.js)
 * already use — this is the same function, not a second opinion about "which screen".
 *
 * Returns `ok:false` rather than a guessed rect when there is no configured operator monitor: the
 * caller must then leave the window where the app put it and say so, because moving it on a guess is
 * exactly what put a browser over PGM.
 *
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @returns {{ ok: boolean, rect: {x:number,y:number,width:number,height:number}|null, reason: string,
 *            monitor: OperatorDisplayRect|null,
 *            programRects: ReturnType<typeof listProgramConsumerRects>}}
 */
function resolveHelperWindowRect(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	const programRects = listProgramConsumerRects(config, plan)
	const monitor = resolveOperatorMonitorRect(config, plan)
	if (!monitor || !(monitor.width > 0) || !(monitor.height > 0)) {
		return { ok: false, rect: null, reason: 'no_operator_monitor', monitor: null, programRects }
	}
	const insetX = Math.max(0, Math.floor(monitor.width * HELPER_WINDOW_INSET))
	const insetY = Math.max(0, Math.floor(monitor.height * HELPER_WINDOW_INSET))
	const rect = {
		x: monitor.x + insetX,
		y: monitor.y + insetY,
		// Sized, not just moved: an un-resized window wider than the operator head spills onto the
		// neighbouring output, which on this box is the program head.
		width: Math.max(1, monitor.width - insetX * 2),
		height: Math.max(1, monitor.height - insetY * 2),
	}
	// Belt and braces: if the operator monitor itself overlaps a program consumer (a genuinely
	// mis-wired layout), refuse to place rather than move a window onto air.
	const clash = programRects.find((p) => rectsIntersect(rect, p))
	if (clash) {
		return { ok: false, rect: null, reason: `overlaps_program_consumer_${clash.index}`, monitor, programRects }
	}
	return { ok: true, rect, reason: 'operator_monitor', monitor, programRects }
}

/**
 * @param {OperatorDisplayRect|null} rect
 * @returns {string}
 */
function formatOperatorDisplaySummary(rect) {
	if (!rect) return 'No operator monitor configured (Device View → GPU port → Operator monitor).'
	const port = rect.sysId || '(unknown port)'
	const role =
		rect.kind === 'multiview' ? `multiview ${rect.index}` : `screen consumer ${rect.index}`
	const interactive = rect.interactive ? ' · interactive (Caspar mouse input)' : ''
	return `Operator monitor: ${port} — ${role} @ ${rect.x},${rect.y} ${rect.width}×${rect.height}${interactive}`
}

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function pointerInRect(x, y, rect) {
	return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

/**
 * Allowed pointer zones when confine is on: operator monitor + any interactive Caspar consumer.
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} layout
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function pointerInConfineAllowance(config, layout, x, y) {
	const operator = resolveOperatorMonitorRect(config, layout)
	if (operator && pointerInRect(x, y, operator)) return true
	return pointerOverInteractiveConsumer(config, layout, x, y)
}

/**
 * @param {object} config
 * @param {ReturnType<typeof calculateLayoutPositions>} [layout]
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function pointerOverInteractiveConsumer(config, layout, x, y) {
	const plan = layout || calculateLayoutPositions(config)
	for (let n = 1; n <= 8; n++) {
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n) || !screenInteractiveEnabled(config, n)) continue
		const mvPort = multiviewPhysicalPortIndex(config)
		if (mvPort && n === mvPort) continue
		if (x >= sc.x && x < sc.x + sc.width && y >= sc.y && y < sc.y + sc.height) return true
	}
	const mv = plan?.multiview?.[1]
	if (
		multiviewScreenConsumerEnabled(config) &&
		multiviewInteractiveEnabled(config) &&
		mv &&
		mv.width > 0 &&
		mv.height > 0 &&
		x >= mv.x &&
		x < mv.x + mv.width &&
		y >= mv.y &&
		y < mv.y + mv.height
	) {
		return true
	}
	return false
}
function listInteractiveConsumerSummaries(config, layout) {
	const plan = layout || calculateLayoutPositions(config)
	/** @type {string[]} */
	const out = []
	const mvPort = multiviewPhysicalPortIndex(config)
	const mv = plan?.multiview?.[1]
	if (multiviewScreenConsumerEnabled(config) && mv && mv.width > 0 && multiviewInteractiveEnabled(config)) {
		out.push(`${mv.sysId || '?'} multiview`)
	}
	for (let n = 1; n <= 8; n++) {
		const sc = plan?.screens?.[n]
		if (!sc || sc.width <= 0 || sc.height <= 0) continue
		if (!screenConsumerEnabled(config, n) || !screenInteractiveEnabled(config, n)) continue
		// Skip legacy mis-filed port key (interactive on multiview jack stored as screen_${port}_interactive).
		if (mvPort && n === mvPort) continue
		out.push(`${sc.sysId || '?'} screen ${n}`)
	}
	return out
}

/**
 * @param {object} config
 * @param {{ layout?: object }} [opts]
 * @returns {object}
 */
function describeOperatorDisplay(config, opts = {}) {
	const layout = opts.layout || calculateLayoutPositions(config)
	const monitorRect = resolveOperatorMonitorRect(config, layout)
	const guiRect = resolveOperatorDisplayRect(config, layout)
	const interactiveAllowance = listInteractiveConsumerSummaries(config, layout)
	return {
		rect: monitorRect,
		guiRect,
		summary: formatOperatorDisplaySummary(monitorRect),
		guiSummary: guiRect ? formatOperatorDisplaySummary(guiRect).replace('Operator monitor:', 'GUI tools target:') : null,
		interactiveAllowance,
		confineDesired: isOperatorPointerConfineDesired(config),
	}
}

module.exports = {
	readCasparSetting,
	operatorMonitorPortIndex,
	nvidiaSyncToDisplayPortIndex,
	resolveLayoutRectForOperatorPort,
	resolveOperatorMonitorRect,
	resolveOperatorDisplayRect,
	// WO-283 follow-up: helper windows are placed inside the operator monitor so they cannot cover a
	// PGM head now that both they and the PGM consumers live in the EWMH ABOVE layer.
	rectsIntersect,
	listProgramConsumerRects,
	resolveHelperWindowRect,
	HELPER_WINDOW_INSET,
	isOperatorPointerConfineDesired,
	evaluateOperatorPointerConfineDesire,
	formatOperatorDisplaySummary,
	describeOperatorDisplay,
	pointerOverInteractiveConsumer,
	pointerInConfineAllowance,
	// WO-290: the operator-monitor picker hit-tests the click against the connected outputs with
	// the SAME half-open rect test the confinement uses — no second opinion about "which screen".
	pointerInRect,
	screenConsumerEnabled,
	screenInteractiveEnabled,
	multiviewScreenConsumerEnabled,
	multiviewInteractiveEnabled,
	multiviewPhysicalPortIndex,
}
