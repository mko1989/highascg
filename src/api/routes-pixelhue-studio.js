'use strict'

/**
 * routes-pixelhue-studio.js — WO-1039: the vendored PixelHue Studio's API for the Godot client's PixelHue tab.
 *
 *   GET  /api/pixelhue/studio/status[?reconnect=1]   { connected, host, device: { model, serial, … }, capabilities } | { connected: false, error }
 *   GET  /api/pixelhue/studio/<resource>[?query]     Studio's read of that resource   (Studio: GET /api/<resource>)
 *   POST /api/pixelhue/studio/<resource>  { … }      Studio's write of that resource  (Studio: PUT /api/<resource>)
 * Resources (src/pixelhue/vendor/pixelhue-studio: server.js + lib/studio-routes.js): state, windows, mvr-layers,
 * mvr-templates, inputs, input-advanced, input-timing, outputs, output-capacity, output-advanced, screens,
 * programming, programming/sources, programming/geometry, audio, device, device-action, self-test, source-backup,
 * gallery, gallery/thumb (image), gallery/manage.
 * The switcher is the one set in Devices ▸ PixelHue; sessions are the bridge's business (studio-bridge.js).
 * Studio's answers pass through unchanged, errors too ({ error }, its status).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { createStudioBridge } = require('../pixelhue/studio-bridge')

const BASE = '/api/pixelhue/studio/'
const RESOURCE_RE = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)?$/

let bridge = null
const theBridge = (deps) => deps.bridge || (bridge = bridge || createStudioBridge())
const hostOf = (deps) => (deps.readSettings || require('./routes-pixelhue').readSettings)().host

function queryString(query, drop = []) {
	const q = new URLSearchParams()
	for (const [k, v] of Object.entries(query || {})) if (!drop.includes(k) && k !== 'session' && v != null) q.set(k, String(v))
	const s = q.toString()
	return s ? `?${s}` : ''
}

async function handleStudio(method, p, query, body, deps = {}) {
	const resource = String(p).slice(BASE.length).replace(/\/+$/, '')
	if (resource === 'status' && method === 'GET') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(await theBridge(deps).status(hostOf(deps), query?.reconnect === '1')) }
	}
	if (!RESOURCE_RE.test(resource) || resource === 'connect' || resource === 'discovery') {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'no such PixelHue Studio resource' }) }
	}
	const r = await theBridge(deps).call(method, `/api/${resource}${queryString(query)}`, method === 'POST' ? parseBody(body) || {} : undefined, hostOf(deps))
	return { status: r.status, headers: { 'Content-Type': r.type, 'Cache-Control': 'no-store' }, body: r.type.includes('json') ? r.body.toString('utf8') : r.body }
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get(BASE + '*', ({ path: p, query }) => handleStudio('GET', p, query), opt)
	routes.post(BASE + '*', ({ path: p, query, body }) => handleStudio('POST', p, query, body), opt)
}

module.exports = { register, handleStudio }
