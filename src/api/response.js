'use strict'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

function jsonBody(o) {
	return JSON.stringify(o)
}

function parseBody(body) {
	if (body == null) return {}
	if (typeof body === 'object' && !Buffer.isBuffer(body)) return body
	try {
		const s = Buffer.isBuffer(body) ? body.toString('utf8') : String(body)
		return JSON.parse(s || '{}')
	} catch {
		return {}
	}
}

/**
 * Strict JSON parse for routes that should return 400 on malformed bodies (WO-101).
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
function parseBodyStrict(body) {
	if (body == null || body === '') return { ok: true, value: {} }
	if (typeof body === 'object' && !Buffer.isBuffer(body)) return { ok: true, value: body }
	try {
		const s = Buffer.isBuffer(body) ? body.toString('utf8') : String(body)
		if (!String(s).trim()) return { ok: true, value: {} }
		return { ok: true, value: JSON.parse(s) }
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
}

function parseQueryString(qs) {
	const o = {}
	if (!qs || typeof qs !== 'string') return o
	for (const part of qs.split('&')) {
		const eq = part.indexOf('=')
		const k = eq >= 0 ? part.slice(0, eq) : part
		const v = eq >= 0 ? part.slice(eq + 1) : ''
		if (k) {
			try {
				o[decodeURIComponent(k)] = decodeURIComponent(v)
			} catch {
				o[k] = v
			}
		}
	}
	return o
}

module.exports = { JSON_HEADERS, jsonBody, parseBody, parseBodyStrict, parseQueryString }
