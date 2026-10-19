'use strict'

/**
 * WO-616 T7 — trigger-zone occupancy engine (pure; the caller supplies time, markers and the `fire` sink).
 *
 * Ported from OpenFollow (github.com/openfollowapp/openfollow @ 2f8aa257, AGPL-3.0-or-later,
 * Copyright (C) 2026 The OpenFollow Project – Paul Hermann, Michel Honold, Vinzenz Schultz):
 * openfollow/zones/engine.py (ZoneEngine.reload_config / update / _emit_transitions, _zone_signature,
 * _evaluate_zone) and docs/architecture/zones.md.
 *   Per zone: occupant set; transitions in order — entries (sorted) first: count 0 → 1 "first_entry", else
 *   "additional_entry"; then exits (sorted): → 0 "final_exit", else "partial_exit". Entry tests the drawn
 *   polygon, an occupant's exit tests the polygon shrunk inward by `hysteresis` m. A change inside `debounce_ms`
 *   of the zone's last event is HELD (occupancy not advanced) and re-evaluated next tick, never queued or lost.
 *   Reloads carry occupancy for zones whose (vertices, enabled, triggered_by) are unchanged (FIFO for
 *   duplicates); master off drops it, so re-arming fires first_entry again.
 * Changes: JavaScript; markers only (detection = T9); `triggered_by` = marker ids (empty = all);
 *   a marker the hub calls STALE keeps its membership (no exit cue because a client dropped — OpenFollow filters
 *   stale markers out); a marker removed from the hub exits; every transition fires (the sink decides what a
 *   zone's actions send), so debounce always applies; occupants are marker ids.
 */

const { pointInPolygon, shrinkPolygon } = require('./zone-geometry')

const KINDS = ['first_entry', 'additional_entry', 'partial_exit', 'final_exit']

const num = (v, d, lo, hi) => {
	const n = Number(v)
	return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}

/** previs.tracking.zones → { enabled, debounce_ms, hysteresis, list: [{ id, name, color, vertices, enabled, triggered_by, actions }] } */
function normalizeZones(raw) {
	const z = raw && typeof raw === 'object' ? raw : {}
	const ids = new Set()
	const list = (Array.isArray(z.list) ? z.list : []).map((o, i) => {
		const r = o && typeof o === 'object' ? o : {}
		let id = String(r.id || `zone${i + 1}`)
		while (ids.has(id)) id += '_'
		ids.add(id)
		const acts = r.actions && typeof r.actions === 'object' ? r.actions : {}
		return {
			id,
			name: String(r.name || `Zone ${i + 1}`),
			color: typeof r.color === 'string' ? r.color : '#4fc3f7',
			vertices: (Array.isArray(r.vertices) ? r.vertices : [])
				.filter((v) => Array.isArray(v) && v.length >= 2 && v.every((x) => Number.isFinite(Number(x))))
				.map((v) => [Number(v[0]), Number(v[1])]),
			enabled: r.enabled !== false,
			triggered_by: [...new Set((Array.isArray(r.triggered_by) ? r.triggered_by : []).map(Number).filter((x) => x >= 1 && x <= 65535))].sort((a, b) => a - b),
			actions: Object.fromEntries(KINDS.map((k) => [k, typeof acts[k] === 'string' ? acts[k].trim() : ''])),
		}
	})
	return { enabled: z.enabled === true, debounce_ms: num(z.debounce_ms, 200, 0, 60000), hysteresis: num(z.hysteresis, 0.05, 0, 10), list }
}

const signature = (zone) => JSON.stringify([zone.vertices, zone.enabled, zone.triggered_by])

class ZoneEngine {
	/** @param {(event: { zone, kind, marker, count, at }) => void} fire */
	constructor(fire) {
		this._fire = typeof fire === 'function' ? fire : () => {}
		this.config = normalizeZones(null)
		this.occ = [] // per zone: { occupants: Set<id>, last: ms (0 = never), lastKind }
	}

	reload(raw) {
		const prevBySig = new Map()
		this.config.list.forEach((z, i) => {
			const q = prevBySig.get(signature(z)) || []
			q.push(this.occ[i])
			prevBySig.set(signature(z), q)
		})
		this.config = normalizeZones(raw)
		const h = this.config.hysteresis
		this.occ = this.config.list.map((z) => {
			const prev = this.config.enabled ? (prevBySig.get(signature(z)) || []).shift() : null
			return { occupants: new Set(prev ? prev.occupants : []), last: prev ? prev.last : 0, lastKind: prev ? prev.lastKind : '',
				exit: z.vertices.length >= 3 ? shrinkPolygon(z.vertices, h) : z.vertices }
		})
	}

	/**
	 * One evaluation. `markers` = hub list [{ id, x, y, stale }]. → number of transitions fired.
	 */
	update(markers, now) {
		if (!this.config.enabled) return 0
		const live = new Map()
		const present = new Set()
		for (const m of markers || []) {
			present.add(m.id)
			if (!m.stale) live.set(m.id, m)
		}
		let fired = 0
		this.config.list.forEach((zone, i) => {
			const o = this.occ[i]
			if (!zone.enabled || zone.vertices.length < 3) {
				o.occupants.clear()
				o.last = 0
				o.lastKind = ''
				return
			}
			const allowed = zone.triggered_by.length ? new Set(zone.triggered_by) : null
			const next = new Set()
			for (const id of o.occupants) {
				if (present.has(id) && !live.has(id) && (!allowed || allowed.has(id))) next.add(id) // stale: hold
			}
			for (const [id, m] of live) {
				if (allowed && !allowed.has(id)) continue
				const poly = o.occupants.has(id) && o.exit.length >= 3 ? o.exit : zone.vertices
				if (pointInPolygon(m.x, m.y, poly)) next.add(id)
			}
			const entered = [...next].filter((id) => !o.occupants.has(id)).sort((a, b) => a - b)
			const exited = [...o.occupants].filter((id) => !next.has(id)).sort((a, b) => a - b)
			if (!entered.length && !exited.length) return
			if (this.config.debounce_ms > 0 && o.last && now - o.last < this.config.debounce_ms) return // held
			let count = o.occupants.size
			for (const id of entered) {
				const kind = count === 0 ? 'first_entry' : 'additional_entry'
				count++
				this._emit(zone, o, kind, id, count, now)
				fired++
			}
			for (const id of exited) {
				count--
				this._emit(zone, o, count === 0 ? 'final_exit' : 'partial_exit', id, count, now)
				fired++
			}
			o.occupants = next
		})
		return fired
	}

	_emit(zone, o, kind, marker, count, at) {
		o.last = at
		o.lastKind = kind
		try {
			this._fire({ zone, kind, marker, count, at })
		} catch (_) {
			/* a failing sink never stalls the engine */
		}
	}

	/** Per zone { id, occupied, count, occupants, last_kind } for clients. */
	states() {
		return this.config.list.map((z, i) => {
			const o = this.occ[i]
			return { id: z.id, occupied: o.occupants.size > 0, count: o.occupants.size,
				occupants: [...o.occupants].sort((a, b) => a - b), last_kind: o.lastKind }
		})
	}
}

module.exports = { ZoneEngine, normalizeZones, KINDS }
