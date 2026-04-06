/**
 * Staged Caspar startup: arm file + HTTP control (works without AMCP).
 * GET/POST/DELETE /api/system/caspar-arm
 *
 * Env: CASPAR_ARM_FILE (default /opt/casparcg/data/caspar-armed)
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody } = require('./response')

function getArmPath() {
	return process.env.CASPAR_ARM_FILE || process.env.CASPAR_READY_FILE || '/opt/casparcg/data/caspar-armed'
}

/**
 * @param {string} method
 * @param {string} p
 * @returns {{ status: number, headers: Record<string, string>, body: string } | null}
 */
function handle(method, p) {
	if (p !== '/api/system/caspar-arm') return null
	const armPath = getArmPath()

	if (method === 'GET') {
		let armed = false
		try {
			armed = fs.existsSync(armPath)
		} catch {
			armed = false
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ armed, path: armPath }),
		}
	}

	if (method === 'POST') {
		try {
			fs.mkdirSync(path.dirname(armPath), { recursive: true })
			fs.writeFileSync(armPath, `${new Date().toISOString()}\n`, 'utf8')
		} catch (e) {
			const msg = e?.message || String(e)
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, armed: true, path: armPath }),
		}
	}

	if (method === 'DELETE') {
		try {
			if (fs.existsSync(armPath)) fs.unlinkSync(armPath)
		} catch (e) {
			const msg = e?.message || String(e)
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, armed: false, path: armPath }),
		}
	}

	return null
}

module.exports = {
	handle,
	getArmPath,
}
