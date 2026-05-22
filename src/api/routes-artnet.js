'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')

/**
 * GET /api/artnet/input — resolved Art-Net listen target (for client debugging).
 */
function handleGetArtnetInput(ctx) {
	const rx = ctx.artnetReceiver
	if (!rx || typeof rx.getInputStatus !== 'function') {
		return {
			status: 503,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Art-Net receiver not initialized' }),
		}
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody(rx.getInputStatus()),
	}
}

module.exports = { handleGetArtnetInput }
