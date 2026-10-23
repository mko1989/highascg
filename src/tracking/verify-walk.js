'use strict'

/**
 * WO-616 T10d — the verification walk (two-camera workflow step 6). The operator walks a known floor line a → b
 * (PSN metres, e.g. a grid line or the downstage edge) and the box measures how far tracking puts them off it, per
 * fusion step: the world position (fused, or one camera's when only one sees them) and each camera's own feet point,
 * as mean / RMS / max in cm, plus how much of the line the walk covered (BINS equal stretches).
 *
 * The walker is the world person given by id, else the first fresh world person standing within START_GATE_M of
 * the line, then kept by id (fusion ids survive occlusion and ByteTrack id switches). Only persons measured in the
 * latest step (age_s 0) count — coasting predictions are not measurements. Auto-stops after MAX_S.
 * Pure: register.js feeds it the withPins snapshot after every fusion step that brought a new frame.
 */

const START_GATE_M = 1.0
const MIN_LENGTH_M = 0.5
const MAX_S = 120
const BINS = 20
const MIN_SAMPLES = 10 // fewer and the result says ok: false

/** Distance of floor point p from segment a–b, and where along it p falls (t, 0–1 inside the ends). */
function segDist(p, a, b) {
	const ux = b[0] - a[0],
		uy = b[1] - a[1]
	const len2 = ux * ux + uy * uy
	const t = len2 > 0 ? ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / len2 : 0
	const c = Math.min(1, Math.max(0, t))
	return { d: Math.hypot(p[0] - (a[0] + c * ux), p[1] - (a[1] + c * uy)), t }
}

/** Distances (m) → { n, mean_cm, rms_cm, max_cm } (cm to 0.1; nulls when empty). */
function stats(ds) {
	if (!ds.length) return { n: 0, mean_cm: null, rms_cm: null, max_cm: null }
	const r1 = (m) => Math.round(m * 1000) / 10
	const mean = ds.reduce((s, d) => s + d, 0) / ds.length
	const rms = Math.sqrt(ds.reduce((s, d) => s + d * d, 0) / ds.length)
	return { n: ds.length, mean_cm: r1(mean), rms_cm: r1(rms), max_cm: r1(Math.max(...ds)) }
}

const isPoint = (p) =>
	Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))

class VerifyWalk {
	constructor() {
		this.run = null
		this.result = null
	}

	/** Begin a walk along a → b ([x, y] floor points); person = a world id to follow, else picked at the line. */
	start({ a, b, person = null } = {}, now) {
		if (!isPoint(a) || !isPoint(b)) return { ok: false, error: 'a and b must be [x, y] floor points (m)' }
		const pa = [Number(a[0]), Number(a[1])],
			pb = [Number(b[0]), Number(b[1])]
		if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < MIN_LENGTH_M)
			return { ok: false, error: `the line must be at least ${MIN_LENGTH_M} m long` }
		const id = person === null || person === undefined || person === '' ? null : Number(person)
		this.run = {
			a: pa,
			b: pb,
			person: Number.isFinite(id) ? id : null,
			at: now,
			world: [],
			cams: {},
			sources: {},
			bins: new Set(),
		}
		this.result = null
		return { ok: true }
	}

	/** One fusion step's snapshot ({ cameras: [{id, persons: [{world, floor}]}], world: {persons} }). */
	sample(snap, now) {
		const r = this.run
		if (!r) return
		if (now - r.at > MAX_S * 1000) {
			this.stop(now)
			return
		}
		const fresh = (snap?.world?.persons || []).filter((w) => w.age_s === 0)
		let w = r.person !== null ? fresh.find((x) => x.id === r.person) : null
		if (r.person === null) {
			let best = START_GATE_M
			for (const x of fresh) {
				const s = segDist([x.x, x.y], r.a, r.b)
				if (s.t >= 0 && s.t <= 1 && s.d <= best) {
					best = s.d
					w = x
				}
			}
			if (w) r.person = w.id
		}
		if (!w) return
		const s = segDist([w.x, w.y], r.a, r.b)
		r.world.push(s.d)
		if (s.t >= 0 && s.t <= 1) r.bins.add(Math.min(BINS - 1, Math.floor(s.t * BINS)))
		r.sources[w.source] = (r.sources[w.source] || 0) + 1
		for (const c of snap.cameras || []) {
			for (const p of c.persons || []) {
				if (p.world === w.id && isPoint(p.floor)) (r.cams[c.id] ||= []).push(segDist(p.floor, r.a, r.b).d)
			}
		}
	}

	/** End the walk → the result (also kept for status()). */
	stop(now) {
		const r = this.run
		if (!r) return this.result
		this.run = null
		const cameras = {}
		for (const id of Object.keys(r.cams).sort()) cameras[id] = stats(r.cams[id])
		this.result = {
			a: r.a,
			b: r.b,
			person: r.person,
			duration_s: Math.round((now - r.at) / 100) / 10,
			samples: r.world.length,
			world: stats(r.world),
			cameras,
			sources: r.sources,
			covered: r.bins.size / BINS,
			ok: r.world.length >= MIN_SAMPLES,
		}
		return this.result
	}

	reset() {
		this.run = null
		this.result = null
	}

	/** { running, live: {a, b, person, samples, elapsed_s, world} | null, result | null }. */
	status(now) {
		const r = this.run
		return {
			running: !!r,
			live: r
				? {
						a: r.a,
						b: r.b,
						person: r.person,
						samples: r.world.length,
						elapsed_s: Math.round((now - r.at) / 100) / 10,
						world: stats(r.world),
						covered: r.bins.size / BINS,
					}
				: null,
			result: this.result,
		}
	}

	/** GET / POST /api/tracking/verify {action: start | stop | reset} (moved out of register.js, WO-708). → { status, body } | null */
	handle(method, body, now) {
		if (method === 'GET') return { status: 200, body: this.status(now) }
		if (method !== 'POST') return null
		let data
		try {
			data = JSON.parse(body || '{}')
		} catch {
			return { status: 400, body: { error: 'body must be JSON' } }
		}
		if (data.action === 'start') {
			const r = this.start(data, now)
			return { status: r.ok ? 200 : 400, body: r.ok ? this.status(now) : r }
		}
		if (data.action === 'stop') this.stop(now)
		else if (data.action === 'reset') this.reset()
		else return { status: 400, body: { error: 'action must be start | stop | reset' } }
		return { status: 200, body: this.status(now) }
	}
}

module.exports = { VerifyWalk, segDist, stats, START_GATE_M, MIN_LENGTH_M, MAX_S, BINS, MIN_SAMPLES }
