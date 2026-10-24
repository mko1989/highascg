'use strict'

/**
 * WO-723 — this server's duties, resolved from its config and the linked servers (src/cluster/server-duties.js), and
 * the "which server sends / receives" choice (src/cluster/server-senders.js):
 *   GET  /api/server/duties                → { tracking, detection, zones, auto, presenters, lighting, ptz, artnet_in,
 *                                             accept_remote } (booleans, resolved)
 *   POST /api/server/duties { patch: { accept_remote: false } } → the resolved object (accept_remote is the one
 *        setting; any duty name answers 400 "resolved from this server's config")
 *   GET  /api/server/senders               → { senders: { lighting|ptz|artnet_in: { by, at, auto, here, who, who_name,
 *                                             auto_name } },  (who / names: '*' = every server)
 *                                             servers: [{ fp, name, self, online, refused? }] }  (servers: [] while
 *                                             unlinked; refused: why that server did not take the choices, e.g. an
 *                                             older version — it keeps its own settings)
 *   POST /api/server/senders { kind, by }  → the same body; `by` = '' (Auto) or a listed server's fingerprint. The
 *        change goes to the online linked servers at once (signed `cluster.senders`, routes-cluster.js).
 * WS `server:duties` (the GET body) and `server:senders` (the GET body) on every change.
 * Linked servers see each other's duties in /api/replication/ping (`duties`) and in /api/cluster (`peers[].duties`).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const duties = require('../cluster/server-duties')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })

/** Once per ctx: every change in the resolution or the choices reaches the clients. */
function bindBroadcast(ctx) {
	if (!ctx || ctx._dutiesBroadcast) return
	let lastDuties = ''
	let lastSenders = ''
	const send = () => {
		if (typeof ctx._wsBroadcast !== 'function') return
		const d = duties.get()
		const s = duties.sendersView()
		if (JSON.stringify(d) !== lastDuties) ctx._wsBroadcast('server:duties', d)
		if (JSON.stringify(s) !== lastSenders) ctx._wsBroadcast('server:senders', s)
		lastDuties = JSON.stringify(d)
		lastSenders = JSON.stringify(s)
	}
	ctx._dutiesBroadcast = send
	duties.onChange(send)
	duties.senders().onChange(send)
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/server/duties', ({ ctx }) => (bindBroadcast(ctx), reply(200, duties.get())), opt)
	routes.post(
		'/api/server/duties',
		({ body, ctx }) => {
			bindBroadcast(ctx)
			try {
				return reply(200, duties.set(parseBody(body)?.patch))
			} catch (e) {
				return reply(e.status || 500, { error: e.message })
			}
		},
		opt
	)
	routes.get('/api/server/senders', ({ ctx }) => (bindBroadcast(ctx), reply(200, duties.sendersView())), opt)
	routes.post(
		'/api/server/senders',
		({ body, ctx }) => {
			bindBroadcast(ctx)
			const b = parseBody(body) || {}
			const by = String(b.by ?? '')
			if (by && !duties.sendersView().servers.some((s) => s.fp === by))
				return reply(400, { error: 'by must be "" (Auto) or the fingerprint of this server or a linked one' })
			try {
				duties.senders().set(String(b.kind || ''), by)
			} catch (e) {
				return reply(e.status || 500, { error: e.message })
			}
			if (ctx?._cluster) require('./routes-cluster').sendersSyncOf(ctx).tick().catch(() => {})
			return reply(200, duties.sendersView())
		},
		opt
	)
}

module.exports = { register, bindBroadcast }
