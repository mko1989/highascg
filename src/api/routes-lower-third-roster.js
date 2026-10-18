'use strict'

/**
 * WO-601 (port fact 4) — POST /api/lower-thirds/roster/import { fileName, dataBase64 } → { ok, roster }.
 * Spreadsheet parsing moved to the server: Godot has no xlsx reader, Node has `exceljs`. Runs the web's own
 * client/lib/lower-third-roster-import.js (parseSpreadsheetFile: size cap 2 MB, .xlsx / .csv / .txt, 15 s parse
 * timeout; buildRosterFromParsed: guessed column mapping), so both clients produce the identical
 * `source.lowerThirdRoster`. Nothing is stored — the client patches the layer like any edit.
 */

const path = require('path')
const { pathToFileURL } = require('url')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { REPO_ROOT } = require('../repo-paths')

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

async function handleRosterImport(body) {
	const b = parseBody(body)
	const fileName = String(b.fileName || '').trim()
	if (!fileName || typeof b.dataBase64 !== 'string' || !b.dataBase64) return out(400, { ok: false, error: 'fileName and dataBase64 required' })
	const lib = await import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', 'lower-third-roster-import.js')).href)
	const buf = Buffer.from(b.dataBase64, 'base64')
	if (buf.byteLength > lib.ROSTER_MAX_BYTES) {
		return out(413, { ok: false, error: `Roster file too large (max ${Math.round(lib.ROSTER_MAX_BYTES / (1024 * 1024))} MB)` })
	}
	try {
		const { headers, rows } = await lib.parseSpreadsheetFile(new File([buf], path.basename(fileName)))
		if (!headers.length || !rows.length) return out(200, { ok: false, error: 'No data rows found' })
		return out(200, { ok: true, roster: lib.buildRosterFromParsed(path.basename(fileName), headers, rows) })
	} catch (e) {
		return out(200, { ok: false, error: String(e?.message || e) })
	}
}

module.exports = { handleRosterImport }
