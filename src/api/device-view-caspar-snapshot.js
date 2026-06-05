'use strict'

const { buildChannelMap } = require('../config/channel-map-from-ctx')

/**
 * Lightweight Caspar connection/channel snapshot for Device View (`live.caspar`).
 * @param {object} ctx
 */
function casparSnapshot(ctx) {
	const conn = ctx._casparStatus
	const connected =
		conn && typeof conn.connected === 'boolean'
			? conn.connected
			: !!(ctx.amcp && ctx.amcp.connected)
	return {
		connected,
		host: ctx.config?.caspar?.host,
		port: ctx.config?.caspar?.port,
		channelMap: buildChannelMap(ctx),
	}
}

module.exports = { casparSnapshot }
