'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { runPrivateVolumeSync, getPrivateSyncDashboard } = require('../system/private-volume-sync')

async function handleGet(path, ctx) {
	if (path !== '/api/system/private-sync') return null
	const dash = await getPrivateSyncDashboard(ctx)
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(dash) }
}

async function handlePost(path, body, ctx) {
	if (path !== '/api/system/private-sync/run') return null
	let payload
	try {
		payload = typeof body === 'string' ? parseBody(body) : body || {}
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
	}
	const dryRun = !!payload.dryRun
	const pushOnly = !!payload.pushOnly
	if (!dryRun && String(payload.confirm || '').trim() !== 'PRIVATE_SYNC') {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'Use dryRun: true to preview, or pass confirm: PRIVATE_SYNC for a real sync.',
			}),
		}
	}
	const logFn = (lvl, msg) => {
		if (typeof ctx.log === 'function') ctx.log(lvl || 'info', msg)
	}
	const out = await runPrivateVolumeSync({ ctx, dryRun, pushOnly, log: logFn })
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: out.ok, dryRun, ...out }) }
}

module.exports = { handleGet, handlePost }
