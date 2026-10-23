'use strict'

/**
 * WO-708 / WO-709 — HTTP + WS of the Auto director (auto-director.js), wired from register.js.
 *   GET  /api/tracking/auto                 → the director snapshot (pool, persons, slots ×9, home, ptz)
 *   POST /api/tracking/auto/pin  { key, slot }          slot 1–9 pins the person, 0 unpins
 *   POST /api/tracking/auto/slot { slot, heads?, ptz? } heads 0 = share; ptz = camera ids
 *   POST /api/tracking/auto/home { after_s?, now? }
 * Every POST answers with the new snapshot. WS `tracking:auto` = the snapshot, ≤ 5 Hz and only when it changed.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
const AUTO_EVENT = 'tracking:auto'
const AUTO_MS = 200

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: JSON.stringify(obj) })

/** → a route reply, or null when the path is not the director's. */
function handleAuto(director, { method, path, body }) {
	if (method === 'GET') return handleGet(director, path)
	if (method === 'POST') return handlePost(director, path, body)
	return null
}

function handleGet(director, path) {
	if (path === '/api/tracking/auto') {
		return director ? reply(200, director.snapshot()) : reply(503, { error: 'auto director not running' })
	}
	return null
}

function handlePost(director, path, body) {
	let op = null
	if (path === '/api/tracking/auto/pin') op = 'pin'
	else if (path === '/api/tracking/auto/slot') op = 'slot'
	else if (path === '/api/tracking/auto/home') op = 'home'
	if (!op) return null
	if (!director) return reply(503, { error: 'auto director not running' })
	let data
	try {
		data = JSON.parse(body || '{}')
	} catch {
		return reply(400, { error: 'body must be JSON' })
	}
	if (!data || typeof data !== 'object' || Array.isArray(data))
		return reply(400, { error: 'body must be a JSON object' })
	const r = director[op](data)
	return reply(r.status, r.body)
}

let _off = null

/** Keep the director's grid (home points) on the active project: ctx → load + subscribe; null → unsubscribe. */
function followProject(director, ctx) {
	if (_off) _off()
	_off = null
	if (!ctx) return
	const apply = (project) => director.configure(project)
	try {
		apply(require('../engine/project-scenes').loadFullProject())
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('warn', '[tracking] auto: project load: ' + (e?.message || e))
	}
	_off = require('../engine/project-events').onProjectChanged(apply)
}

/** WS `tracking:auto`: call every tick; sends at most every AUTO_MS, only when the snapshot changed. */
function createAutoBroadcast() {
	let sent = { json: '', at: 0 }
	return {
		tick(director, ctx, now) {
			if (!director || !ctx || typeof ctx._wsBroadcast !== 'function' || now - sent.at < AUTO_MS) return
			const snap = director.snapshot() // looked at ≤ 5 Hz, sent only when it changed
			const json = JSON.stringify(snap)
			const same = json === sent.json
			sent = { json, at: now }
			if (!same) ctx._wsBroadcast(AUTO_EVENT, snap)
		},
	}
}

module.exports = { handleAuto, createAutoBroadcast, followProject, reply, AUTO_EVENT }
