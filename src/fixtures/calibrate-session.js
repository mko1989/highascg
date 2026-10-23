'use strict'

/**
 * WO-624 E3 / WO-616 T13 — the fixture calibration session behind POST /api/tracking/follow/calibrate (one per
 * fixture, in memory). Every step is a server action so the Godot Inspector only renders the reply:
 *
 *   {action: 'start', id}                      park the head where it is aimed (follow-engine hold)
 *   {action: 'start', id, hold: false}         WO-700: leave the head alone (Lighting → Calibrate heads): the real
 *                                              beam is aimed by the Programmer or the console; nothing is sent
 *                                              for the session; each point takes the pan / tilt the head is getting
 *                                              (`frame(fx)`: the console's input in visualiser mode, else ours) and
 *                                              every point already moves the solved pose (prior = the pose at start)
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
const { axisDeg } = require('./follow-ik')
const { axisFn, beamOf, fileAxis, toPhys } = require('./gdtf-ik')

/**
 * WO-700: how a live session reads and models fixture fx. A typed head with an Axis chain is modelled as the previs
 * draws it (gdtf-ik.js beamOf, the file's sense — so the solved pose puts the digital beam on the mark); anything
 * else in the follow engine's commanded degrees (follow-ik.js, both pan senses).
 */
function liveModel(fx) {
	const pf = axisFn(fx, 'Pan')
	const tf = axisFn(fx, 'Tilt')
	const chain = fx.gdtf?.chain && pf && tf ? fx.gdtf.chain : null
	const pan = chain ? { ...fx.pan, ...fileAxis(pf, fx.pan) } : fx.pan
	const tilt = chain ? { ...fx.tilt, ...fileAxis(tf, fx.tilt) } : fx.tilt
	return {
		/** The pan / tilt in fx's bytes of `buf`, or null. */
		read(buf) {
			if (!buf || !fx.moving) return null
			const at = (ch) => buf[fx.address - 2 + ch] ?? 0
			const deg = (ax) => axisDeg(ax, [at(ax.ch), ax.fine ? at(ax.fine) : 0])
			return { pan: deg(pan), tilt: deg(tilt), inv: chain ? null : fx.pan.invert }
		},
		solveOpts: chain
			? {
					forward: (pose, p, t) => beamOf(chain, pose, toPhys(pf, pan, p), toPhys(tf, tilt, t)),
					senses: [1],
					extra: { pitch: fx.pose.pitch, roll: fx.pose.roll },
				}
			: {},
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
		const opts = s.live ? { ...liveModel(fx).solveOpts, prior: s.pose0 } : {}
		return {
			id,
			name: fx.name,
			pan: s.pan,
			tilt: s.tilt,
			live: !!s.live,
			pose0: s.pose0 || null,
			points: pts,
			hang: fx.pose.hang,
			output_enabled: engine.isLive(fx),
			problem: fx.problem || fx.noSend || null,
			solve: solveFixturePose(pts, { ...opts, hang: fx.pose.hang }),
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
				engine.release(id) // a camera-mode session on the same head handed over
				const a = liveModel(fx).read(frame(fx)) || engine.aimOf(id)
				const pose0 = s?.pose0 || { x: fx.pose.x, y: fx.pose.y, z: fx.pose.z, yaw: fx.pose.yaw || 0 }
				sessions.set(id, { pan: a.pan, tilt: a.tilt, points: s?.live ? s.points : [], live: true, pose0 })
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
				const a = liveModel(fx).read(frame(fx))
				if (!a) {
					return {
						status: 409,
						body: { error: `no DMX for ${fx.name} — turn its DMX output on, or receive the console (Art-Net / sACN input)` },
					}
				}
				s.pan = a.pan
				s.tilt = a.tilt
				s.points.push({ pan: a.pan, tilt: a.tilt, x: m.x, y: m.y, z: m.z, inv: a.inv })
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
