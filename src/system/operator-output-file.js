'use strict'

/**
 * WO-1084 — tell the run.sh screen gate which screen is the operator's. The gate tool runs in the Caspar
 * supervisor with no config of its own, so node writes the answer to a small file
 * (src/utils/connector-state.js `operatorOutputFile`) whenever it settles it: node start, the boot answer
 * (WO-638/645 — it writes casparcg.config), every casparcg.config write (Apply, project load, switches) and a
 * hot-plug. No Caspar window may open on that screen.
 *
 * The name is derived exactly the way the client finds its own screen (GET /api/system/operator-screen): the
 * live output whose 1-based GPU port is the `screen_N_operator_monitor` flag (operator-monitor-picker.js
 * listPickerOutputs + operator-monitor-resolve.js resolveFlagPort). So the screen the GUI stands on is the screen
 * the gate keeps clear.
 */

/**
 * PURE. The operator's output name(s) from the picker rows and the flag port.
 * @param {Array<{ name: string, port: number|null }>} outputs
 * @param {number|null} flagPort
 * @returns {string[]}
 */
function operatorNamesFrom(outputs, flagPort) {
	if (flagPort == null) return []
	return (outputs || []).filter((o) => o && o.port === flagPort && o.name).map((o) => String(o.name))
}

/**
 * Resolve and write. Never throws; returns the names (or [] when unknown — the file is then left as it was, so a
 * passing X hiccup does not drop the protection).
 * @param {object} ctx
 * @param {{ listOutputs?: Function, resolveFlagPort?: Function, write?: Function }} [deps] injected offline
 */
function syncOperatorOutputFile(ctx, deps = {}) {
	try {
		const config = ctx?.configManager?.get ? ctx.configManager.get() : ctx?.config || {}
		const outputs = (deps.listOutputs || require('./operator-monitor-picker').listPickerOutputs)(config) || []
		const port = (deps.resolveFlagPort || require('../utils/operator-monitor-resolve').resolveFlagPort)(config)
		const names = operatorNamesFrom(outputs, port)
		if (!names.length) return []
		const write = deps.write || require('../utils/connector-state').writeOperatorNames
		if (write(names, undefined, { port })) ctx?.log?.('info', `[Screen gate] operator screen = ${names.join('+')} (port ${port})`)
		return names
	} catch (e) {
		ctx?.log?.('warn', `[Screen gate] operator screen not written: ${e?.message || e}`)
		return []
	}
}

module.exports = { operatorNamesFrom, syncOperatorOutputFile }
