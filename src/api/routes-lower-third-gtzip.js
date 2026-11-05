/**
 * WO-951 — POST /api/lower-thirds/import-gtzip { name, data: base64 }: a NewTek LiveGraphics-style .gtzip becomes a
 * CG Studio lower third (template/studio/lt-<name>.html + assets/lt-<name>/), listed with the studio exports.
 * Answers { ok, id, casparPath, fields: { title, subtitle }, warnings[] } — what did not import is said, not hidden.
 */
'use strict'

const path = require('path')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

const STUDIO_DIR = path.join(__dirname, '..', '..', 'template', 'studio')
const MAX_BYTES = 7 * 1024 * 1024 // the base64 body stays under the server's 10 MB request limit

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

/**
 * @param {unknown} body
 * @param {object} _ctx
 * @param {{ studioDir?: string }} [deps] tests: where to write
 */
async function handleImport(body, _ctx, deps = {}) {
	const b = parseBody(body) || {}
	const name = String(b.name || '').trim()
	const data = typeof b.data === 'string' ? b.data.replace(/^data:[^,]*,/, '') : ''
	if (!name || !data) return reply(400, { ok: false, error: 'name and data (base64 of the .gtzip) are required' })
	const buf = Buffer.from(data, 'base64')
	if (!buf.length) return reply(400, { ok: false, error: 'data is not base64' })
	if (buf.length > MAX_BYTES)
		return reply(413, { ok: false, error: `the .gtzip is ${Math.round(buf.length / 1048576)} MB — at most 7 MB` })
	try {
		const { importGtzip } = require('../cg-studio/gtzip-import')
		return reply(200, await importGtzip(buf, { name, studioDir: deps.studioDir || STUDIO_DIR }))
	} catch (e) {
		return reply(422, { ok: false, error: `could not import ${name}: ${e?.message || e}` })
	}
}

module.exports = { handleImport, MAX_BYTES }
