/**
 * HTTP: tail HighAsCG in-memory log buffer + Caspar log file on disk.
 * Env: `CASPAR_LOG_PATH` overrides default. Otherwise: `/opt/casparcg/log/caspar_YYYY-MM-DD.log` (local date).
 */

'use strict'

const fs = require('fs')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const logBuffer = require('../utils/log-buffer')

/**
 * @param {string} filePath
 * @param {number} maxLines
 * @param {number} maxBytes
 * @returns {string[]}
 */
function tailFileLines(filePath, maxLines, maxBytes) {
	try {
		if (!fs.existsSync(filePath)) {
			return [`(file not found: ${filePath})`]
		}
		const stat = fs.statSync(filePath)
		const size = stat.size
		if (size === 0) return ['(empty file)']
		const fd = fs.openSync(filePath, 'r')
		try {
			const readLen = Math.min(size, maxBytes)
			const start = size - readLen
			const buf = Buffer.alloc(readLen)
			fs.readSync(fd, buf, 0, readLen, start)
			let text = buf.toString('utf8')
			const lines = text.split(/\r?\n/)
			if (start > 0 && lines.length > 0) lines.shift()
			if (lines.length > maxLines) return lines.slice(-maxLines)
			return lines
		} finally {
			fs.closeSync(fd)
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		return [`(error reading log file: ${msg})`]
	}
}

function resolveCasparLogPath() {
	const env = String(process.env.CASPAR_LOG_PATH || '').trim()
	if (env) return env
	const d = new Date()
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `/opt/casparcg/log/caspar_${y}-${m}-${day}.log`
}

/**
 * @param {string} p
 * @param {Record<string, string>} [query]
 */
function handleGet(p, query = {}) {
	if (p !== '/api/logs') return null
	const lines = Math.min(3000, Math.max(50, parseInt(String(query.lines || '600'), 10) || 600))
	const maxBytes = Math.min(4 * 1024 * 1024, Math.max(65536, parseInt(String(query.maxBytes || '393216'), 10) || 393216))
	const wantHigh = query.highascg !== '0' && query.highascg !== 'false'
	const wantCaspar = query.caspar !== '0' && query.caspar !== 'false'
	const casparPath = resolveCasparLogPath()
	const out = {
		highascg: wantHigh ? logBuffer.getHighasLines(lines) : [],
		caspar: wantCaspar ? tailFileLines(casparPath, lines, maxBytes) : [],
		casparPath: wantCaspar ? casparPath : null,
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(out) }
}

/**
 * @param {string} p
 * @param {string} body
 */
function handlePost(p, body) {
	if (p !== '/api/logs/clear') return null
	const b = parseBody(body) || {}
	const target = b.target || 'highascg'
	if (target === 'highascg' || target === 'both') logBuffer.clearHighasLines()
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, cleared: target }),
	}
}

module.exports = { handleGet, handlePost, resolveCasparLogPath, tailFileLines }
