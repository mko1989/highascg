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
 *       · POST /api/tracking/detect/pick {key} (WO-624 E2: the replace pin follows this detected person)
 *       · GET / POST /api/tracking/follow/calibrate {action, id, …} (WO-624 E3: fixture position calibration,
 *         src/fixtures/calibrate-session.js) · POST …/calibrate/spot {camera, action?, id?} (T13b: the server finds
 *         the beam spot in the camera picture, src/fixtures/calibrate-spot.js)
 * WS out: tracking:markers · tracking:follow {output_enabled, fixtures:[{id,state,pan,tilt,problem}]} (≤ 10 Hz on change)
 *         · tracking:zones {enabled, zones:[{id,occupied,count,occupants,last_kind}]} (on change)
 * Zones (T7, src/tracking/zone-service.js): GET /api/tracking/zones — occupancy + the last 20 transitions fired.
 * Detection (T9, src/tracking/detect-service.js): GET /api/tracking/detections — sidecar state + latest persons;
 *       WS tracking:detections {enabled, running, cameras:[{id,role,frame,stale,persons:[{tid,box,score,age_s,floor}]}]}
 *       (≤ 15 Hz while persons change, and when a camera goes stale); a person a marker is pinned to carries `marker`.
 * Pinning (T9b, src/tracking/detect-pin.js) runs every tick: replace / assist write the hub (source 'detect'). In
 * assist, operator writes (WS / HTTP) become the marker's ANCHOR, not its position; markers broadcasts then carry
 * `anchor: {x, y, z}` next to the AI-corrected output, so the client keeps steering the anchor. In replace, operator
 * writes to the pinned marker are dropped while the pin drives it (status 0 = nobody tracked, held in place) and it
 * carries `driven: true` — the client stops heartbeating it (never inferred from `source`: a dead anchor leaves
 * source 'detect' on a marker nobody drives, and the operator must be able to take it back).
 * Fusion (T10, src/tracking/fusion.js) steps every tick on each watched camera's latest frame: tracking:detections
 * carries `world: {fused, plane_z, persons:[{id,x,y,vx,vy,height,source,cameras,keys,score,area,age_s,marker?}]}`; each
 * camera person the world person it belongs to (`world: id`). With 2+ solved cameras (`fused`) the pin follows
 * world persons (key `w:<id>`), so a person hidden in one camera stays pinned from the other.
 * Verification walk (T10d, src/tracking/verify-walk.js): GET /api/tracking/verify · POST {action: 'start', a: [x,y],
 *       b: [x,y], person?} | {action: 'stop'} | {action: 'reset'} — sampled after every fusion step with a new frame.
 */

'use strict'

const { MarkerHub, MARKER_STALE_AFTER_MS } = require('./marker-hub')
const { createFollowService } = require('../fixtures/follow-service')
const { createCalibration } = require('../fixtures/calibrate-session')
const { createSpotFinder, LEASE_ID: SPOT_LEASE_ID } = require('../fixtures/calibrate-spot')
const { createZoneService } = require('./zone-service')
const { createDetectService } = require('./detect-service')
const { DetectPin } = require('./detect-pin')
const { Fusion } = require('./fusion')
const { VerifyWalk } = require('./verify-walk')

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
const TICK_MS = 33
const HEARTBEAT_MS = 1000
const WS_EVENT = 'tracking:markers'
const FOLLOW_EVENT = 'tracking:follow'
const FOLLOW_MS = 100
const ZONES_EVENT = 'tracking:zones'
const DETECT_EVENT = 'tracking:detections'
const DETECT_MS = 66

const hub = new MarkerHub()
let _timer = null
let _ctx = null
let _sent = { rev: -1, stale: '', at: 0 }
let _writes = 0
let _follow = null
let _calib = null
let _spot = null
let _followSent = { json: '', at: 0 }
let _zones = null
let _zonesSent = ''
let _detect = null
let _detectSent = { json: '', at: 0 }
const pin = new DetectPin()
const fusion = new Fusion()
const walk = new VerifyWalk()
let _pinAt = 0

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: JSON.stringify(obj) })

/** One marker or {markers: [...]} → { accepted, errors[] } */
function apply(data, source) {
	const list = Array.isArray(data?.markers) ? data.markers : [data]
	const errors = []
	let accepted = 0
	const assist = DetectPin.assistActive(_detect?.config)
	for (const m of list) {
		if (assist && (m?.source || source) === 'operator' && pin.setAnchor(m, hub.now())) {
			accepted++ // the anchor; the pin moves the output (seeded here the first time)
			if (!hub.markers.has(Number(m.id))) hub.set({ ...m, source: 'operator' })
			continue
		}
		if ((m?.source || source) === 'operator' && pin.drives(Number(m?.id))) {
			accepted++ // replace: detection owns this marker; the client's heartbeat must not flap its source
			continue
		}
		const r = hub.set({ ...m, source: m?.source || source })
		if (r.ok) accepted++
		else errors.push({ id: m?.id ?? null, error: r.error })
	}
	_writes += accepted
	return { accepted, errors }
}

