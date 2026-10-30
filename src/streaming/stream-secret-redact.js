/**
 * WO-307 — one redaction module for every stream secret (RTMP key, SRT passphrase), used by
 * BOTH the streaming-channel log sites (streaming-channel-status.js) AND the AMCP transport layer
 * (amcp-client-transport.js). Deliberately a LEAF module (no requires) so it can be required from
 * the transport's hot path without any risk of a require cycle through config/routing.
 *
 * Found while wiring the SRT passphrase (which was about to become a SECOND secret flowing
 * through the exact code path the 2026-07-20 YouTube-key-in-logs incident already burned once):
 * amcp-client-transport.js — the file that actually sends every AMCP command — logs the RAW,
 * unredacted command at THREE further sites the original stream-key fix never reached, because
 * that fix only touched routes-streaming-channel-rtmp.js's own log calls:
 *   - the debug trace immediately before every socket.send (`AMCP → <cmd>`)
 *   - recordAmcpHistory(), which writes the last 50 raw commands to data/amcp-last50.txt on disk
 *   - the timeout warn log AND the timeout Error's message text (which propagates to any caller's
 *     catch block and gets logged again there)
 * — twice each, once in the plain _send path and once in the typed (_invokeTyped) path, plus a
 * fourth site in the replication skip-log branch. All nine are fixed by routing through
 * `redactAmcpCommandForLog` here; the actual bytes sent to Caspar (`socket.send`/`sendRaw`) and
 * the replication fan-out (`fanoutSingleCommand`) are left completely untouched — only the
 * LOGGED/HISTORY/ERROR-MESSAGE copy is ever redacted.
 */
'use strict'

// WO-830c: SRT `streamid` is the access token on most hosted ingests (`publish:<key>`), so it is a secret like the
// passphrase; any other query param that names a key/token/secret/password gets the same treatment.
const SECRET_QUERY_NAME_RE = /^(passphrase|streamid|pass|password|key|streamkey|token|secret|auth)$/i
const SECRET_QUERY_FALLBACK_RE = /((?:^|[?&])(?:passphrase|streamid|password|key|streamkey|token|secret)=)[^&\s"]*/gi

/** @param {URL} u mutated in place */
function maskSecretQueryParams(u) {
	for (const name of [...new Set([...u.searchParams.keys()])]) {
		if (SECRET_QUERY_NAME_RE.test(name)) u.searchParams.set(name, '****')
	}
}

/**
 * Mask an RTMP key (last URL path segment) or an SRT passphrase (query param). Server keeps the
 * full URL internally for AMCP REMOVE / reconnection — this is a DISPLAY-ONLY copy.
 * @param {unknown} url
 */
function redactStreamUrl(url) {
	const s = String(url || '').trim()
	if (!s) return s
	if (/^srt:\/\//i.test(s)) {
		try {
			const u = new URL(s.replace(/^srt:\/\//i, 'https://'))
			maskSecretQueryParams(u)
			const path = u.pathname === '/' ? '' : u.pathname
			return `srt://${u.host}${path}${u.search}`
		} catch {
			return s.replace(SECRET_QUERY_FALLBACK_RE, '$1****')
		}
	}
	try {
		const u = new URL(s.replace(/^rtmps?:\/\//i, 'https://').replace(/^rtmp:\/\//i, 'http://'))
		const parts = u.pathname.split('/').filter(Boolean)
		if (parts.length >= 2) {
			parts[parts.length - 1] = '****'
			const scheme = /^rtmps:/i.test(s) ? 'rtmps' : 'rtmp'
			// WO-830c: some ingests carry the key in the query (?key=…) as well as / instead of the last segment.
			maskSecretQueryParams(u)
			return `${scheme}://${u.host}/${parts.join('/')}${u.search}`
		}
	} catch {
		/* fall through */
	}
	const slash = s.lastIndexOf('/')
	if (slash > 'rtmp://'.length) return `${s.slice(0, slash + 1)}****`
	return s
}

/**
 * Redact stream keys inside quoted AMCP STREAM params (narrow: only a trailing quoted path
 * segment). Kept for the existing call site in streaming-channel-status.js; prefer
 * {@link redactAmcpCommandForLog} for anything new — it also catches SRT query secrets and
 * unquoted URLs (param() only quotes a token when it contains whitespace, and these URLs never
 * do once percent-encoded).
 * @param {unknown} command
 */
function redactAmcpStreamCommand(command) {
	const s = String(command || '')
	if (!s) return s
	return s.replace(/(STREAM\s+"[^"]*\/)([^"/?#]+)(")/gi, '$1****$3')
}

/**
 * Redact every rtmp(s)/srt URL found anywhere in an arbitrary AMCP command or log/error string —
 * quoted or bare, at any position (not just after `STREAM`), so it is safe to wrap indiscriminately
 * at the transport layer without knowing which command shape carries the secret.
 * @param {unknown} cmd
 * @returns {string}
 */
function redactAmcpCommandForLog(cmd) {
	const s = String(cmd || '')
	if (!s) return s
	return s
		.replace(/"?((?:rtmps?|srt):\/\/[^\s"]+)"?/gi, (whole, url) => {
			const redacted = redactStreamUrl(url)
			return whole.startsWith('"') ? `"${redacted}"` : redacted
		})
		// WO-811: the node's template key (CG data `templateKey`, URL `#template_key=`) stays out of the node's own log.
		.replace(/(templateKey\\*"\s*:\s*\\*")[^"\\]*/g, '$1***')
		.replace(/([?&#]template_key=)[^&#\s"]*/gi, '$1***')
}

module.exports = { redactStreamUrl, redactAmcpStreamCommand, redactAmcpCommandForLog }
