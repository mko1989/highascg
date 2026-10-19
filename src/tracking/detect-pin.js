'use strict'

/**
 * WO-616 T9b — detection pinning: drives hub markers from detected persons (detect-service persons, floor-cast here).
 *
 * Ported from OpenFollow (https://github.com/openfollowapp/openfollow @ 2f8aa257, AGPL-3.0-or-later):
 * openfollow/runtime/services_detection_pin.py, openfollow/runtime/frame_timing.py and the sticky pinned-person
 * pick of openfollow/video/detection.py (`tracked_detection`).
 * Copyright (C) 2026 The OpenFollow Project – Paul Hermann, Michel Honold, Vinzenz Schultz.
 *
 *   replace — one marker (`pin_marker_id`) is written from one tracked person: sticky by track while it lives
 *             (coasting included), else re-acquired nearest the last followed box centre (≤ 0.15 of the frame),
 *             else the largest box. Velocity-EMA + `prediction` lookahead + `smoothing` EMA on the floor point;
 *             the marker's validity (`status`) grades the score around `confidence` and fades over the coast window.
 *   assist  — the operator steers an ANCHOR (their writes are redirected here); the hub marker is the output and
 *             glides toward the person nearest the anchor within `assist_radius_m` (eased by `assist_strength`),
 *             or home to the anchor when nobody is in range. The outer glide is seeded once and never reset, so
 *             the output never snaps. Only boxes matched this step count (OpenFollow `detections`).
 *   `pin_point` top casts the box's top-centre onto the marker's own height; bottom casts the feet onto the grid.
 * Changes: JavaScript; several cameras (a person is `camera:tid`, re-acquire stays on the same camera); the replace
 * target is an explicit id; no paths / touch remote; an anchor nobody refreshed for ANCHOR_STALE_MS (the client went
 * away) stops being driven, so its marker goes stale like any other; box age is the sidecar's at its last step.
 * WO-616 T10b: with 2+ solved cameras the persons are FUSED world persons (fusion.js; key `w:<id>`, camera 'world',
 * `world: [x, y]`, `area` = largest member box) — no box to cast; re-acquire is by floor distance
 * (REACQUIRE_MAX_FLOOR_M) instead of picture distance, largest box still wins a fresh pick.
 */

const { boxPoint } = require('./detect-model')

const NOMINAL_FRAME_DT = 1 / 60
const MIN_SMOOTH_DT = 1 / 1000
const MAX_SMOOTH_DT = 0.2
const VELOCITY_ALPHA = 0.3
const REACQUIRE_MAX_CENTER_DIST = 0.15
const REACQUIRE_MAX_FLOOR_M = 0.75
const ANCHOR_STALE_MS = 1000

/** Elapsed seconds as a multiple of the nominal 60 fps frame, clamped for EMA stability. */
const dtSteps = (dt) => Math.min(Math.max(dt, MIN_SMOOTH_DT), MAX_SMOOTH_DT) / NOMINAL_FRAME_DT

/** A per-nominal-frame EMA alpha re-derived for `steps` frames (frame-rate independent). */
function emaFactor(alpha, steps) {
	if (steps === 1) return alpha
	const base = 1 - alpha
	return base <= 0 ? 1 : 1 - base ** steps
}

/** PSN validity of a marker driven by one tracked person: 0.5 at the threshold, 1 at score 1, fading while it coasts. */
function detectionStatus(score, threshold, ageS = 0, graceS = 0.5) {
	const matched = threshold >= 1 ? 1 : Math.min(1, Math.max(0, 0.5 + (0.5 * (score - threshold)) / (1 - threshold)))
	if (ageS <= 0) return matched
	if (graceS <= 0) return 0
	return matched * Math.max(0, 1 - ageS / graceS)
}

function newState() {
	return { sx: null, sy: null, vx: 0, vy: 0, px: null, py: null, locked: null, ax: null, ay: null, attached: null, status: null }
}
function softRelease(s) {
	Object.assign(s, { sx: null, sy: null, vx: 0, vy: 0, px: null, py: null, locked: null })
}

