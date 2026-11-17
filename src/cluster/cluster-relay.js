'use strict'

/**
 * WO-802 — a client reaches a linked server only through its own node (owner, 29.10: "the godot clients should stay
 * connected to their respective node servers on their machines and all the communication should happen via node
 * servers"). The Devices "Edit" on a linked server's card sends its requests here:
 *
 *   GET | POST | DELETE /api/cluster/peers/:id/relay/<path>[?query]  →  that server's /<path>, status and body as is
 *
 * Only to a server linked here (cluster-peers.js `saved`). Refused: anything outside /api/, /api/system/* (power,
 * updates, the dock: a client never shuts down or updates another machine), /api/ws, and a relay of a relay (one hop:
 * node ↔ node). The request carries no credentials, exactly as the client's own direct request did before.
 */

const { outboundAuthHeaders } = require('../server/auth')
const { fetchBody } = require('./cluster-http')
const { sendSigned } = require('./cluster-signed-request')

const TIMEOUT_MS = 14000 // under the client's 15 s (core/api.gd TIMEOUT_S): it hears this server name the silent one
/** WO-805: the Caspar Applies restart Caspar (typ. 5-15 s; the server's own waits cap out near ~100 s) — under the client's
 *  own long timeout for them (core/api.gd APPLY_TIMEOUT_S 120 s), so the relay still answers first. */
const LONG_TIMEOUT_MS = 110_000
const LONG_PATHS = /^\/api\/(caspar-config\/apply|replication\/apply-device-view-caspar)(\?|$)/
const METHODS = new Set(['GET', 'POST', 'DELETE'])
const MAX_BODY = 8 * 1024 * 1024
/** Never relayed: [pattern, why] (regexes, so the contract generator does not list them as routes handled here). */
const REFUSED = [
	[/^\/api\/ws(\/|$)/, 'the WebSocket is not relayed'],
	[/^\/api\/system(\/|$)/, '/api/system is never relayed (power, updates, dock stay on their own machine)'],
	[/^\/api\/cluster\/peers\/[^/]+\/relay(\/|$)/, 'a relay is not relayed again'],
]

/** The relayed path from the route's tail ("api/device-view") → "/api/device-view", or { error } when refused. */
function relayPath(tail) {
	const raw = String(tail || '').replace(/^\/+/, '')
	let p
	try {
		p = '/' + decodeURIComponent(raw)
	} catch {
		return { error: 'bad path' }
	}
	if (!p.startsWith('/api/') || p.includes('..') || /[\s\\]/.test(p)) return { error: 'only /api/ paths are relayed' }
	const refused = REFUSED.find(([re]) => re.test(p))
	return refused ? { error: refused[1] } : { path: '/' + raw }
}

/** Query object (router-dispatch parseQueryString) → "?a=1&b=2" ('' when empty). */
function queryText(query) {
	const q = new URLSearchParams()
	for (const [k, v] of Object.entries(query && typeof query === 'object' ? query : {})) {
		for (const x of Array.isArray(v) ? v : [v]) q.append(k, String(x))
	}
	const s = q.toString()
	return s ? `?${s}` : ''
}

/** method, host, port, path, body (string | undefined) → { status, contentType, body: Buffer } | { status: 0, error }.
 * WO-1106 D3: the whole answer must be in within `timeout` (cluster-http.js fetchBody: settles once, byte cap, overall
 * deadline) — an answer trickling a byte at a time never went idle and held the client past its own 15 s. */
async function rawRequest(method, host, port, path, body, timeout = TIMEOUT_MS, extraHeaders = null) {
	const data = body == null || body === '' ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
	const headers = { Accept: 'application/json', ...outboundAuthHeaders(), ...(extraHeaders || {}) } // WO-811: the shared password (none today)
	if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': data.length })
	const r = await fetchBody({ host, port, path, method, timeout, headers }, data, { cap: MAX_BODY, deadline: timeout })
	if (!r.status) return { status: 0, error: r.error === 'deadline' ? `no complete answer in ${Math.round(timeout / 1000)} s` : r.error }
	return { status: r.status, contentType: String(r.headers?.['content-type'] || 'application/json'), body: r.body }
}

/** WO-1106 C29: the relayed requests that a linked server gates (cluster-route-gate.js): changes to its cluster routes. */
const GATED = (method, path) => method !== 'GET' && /^\/api\/cluster\//.test(path)

/**
 * @param {{ cluster: { saved: (id: string) => ({ host: string, port: number, name: string, device_key?: string }|null) },
 *   request?: typeof rawRequest, log?: Function, onAnswered?: (id, method, path, status) => Promise<void>|void,
 *   selfKey?: () => string, sign?: (text: string) => string }} deps
 * → relay({ method, id, tail, query, body, signed? }) → { status, headers, body }
 *   signed: the operator was allowed HERE (API auth or on the box, cluster-route-gate.js) — WO-1106 C29: a change to
 *   that server's cluster routes is then signed with this server's key, which that server takes as the operator's
 *   (an unsigned one is refused there while its API auth is off). An older server ignores the headers.
 */
function createRelay(deps) {
	const request = deps.request || rawRequest
	const json = (status, obj) => ({ status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })
	return async function relay({ method, id, tail, query, body, signed = false }) {
		const m = String(method || '').toUpperCase()
		if (!METHODS.has(m)) return json(405, { error: `${m} is not relayed` })
		const peer = deps.cluster.saved(String(id || ''))
		if (!peer) return json(404, { error: 'no such server (not linked here)' })
		const p = relayPath(tail)
		if (p.error) return json(403, { error: p.error })
		const full = p.path + queryText(query)
		const text = m === 'GET' || body == null || body === '' ? '' : typeof body === 'string' ? body : JSON.stringify(body)
		const timeout = LONG_PATHS.test(p.path) ? LONG_TIMEOUT_MS : undefined // undefined: rawRequest's TIMEOUT_MS
		const send = (headers) => {
			const args = [m, peer.host, peer.port, full, text || undefined]
			if (timeout || headers) args.push(timeout)
			if (headers) args.push(headers) // WO-1106 C29
			return request(...args)
		}
		const sign = signed && GATED(m, p.path) && peer.device_key && deps.selfKey && deps.sign
		const r = sign ? await sendSigned(send, { method: m, path: full, body: text, toKey: peer.device_key, selfKey: deps.selfKey(), sign: deps.sign }) : await send(null)
		if (!r.status) {
			deps.log?.('warn', `[cluster] relay ${m} ${p.path} → ${peer.name}: ${r.error}`)
			return json(502, { error: `${peer.name}: no answer (${r.error})` })
		}
		// WO-1029 S4: a write landed there → the node's copy of that server's Devices view is fresh again before it answers
		if (deps.onAnswered) await Promise.resolve(deps.onAnswered(String(id), m, p.path, r.status)).catch(() => {})
		return { status: r.status, headers: { 'Content-Type': r.contentType }, body: r.body }
	}
}

module.exports = { createRelay, relayPath, queryText, rawRequest, TIMEOUT_MS, LONG_TIMEOUT_MS }
