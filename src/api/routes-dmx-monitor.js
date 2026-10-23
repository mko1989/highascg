'use strict'

/**
 * WO-693 — DMX viewer (src/artnet/dmx-monitor.js). Core, not the Tracking module: it works with the fixture engine off.
 *   GET  /api/dmx-monitor?protocol=artnet|sacn&universe=N  → { running, watched, artnet: { listening, nodes, sources },
 *                                                              sacn: { listening, sources }, frame: {…, data: [512]} | null }
 *                                                              (starts listening; stops 15 s after the last GET)
 *   POST /api/dmx-monitor/poll                              → { sent: [broadcast addresses] } — ArtPoll, answers arrive
 *                                                              as artnet.nodes on the next GETs
 */

const { JSON_HEADERS, jsonBody } = require('./response')
const { sharedMonitor } = require('../artnet/dmx-monitor')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })

function register(routes, monitorOf = (ctx) => sharedMonitor(typeof ctx?.log === 'function' ? ctx.log.bind(ctx) : null)) {
	const opt = { requireCaspar: false }
	routes.get('/api/dmx-monitor', ({ ctx, query }) => {
		const m = monitorOf(ctx)
		m.touch({ protocol: query?.protocol, universe: query?.universe })
		return reply(200, m.snapshot())
	}, opt)
	routes.post('/api/dmx-monitor/poll', ({ ctx }) => {
		const m = monitorOf(ctx)
		m.touch(m.watched)
		return reply(200, { sent: m.poll() })
	}, opt)
}

module.exports = { register }