/** Velocity EMA + lookahead + EMA on a world target (both modes). Mutates `s`. → [x, y] */
function advanceSmoothing(s, tx, ty, cfg, steps) {
	const va = emaFactor(VELOCITY_ALPHA, steps)
	if (s.px !== null) {
		s.vx += va * ((tx - s.px) / steps - s.vx)
		s.vy += va * ((ty - s.py) / steps - s.vy)
	}
	s.px = tx
	s.py = ty
	const gx = tx + s.vx * cfg.prediction
	const gy = ty + s.vy * cfg.prediction
	const a = emaFactor(cfg.smoothing, steps)
	if (s.sx === null) {
		s.sx = gx
		s.sy = gy
	} else {
		s.sx += a * (gx - s.sx)
		s.sy += a * (gy - s.sy)
	}
	return [s.sx, s.sy]
}

const centre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
const area = (b) => (b[2] - b[0]) * (b[3] - b[1])
/** Where a person is for re-acquire: picture box centre, or a world person's floor point. */
const centreOf = (p) => (p.world ? p.world : centre(p.box))
const sizeOf = (p) => (p.world ? Number(p.area) || 0 : area(p.box))
/** A person → the PSN point to pin: its box cast onto z (top / feet), or a world person's floor point at z. */
const pointOf = (p, z, top) => (p.world ? [p.world[0], p.world[1], z] : boxPoint(p.box, p.camEntry, z, top))

class DetectPin {
	constructor() {
		this.states = new Map() // marker id → pin state
		this.anchors = new Map() // marker id → { id, name, x, y, z, at } (assist: the operator's own position)
		this.mode = null
		this.pinnedKey = null
		this.lastCentre = null // { camera, c: [cx, cy] }
		this.rev = 0
	}

	static assistActive(cfg) {
		return !!cfg?.enabled && cfg.pin_mode === 'assist'
	}

	/** Assist: an operator write becomes the anchor. → false when it is not a usable position. */
	setAnchor(m, now) {
		const id = Number(m?.id), x = Number(m?.x), y = Number(m?.y), z = m?.z == null ? 0 : Number(m.z)
		if (!Number.isInteger(id) || id < 1 || id > 65535 || ![x, y, z].every(Number.isFinite)) return false
		const prev = this.anchors.get(id)
		if (!prev || prev.x !== x || prev.y !== y || prev.z !== z) this.rev++
		this.anchors.set(id, { id, name: m.name == null ? prev?.name : String(m.name), x, y, z, at: now })
		return true
	}

	/** Replace: this marker is the pin's (operator writes to it are dropped until it releases). */
	drives(id) {
		return this.mode === 'replace' && this.states.get(id)?.status != null
	}

	anchor(id) {
		return this.anchors.get(id) || null
	}

	/** person key → marker id it drives this tick (display: the box painted in the marker's colour). */
	attached() {
		const out = {}
		for (const [id, s] of this.states) if (s.attached) out[s.attached] = id
		return out
	}

	_release(hub, id, s) {
		if (s.status === null) return
		s.status = null
		hub.setStatus(id, 1)
	}

	_prune(hub, keep) {
		for (const [id, s] of [...this.states]) {
			if (keep.has(id)) continue
			this._release(hub, id, s)
			this.states.delete(id)
		}
	}

	_state(id) {
		if (!this.states.has(id)) this.states.set(id, newState())
		return this.states.get(id)
	}

	/**
	 * One animate tick. persons: [{ key, camera, tid, box, score, age_s, camEntry }] (fresh cameras only), or fused
	 * world persons [{ key: 'w:<id>', camera: 'world', tid, world: [x, y], score, age_s, area }];
	 * cfg: normalizeDetection; available: the sidecar is up with a model; dt: seconds since the last tick.
	 */
	step({ cfg, available, persons, hub, planeZ = 0, now, dt = NOMINAL_FRAME_DT }) {
		if (!cfg.enabled || cfg.pin_mode === 'off') {
			this.anchors.clear()
			this._prune(hub, new Set())
			this.pinnedKey = null
			return
		}
		if (cfg.pin_mode !== this.mode) {
			this._prune(hub, new Set())
			this.mode = cfg.pin_mode
			this.pinnedKey = null
			this.lastCentre = null
		}
		const steps = dtSteps(dt)
		if (cfg.pin_mode === 'assist') return this._assist(cfg, available ? persons : [], hub, planeZ, now, steps)
		this.anchors.clear()
		this._replace(cfg, available, persons, hub, planeZ, steps)
	}

