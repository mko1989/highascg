/**
 * §3.1 tunnels through tables (WO-1074) — pure: the tube of each tunnel of the active track, a dark arched corridor
 * along the centre line from … to (contract: walls + ceiling, inner height ≈ 0.75 × width). The server carved the
 * table's cells within width/2 + 1 cell (0.3 · scale) of that line (occ.js carveTracks), so the inner walls stand
 * there; the shell is THICK thick. Cross-section at lateral offset d (|d| ≤ w): straight walls up to the shoulder
 * SHOULDER × height, then an elliptic arch up to the full height (profileTop).
 *   tubesOf(T) → [{ k, from, to, y, line: [[x, z]], wi, wo, h0, hi, ho, len }] (world; the track's own scale);
 *   tubeAt(tubes, x, z, y) → { tube, d, t (0 … 1 along it), top } for a point inside a tube's span, or null;
 *   cutSegments(tubes, max) → [[ax, az, bx, bz, y, wo, h0, ho]] — the outer volume, for the scene cut (tunnel-cut.js);
 *   portalShot(tube, s) → { eye, target } — a camera at the exit portal looking back up the tube (the director).
 */

export const TUBE_H = 0.75 // × width: the tube's inner height
export const SHOULDER = 0.55 // × height: where the walls turn into the arch
const CARVE = 0.3 // × scale: the carve's extra cell (rc-scene.js occupancy cell 0.3 · s)
const THICK = 0.15 // × scale: shell thickness

/** Height of the arch (half-width w, shoulder h0, apex h) above the floor at lateral offset d; −1 outside. */
export function profileTop(d, w, h0, h) {
	const a = Math.abs(d) / w
	return a > 1 ? -1 : h0 + (h - h0) * Math.sqrt(Math.max(0, 1 - a * a))
}

/** The tubes of a prepared track (T.tunnels, T.pts, T.ys, T.width, T.scale). */
export function tubesOf(T) {
	const out = []
	const s = T?.scale ?? 1
	for (const [k, q] of (T?.tunnels || []).entries()) {
		if (!(q.to > q.from) || q.to >= T.n) continue
		const line = T.pts.slice(q.from, q.to + 1).map((p) => [p[0], p[1]])
		let len = 0
		for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
		const wi = T.half + CARVE * s
		const hi = TUBE_H * T.width
		out.push({
			k,
			from: q.from,
			to: q.to,
			y: T.ys[q.from],
			line,
			len,
			wi,
			wo: wi + THICK * s,
			h0: SHOULDER * hi,
			hi,
			ho: hi + THICK * s,
		})
	}
	return out
}

/** Lateral distance and position along a polyline (no end caps: t ∈ [0, 1] of the whole line) → { d, t } or null. */
function along(line, len, x, z) {
	let best = null
	let s0 = 0
	for (let i = 0; i + 1 < line.length; i++) {
		const [ax, az] = line[i]
		const [bx, bz] = line[i + 1]
		const dx = bx - ax,
			dz = bz - az
		const l2 = dx * dx + dz * dz
		const l = Math.sqrt(l2)
		let u = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0
		if ((i === 0 && u < 0) || (i === line.length - 2 && u > 1)) {
			s0 += l
			continue
		}
		u = Math.max(0, Math.min(1, u))
		const d = Math.hypot(ax + u * dx - x, az + u * dz - z)
		if (!best || d < best.d) best = { d, t: len > 0 ? (s0 + u * l) / len : 0 }
		s0 += l
	}
	return best
}

/** Inside a tube's outer span (plan within wo, height between just under the floor and the outer apex)? */
export function tubeAt(tubes, x, z, y) {
	for (const tube of tubes || []) {
		if (y < tube.y - tube.wo || y > tube.y + tube.ho) continue
		const a = along(tube.line, tube.len, x, z)
		if (!a || a.d > tube.wo) continue
		return {
			tube,
			d: a.d,
			t: a.t,
			top: tube.y + Math.max(0, profileTop(Math.min(a.d, tube.wi), tube.wi, tube.h0, tube.hi)),
		}
	}
	return null
}

/** The outer volumes as straight pieces (a long bent line is cut into at most `max` pieces over all tubes). */
export function cutSegments(tubes, max = 24) {
	const out = []
	const per = Math.max(1, Math.floor(max / Math.max(1, (tubes || []).length)))
	for (const t of tubes || []) {
		const m = t.line.length - 1
		const step = Math.max(1, Math.ceil(m / per))
		for (let i = 0; i < m; i += step) {
			const a = t.line[i],
				b = t.line[Math.min(m, i + step)]
			out.push([a[0], a[1], b[0], b[1], t.y, t.wo, t.h0, t.ho])
		}
	}
	return out.slice(0, max)
}

/** A camera just outside the tube's exit portal (driving direction), low, looking back in along it: the car comes at it. */
export function portalShot(tube, s = 1) {
	const L = tube.line
	const p = L[L.length - 1],
		q = L[L.length - 2]
	const l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1
	const ux = (p[0] - q[0]) / l,
		uz = (p[1] - q[1]) / l
	return {
		eye: [p[0] + ux * 0.6 * s, tube.y + tube.hi * 0.7, p[1] + uz * 0.6 * s],
		target: [p[0] - ux * tube.len * 0.5, tube.y + tube.hi * 0.25, p[1] - uz * tube.len * 0.5],
	}
}
