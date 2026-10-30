/**
 * POST /api/config/reset — factory reset hook.
 * WO-831: POST /api/config/apply (Companion parity, needed `ctx.applyServerConfigAndRestart`) was removed —
 * nothing ever defined that hook, so every call answered 501.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

async function handleConfigReset(body, ctx) {
	const b = parseBody(body)
	if (!b.reset) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'reset=true required' }) }
	}
	if (typeof ctx.resetConfigToDefaults !== 'function') {
		return {
			status: 501,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Reset hook not configured' }),
		}
	}
	ctx.resetConfigToDefaults()
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, message: 'System reset to factory defaults. Please refresh.' }),
	}
}

async function handlePost(path, body, ctx) {
	if (path === '/api/config/reset') return handleConfigReset(body, ctx)
	return null
}

module.exports = { handlePost }
