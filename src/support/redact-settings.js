'use strict'

const SENSITIVE_KEY_RE = /(token|password|secret|apikey|api_key|auth|privatekey|private_key|tailscale)/i

function listRedactedKeyPatterns() {
	return [
		'token',
		'password',
		'secret',
		'apikey',
		'api_key',
		'auth',
		'privatekey',
		'private_key',
		'tailscale',
	]
}

/**
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
function redactValue(value, key = '') {
	if (value == null) return value
	if (SENSITIVE_KEY_RE.test(key)) return '[REDACTED]'
	if (typeof value === 'string') {
		if (value.length > 4096) return value.slice(0, 4096) + '…[truncated]'
		return value
	}
	if (Array.isArray(value)) return value.map((v, i) => redactValue(v, `${key}[${i}]`))
	if (typeof value === 'object') return redactObject(/** @type {Record<string, unknown>} */ (value))
	return value
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function redactObject(obj) {
	if (!obj || typeof obj !== 'object') return {}
	const out = {}
	for (const [k, v] of Object.entries(obj)) {
		out[k] = redactValue(v, k)
	}
	return out
}

module.exports = { redactObject, redactValue, SENSITIVE_KEY_RE, listRedactedKeyPatterns }
