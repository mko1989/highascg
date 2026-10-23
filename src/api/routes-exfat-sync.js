/**
 * WO-47: exFAT sync map status (view configured folders) + optional dry-run / run.
 * WO-697: GET /api/system/stick, POST /api/system/stick/save | /load — save to / load from a stick by hand.
 */
'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getExfatSyncDashboard, runExfatSync } = require('../system/exfat-sync')
const { stickStatus, saveToStick, loadFromStick } = require('../system/stick-transfer')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

async function handleGet(path, ctx) {
	if (path === '/api/system/stick') return reply(200, stickStatus())
	if (path !== '/api/system/exfat-sync') return null
	const dash = await getExfatSyncDashboard()
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(dash) }
}

async function handlePost(path, body, ctx) {
	if (path !== '/api/system/exfat-sync/run') return null
	let payload
	try {
		payload = typeof body === 'string' ? parseBody(body) : body || {}
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
	}
	const dryRun = !!payload.dryRun
	if (!dryRun && String(payload.confirm || '').trim() !== 'EXFAT_SYNC') {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'Use dryRun: true to preview, or pass confirm: EXFAT_SYNC for a real mtime sync (overwrites older files).',
			}),
		}
	}
	const logFn = (lvl, msg) => {
		if (typeof ctx.log === 'function') ctx.log(lvl || 'info', msg)
	}
	const out = await runExfatSync({ dryRun, log: logFn })
	const benign =
		!out.errors?.length ||
		(out.errors.length === 1 &&
			/not a mount point|no valid exfat-sync map|no exfat sync map\b/i.test(String(out.errors[0])))
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: benign, dryRun, ...out }) }
}

async function handleStickPost(path, body, ctx) {
	let payload
	try {
		payload = typeof body === 'string' ? parseBody(body) : body || {}
	} catch {
		return reply(400, { error: 'Invalid JSON' })
	}
	const log = (lvl, msg) => {
		if (typeof ctx.log === 'function') ctx.log(lvl || 'info', msg)
	}
	const out =
		path === '/api/system/stick/save'
			? await saveToStick({ log, settings: payload.settings !== false })
			: loadFromStick(payload.slug, { log })
	return reply(out.error ? 400 : 200, out)
}

module.exports = {
	handleGet,
	handlePost,
	handleStickPost,
}