/** Hub markers + each assisted marker's anchor (the operator's own position) / `driven` while the replace pin owns it. */
function markersView(now = hub.now()) {
	return hub.list(now).map((m) => {
		const a = pin.anchor(m.id)
		if (a) return { ...m, anchor: { x: a.x, y: a.y, z: a.z } }
		return pin.drives(m.id) ? { ...m, driven: true } : m
	})
}

/** Detection pinning, every tick (dt-corrected, OpenFollow's animate clock). */
function pinTick() {
	if (!_detect) return
	const now = hub.now()
	const dt = _pinAt ? (now - _pinAt) / 1000 : TICK_MS / 1000
	_pinAt = now
	const cfg = _detect.config
	const stepped = cfg.enabled && fusion.step({ cams: _detect.frames(), now, planeZ: _detect.planeZ })
	if (!cfg.enabled) fusion.reset()
	if (stepped && walk.run) walk.sample(withPins(_detect.snapshot(), now), now)
	const persons = _detect.solvedCameras >= 2 ? worldPersons(now) : _detect.persons()
	pin.step({ cfg, available: _detect.available, persons, hub, planeZ: _detect.planeZ, now, dt })
}

/** Fused world persons in the pin's person shape (detect-pin.js T10b). */
function worldPersons(now) {
	return fusion.persons(now).map((w) => ({ key: `w:${w.id}`, camera: 'world', tid: w.id, world: [w.x, w.y], score: w.score, age_s: w.age_s, area: w.area }))
}

