/**
 * Structured WebSocket AMCP: JSON messages parallel REST bodies (WO-07 T5.2).
 * Raw `{ type: 'amcp', cmd }` stays in ws-server.js.
 */

'use strict'

const amcpRoutes = require('../api/routes-amcp')
const mixerRoutes = require('../api/routes-mixer')
const cgRoutes = require('../api/routes-cg')

/** @type {Record<string, string>} */
const TYPE_TO_PATH = {
	play: '/api/play',
	loadbg: '/api/loadbg',
	load: '/api/load',
	pause: '/api/pause',
	resume: '/api/resume',
	stop: '/api/stop',
	clear: '/api/clear',
	call: '/api/call',
	swap: '/api/swap',
	add: '/api/add',
	remove: '/api/remove',
	print: '/api/print',
	log_level: '/api/log/level',
	log_category: '/api/log/category',
	set: '/api/set',
	lock: '/api/lock',
	ping: '/api/ping',
	restart: '/api/restart',
	kill: '/api/kill',
	diag: '/api/diag',
	gl_gc: '/api/gl/gc',
	channel_grid: '/api/channel-grid',
	amcp_batch: '/api/amcp/batch',
	amcp_raw_batch: '/api/amcp/raw-batch',
	raw: '/api/raw',
}

const STRUCTURED_TYPES = new Set(Object.keys(TYPE_TO_PATH))

/**
 * @param {Record<string, unknown>} msg
 * @returns {boolean}
 */
function isStructuredAmcpMessage(msg) {
	if (!msg || typeof msg !== 'object') return false
	const t = msg.type
	if (typeof t !== 'string') return false
	if (t === 'mixer') return typeof msg.command === 'string' && !!String(msg.command).trim()
	if (t === 'cg') return typeof msg.command === 'string' && !!String(msg.command).trim()
	return STRUCTURED_TYPES.has(t)
}

/**
 * @param {Record<string, unknown>} msg
 * @returns {Record<string, unknown>}
 */
function stripForBody(msg) {
	const o = { ...msg }
	delete o.id
	delete o.type
	delete o.command
	return o
}

/**
 * @param {{ status: number, body: string } | null | undefined} res
 * @returns {unknown}
 */
function normalizeRouteResult(res) {
	if (!res || typeof res.body !== 'string') {
		return { ok: false, error: 'Route handler returned no response' }
	}
	try {
		const parsed = JSON.parse(res.body)
		if (res.status >= 400) {
			return { ok: false, status: res.status, ...(typeof parsed === 'object' && parsed ? parsed : { data: parsed }) }
		}
		return parsed
	} catch {
		return { ok: false, error: 'Invalid JSON from route handler', raw: res.body }
	}
}

/**
 * Dispatch a structured WS message to the same handlers as HTTP POST.
 * @param {import('./ws-server').WsAppContext} ctx
 * @param {Record<string, unknown>} msg
 * @returns {Promise<unknown | null>} Parsed JSON body, or null if this module does not handle `msg.type`.
 */
async function dispatchStructuredAmcp(ctx, msg) {
	if (!msg || typeof msg !== 'object') return null
	const t = msg.type
	if (typeof t !== 'string') return null

	if (t === 'mixer') {
		const cmd = msg.command
		if (typeof cmd !== 'string' || !cmd.trim()) return null
		const path = `/api/mixer/${encodeURIComponent(cmd.trim().toLowerCase())}`
		const body = JSON.stringify(stripForBody(msg))
		const res = await mixerRoutes.handlePost(path, body, ctx)
		if (!res) return { ok: false, error: 'Unknown mixer route' }
		return normalizeRouteResult(res)
	}

	if (t === 'cg') {
		const cmd = msg.command
		if (typeof cmd !== 'string' || !cmd.trim()) return null
		const path = `/api/cg/${encodeURIComponent(cmd.trim().toLowerCase())}`
		const body = JSON.stringify(stripForBody(msg))
		const res = await cgRoutes.handlePost(path, body, ctx)
		if (!res) return { ok: false, error: 'Unknown CG route' }
		return normalizeRouteResult(res)
	}

	if (!STRUCTURED_TYPES.has(t)) return null

	const path = TYPE_TO_PATH[t]
	const body = JSON.stringify(stripForBody(msg))
	const res = await amcpRoutes.handlePost(path, body, ctx)
	if (!res) return { ok: false, error: 'Unknown AMCP route for type ' + t }
	return normalizeRouteResult(res)
}

module.exports = {
	dispatchStructuredAmcp,
	isStructuredAmcpMessage,
	STRUCTURED_TYPES,
	TYPE_TO_PATH,
	/** @internal testing */
	_stripForBody: stripForBody,
}
