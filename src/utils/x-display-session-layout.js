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
	nvidiaSyncToDisplayMode,
	nvidiaSyncAutoPortIndex,
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
	nvidiaSyncToDisplayMode,
	nvidiaSyncAutoPortIndex,
	resolveLayoutRectForOperatorPort,
	resolveOperatorMonitorRect,
	resolveOperatorDisplayRect,
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
