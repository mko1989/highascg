'use strict'

/**
 * WO-770 — explicit VR session from the operator GUI (see src/vr/vr-session.js):
 *   GET  /api/vr/status → { installed, serverRunning, headsetConnected, sessionRunning, pairingEnabled, pin, paired[],
 *                           systemName, clientRunning, clientPid?, starting, error }
 *   POST /api/vr/start  → { ok, ...status } | 500 { ok:false, error }   (WiVRn start + pairing PIN + XR client)
 *   POST /api/vr/pair   { minutes? 1–30, default 5 } → { ok, pin } | 409 when WiVRn is not running
 *   POST /api/vr/stop   → { ok, ...status }   (also stops the desk panel)
 * WO-792 — the lighting desk's UI (MagicQ) as a panel in the headset (src/vr/vr-desk-panel.js); status carries `desk`:
 *   POST /api/vr/desk/start → { ok, ...desk } | 500 { ok:false, error }   (WayVR --headless + MagicQ on its X display)
 *   POST /api/vr/desk/stop  → { ok, ...desk }
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const vr = require('../vr/vr-session')

const reply = (status, data) => ({ status, headers: JSON_HEADERS, body: jsonBody(data) })

/** @param {any} routes */
function register(routes) {
	const session = () => vr.instance
	routes.get('/api/vr/status', async () => reply(200, await session().status()), { requireCaspar: false })
	routes.post(
		'/api/vr/start',
		async () => {
			const r = await session().start()
			return reply(r.ok ? 200 : 500, r)
		},
		{ requireCaspar: false }
	)
	routes.post(
		'/api/vr/pair',
		async ({ body }) => {
			const r = await session().pair((parseBody(body) || {}).minutes)
			return reply(r.ok ? 200 : r.notRunning ? 409 : 500, r.notRunning ? { ok: false, error: r.error } : r)
		},
		{ requireCaspar: false }
	)
	routes.post('/api/vr/stop', async () => reply(200, await session().stop()), { requireCaspar: false })
	routes.post(
		'/api/vr/desk/start',
		async () => {
			const r = await session().deskStart()
			return reply(r.ok ? 200 : 500, r)
		},
		{ requireCaspar: false }
	)
	routes.post('/api/vr/desk/stop', async () => reply(200, await session().deskStop()), { requireCaspar: false })
}

module.exports = { register }
