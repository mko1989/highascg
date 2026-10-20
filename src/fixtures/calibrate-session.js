'use strict'

/**
 * WO-624 E3 / WO-616 T13 — the fixture calibration session behind POST /api/tracking/follow/calibrate (one per
 * fixture, in memory). Every step is a server action so the Godot Inspector only renders the reply:
 *
 *   {action: 'start', id}                      park the head where it is aimed (follow-engine hold)
 *   {action: 'jog', id, pan?, tilt?, dpan?, dtilt?}  absolute and / or relative commanded degrees
 *   {action: 'point', id, marker}              the beam spot is where `marker` stands → one (pan, tilt) ↔ point pair
 *   {action: 'point', id, at: [x, y, z]}       … or the floor spot the operator clicked in a camera picture
 *                                              (WO-630 F1: no marker to place first; PSN metres)
 *   {action: 'undo', id}                       drop the last pair
 *   {action: 'end', id}                        release the head (it follows its marker again)
 * Each reply carries the session and, from 3 pairs, the solved pose (calibrate-solve.js). The pose is applied by
 * the client: `project.fixtures` is a client-owned slice the server cannot write (CLIENT_OWNED_SLICES).
 */

const { solveFixturePose } = require('./calibrate-solve')

function createCalibration({ engine, hub }) {
	const sessions = new Map() // fixture id → { pan, tilt, points: [] }

	const view = (id) => {
		const s = sessions.get(id)
		const fx = engine.fixtures.find((f) => f.id === id)
		if (!s || !fx) return null
		// a pair taken before Invert pan was flipped meant the mirrored pan: re-read it in today's sense
		const pts = s.points.map((p) => ({ ...p, pan: p.inv === fx.pan.invert ? p.pan : -p.pan }))
		return { id, name: fx.name, pan: s.pan, tilt: s.tilt, points: pts, hang: fx.pose.hang,
			output_enabled: engine.enabled, problem: fx.problem || null,
			solve: solveFixturePose(pts, { hang: fx.pose.hang }) }
	}

	function handle(data) {
		const id = String(data?.id || '')
		const fx = engine.fixtures.find((f) => f.id === id)
		if (!fx) {
			sessions.delete(id)
			return { status: 404, body: { error: `no fixture "${id}" in the follow patch` } }
		}
		const s = sessions.get(id)
		const action = data?.action
		if (action === 'start') {
			const a = s || engine.aimOf(id)
			const held = engine.hold(id, a.pan, a.tilt)
			sessions.set(id, { ...held, points: s ? s.points : [] })
			return { status: 200, body: view(id) }
		}
		if (action === 'end') {
			engine.release(id)
			sessions.delete(id)
			return { status: 200, body: { id, ended: true } }
		}
		if (!s) return { status: 409, body: { error: `${fx.name} is not being calibrated — start first` } }
		if (action === 'jog') {
			const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))
			const pan = num(data.pan) ?? s.pan
			const tilt = num(data.tilt) ?? s.tilt
			const next = [pan + (num(data.dpan) || 0), tilt + (num(data.dtilt) || 0)]
			if (!next.every(Number.isFinite)) return { status: 400, body: { error: 'pan / tilt must be numbers' } }
			Object.assign(s, engine.hold(id, next[0], next[1]))
			return { status: 200, body: view(id) }
		}
		if (action === 'point') {
			const at = Array.isArray(data.at) ? data.at.map(Number) : null
			if (at && (at.length !== 3 || !at.every((v) => Number.isFinite(v) && Math.abs(v) <= 500))) {
				return { status: 400, body: { error: 'at must be [x, y, z] in metres, within 500 m of the origin' } }
			}
			const m = at ? { x: at[0], y: at[1], z: at[2] } : (hub.list(hub.now()) || []).find((k) => k.id === Number(data.marker))
			if (!m) return { status: 404, body: { error: `no marker ${data.marker} — place one on the beam spot` } }
			// a stale marker still stands where the operator dropped it — its position is all a pair needs
			Object.assign(s, engine.hold(id, s.pan, s.tilt)) // refresh the hold's TTL
			s.points.push({ pan: s.pan, tilt: s.tilt, x: m.x, y: m.y, z: m.z, inv: fx.pan.invert })
			return { status: 200, body: view(id) }
		}
		if (action === 'undo') {
			s.points.pop()
			return { status: 200, body: view(id) }
		}
		return { status: 400, body: { error: 'action must be start | jog | point | undo | end' } }
	}

	return {
		handle,
		/** GET: every open session (a client re-entering the Inspector picks its state back up). */
		list: () => [...sessions.keys()].map(view).filter(Boolean),
	}
}

module.exports = { createCalibration }
