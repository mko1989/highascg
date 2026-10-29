'use strict'

/**
 * WO-811 — the one place every AMCP line passes before it reaches Caspar (amcp-client-transport.js `_sendPrepare` /
 * `_invokeTyped`, amcp-batch.js BEGIN…COMMIT). Two jobs:
 *
 * 1. While enforcement is ON, hand the node's TEMPLATE KEY (src/server/template-credential.js — random per node start,
 *    in memory only) to the templates that open the node WebSocket, at the moment they are sent (take, multiview apply,
 *    playlist hop, shader live edit, PRV push — all go through here):
 *    - `CG <ch-l> ADD <n> <template> <0|1> [<json>]` for a WS template → `templateKey` merged into the JSON data;
 *    - `PLAY|LOADBG|LOAD <ch-l> [HTML] <url>` to this machine's `/templates/<ws template>.html` → `#template_key=<key>`.
 *    Enforcement OFF → the line is untouched (the bytes of before).
 * 2. The shared password never goes to Caspar: a line that carries it (plain, AMCP-escaped or URL-encoded) is refused,
 *    whatever built it. Caspar logs CG data and URLs; its log must never hold the password. (Passwords shorter than 8
 *    characters are not matched — too many false hits in ordinary command text.)
 */

const { param } = require('./amcp-utils')
const { isEnforceAuthActive, getExpectedApiToken } = require('../server/auth')
const tc = require('../server/template-credential')

const TOKEN = '("(?:\\\\.|[^"\\\\])*"|\\S+)'
const CG_ADD_RE = new RegExp(`^(CG\\s+\\d+(?:-\\d+)?\\s+ADD\\s+\\d+\\s+)${TOKEN}(\\s+\\S+)(?:\\s+${TOKEN})?\\s*$`, 'i')
const HTML_URL_RE = new RegExp(`^((?:PLAY|LOADBG|LOAD)\\s+\\d+(?:-\\d+)?\\s+\\[HTML\\]\\s+)${TOKEN}(.*)$`, 'i')
const MIN_GUARD_LEN = 8

/** Inverse of amcp-utils `param()`: strip the quotes, undo `\\` and `\"`. */
function unparam(tok) {
	const s = String(tok || '')
	const inner = s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
	return inner.replace(/\\(.)/g, '$1')
}

function withKeyInCgAdd(line, key) {
	const m = CG_ADD_RE.exec(line)
	if (!m || !tc.isWsTemplateName(unparam(m[2]))) return line
	let data = {}
	if (m[4] != null) {
		try {
			data = JSON.parse(unparam(m[4]))
		} catch {
			return line // not JSON → leave it alone (the template gets no key, as before)
		}
		if (!data || typeof data !== 'object' || Array.isArray(data)) return line
	}
	const json = JSON.stringify({ ...data, [tc.TEMPLATE_KEY_FIELD]: key })
	const quoted = param(json)
	return `${m[1]}${m[2]}${m[3]} ${quoted.startsWith('"') ? quoted : `"${quoted}"`}`
}

function withKeyInHtmlUrl(line, key) {
	const m = HTML_URL_RE.exec(line)
	if (!m) return line
	let u
	try {
		u = new URL(unparam(m[2]))
	} catch {
		return line
	}
	if (!/^https?:$/.test(u.protocol) || !tc.isOwnHost(u.hostname) || !tc.isWsTemplateName(u.pathname)) return line
	const hash = new URLSearchParams(u.hash.replace(/^#/, ''))
	hash.set(tc.TEMPLATE_KEY_QUERY, key)
	u.hash = hash.toString()
	return `${m[1]}${param(u.toString())}${m[3]}`
}

/** The line with the template key in place (enforcement ON and a WS template), else the line unchanged. */
function injectTemplateCredential(line, config) {
	const s = String(line ?? '')
	if (!isEnforceAuthActive(config)) return s
	const key = tc.templateCredential()
	return withKeyInHtmlUrl(withKeyInCgAdd(s, key), key)
}

/** True when the line carries the shared password in any form a builder could have put it. */
function carriesSharedPassword(line, config) {
	const pw = getExpectedApiToken(config)
	if (!pw || pw.length < MIN_GUARD_LEN) return false
	const s = String(line ?? '')
	const escaped = pw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return s.includes(pw) || s.includes(escaped) || s.includes(encodeURIComponent(pw))
}

/**
 * @param {string} line one AMCP command
 * @param {object} config
 * @returns {{ line: string, error: Error | null }} `error` set (and `line` emptied) when the line carries the password
 */
function prepareAmcpLine(line, config) {
	const out = injectTemplateCredential(line, config)
	if (carriesSharedPassword(out, config)) return { line: '', error: passwordRefusal() }
	return { line: out, error: null }
}

function passwordRefusal() {
	return new Error('AMCP command refused: it carries the HighAsCG password, which never goes to Caspar (WO-811)')
}

module.exports = { injectTemplateCredential, carriesSharedPassword, prepareAmcpLine, passwordRefusal, unparam }
