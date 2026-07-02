'use strict'

const os = require('os')

/**
 * Stable machine id for per-host private volume paths on USB/bridge sticks.
 * Prefer replication.selfId, then config.general.machineId, then hostname.
 * @param {object} [ctx]
 * @returns {string}
 */
function getMachineId(ctx) {
	try {
		const { getHardwareIdentity } = require('../system/hardware-identity')
		const hw = getHardwareIdentity({ networkCfg: ctx?.config?.network })
		if (hw?.hostname) return sanitizeMachineId(hw.hostname)
	} catch {
		/* optional */
	}
	const cfg = ctx?.config || ctx?.configManager?.get?.() || {}
	const repl = cfg.replication?.selfId
	if (repl && String(repl).trim()) return sanitizeMachineId(String(repl).trim())
	const general = cfg.general?.machineId
	if (general && String(general).trim()) return sanitizeMachineId(String(general).trim())
	return sanitizeMachineId(os.hostname() || 'playout')
}

/**
 * @param {string} raw
 * @returns {string}
 */
function sanitizeMachineId(raw) {
	return String(raw || 'playout')
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'playout'
}

module.exports = { getMachineId, sanitizeMachineId }
