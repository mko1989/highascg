'use strict'

/**
 * WO-807 — region-to-fixture-pixel mapping (src/fixtures/pixel-map-service.js, via ctx.fixtureService.pixelMap):
 *   GET  /api/fixtures/pixelmap         → { ok, mappings: [{ id, enabled, fixtureId, pixel, channelNo, rect {x, y, w, h},
 *                                          mode, colourOrder, problem }] } (problem: why it is not output, else null)
 *   POST /api/fixtures/pixelmap {mappings}  → replaces the whole list (project.pixelMappings, server-owned).
 *                                          200 { ok, mappings } | 400 { ok: false, errors: [{ index, id, error }] }
 *                                          (POST, not PUT: the route registry has no PUT verb)
 *   GET  /api/fixtures/pixelmap/live    → { ok, at, stats, channels: [{ channelNo, role, state, width, height, age_ms }],
 *                                          mappings: [{ id, fixtureId, pixel, rgb [r, g, b] | null, age_ms, protocol,
 *                                          universe, slots [1-based DMX], order, dmx [{ slot, value }], on_wire, problem }] }
 *   GET  /api/fixtures/pixelmap/pixels  → { ok, fixtures: [{ id, name, protocol, universe, address, problem,
 *                                          pixels: [{ pixel, geometry, order, slots }] }] } — what can be mapped
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { pixelsOf, slotsOf } = require('../fixtures/pixel-map-model')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })
const NO_ENGINE = { ok: false, error: 'fixture engine not running' }

function pixelFixtures(engine) {
	const out = []
	for (const fx of engine.fixtures || []) {
		const pixels = pixelsOf(fx)
		if (!pixels.length) continue
		out.push({ id: fx.id, name: fx.name, protocol: fx.protocol, universe: fx.universe, address: fx.address,
			problem: fx.problem || null, pixels: pixels.map((p) => ({ pixel: p.pixel, geometry: p.geometry, order: p.order, slots: slotsOf(fx, p) })) })
	}
	return out
}

async function handleSet(body, pm) {
	const b = parseBody(body)
	const list = b && typeof b === 'object' ? b.mappings : undefined
	try {
		const r = await pm.set(list)
		return r.ok ? reply(200, r) : reply(400, r)
	} catch (e) {
		return reply(500, { ok: false, error: e?.message || String(e) })
	}
}

function register(routes) {
	const opt = { requireCaspar: false }
	const svc = (ctx) => ctx?.fixtureService?.pixelMap ? ctx.fixtureService : null
	routes.get('/api/fixtures/pixelmap', ({ ctx }) => (svc(ctx) ? reply(200, { ok: true, mappings: svc(ctx).pixelMap.mappings() }) : reply(503, NO_ENGINE)), opt)
	routes.post('/api/fixtures/pixelmap', ({ ctx, body }) => (svc(ctx) ? handleSet(body, svc(ctx).pixelMap) : reply(503, NO_ENGINE)), opt)
	routes.get('/api/fixtures/pixelmap/live', ({ ctx }) => (svc(ctx) ? reply(200, { ok: true, ...svc(ctx).pixelMap.live() }) : reply(503, NO_ENGINE)), opt)
	routes.get('/api/fixtures/pixelmap/pixels', ({ ctx }) => (svc(ctx) ? reply(200, { ok: true, fixtures: pixelFixtures(svc(ctx).engine) }) : reply(503, NO_ENGINE)), opt)
}

module.exports = { register, handleSet, pixelFixtures }
