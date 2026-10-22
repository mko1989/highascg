'use strict'

/**
 * WO-675 — who on stage looks like which presenter: per person key (`w:<id>` / `camera:tid`), the smoothed cosine
 * similarity to every presenter, separately for faces (SFace, 128-d) and bodies (P2: youtureid, 768-d — wide stage
 * shots where the face is a few pixels). A kind's winner needs its MIN, its SEEN count and a MARGIN over the
 * runner-up. Fusion: face and body agreeing → `face+body`; disagreeing → nothing (owner D1: the operator decides
 * anyway, a doubtful suggestion is worse than none); body alone → `body`, unless a clearly seen face says it is not
 * that presenter (face similarity under FACE_VETO). One suggestion per presenter: the best one.
 */

const KINDS = {
	face: { min: 0.363, margin: 0.05, seen: 2 }, // SFace's published same-person threshold
	body: { min: 0.5, margin: 0.08, seen: 3 }, // re-ID gallery: same person ≥ 0.59, different ≤ 0.47 (WO-675 P2)
}
const FACE_VETO = 0.15
const EVIDENCE_TTL_MS = 10000
const SMOOTH = 0.35 // weight of a new observation

function dot(a, b) {
	let s = 0
	for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]
	return s
}

function unit(v) {
	if (!Array.isArray(v) || v.length < 32 || !v.every((x) => Number.isFinite(Number(x)))) return null
	const f = v.map(Number)
	const n = Math.sqrt(dot(f, f))
	return n > 0 ? f.map((x) => x / n) : null
}

function createMatcher(now = Date.now) {
	const evidence = { face: new Map(), body: new Map() } // kind → person key → Map(presenter id → { s, n, at })

	/** list: [{ key, feature }] of one kind; presenters: [{ id, face, body }] (unit features or null). */
	function observe(kind, list, presenters) {
		const map = evidence[kind]
		if (!map) return
		const t = now()
		for (const o of Array.isArray(list) ? list : []) {
			const f = unit(o?.feature)
			if (!f || !o.key) continue
			let ev = map.get(o.key)
			if (!ev) map.set(o.key, (ev = new Map()))
			for (const p of presenters) {
				if (!p[kind] || p[kind].length !== f.length) continue
				const sim = dot(f, p[kind])
				const e = ev.get(p.id)
				ev.set(p.id, e ? { s: e.s + (sim - e.s) * SMOOTH, n: e.n + 1, at: t } : { s: sim, n: 1, at: t })
			}
		}
	}

	/** Fresh entries of one kind for one key, best first (stale keys are dropped). */
	function fresh(kind, key, has) {
		const ev = evidence[kind].get(key)
		if (!ev) return []
		const t = now()
		const out = [...ev.entries()].filter(([pid, e]) => t - e.at <= EVIDENCE_TTL_MS && has(pid))
		if (!out.length) evidence[kind].delete(key)
		return out.sort((a, b) => b[1].s - a[1].s)
	}

	function winner(kind, list) {
		const k = KINDS[kind]
		if (!list.length) return null
		const [pid, best] = list[0]
		const second = list[1]?.[1].s ?? -1
		return best.n >= k.seen && best.s >= k.min && best.s - second >= k.margin ? { pid, s: best.s } : null
	}

	/** [{ presenter, key, score, via }]; `bound(pid, key)` true skips a confirmed pair, `has(pid)` drops removed ones. */
	function suggestions(has, bound) {
		const byPresenter = new Map()
		const keys = new Set([...evidence.face.keys(), ...evidence.body.keys()])
		for (const key of keys) {
			const faces = fresh('face', key, has)
			const f = winner('face', faces)
			const b = winner('body', fresh('body', key, has))
			if (f && b && f.pid !== b.pid) continue
			let pick = f ? { pid: f.pid, score: f.s, via: b ? 'face+body' : 'face' } : null
			if (!pick && b) {
				const seen = faces.find(([pid]) => pid === b.pid)?.[1]
				if (seen && seen.n >= KINDS.face.seen && seen.s < FACE_VETO) continue
				pick = { pid: b.pid, score: b.s, via: 'body' }
			}
			if (!pick || bound(pick.pid, key)) continue
			const s = { presenter: pick.pid, key, score: Math.round(pick.score * 1000) / 1000, via: pick.via }
			const prev = byPresenter.get(pick.pid)
			if (!prev || rank(s) > rank(prev)) byPresenter.set(pick.pid, s)
		}
		return [...byPresenter.values()].sort((a, b) => rank(b) - rank(a))
	}

	function forget(pid) {
		for (const map of Object.values(evidence)) for (const ev of map.values()) ev.delete(pid)
	}

	function clear() {
		evidence.face.clear()
		evidence.body.clear()
	}

	return { observe, suggestions, forget, clear }
}

/** A face-backed suggestion outranks a body-only one; then the higher score. */
const rank = (s) => (s.via === 'body' ? 0 : 10) + s.score

module.exports = { createMatcher, unit, dot, KINDS, FACE_VETO, EVIDENCE_TTL_MS }
