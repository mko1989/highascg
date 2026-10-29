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

const http = require('http')
const { outboundAuthHeaders } = require('../server/auth')

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

/** method, host, port, path, body (string | undefined) → { status, contentType, body: Buffer } | { status: 0, error }. */
function rawRequest(method, host, port, path, body, timeout = TIMEOUT_MS) {
	return new Promise((resolve) => {
		const data = body == null || body === '' ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
		const headers = { Accept: 'application/json', ...outboundAuthHeaders() } // WO-811: the shared password (none today)
		if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': data.length })
		const req = http.request({ host, port, path, method, timeout, headers }, (res) => {
			const chunks = []
			let size = 0
			res.on('data', (c) => {
				size += c.length
				if (size > MAX_BODY) return req.destroy(new Error('answer too large'))
				chunks.push(c)
			})
			res.on('end', () => resolve({ status: res.statusCode, contentType: String(res.headers['content-type'] || 'application/json'), body: Buffer.concat(chunks) }))
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', (e) => resolve({ status: 0, error: e.message }))
		req.end(data || undefined)
	})
}

/**
 * @param {{ cluster: { saved: (id: string) => ({ host: string, port: number, name: string }|null) },
 *   request?: typeof rawRequest, log?: Function }} deps
 * → relay({ method, id, tail, query, body }) → { status, headers, body }
 */
function createRelay(deps) {
	const request = deps.request || rawRequest
	const json = (status, obj) => ({ status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })
	return async function relay({ method, id, tail, query, body }) {
		const m = String(method || '').toUpperCase()
		if (!METHODS.has(m)) return json(405, { error: `${m} is not relayed` })
		const peer = deps.cluster.saved(String(id || ''))
		if (!peer) return json(404, { error: 'no such server (not linked here)' })
		const p = relayPath(tail)
		if (p.error) return json(403, { error: p.error })
		const args = [m, peer.host, peer.port, p.path + queryText(query), m === 'GET' ? undefined : body]
		if (LONG_PATHS.test(p.path)) args.push(LONG_TIMEOUT_MS)
		const r = await request(...args)
		if (!r.status) {
			deps.log?.('warn', `[cluster] relay ${m} ${p.path} → ${peer.name}: ${r.error}`)
			return json(502, { error: `${peer.name}: no answer (${r.error})` })
		}
		return { status: r.status, headers: { 'Content-Type': r.contentType }, body: r.body }
	}
}

module.exports = { createRelay, relayPath, queryText, rawRequest, TIMEOUT_MS, LONG_TIMEOUT_MS }
