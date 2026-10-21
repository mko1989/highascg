'use strict'

/**
 * WO-628 — the operator dock (src/system/operator-dock.js).
 *   GET  /api/system/dock         — { pinned: [{ action, name }], apps: [{ action, name, comment }], running: [action] }
 *   POST /api/system/dock/launch  — { action, password? }: launch, or focus the running window. Same nuclear-password
 *                                   gate as POST /api/system/gui-launch (an installed app can be a terminal).
 * Icons: GET /api/system/operator-helper-icon?action=… (WO-387).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getDock, launchOrFocus } = require('../system/operator-dock')
const { checkNuclearPassword } = require('./routes-system-setup')

async function handleGet(deps) {
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(await getDock(deps)) }
}

async function handleLaunch(body, ctx) {
	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok)
		return {
			status: pw.status || 403,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: pw.error, passwordRequired: true }),
		}
	const r = await launchOrFocus(parseBody(body)?.action, ctx)
	return { status: r.status, headers: JSON_HEADERS, body: jsonBody(r.body) }
}

module.exports = { handleGet, handleLaunch }
