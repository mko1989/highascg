'use strict'

/**
 * WO-713 R2 — calibrate a PTZ camera on a person standing on a mark (the head twin is WO-700 R7,
 * src/fixtures/calibrate-session.js). POST /api/tracking/ptz/calibrate { action, id, ... }, GET lists the open sessions.
 *
 *   start { id }                        hold the camera (the Auto director is ignored for it) where it was last sent;
 *                                       the session begins with the pins the camera has (cam.offset_map)
 *   jog { id, dpan?, dtilt?, pan?, tilt?, zoom? }  degrees, relative and / or absolute (clamped to the camera's range);
 *                                       zoom 0…65535 (VISCA direct). From an unknown position deltas start at 0 / 0
 *   point { id, marker } | { id, at: [x, y, z] }  the person on that mark is in the middle of the picture: the camera's
 *                                       held angles vs the geometric aim at mark + aim_z become one pin
 *                                       { pan, tilt, dpan, dtilt } (pan / tilt = the geometric angles, as aimAngles
 *                                       keys the blend); the same spot again (beam-offset.js addPin) replaces its pin
 *   undo { id }                         drop the last point · clear { id }  drop every pin (the camera's old ones too)
 *   end { id }                          release the camera
 * Every reply is the session view ({ id, name, pan, tilt, zoom, ttl_ms, pins, added, max_pins, points }). Nothing is
 * persisted here: the client writes `pins` into project.previs.tracking.ptz[i].offset_map (a client-owned slice).
 * The hold is the service's (60 s from the last action); a session whose hold lapsed is gone.
 */

const { geomAngles, wrap180, MAX_PINS, normalizePins } = require('./ptz-model')
const { addPin } = require('../fixtures/beam-offset')

const ACTIONS = ['start', 'jog', 'point', 'undo', 'clear', 'end']
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const fail = (status, error) => ({ status, body: { error } })

/** A number from a JSON field: undefined when absent, NaN when present but not a real number. */
const field = (v) => (v === undefined || v === null ? undefined : typeof v === 'number' ? v : NaN)

/**
 * @param {{ ptz: object, markerOf?: (id: number) => ({x:number,y:number,z:number}|undefined) }} deps
 *   ptz = the ptz service (camera, hold, release, holdOf)
 */
function createPtzCalibrate({ ptz, markerOf = () => undefined }) {
	const sessions = new Map() // camera id → { map0: pin[], points: [] }

	/** The live session of camera id, or null (a lapsed hold ends it). */
	const live = (id) => {
		const s = sessions.get(id)
		if (s && !ptz.holdOf(id)) sessions.delete(id)
		return sessions.get(id) || null
	}

	const pinsOf = (s) => s.points.reduce((m, p) => addPin(m, p.pin).slice(-MAX_PINS), s.map0)

	function view(id) {
		const s = live(id)
		const h = s && ptz.holdOf(id)
		if (!s || !h) return null
		const pins = pinsOf(s)
		return {
			id,
			name: ptz.camera(id)?.name ?? id,
			pan: h.pan,
			tilt: h.tilt,
			zoom: h.zoom,
			ttl_ms: h.ttl_ms,
			pins,
			added: s.points.length,
			max_pins: MAX_PINS,
			points: s.points.map((p) => ({ marker: p.marker, at: p.at, ...p.pin })),
		}
	}
	const ok = (id) => ({ status: 200, body: view(id) })

	function jog(id, cam, data) {
		const [dpan, dtilt, pan, tilt, zoom] = ['dpan', 'dtilt', 'pan', 'tilt', 'zoom'].map((k) => field(data[k]))
		const given = { dpan, dtilt, pan, tilt, zoom }
		for (const [k, v] of Object.entries(given)) if (Number.isNaN(v)) return fail(400, `${k} must be a number`)
		if (zoom !== undefined && !(Number.isInteger(zoom) && zoom >= 0 && zoom <= 65535))
			return fail(400, 'zoom must be an integer 0…65535')
		if ([dpan, dtilt, pan, tilt].some((v) => v !== undefined && !Number.isFinite(v)))
			return fail(400, 'angles must be finite')
		const cur = ptz.holdOf(id)
		const p = (pan ?? cur.pan ?? 0) + (dpan ?? 0)
		const t = (tilt ?? cur.tilt ?? 0) + (dtilt ?? 0)
		const patch = { pan: clamp(p, cam.pan.min, cam.pan.max), tilt: clamp(t, cam.tilt.min, cam.tilt.max) }
		if (zoom !== undefined) patch.zoom = zoom
		const r = ptz.hold(id, patch)
		return r.ok ? ok(id) : fail(r.status, r.error)
	}

	function point(id, cam, data) {
		const h = ptz.holdOf(id)
		const at = Array.isArray(data.at) ? data.at.map((v) => (typeof v === 'number' ? v : NaN)) : null
		if (data.at !== undefined && (!at || at.length !== 3 || !at.every((v) => Number.isFinite(v) && Math.abs(v) <= 500)))
			return fail(400, 'at must be [x, y, z] in metres, within 500 m of the origin')
		if (!at && data.marker === undefined) return fail(400, 'point needs marker or at')
		if (h.pan === null || h.tilt === null) return fail(409, 'jog the camera onto the person first')
		const m = at ? { x: at[0], y: at[1], z: at[2] } : markerOf(Number(data.marker))
		if (!m) return fail(404, `no marker ${data.marker} — pick a mark or place a marker on the person`)
		// the person stands on the mark: aim at mark + aim_z, as the director does
		const g = geomAngles(cam, m)
		const pin = { pan: g.pan, tilt: g.tilt, dpan: wrap180(h.pan - g.pan), dtilt: h.tilt - g.tilt }
		const kept = normalizePins([pin])[0]
		if (!kept || kept.dpan !== pin.dpan || kept.dtilt !== pin.dtilt)
			return fail(400, 'that pin is outside the valid range — check the camera pose')
		sessions.get(id).points.push({ pin, marker: at ? null : Number(data.marker), at: [m.x, m.y, m.z] })
		return ok(id)
	}

	function handle(data) {
		const action = data?.action
		if (!ACTIONS.includes(action)) return fail(400, `action must be ${ACTIONS.join(' | ')}`)
		const id = typeof data.id === 'string' ? data.id : ''
		if (!id) return fail(400, 'id (the camera id) is required')
		if (action === 'end') {
			ptz.release(id)
			const had = sessions.delete(id)
			return { status: 200, body: { id, ended: had } }
		}
		const cam = ptz.camera(id)
		if (!cam) return fail(404, `no PTZ camera "${id}"`)
		if (action === 'start') {
			const r = ptz.hold(id, {})
			if (!r.ok) return fail(r.status, r.error)
			if (!live(id)) sessions.set(id, { map0: cam.offset_map, points: [] })
			return ok(id)
		}
		const s = live(id)
		if (!s) return fail(409, `${cam.name} is not being calibrated — start first`)
		ptz.hold(id, {}) // any action refreshes the TTL
		if (action === 'jog') return jog(id, cam, data)
		if (action === 'point') return point(id, cam, data)
		if (action === 'undo') s.points.pop()
		else Object.assign(s, { map0: [], points: [] })
		return ok(id)
	}

	return { handle, list: () => [...sessions.keys()].map(view).filter(Boolean) }
}

module.exports = { createPtzCalibrate, ACTIONS }
