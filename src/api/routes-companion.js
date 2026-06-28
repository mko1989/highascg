'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { buildCompanionControlStatus } = require('./companion-control-status')

/**
 * Companion integration routes (hot-backup control plane).
 * @param {string} path
 * @param {object} ctx
 */
function handleGet(path, ctx) {
	if (path === '/api/companion/control-status') {
		const status = buildCompanionControlStatus(ctx)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(status) }
	}
	return null
}

module.exports = { handleGet }