/** Broadcast when a write landed, the stale set changed, or the heartbeat is due (never for an empty, idle hub). */
function tick(force = false) {
	if (!_ctx || typeof _ctx._wsBroadcast !== 'function') return
	const now = hub.now()
	const stale = hub.staleKey(now)
	const due = now - _sent.at >= HEARTBEAT_MS && hub.markers.size > 0
	const rev = `${hub.rev}:${pin.rev}`
	if (!force && rev === _sent.rev && stale === _sent.stale && !due) return
	_sent = { rev, stale, at: now }
	_ctx._wsBroadcast(WS_EVENT, { markers: markersView(now), stale_after_ms: MARKER_STALE_AFTER_MS })
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

/** Zone occupancy: only when it changed (the engine itself evaluates at 10 Hz). */
function zonesTick() {
	if (!_zones || !_ctx || typeof _ctx._wsBroadcast !== 'function') return
	const snap = _zones.snapshot()
	const json = JSON.stringify(snap)
	if (json === _zonesSent) return
	_zonesSent = json
	_ctx._wsBroadcast(ZONES_EVENT, snap)
}

/**
 * A detections snapshot + `world` (fusion) — `marker` on each person a marker is pinned to, a camera person also
 * when the world person it belongs to (`world: id`, from the latest fusion step only) is pinned. Copies: the
 * service's own lists stay clean.
 */
function withPins(snap, now = hub.now()) {
	const att = pin.attached()
	const world = fusion.persons(now)
	const owner = new Map()
	for (const w of world) if (w.age_s === 0) for (const k of w.keys) owner.set(k, w.id)
	for (const c of snap.cameras) {
		c.persons = c.persons.map((p) => {
			const k = `${c.id}:${p.tid}`
			const wid = owner.get(k)
			const m = att[k] ?? (wid !== undefined ? att[`w:${wid}`] : undefined)
			if (wid === undefined && m === undefined) return p
			const q = wid !== undefined ? { ...p, world: wid } : { ...p }
			if (m !== undefined) q.marker = m
			return q
		})
	}
	snap.world = { fused: !!_detect && _detect.solvedCameras >= 2, plane_z: _detect ? _detect.planeZ : 0, persons: world.map((w) => (att[`w:${w.id}`] !== undefined ? { ...w, marker: att[`w:${w.id}`] } : w)) }
	return snap
}

/** Detected persons: ≤ 15 Hz, only when something changed (a step with the same boxes sends nothing). */
function detectTick() {
	if (!_detect || !_ctx || typeof _ctx._wsBroadcast !== 'function') return
	const now = hub.now()
	if (now - _detectSent.at < DETECT_MS) return
	const snap = withPins(_detect.snapshot())
	const json = JSON.stringify(snap)
	if (json === _detectSent.json) return
	_detectSent = { json, at: now }
	_ctx._wsBroadcast(DETECT_EVENT, snap)
}

/**
 * WO-624 E2 — POST /api/tracking/detect/pick {key}: the operator picked a detected person (a box clicked in the camera
 * view; `camera:tid`, or `w:<id>` for a fused world person). The replace pin takes it next (detect-pin.js request);
 * until the project's pin_mode is replace the pick waits (PICK_TTL_MS) — the client switches the mode itself
 * (project.previs is client-owned).
 */
function pick(body) {
	let data
	try {
		data = JSON.parse(body || '{}')
	} catch {
		return reply(400, { error: 'body must be JSON' })
	}
	if (!_detect) return reply(503, { error: 'detection service not running' })
	const key = String(data?.key || '')
	if (!/^\S+:\d+$/.test(key)) return reply(400, { error: 'key must be camera:tid or w:<id>' })
	const now = hub.now()
	const persons = _detect.solvedCameras >= 2 ? worldPersons(now) : _detect.persons()
	if (!persons.some((p) => p.key === key)) return reply(404, { error: `no detected person ${key} right now` })
	pin.request(key, now)
	const cfg = _detect.config
	return reply(200, {
		ok: true,
		key,
		pin_mode: cfg.pin_mode,
		marker: cfg.pin_marker_id,
		waiting_for_replace: !cfg.enabled || cfg.pin_mode !== 'replace',
		marker_missing: !hub.markers.has(cfg.pin_marker_id),
	})
}

async function handleApi({ method, path, body }) {
	if (method === 'GET' && path === '/api/tracking/stats') {
		return reply(200, { module: 'tracking', status: 'markers', markers: hub.markers.size, writes: _writes,
			stale_after_ms: MARKER_STALE_AFTER_MS, see: 'work/work-orders/616_WO_previs_tracking_openfollow_cameras.md' })
	}
	if (method === 'GET' && path === '/api/tracking/follow') {
		return _follow ? reply(200, _follow.status()) : reply(503, { error: 'follow engine not running' })
	}
	if (method === 'GET' && path === '/api/tracking/zones') {
		return _zones ? reply(200, _zones.status()) : reply(503, { error: 'zone engine not running' })
	}
	if (method === 'GET' && path === '/api/tracking/detections') {
		return _detect ? reply(200, withPins(_detect.status())) : reply(503, { error: 'detection service not running' })
	}
	if (path === '/api/tracking/verify') {
		if (method === 'GET') return reply(200, walk.status(hub.now()))
		if (method === 'POST') {
			let data
			try {
				data = JSON.parse(body || '{}')
			} catch {
				return reply(400, { error: 'body must be JSON' })
			}
			const now = hub.now()
			if (data.action === 'start') {
				const r = walk.start(data, now)
				return reply(r.ok ? 200 : 400, r.ok ? walk.status(now) : r)
			}
			if (data.action === 'stop') {
				walk.stop(now)
				return reply(200, walk.status(now))
			}
			if (data.action === 'reset') {
				walk.reset()
				return reply(200, walk.status(now))
			}
			return reply(400, { error: 'action must be start | stop | reset' })
		}
	}
	if (method === 'POST' && path === '/api/tracking/detect/pick') return pick(body)
	if (method === 'POST' && path === '/api/tracking/follow/calibrate/spot') {
		if (!_spot) return reply(503, { error: 'follow engine not running' })
		let data
		try {
			data = JSON.parse(body || '{}')
		} catch {
			return reply(400, { error: 'body must be JSON' })
		}
		const r = await _spot.handle(data)
		return reply(r.status, r.body)
	}
	if (path === '/api/tracking/follow/calibrate') {
		if (!_calib) return reply(503, { error: 'follow engine not running' })
		if (method === 'GET') return reply(200, { sessions: _calib.list() })
		if (method === 'POST') {
			let data
			try {
				data = JSON.parse(body || '{}')
			} catch {
				return reply(400, { error: 'body must be JSON' })
			}
			const r = _calib.handle(data)
			return reply(r.status, r.body)
		}
	}
	if (path === '/api/tracking/markers') {
		if (method === 'GET') return reply(200, { markers: markersView(), stale_after_ms: MARKER_STALE_AFTER_MS })
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
			pinTick()
			tick()
			followTick()
			zonesTick()
			detectTick()
		}, TICK_MS)
		if (typeof _timer.unref === 'function') _timer.unref()
		if (ctx && typeof ctx.log === 'function') ctx.log('info', '[tracking] marker hub up (WO-616) — tracking:markers')
		if (_follow) _follow.stop()
		_follow = createFollowService(ctx, hub)
		_calib = createCalibration({ engine: _follow.engine, hub })
		_spot = createSpotFinder({
			calib: _calib,
			project: () => require('../engine/project-scenes').loadFullProject(),
			lease: (roles) => require('../system/video-surfaces').getVideoSurfaceManager(ctx).lease(SPOT_LEASE_ID, roles),
		})
		if (_zones) _zones.stop()
		_zones = createZoneService(ctx, hub)
		_zonesSent = ''
		if (_detect) _detect.stop()
		_detect = createDetectService(ctx)
		_detectSent = { json: '', at: 0 }
		fusion.reset()
	},

	async onShutdown() {
		if (_timer) clearInterval(_timer)
		_timer = null
		if (_follow) _follow.stop()
		_follow = null
		_calib = null
		_spot = null
		if (_zones) _zones.stop()
		_zones = null
		if (_detect) _detect.stop()
		_detect = null
		if (_ctx && _ctx.trackingHub === hub) delete _ctx.trackingHub
		_ctx = null
	},
}
