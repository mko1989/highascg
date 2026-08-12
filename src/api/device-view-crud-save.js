/**
 * Shared config-save helper for the Device View CRUD handlers.
 *
 * Its own module (WO-496) so `device-view-crud-mapping.js` can use the identical persistence path —
 * including the replication hook — without either CRUD file requiring the other.
 */
'use strict'

/**
 * @param {object} ctx
 * @param {Record<string, unknown>} patch
 */
function saveConfig(ctx, patch) {
	if (!ctx.configManager) {
		if (typeof ctx.log === 'function') ctx.log('warn', '[device-view] configManager missing; graph/destination changes are not persisted to disk')
		Object.assign(ctx.config, patch)
	} else {
		ctx.configManager.save({ ...ctx.configManager.get(), ...patch })
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
	}
	try {
		const { onDeviceConfigSaved } = require('../replication/follower-machine-profile')
		onDeviceConfigSaved(ctx, patch)
	} catch {
		/* optional */
	}
	return true
}

module.exports = { saveConfig }
