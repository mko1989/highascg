/**
 * Tracking module registration (WO-616; WO-19 / WO-30 boundaries).
 *
 * Loaded by `src/module-registry.tryLoad('tracking')` when the Tracking plugin is enabled. Owns the marker hub
 * (`marker-hub.js`): sources write markers over WS (`tracking:marker`, the Godot camera view's driver) or HTTP;
 * every client gets `tracking:markers` (≤ 30 Hz while anything moves, a 1 Hz heartbeat, and at once when a marker
 * goes stale). `ctx.trackingHub` is the hub for server consumers. No PSN / OSC output: dropped by the owner
 * 2026-10-19 (WO-616 T6) — markers leave the box as Art-Net through the follow engine (T11,
 * src/fixtures/follow-service.js: hub → pan / tilt → ArtDmx, patch in `project.fixtures`).
 *
 * HTTP: GET /api/tracking/markers · POST /api/tracking/markers {id,x,y,z,name?} or {markers:[…]} ·
 *       DELETE /api/tracking/markers/<id> · GET /api/tracking/stats · GET /api/tracking/follow (engine status)
 * WS out: tracking:markers · tracking:follow {output_enabled, fixtures:[{id,state,pan,tilt,problem}]} (≤ 10 Hz on change)
 */

'use strict'

const { MarkerHub, MARKER_STALE_AFTER_MS } = require('./marker-hub')
const { createFollowService } = require('../fixtures/follow-service')

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
const TICK_MS = 33
const HEARTBEAT_MS = 1000
const WS_EVENT = 'tracking:markers'
const FOLLOW_EVENT = 'tracking:follow'
const FOLLOW_MS = 100

const hub = new MarkerHub()
let _timer = null
let _ctx = null
let _sent = { rev: -1, stale: '', at: 0 }
let _writes = 0
let _follow = null
let _followSent = { json: '', at: 0 }

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: JSON.stringify(obj) })

/** One marker or {markers: [...]} → { accepted, errors[] } */
function apply(data, source) {
	const list = Array.isArray(data?.markers) ? data.markers : [data]
	const errors = []
	let accepted = 0
	for (const m of list) {
		const r = hub.set({ ...m, source: m?.source || source })
		if (r.ok) accepted++
		else errors.push({ id: m?.id ?? null, error: r.error })
	}
	_writes += accepted
	return { accepted, errors }
}

/** Broadcast when a write landed, the stale set changed, or the heartbeat is due (never for an empty, idle hub). */
function tick(force = false) {
	if (!_ctx || typeof _ctx._wsBroadcast !== 'function') return
	const now = hub.now()
	const stale = hub.staleKey(now)
	const due = now - _sent.at >= HEARTBEAT_MS && hub.markers.size > 0
	if (!force && hub.rev === _sent.rev && stale === _sent.stale && !due) return
	_sent = { rev: hub.rev, stale, at: now }
	_ctx._wsBroadcast(WS_EVENT, { markers: hub.list(now), stale_after_ms: MARKER_STALE_AFTER_MS })
}

/** Follow aims for the previs beams: ≤ 10 Hz, only when an aim / state changed. */
function followTick() {
	if (!_follow || !_ctx || typeof _ctx._wsBroadcast !== 'function') return
	const now = hub.now()
	if (now - _followSent.at < FOLLOW_MS) return
	const snap = _follow.snapshot()
	const json = JSON.stringify(snap)
	if (json === _followSent.json) return
	_followSent = { json, at: now }
	_ctx._wsBroadcast(FOLLOW_EVENT, snap)
}

async function handleApi({ method, path, body }) {
	if (method === 'GET' && path === '/api/tracking/stats') {
		return reply(200, { module: 'tracking', status: 'markers', markers: hub.markers.size, writes: _writes,
			stale_after_ms: MARKER_STALE_AFTER_MS, see: 'work/work-orders/616_WO_previs_tracking_openfollow_cameras.md' })
	}
	if (method === 'GET' && path === '/api/tracking/follow') {
		return _follow ? reply(200, _follow.status()) : reply(503, { error: 'follow engine not running' })
	}
	if (path === '/api/tracking/markers') {
		if (method === 'GET') return reply(200, { markers: hub.list(), stale_after_ms: MARKER_STALE_AFTER_MS })
		if (method === 'POST') {
			let data
			try {
				data = JSON.parse(body || '{}')
			} catch {
				return reply(400, { error: 'body must be JSON' })
			}
			const r = apply(data, 'api')
			tick()
			return reply(r.accepted > 0 || r.errors.length === 0 ? 200 : 400, r)
		}
	}
	const del = /^\/api\/tracking\/markers\/(\d+)$/.exec(path)
	if (del && method === 'DELETE') {
		const ok = hub.remove(Number(del[1]))
		tick()
		return reply(ok ? 200 : 404, { ok })
	}
	return null
}

/** Inbound `tracking:marker` {id,x,y,z,name?} | {markers:[…]} from a client (the Godot marker driver). */
function handleWs(msg, { ws }) {
	if (msg.type !== 'tracking:marker') return false
	const r = apply(msg.data, 'operator')
	if (r.errors.length && ws && typeof ws.send === 'function') {
		ws.send(JSON.stringify({ type: 'tracking:error', data: { errors: r.errors }, id: msg.id }))
	}
	return true
}

module.exports = {
	name: 'tracking',
	hub,
	apiPathPrefixes: ['/api/tracking'],
	handleApi,
	handleWs,
	wsNamespaces: ['tracking:'],
	webBundles: [],

	onBoot(ctx) {
		_ctx = ctx
		if (ctx) ctx.trackingHub = hub
		if (_timer) clearInterval(_timer)
		_timer = setInterval(() => {
			tick()
			followTick()
		}, TICK_MS)
		if (typeof _timer.unref === 'function') _timer.unref()
		if (ctx && typeof ctx.log === 'function') ctx.log('info', '[tracking] marker hub up (WO-616) — tracking:markers')
		if (_follow) _follow.stop()
		_follow = createFollowService(ctx, hub)
	},

	async onShutdown() {
		if (_timer) clearInterval(_timer)
		_timer = null
		if (_follow) _follow.stop()
		_follow = null
		if (_ctx && _ctx.trackingHub === hub) delete _ctx.trackingHub
		_ctx = null
	},
}
