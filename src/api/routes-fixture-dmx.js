'use strict'

/**
 * WO-615 T3/T4 — the fixture DMX engine (src/fixtures/follow-engine.js, via ctx.fixtureService):
 *   GET    /api/fixtures/dmx                         → { dmx (master, priority, enabled universes), universes:
 *                                                        [{ protocol, universe, dest, live, used, fixtures:
 *                                                        [{ id, name, address, from, to, channels, problem }] }] }
 *   GET    /api/fixtures/dmx/frame?protocol=&universe=  → { protocol, universe, dest, live, data: [512] } (what goes
 *                                                        out — or would, while the universe is not live)
 *   GET    /api/fixtures/program                     → { values: { fixtureId: { key: value } } }
 *   POST   /api/fixtures/program {ids | id, values, replace?}  → { changed: [ids] }
 *   DELETE /api/fixtures/program[?id=<id>]           → release (all, or one fixture) — channels back to defaults
 *   GET    /api/fixtures/program/features[?ids=a,b]  → { fixtures: { id: features } } what each typed fixture can set
 *                                                        (dimmer, colour mixing / wheel, CTO, pan, tilt, zoom, gobos)
 *   POST   /api/fixtures/program/aim {ids, target: [x, y, z]}  → { aimed, unreachable } — Pan / Tilt pointing the
 *                                                        beams at a stage point (PSN metres: x stage left, y upstage, z up)
 * The patch itself stays in `project.fixtures` (Godot-owned slice); the master and universe list are its `dmx` key.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })
const NO_ENGINE = { error: 'fixture engine not running' }

function keyOf(fx) {
	return `${fx.protocol}|${fx.to.host}:${fx.to.port}|${fx.universe}`
}

/** Universe usage map: every patched fixture with a destination, grouped by protocol / destination / universe. */
function usage(engine) {
	const out = new Map()
	for (const fx of engine.fixtures) {
		if (!fx.to) continue
		const k = keyOf(fx)
		if (!out.has(k)) {
			const u = engine._uni.get(k)
			out.set(k, { protocol: fx.protocol, universe: fx.universe, dest: `${fx.to.host}:${fx.to.port}`,
				live: u ? engine._live(u) : false, used: 0, fixtures: [] })
		}
		const row = out.get(k)
		const slots = fx.slots.length ? fx.slots : [fx.address - 1]
		row.fixtures.push({ id: fx.id, name: fx.name, address: fx.address, from: Math.min(...slots) + 1,
			to: Math.max(...slots) + 1, channels: fx.slots.length, problem: fx.problem })
		if (!fx.problem && fx.enabled) row.used += fx.slots.length
	}
	return [...out.values()].sort((a, b) => a.protocol.localeCompare(b.protocol) || a.universe - b.universe)
}

function frame(engine, query) {
	const protocol = query?.protocol === 'sacn' ? 'sacn' : 'artnet'
	const universe = Number(query?.universe)
	const u = [...engine._uni.values()].find((x) => x.protocol === protocol && x.universe === universe &&
		(!query?.dest || `${x.to.host}:${x.to.port}` === query.dest))
	if (!u) return reply(404, { error: 'no patched universe there' })
	return reply(200, { protocol, universe, dest: `${u.to.host}:${u.to.port}`, live: engine._live(u), data: [...u.buf] })
}

function handleProgram(method, body, query, service) {
	const engine = service.engine
	if (method === 'GET') return reply(200, { values: engine.values() })
	if (method === 'DELETE') {
		engine.clearProgram(query?.id ? [String(query.id)] : undefined)
		return reply(200, { ok: true })
	}
	const b = parseBody(body) || {}
	const ids = Array.isArray(b.ids) ? b.ids.map(String) : b.id != null ? [String(b.id)] : []
	if (!ids.length) return reply(400, { error: 'ids (or id) required' })
	if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values)) return reply(400, { error: 'values object required' })
	return reply(200, { changed: engine.program(ids, b.values, { replace: b.replace === true }) })
}

function handleAim(body, service) {
	const b = parseBody(body) || {}
	const ids = Array.isArray(b.ids) ? b.ids.map(String) : []
	const t = Array.isArray(b.target) ? b.target.slice(0, 3).map(Number) : []
	if (!ids.length) return reply(400, { error: 'ids required' })
	if (t.length !== 3 || !t.every(Number.isFinite)) return reply(400, { error: 'target [x, y, z] (metres) required' })
	return reply(200, service.aim(ids, t))
}

function register(routes) {
	const opt = { requireCaspar: false }
	const svc = (ctx) => ctx?.fixtureService || null
	routes.get('/api/fixtures/dmx', ({ ctx }) => {
		const s = svc(ctx)
		return s ? reply(200, { dmx: s.engine.status().dmx, universes: usage(s.engine) }) : reply(503, NO_ENGINE)
	}, opt)
	routes.get('/api/fixtures/dmx/frame', ({ ctx, query }) => (svc(ctx) ? frame(svc(ctx).engine, query) : reply(503, NO_ENGINE)), opt)
	const program = (method) => ({ ctx, body, query }) =>
		svc(ctx) ? handleProgram(method, body, query, svc(ctx)) : reply(503, NO_ENGINE)
	routes.get('/api/fixtures/program', program('GET'), opt)
	routes.post('/api/fixtures/program', program('POST'), opt)
	routes.delete('/api/fixtures/program', program('DELETE'), opt)
	routes.get('/api/fixtures/program/features', ({ ctx, query }) => {
		const ids = query?.ids ? String(query.ids).split(',').filter(Boolean) : null
		return svc(ctx) ? reply(200, { fixtures: svc(ctx).features(ids) }) : reply(503, NO_ENGINE)
	}, opt)
	routes.post('/api/fixtures/program/aim', ({ ctx, body }) => (svc(ctx) ? handleAim(body, svc(ctx)) : reply(503, NO_ENGINE)), opt)
}

module.exports = { register, usage, frame, handleProgram, handleAim }
