'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')
const {
	getVersionInfo,
	checkForUpdate,
	startApplyJob,
	getApplyStatus,
} = require('../system/server-update')

async function handleGet(path, ctx, query) {
	if (path === '/api/system/version') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody(getVersionInfo()),
		}
	}
	if (path === '/api/system/update/check') {
		const force = String(query?.force || '') === '1' || String(query?.force || '').toLowerCase() === 'true'
		const data = await checkForUpdate({ force })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
	}
	if (path === '/api/system/update/status') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(getApplyStatus()) }
	}
	return null
}

async function handlePost(path, body, ctx) {
	if (path !== '/api/system/update/apply') return null

	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) {
		return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }
	}

	let payload
	try {
		payload = parseBody(body)
	} catch {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
	}

	if (!payload.confirm) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Pass confirm: true to install the latest server release.' }),
		}
	}

	try {
		const started = await startApplyJob({
			releaseTag: payload.releaseTag,
			assetUrl: payload.assetUrl,
			assetName: payload.assetName,
		})
		return { status: 202, headers: JSON_HEADERS, body: jsonBody({ ok: true, ...started }) }
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return { status: 409, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

module.exports = { handleGet, handlePost }
