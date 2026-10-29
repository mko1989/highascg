'use strict'

/**
 * WO-811 phase 3 — "is this request from a client on the box itself?" for actions that only make sense on the box's own
 * screen (:0), e.g. the OS-password terminal (owner 29.10: available only from the box's own screen).
 *
 * A loopback socket alone is NOT enough here (WO-811 1.5 #3): any TLS/reverse proxy in front of this server (the :4443
 * HTTPS proxy that WO-811 found, since removed in WO-822; Caddy or Tailscale Serve per docs/SECURITY.md; `ssh -L`) relays
 * every remote client from 127.0.0.1, and Caspar's CEF renders arbitrary web pages from loopback. The proxy-header and
 * Host-port rules below are kept as defence in depth for those, not only for the removed proxy. So all of:
 *  1. the TCP peer is loopback (127.0.0.0/8, ::1, ::ffff:127.x) — same test as routes-media-ingest-local.js isLoopback;
 *  2. no proxy header (a proxy stamps `X-Forwarded-For`; `Forwarded` / `X-Real-IP` / `X-Forwarded-Host` are refused too);
 *  3. the Host header (when sent) names a loopback host, and its port, when given, is the port this server accepted the
 *     connection on — a request relayed by a proxy on another port (e.g. :4443) keeps the client's `Host: <box>:4443`;
 *  4. a browser `Origin` (when sent) is a loopback origin — a foreign web page (CEF webpage source) carries its own.
 * Godot sends no Origin and `Host: 127.0.0.1:4200`; the web UI opened on the box sends loopback Host + Origin.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host']

function isLoopbackAddress(addr) {
	const ip = String(addr || '').replace(/^::ffff:/i, '')
	return ip === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

/** "127.0.0.1:4200" → { host: '127.0.0.1', port: '4200' }; "[::1]:4200" → { host: '[::1]', port: '4200' }. */
function splitHostHeader(value) {
	const s = String(value || '').trim().toLowerCase()
	if (s.startsWith('[')) {
		const end = s.indexOf(']')
		return { host: s.slice(0, end + 1), port: end >= 0 ? s.slice(end + 2) : '' }
	}
	const i = s.lastIndexOf(':')
	return i >= 0 ? { host: s.slice(0, i), port: s.slice(i + 1) } : { host: s, port: '' }
}

/**
 * @param {import('http').IncomingMessage | null | undefined} req
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function checkBoxLocalRequest(req) {
	const sock = req?.socket
	if (!sock || !isLoopbackAddress(sock.remoteAddress)) return { ok: false, reason: 'not from this machine' }
	const h = req.headers || {}
	for (const name of PROXY_HEADERS) {
		if (h[name] != null && String(h[name]).trim() !== '') return { ok: false, reason: 'relayed by a proxy' }
	}
	if (h.host != null) {
		const { host, port } = splitHostHeader(h.host)
		if (!LOOPBACK_HOSTS.has(host)) return { ok: false, reason: 'not addressed to this machine' }
		if (port && sock.localPort && Number(port) !== Number(sock.localPort)) return { ok: false, reason: 'relayed by a proxy' }
	}
	// `Origin: null` (file:// or sandboxed page) is foreign too: new URL('null') throws.
	if (h.origin != null && String(h.origin).trim() !== '') {
		let originHost
		try {
			originHost = new URL(String(h.origin)).hostname.toLowerCase()
		} catch {
			return { ok: false, reason: 'foreign page' }
		}
		if (!LOOPBACK_HOSTS.has(originHost)) return { ok: false, reason: 'foreign page' }
	}
	return { ok: true }
}

module.exports = { checkBoxLocalRequest, isLoopbackAddress, splitHostHeader }
