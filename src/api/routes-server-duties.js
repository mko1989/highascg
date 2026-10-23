'use strict'

/**
 * WO-712 R1 — this server's duties (src/cluster/server-duties.js), set in its own Devices view:
 *   GET  /api/server/duties                → { detection, zones, auto, lighting, ptz, presenters, accept_remote } (booleans)
 *   POST /api/server/duties { patch: { lighting: false } } → the saved object; WS `server:duties` carries the same object.
 *        400 for an unknown duty name or a non-boolean value.
 * Linked servers see each other's duties in /api/replication/ping (`duties`) and in /api/cluster (`peers[].duties`).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const duties = require('../cluster/server-duties')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/server/duties', () => reply(200, duties.get()), opt)
	routes.post(
		'/api/server/duties',
		({ body, ctx }) => {
			let saved
			try {
				saved = duties.set(parseBody(body)?.patch)
			} catch (e) {
				return reply(e.status || 500, { error: e.message })
			}
			if (typeof ctx?._wsBroadcast === 'function') ctx._wsBroadcast('server:duties', saved)
			return reply(200, saved)
		},
		opt
	)
}

module.exports = { register }
