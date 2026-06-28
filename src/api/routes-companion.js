'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { buildCompanionControlStatus } = require('./companion-control-status')
const routesCompanionPreview = require('./routes-companion-preview')

/**
 * Companion integration routes (hot-backup control plane + WO-75 preview).
 * @param {string} path
 * @param {object} ctx
 */
async function handleGet(path, ctx) {
	const preview = await routesCompanionPreview.handleGet(path, ctx)
	if (preview) return preview
	if (path === '/api/companion/control-status') {
		const status = buildCompanionControlStatus(ctx)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(status) }
	}
	return null
}

async function handlePost(path, body, ctx) {
	return routesCompanionPreview.handlePost(path, body, ctx)
}

module.exports = { handleGet, handlePost }
