/**
 * POST /api/config/apply — trigger generated Caspar config deploy + restart (Companion parity).
 * Wire `ctx.applyServerConfigAndRestart` from app integration (**T10**).
 * @see companion-module-casparcg-server/src/api-routes.js handleConfigApply
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/**
 * @param {string} path
 * @param {string} body
 * @param {{ applyServerConfigAndRestart?: () => void }} ctx
 */
async function handleConfigApply(body, ctx) {
	const b = parseBody(body)
	if (!b.apply) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'apply=true required' }) }
	}
	if (typeof ctx.applyServerConfigAndRestart !== 'function') {
		return {
			status: 501,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Config apply hook not configured (set ctx.applyServerConfigAndRestart)' }),
		}
	}
	ctx.applyServerConfigAndRestart()
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, message: 'Config apply initiated' }),
	}
}

async function handlePost(path, body, ctx) {
	if (path !== '/api/config/apply') return null
	return handleConfigApply(body, ctx)
}

module.exports = { handlePost, handleConfigApply }
