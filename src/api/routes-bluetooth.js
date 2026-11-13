'use strict'

/**
 * WO-1066 — Bluetooth game controllers for Settings ▸ Controllers (src/bluetooth/bluetooth-pads.js).
 *   GET  /api/bluetooth              { ok, available, reason?, powered, scanning, devices: [{ address, name, paired,
 *                                      trusted, connected, gamepad }] } — controllers only
 *        ?all=1                      every named or classed device (a controller that does not say it is one)
 *   POST /api/bluetooth/scan         { seconds? }  start a timed discovery (default 30 s); answers at once
 *   POST /api/bluetooth/pair         { address }   pair + trust + connect
 *   POST /api/bluetooth/connect      { address }
 *   POST /api/bluetooth/disconnect   { address }
 *   POST /api/bluetooth/forget       { address }   remove the pairing
 *   POST /api/bluetooth/power        { on }
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { createBluetoothPads } = require('../bluetooth/bluetooth-pads')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })
let pads = null
const svc = (deps) => deps?.pads || (pads = pads || createBluetoothPads())

async function handleGet(query, deps) {
	return reply(200, await svc(deps).status({ all: String(query?.all || '') === '1' }))
}

async function handlePost(path, body, deps) {
	const b = parseBody(body) || {}
	const s = svc(deps)
	const op = path.replace('/api/bluetooth/', '')
	if (op === 'scan') return reply(200, s.startScan(b.seconds))
	if (op === 'power') return reply(200, await s.power(b.on !== false))
	const fn = { pair: s.pair, connect: s.connect, disconnect: s.disconnect, forget: s.forget }[op]
	if (!fn) return reply(404, { error: 'Not found' })
	const r = await fn(b.address)
	return reply(r.ok ? 200 : r.step === 'address' ? 400 : 409, r)
}

/** @param {import('./route-registry').RouteRegistry} routes */
function register(routes) {
	routes.get('/api/bluetooth', ({ query }) => handleGet(query), { requireCaspar: false })
	routes.post('/api/bluetooth/*', ({ path, body }) => handlePost(path, body), { requireCaspar: false })
}

module.exports = { register, handleGet, handlePost }
