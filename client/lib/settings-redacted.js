/**
 * WO-830c: GET /api/settings masks secrets as "[REDACTED]" (src/support/redact-settings.js). Posting that mask back would
 * make the server treat it as the new value (it once stored it as the nuclear-password hash), so every settings POST
 * built from a GET copy goes through here first: a masked value is simply left out and the server keeps what it stores.
 */

const REDACTED_MARKER = '[REDACTED]'

/**
 * Deep copy of `value` without any key whose value is the redaction mask (array items that are the mask are dropped).
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function stripRedacted(value) {
	if (value === REDACTED_MARKER) return undefined
	if (Array.isArray(value)) return /** @type {any} */ (value.filter((v) => v !== REDACTED_MARKER).map(stripRedacted))
	if (value && typeof value === 'object') {
		const out = {}
		for (const [k, v] of Object.entries(value)) {
			if (v === REDACTED_MARKER) continue
			out[k] = stripRedacted(v)
		}
		return /** @type {any} */ (out)
	}
	return value
}
