'use strict'

/**
 * WO-616 T5 — tracking marker hub: the server's one list of live markers (operator-driven from the Godot camera
 * view today; detections / fusion later), in the PSN frame (metres, X stage left, Y upstage, Z up). Consumers:
 * the `tracking:markers` WS broadcast (previs on every client) and the WO-615 follow → Art-Net engine.
 *
 * Freshness follows OpenFollow (openfollow/psn/marker.py @ 2f8aa257, AGPL-3.0-or-later, (C) 2026 The OpenFollow
 * Project – Paul Hermann, Michel Honold, Vinzenz Schultz): a marker counts as live for MARKER_STALE_AFTER_MS after
 * its last write, a never-written marker is stale, and stale positions are still listed (so a follow can hold)
 * but flagged. Sources keep a parked marker live by re-sending it (the Godot driver heartbeats every 250 ms).
 * Changes: JavaScript; milliseconds; one hub for every source instead of per-station markers.
 */

const MARKER_STALE_AFTER_MS = 1000
const MAX_REACH_M = 500 // positions farther than this from the origin are refused (a broken unproject, not a person)
const MAX_ID = 65535 // PSN / Art-Net follow ids are 16-bit
const NAME_MAX = 64

const round = (v) => Math.round(v * 1e4) / 1e4
const PUBLIC = ['name', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'source']

class MarkerHub {
	/** @param {{ now?: () => number }} [opts] */
	constructor(opts = {}) {
		this.now = opts.now || Date.now
		/** @type {Map<number, {id:number,name:string,x:number,y:number,z:number,vx:number,vy:number,vz:number,source:string,at:number}>} */
		this.markers = new Map()
		this.rev = 0 // bumps on every change / removal (not on an identical heartbeat) — the broadcaster sends when it moves
	}

	/**
	 * Write one marker position. → { ok: true, marker } | { ok: false, error }
	 * @param {{ id: unknown, x: unknown, y: unknown, z?: unknown, name?: unknown, source?: unknown }} m
	 */
	set(m) {
		const id = Number(m?.id)
		if (!Number.isInteger(id) || id < 1 || id > MAX_ID) return { ok: false, error: `id must be an integer 1..${MAX_ID}` }
		const x = Number(m.x), y = Number(m.y), z = m.z == null ? 0 : Number(m.z)
		if (![x, y, z].every(Number.isFinite)) return { ok: false, error: 'x, y, z must be finite numbers (metres)' }
		if (Math.hypot(x, y, z) > MAX_REACH_M) return { ok: false, error: `position is more than ${MAX_REACH_M} m from the origin` }
		const now = this.now()
		const prev = this.markers.get(id)
		let vx = 0, vy = 0, vz = 0
		const dt = prev ? (now - prev.at) / 1000 : 0
		if (prev && dt > 0 && dt <= MARKER_STALE_AFTER_MS / 1000) {
			vx = (x - prev.x) / dt
			vy = (y - prev.y) / dt
			vz = (z - prev.z) / dt
		}
		const name = m.name == null ? prev?.name || `Marker ${id}` : String(m.name).slice(0, NAME_MAX)
		const source = m.source == null ? prev?.source || 'api' : String(m.source).slice(0, 32)
		const rec = { id, name, x: round(x), y: round(y), z: round(z), vx: round(vx), vy: round(vy), vz: round(vz), source, at: now }
		this.markers.set(id, rec)
		// A heartbeat (same position, name, source) only refreshes freshness: no rev bump, so idle sources keeping
		// a parked marker live do not make the broadcaster send. A marker coming back from stale still sends
		// (the stale set changes).
		if (!prev || PUBLIC.some((k) => prev[k] !== rec[k])) this.rev++
		return { ok: true, marker: this.view(rec, now) }
	}

	remove(id) {
		const ok = this.markers.delete(Number(id))
		if (ok) this.rev++
		return ok
	}

	/** Public shape: position, speed (m/s from the last two writes), age, stale. */
	view(rec, now = this.now()) {
		const age = now - rec.at
		return { id: rec.id, name: rec.name, x: rec.x, y: rec.y, z: rec.z, vx: rec.vx, vy: rec.vy, vz: rec.vz,
			source: rec.source, age_ms: age, stale: !(age >= 0 && age < MARKER_STALE_AFTER_MS) }
	}

	/** Every marker, id order, aged against one `now` (one notion of "now" per packet). */
	list(now = this.now()) {
		return [...this.markers.values()].sort((a, b) => a.id - b.id).map((r) => this.view(r, now))
	}

	/** Ids that are stale at `now` — the broadcaster sends when this set changes, even without writes. */
	staleKey(now = this.now()) {
		return this.list(now).filter((m) => m.stale).map((m) => m.id).join(',')
	}
}

module.exports = { MarkerHub, MARKER_STALE_AFTER_MS, MAX_REACH_M, MAX_ID }
