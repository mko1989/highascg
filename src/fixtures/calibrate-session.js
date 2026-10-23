'use strict'

/**
 * WO-624 E3 / WO-616 T13 — the fixture calibration session behind POST /api/tracking/follow/calibrate (one per
 * fixture, in memory). Every step is a server action so the Godot Inspector only renders the reply:
 *
 *   {action: 'start', id}                      park the head where it is aimed (follow-engine hold)
 *   {action: 'start', id, hold: false}         WO-700: leave the head alone (Lighting → Calibrate heads): the real
 *                                              beam is aimed by the Programmer or the console; nothing is sent
 *                                              for the session; each point takes the angles the head is getting
 *                                              (`frame(fx)`: the console's input in visualiser mode, else ours) and
 *                                              solves the pan / tilt offset (R3: the head never moves) — from 1 point;
 *                                              R7: each point pins its mark exactly (beam-offset.js offset_map)
 *   {action: 'jog', id, pan?, tilt?, dpan?, dtilt?}  absolute and / or relative commanded degrees
 *   {action: 'point', id, marker}              the beam spot is where `marker` stands → one (pan, tilt) ↔ point pair
 *   {action: 'point', id, at: [x, y, z]}       … or the floor spot the operator clicked in a camera picture
 *                                              (WO-630 F1: no marker to place first; PSN metres)
 *   {action: 'undo', id}                       drop the last pair
 *   {action: 'end', id}                        release the head (it follows its marker again)
 * Each reply carries the session and, from 3 pairs, the solved pose (calibrate-solve.js) — a live session the solved
 * offset and the one it started from (`offset0`). Either is applied by the client: `project.fixtures` is a client-owned slice the server cannot write (CLIENT_OWNED_SLICES).
 */

const { solveFixturePose, solveOffsets } = require('./calibrate-solve')
const { axisFn, beamOf } = require('./gdtf-ik')
const { addPin, normalizeMap } = require('./beam-offset')

const wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180

/**
 * WO-700 R7: the pinned marks a live session leaves on the head — the ones it started with, each new point added
 * (beam-offset.js addPin: the same mark again replaces its pin). The solve carries the whole list (the client writes
 * it into the patch) and, for the Inspector, how far one constant offset would miss (solveOffsets) — the hint that
 * the head is patched in the wrong spot.
 */
function liveSolve(s, pts, lm, fx) {
	if (!pts.length) return { ok: false, need: 1 }
	let map = s.map0
	for (const p of pts) map = addPin(map, { pan: p.pan, tilt: p.tilt, dpan: p.dpan, dtilt: p.dtilt })
	const one = solveOffsets(pts, lm.forward, { pose: fx.pose })
	return { ok: true, map, pinned: pts.length, rms_deg: one.rms_deg, warning: one.warning }
}

/**
 * WO-700: a live session's head — a typed head with an Axis chain, modelled as the previs draws it (gdtf-ik.js
 * beamOf at the angles sent + the offset). null for anything else (nothing to calibrate it against).
 */
function liveModel(fx) {
	const chain = fx.gdtf?.chain
	const axes = ['Pan', 'Tilt'].map((a) =>
		fx.gdtf?.channels.find((c) => (c.functions[c.initial] || c.functions[0])?.attribute === a)
	)
	if (!chain || !fx.pose || axes.some((c) => !c) || !axisFn(fx, 'Pan') || !axisFn(fx, 'Tilt')) return null
	/** The physical angle channel c is at in `buf` (as gdtf-visual.js decodes its initial function). */
	const phys = (c, buf) => {
		const f = c.functions[c.initial] || c.functions[0]
		let dmx = 0
		for (const o of c.offsets) dmx = dmx * 256 + (buf[fx.address - 2 + o] ?? 0)
		const t = f.to === f.from ? 0 : Math.max(0, Math.min(1, (dmx - f.from) / (f.to - f.from)))
		return f.physFrom + t * (f.physTo - f.physFrom)
	}
	return {
		read: (buf) => (buf ? { pan: phys(axes[0], buf), tilt: phys(axes[1], buf), inv: null } : null),
		forward: (pan, tilt, pose = fx.pose) => beamOf(chain, pose, pan, tilt),
	}
}

/** @param {{ engine, hub, frame?: (fx) => Uint8Array | null }} deps frame: the bytes fx's real head gets (WO-700) */
function createCalibration({ engine, hub, frame = (fx) => (engine.isLive(fx) ? engine.frameOf(fx) : null) }) {
	const sessions = new Map() // fixture id → { pan, tilt, points: [] }

	const view = (id) => {
		const s = sessions.get(id)
		const fx = engine.fixtures.find((f) => f.id === id)
		if (!s || !fx) return null
		// a pair taken before Invert pan was flipped meant the mirrored pan: re-read it in today's sense
		// (a live point read in the file's sense, inv null, does not depend on the patch's flip)
		const pts = s.points.map((p) => ({ ...p, pan: p.inv === null || p.inv === fx.pan.invert ? p.pan : -p.pan }))
		const lm = s.live ? liveModel(fx) : null
		return {
			id,
			name: fx.name,
			pan: s.pan,
			tilt: s.tilt,
			live: !!s.live,
			offset0: s.offset0 || null,
			map0: s.live ? s.map0 : null,
			points: pts,
			hang: fx.pose.hang,
			output_enabled: engine.isLive(fx),
			problem: fx.problem || fx.noSend || null,
			solve: lm ? liveSolve(s, pts, lm, fx) : solveFixturePose(pts, { hang: fx.pose.hang }),
		}
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
			if (data.hold === false) {
				const lm = liveModel(fx)
				if (!lm) return { status: 409, body: { error: `${fx.name} has no GDTF pan / tilt head to calibrate` } }
				engine.release(id) // a camera-mode session on the same head handed over
				const a = lm.read(frame(fx)) || { pan: 0, tilt: 0 }
				const offset0 = s?.offset0 || { pan: fx.offset?.pan || 0, tilt: fx.offset?.tilt || 0 }
				const map0 = s?.live ? s.map0 : normalizeMap(fx.offset_map)
				sessions.set(id, { pan: a.pan, tilt: a.tilt, points: s?.live ? s.points : [], live: true, offset0, map0 })
				return { status: 200, body: view(id) }
			}
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
			if (s.live) return { status: 409, body: { error: 'aim this head with the programmer (Pan / Tilt)' } }
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
			const m = at
				? { x: at[0], y: at[1], z: at[2] }
				: (hub.list(hub.now()) || []).find((k) => k.id === Number(data.marker))
			if (!m) return { status: 404, body: { error: `no marker ${data.marker} — place one on the beam spot` } }
			// a stale marker still stands where the operator dropped it — its position is all a pair needs
			if (s.live) {
				const a = liveModel(fx)?.read(frame(fx))
				if (!a) {
					return {
						status: 409,
						body: { error: `no DMX for ${fx.name} — turn its DMX output on, or receive the console (Art-Net / sACN input)` },
					}
				}
				s.pan = a.pan
				s.tilt = a.tilt
				// R7: the correction that puts the beam exactly on this mark at these angles, over the trim now
				const pt = { pan: a.pan, tilt: a.tilt, x: m.x, y: m.y, z: m.z, inv: a.inv }
				const e = solveOffsets([pt], liveModel(fx).forward).offset
				pt.dpan = wrap(e.pan - (Number(fx.offset?.pan) || 0))
				pt.dtilt = wrap(e.tilt - (Number(fx.offset?.tilt) || 0))
				s.points.push(pt)
				return { status: 200, body: view(id) }
			}
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
