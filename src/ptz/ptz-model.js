'use strict'

/**
 * WO-711 — PTZ camera entries in `project.previs.tracking.ptz` (Godot-owned slice, CLIENT_OWNED_SLICES) and the
 * geometry that turns a stage point into pan / tilt. Pure. The Godot twin is
 * godot/client/features/previs/tracking/ptz_model.gd; both normalize the same way.
 *
 *   ptz: [{ id, name, enabled (false), auto (false),
 *           protocol: "visca-udp" | "visca-ip", host, port (1259 / 52381), address 1-7 (1),
 *           pose: { x, y, z (PSN m, as fixtures' pose), yaw ° (0 = facing upstage, 90 = stage left — as fixtures),
 *                   pitch ° (+ up; where tilt 0 looks) },
 *           pan:  { min, max, units_per_deg, invert },  (-170…170, 14.4)
 *           tilt: { min, max, units_per_deg, invert },  (-30…90, 14.4)
 *           speed: { pan 1-24 (12), tilt 1-20 (10) },
 *           aim_z (1.4 m above the floor point), home: { preset 0-127 (0 = the VISCA Home command) },
 *           zoom: null | 0…65535 (a fixed zoom position, sent when following starts) }]
 *
 * Defaults match a PTZOptics unit: pan ±170° = ±2448 units and tilt −30…+90° at the same 14.4 units / degree
 * (derived, not read off a camera — see WO-711). Sony BRC / EVI units use other scales; the operator edits
 * units_per_deg and the ranges per camera (read the camera's position inquiry at a known angle to measure it). Positive pan = to the
 * camera's right, positive tilt = up (VISCA). `invert` flips the sign for a ceiling-mounted unit.
 */

const { PROTOCOLS, DEFAULT_PORTS } = require('./visca')

const DEG = 180 / Math.PI

const num = (v, d, lo, hi) => {
	const n = Number(v)
	return Number.isFinite(n) && v !== null && v !== '' && typeof v !== 'boolean' ? Math.max(lo, Math.min(hi, n)) : d
}
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi))

function axis(a, min, max, upd) {
	const o = a && typeof a === 'object' ? a : {}
	let lo = num(o.min, min, -360, 360)
	let hi = num(o.max, max, -360, 360)
	if (lo > hi) [lo, hi] = [hi, lo]
	return { min: lo, max: hi, units_per_deg: num(o.units_per_deg, upd, 0.01, 1000), invert: o.invert === true }
}

function normalizeCamera(raw, i = 0) {
	const o = raw && typeof raw === 'object' ? raw : {}
	const pose = o.pose && typeof o.pose === 'object' ? o.pose : {}
	const speed = o.speed && typeof o.speed === 'object' ? o.speed : {}
	const home = o.home && typeof o.home === 'object' ? o.home : {}
	const protocol = PROTOCOLS.includes(o.protocol) ? o.protocol : 'visca-udp'
	const zoom = o.zoom === null || o.zoom === undefined || o.zoom === '' ? null : int(o.zoom, 0, 0, 65535)
	return {
		id: String(o.id || `ptz${i + 1}`),
		name: String(o.name || `PTZ ${i + 1}`),
		enabled: o.enabled === true,
		auto: o.auto === true,
		protocol,
		host: typeof o.host === 'string' ? o.host.trim() : '',
		port: int(o.port, DEFAULT_PORTS[protocol], 1, 65535),
		address: int(o.address, 1, 1, 7),
		pose: {
			x: num(pose.x, 0, -500, 500),
			y: num(pose.y, -8, -500, 500),
			z: num(pose.z, 2.5, -50, 200),
			yaw: num(pose.yaw, 0, -360, 360),
			pitch: num(pose.pitch, 0, -89, 89),
		},
		pan: axis(o.pan, -170, 170, 14.4),
		tilt: axis(o.tilt, -30, 90, 14.4),
		speed: { pan: int(speed.pan, 12, 1, 24), tilt: int(speed.tilt, 10, 1, 20) },
		aim_z: num(o.aim_z, 1.4, -5, 10),
		home: { preset: int(home.preset, 0, 0, 127) },
		zoom,
	}
}

/** project.previs.tracking.ptz -> normalized list with unique ids. Junk entries are skipped. */
function normalizeList(list) {
	const out = []
	const seen = new Set()
	for (const raw of Array.isArray(list) ? list : []) {
		if (!raw || typeof raw !== 'object') continue
		const c = normalizeCamera(raw, out.length)
		while (seen.has(c.id)) c.id += '_'
		seen.add(c.id)
		out.push(c)
	}
	return out
}

/** Wrap degrees into (-180, 180]. */
function wrap180(d) {
	const r = ((((d + 180) % 360) + 360) % 360) - 180
	return r === -180 ? 180 : r
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * Pan / tilt degrees (camera frame, + right / + up) that point the camera at a stage point, clamped to its ranges.
 * target = { x, y, z } PSN metres (z = the floor point; aim_z is added). `clamped` is true when a range cut the aim.
 * A target straight above / below the camera keeps pan 0.
 */
function aimAngles(cam, target) {
	const dx = Number(target.x) - cam.pose.x
	const dy = Number(target.y) - cam.pose.y
	const dz = Number(target.z) + cam.aim_z - cam.pose.z
	const horiz = Math.hypot(dx, dy)
	// yaw 0 faces +Y (upstage), 90 faces +X (stage left): bearing = atan2(dx, dy), clockwise seen from above.
	const bearing = horiz < 1e-6 ? cam.pose.yaw : Math.atan2(dx, dy) * DEG
	const panWant = wrap180(bearing - cam.pose.yaw)
	const tiltWant = Math.atan2(dz, horiz) * DEG - cam.pose.pitch
	const pan = clamp(panWant, cam.pan.min, cam.pan.max)
	const tilt = clamp(tiltWant, cam.tilt.min, cam.tilt.max)
	return { pan, tilt, clamped: pan !== panWant || tilt !== tiltWant }
}

/** Degrees -> signed 16-bit camera units (units_per_deg, invert). */
function toUnits(axisCfg, deg) {
	const u = Math.round(deg * axisCfg.units_per_deg) * (axisCfg.invert ? -1 : 1)
	return clamp(u === 0 ? 0 : u, -32768, 32767)
}

module.exports = { normalizeCamera, normalizeList, aimAngles, toUnits, wrap180 }
