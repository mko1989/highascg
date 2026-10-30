'use strict'

const REDACTED = '[REDACTED]'
const { redactAmcpCommandForLog } = require('../streaming/stream-secret-redact')

const SENSITIVE_KEY_RE = /(token|password|secret|apikey|api_key|auth|privatekey|private_key|tailscale)/i

// WO-830c: what a SUPPORT BUNDLE additionally masks - SRT passphrase / streamid, stream keys, Wi-Fi PSKs, generic
// credentials, any `...Key` camelCase tail (not `...PublicKey`; never a bare `key`: keyframe/keyer/hotkey). These stay
// OUT of the base regex on purpose: GET /api/settings uses it too, and the Devices inspector round-trips `srtStreamId`
// (a mask there would show in the field and be posted back).
const SUPPORT_EXTRA_KEY_RE = /(passwd|passphrase|psk|credential|stream_?key|stream_?id|(?<!public)(?<=[a-z])key$)/i

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

/** Extra patterns applied with `{ forSupport: true }` (the support bundle). */
function listSupportExtraKeyPatterns() {
	return ['passwd', 'passphrase', 'psk', 'credential', 'streamkey', 'streamid', '*Key (camelCase, not *PublicKey)']
}

/**
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
function redactValue(value, key = '', opts = {}) {
	if (value == null) return value
	// WO-611 #6: a flag leaks nothing — redacting `nuclearRequirePassword` made every client read it as off (and the
	// web Settings save then wrote false back, silently dropping the password requirement).
	if (typeof value === 'boolean') return value
	if (SENSITIVE_KEY_RE.test(key) || (opts.forSupport && SUPPORT_EXTRA_KEY_RE.test(key))) return REDACTED
	if (typeof value === 'string') {
		// WO-830c: support bundle only: a stream URL pasted into a non-secret-named field (rtmp://…/<key>, srt://…?passphrase=) still leaks.
		if (opts.forSupport && /(?:rtmps?|srt):\/\//i.test(value)) value = redactAmcpCommandForLog(value)
		if (value.length > 4096) return value.slice(0, 4096) + '…[truncated]'
		return value
	}
	if (Array.isArray(value)) return value.map((v, i) => redactValue(v, `${key}[${i}]`, opts))
	if (typeof value === 'object') return redactObject(/** @type {Record<string, unknown>} */ (value), opts)
	return value
}

/**
 * @param {Record<string, unknown>} obj
 * @param {{ forSupport?: boolean }} [opts] forSupport (support bundle): also the SUPPORT_EXTRA_KEY_RE keys, and rtmp/srt URLs inside any string
 * @returns {Record<string, unknown>}
 */
function redactObject(obj, opts = {}) {
	if (!obj || typeof obj !== 'object') return {}
	const out = {}
	for (const [k, v] of Object.entries(obj)) {
		out[k] = redactValue(v, k, opts)
	}
	return out
}

/**
 * WO-830c: the inverse guard for settings POST. GET masks secrets as "[REDACTED]"; a client that posts its GET copy back
 * must never have the mask stored as the new value. Deep copy without any key whose value IS the mask (array items that
 * are the mask are dropped), so the stored value is kept.
 * @param {unknown} value
 * @returns {unknown}
 */
function stripRedactedMarkers(value) {
	if (Array.isArray(value)) return value.filter((v) => v !== REDACTED).map(stripRedactedMarkers)
	if (value && typeof value === 'object') {
		const out = {}
		for (const [k, v] of Object.entries(value)) {
			if (v !== REDACTED) out[k] = stripRedactedMarkers(v)
		}
		return out
	}
	return value
}

module.exports = {
	redactObject,
	redactValue,
	stripRedactedMarkers,
	REDACTED,
	SENSITIVE_KEY_RE,
	listRedactedKeyPatterns,
	listSupportExtraKeyPatterns,
}