	_replace(cfg, available, persons, hub, planeZ, steps) {
		const id = cfg.pin_marker_id
		const marker = hub.markers.get(id)
		if (!marker) return this._prune(hub, new Set())
		this._prune(hub, new Set([id]))
		const s = this._state(id)
		s.attached = null
		if (!available) return this._release(hub, id, s)
		const coastS = Math.max(cfg.grace_ms, cfg.interval_ms) / 1000
		const best = this._tracked(persons, coastS)
		const invalid = () => {
			hub.set({ id, x: marker.x, y: marker.y, z: marker.z, status: 0, source: 'detect' }) // held, fresh, invalid
			s.status = 0
		}
		if (!best) {
			Object.assign(s, newState())
			return invalid()
		}
		s.attached = best.key
		const top = cfg.pin_point === 'top'
		const world = pointOf(best, top ? marker.z : planeZ, top)
		if (!world) return invalid()
		const [x, y] = advanceSmoothing(s, world[0], world[1], cfg, steps)
		s.status = detectionStatus(best.score, cfg.confidence, best.age_s, coastS)
		hub.set({ id, x, y, z: marker.z, status: s.status, source: 'detect' })
	}

	/** detection.py tracked_detection: sticky by track, else nearest the last centre, else the largest box. */
	_tracked(persons, coastS) {
		if (this.pinnedKey !== null) {
			const p = persons.find((q) => q.key === this.pinnedKey)
			if (p && p.age_s <= coastS) {
				this.lastCentre = { camera: p.camera, c: centreOf(p) }
				return p
			}
			this.pinnedKey = null
		}
		const matched = persons.filter((p) => p.age_s <= 0)
		if (!matched.length) return null
		let best = null
		if (this.lastCentre) {
			let bd = (this.lastCentre.camera === 'world' ? REACQUIRE_MAX_FLOOR_M : REACQUIRE_MAX_CENTER_DIST) ** 2
			for (const p of matched) {
				if (p.camera !== this.lastCentre.camera) continue
				const [cx, cy] = centreOf(p)
				const d = (cx - this.lastCentre.c[0]) ** 2 + (cy - this.lastCentre.c[1]) ** 2
				if (d <= bd) {
					bd = d
					best = p
				}
			}
		}
		if (!best) best = matched.reduce((a, b) => (sizeOf(b) > sizeOf(a) ? b : a))
		this.pinnedKey = best.key
		this.lastCentre = { camera: best.camera, c: centreOf(best) }
		return best
	}

	_assist(cfg, persons, hub, planeZ, now, steps) {
		for (const [id, a] of [...this.anchors]) if (now - a.at >= ANCHOR_STALE_MS) this.anchors.delete(id)
		const ids = [...this.anchors.keys()].sort((a, b) => a - b)
		this._prune(hub, new Set(ids))
		const top = cfg.pin_point === 'top'
		const matched = persons.filter((p) => p.age_s <= 0)
		const cache = new Map() // plane z → [{ key, x, y }], each detection unprojected once per plane
		const worldsAt = (z) => {
			if (!cache.has(z)) {
				const out = []
				for (const p of matched) {
					const w = pointOf(p, z, top)
					if (w) out.push({ key: p.key, x: w[0], y: w[1] })
				}
				cache.set(z, out)
			}
			return cache.get(z)
		}
		const r2 = cfg.assist_radius_m ** 2
		for (const id of ids) {
			const a = this.anchors.get(id)
			const out = hub.markers.get(id)
			if (!out) continue
			const s = this._state(id)
			let chosen = null
			let bd = r2
			for (const w of worldsAt(top ? a.z : planeZ)) {
				const d = (w.x - a.x) ** 2 + (w.y - a.y) ** 2
				if (d <= bd) {
					bd = d
					chosen = w
				}
			}
			let tx = a.x, ty = a.y
			if (!chosen) softRelease(s)
			else {
				if (chosen.key !== s.locked) {
					softRelease(s)
					s.locked = chosen.key
				}
				const [sx, sy] = advanceSmoothing(s, chosen.x, chosen.y, cfg, steps)
				tx = a.x + cfg.assist_strength * (sx - a.x)
				ty = a.y + cfg.assist_strength * (sy - a.y)
			}
			const g = emaFactor(cfg.smoothing, steps)
			if (s.ax === null) {
				s.ax = out.x
				s.ay = out.y
			}
			s.ax += g * (tx - s.ax)
			s.ay += g * (ty - s.ay)
			s.attached = s.locked
			hub.set({ id, x: s.ax, y: s.ay, z: a.z, name: a.name, source: 'detect' })
		}
	}
}

module.exports = { DetectPin, detectionStatus, dtSteps, emaFactor, advanceSmoothing, ANCHOR_STALE_MS, REACQUIRE_MAX_CENTER_DIST, REACQUIRE_MAX_FLOOR_M }
