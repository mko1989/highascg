'use strict'

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024

function readMaxBodyBytes() {
	const raw = process.env.HIGHASCG_MAX_BODY_BYTES
	if (raw == null || raw === '') return DEFAULT_MAX_BODY_BYTES
	const n = parseInt(String(raw), 10)
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BODY_BYTES
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {number} [maxBytes]
 * @returns {Promise<string>}
 */
async function readRequestBody(req, maxBytes = readMaxBodyBytes()) {
	/** @type {Buffer[]} */
	const chunks = []
	let total = 0
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		total += buf.length
		if (total > maxBytes) {
			const err = new Error(`Request body exceeds ${maxBytes} bytes`)
			err.code = 'BODY_TOO_LARGE'
			throw err
		}
		chunks.push(buf)
	}
	if (chunks.length === 0) return ''
	return Buffer.concat(chunks).toString('utf8')
}

module.exports = { readRequestBody, readMaxBodyBytes, DEFAULT_MAX_BODY_BYTES }
