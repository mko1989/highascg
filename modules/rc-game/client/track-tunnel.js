/**
 * §3.1 tunnels through tables (WO-1074): the drawn tube of each tunnel of the active track (tunnel.js tubesOf) — a
 * dark arched corridor (walls + ceiling, ribbed in two dark shades so speed reads), a row of small glowing lights
 * along the ceiling and a striped arch frame at each portal. Unlit vertex colours (mesh-util.js), every size × the
 * track's scale. The table's own faces inside the tube are cut by tunnel-cut.js. Refined 15.11 (owner: the track
 * disappears into the tablecloth): with the scene's occupancy grids the tube is drawn only from the furniture face
 * to the furniture face (tunnel.js portalInsets), so each arch stands on the cloth / chair cover; there is no outer
 * shell — only a short collar in a dark cloth-neutral shade behind each arch fills the cut ring around the opening.
 */
import * as THREE from 'three'
import { TriBatch, flatMat, lin } from './mesh-util.js'
import { leftNormal } from './track-math.js'
import { tubesOf, portalInsets } from './tunnel.js'

const INNER_A = lin('#16171c')
const INNER_B = lin('#1f2129')
const CEIL = lin('#2a2c36')
const COLLAR_C = lin('#2a2622')
const COLLAR_TOP = lin('#332e29')
const FRAME_A = lin('#ffc81a')
const FRAME_B = lin('#17181c')
const LAMP = lin('#fff1b8')
const ARC = 12 // arch pieces
const RIB = 0.6 // × scale: rib length along the tube
const LAMP_EVERY = 1.0 // × scale
const LAMP_LEN = 0.3 // × scale
const LAMP_W = 0.25 // × scale
const FRAME = 0.12 // × scale: the portal frame stands this far out of the inner walls
const COLLAR = 0.5 // × scale: the dark collar behind each arch
const COLLAR_T = 0.04 // × scale: its thickness beyond the inner walls

/** The cross-section of half-width w, shoulder h0, apex h: [[d, height]] from the left floor to the right floor. */
export function profile(w, h0, h) {
	const out = [[w, 0]]
	for (let j = 0; j <= ARC; j++) {
		const a = (Math.PI * j) / ARC
		out.push([w * Math.cos(a), h0 + (h - h0) * Math.sin(a)])
	}
	out.push([-w, 0])
	return out
}

/**
 * The drawn stretch of a tube: stations { p: [x, z], t: [tx, tz], s } from `a` in from its first point to `b` before
 * its last (s = distance from the first point; the track's points in between, the ends interpolated).
 */
function stations(T, tube, a, b) {
	const end = tube.len - b
	const c = [0] // distance of point from + k from the first point
	for (let i = tube.from; i < tube.to; i++) c.push(c[c.length - 1] + T.segs[i].len)
	const norm = (tx, tz) => {
		const l = Math.hypot(tx, tz) || 1
		return [tx / l, tz / l]
	}
	const interp = (sAt) => {
		let k = 0
		while (k + 2 < c.length && c[k + 1] < sAt) k++
		const i = tube.from + k
		const l = c[k + 1] - c[k]
		const u = l > 0 ? Math.max(0, Math.min(1, (sAt - c[k]) / l)) : 0
		const p = [0, 1].map((q) => T.pts[i][q] + (T.pts[i + 1][q] - T.pts[i][q]) * u)
		const ta = T.tangents[i],
			tb = T.tangents[i + 1]
		return { p, t: norm(ta[0] + (tb[0] - ta[0]) * u, ta[1] + (tb[1] - ta[1]) * u), s: sAt }
	}
	if (!(end > a)) return []
	const out = [interp(a)]
	for (let k = 1; k + 1 < c.length; k++) {
		if (c[k] > a + 1e-9 && c[k] < end - 1e-9)
			out.push({ p: [...T.pts[tube.from + k]], t: norm(...T.tangents[tube.from + k]), s: c[k] })
	}
	out.push(interp(end))
	return out
}

/** The tubes of a prepared track as one group (null without tunnels). `grids`: the scene's UNCARVED decoded grids. */
export function buildTunnels(T, grids = null) {
	const tubes = tubesOf(T)
	if (!tubes.length) return null
	const s = T.scale ?? 1
	const inner = new TriBatch()
	const shell = new TriBatch()
	const lamps = new TriBatch()
	for (const tube of tubes) {
		const [ia, ib] = grids ? portalInsets(tube, grids, s) : [0, 0]
		const st = stations(T, tube, ia, ib)
		if (st.length < 2) continue
		tube.drawn = [ia, ib]
		const at = (k, d, h) => {
			const [lx, lz] = leftNormal(...st[k].t)
			return [st[k].p[0] + lx * d, tube.y + h, st[k].p[1] + lz * d]
		}
		const pin = profile(tube.wi, tube.h0, tube.hi)
		const pout = profile(tube.wi + COLLAR_T * s, tube.h0, tube.hi + COLLAR_T * s)
		const last = st.length - 1
		let lampAt = st[0].s + (LAMP_EVERY * s) / 2
		for (let k = 0; k < last; k++) {
			const s0 = st[k].s,
				s1 = st[k + 1].s
			const rib = Math.floor((s0 - st[0].s) / (RIB * s)) % 2
			const collar = s0 - st[0].s < COLLAR * s || st[last].s - s1 < COLLAR * s
			for (let j = 0; j + 1 < pin.length; j++) {
				const top = j > 0 && j < pin.length - 2 && pin[j][1] > tube.h0 && pin[j + 1][1] > tube.h0
				const c = top ? CEIL : rib ? INNER_A : INNER_B
				inner.quad(at(k, ...pin[j]), at(k + 1, ...pin[j]), at(k + 1, ...pin[j + 1]), at(k, ...pin[j + 1]), c)
				if (collar)
					shell.quad(
						at(k, ...pout[j]),
						at(k + 1, ...pout[j]),
						at(k + 1, ...pout[j + 1]),
						at(k, ...pout[j + 1]),
						top ? COLLAR_TOP : COLLAR_C
					)
			}
			// lamps: small quads just under the apex
			const len = s1 - s0
			while (len > 0 && lampAt < s1) {
				const u = (lampAt - s0) / len
				const p = [0, 1].map((q) => st[k].p[q] + (st[k + 1].p[q] - st[k].p[q]) * u)
				const [tx, tz] = st[k].t
				const [lx, lz] = leftNormal(tx, tz)
				const y = tube.y + tube.hi - 0.004 * s
				const a = (LAMP_LEN * s) / 2,
					b = (LAMP_W * s) / 2
				const P = (fa, fb) => [p[0] + tx * fa + lx * fb, y, p[1] + tz * fa + lz * fb]
				lamps.quad(P(-a, -b), P(a, -b), P(a, b), P(-a, b), LAMP)
				lampAt += LAMP_EVERY * s
			}
		}
		// the portal frames: a striped arch ring from the inner profile out, at each drawn end (on the furniture face)
		const pframe = profile(tube.wi + FRAME * s, tube.h0, tube.hi + FRAME * s)
		for (const k of [0, last]) {
			for (let j = 0; j + 1 < pin.length; j++) {
				const c = j % 2 ? FRAME_A : FRAME_B
				shell.quad(at(k, ...pin[j]), at(k, ...pin[j + 1]), at(k, ...pframe[j + 1]), at(k, ...pframe[j]), c)
			}
		}
	}
	const g = new THREE.Group()
	g.name = 'tunnels'
	for (const [b, off] of [
		[shell, 0],
		[inner, 0],
		[lamps, 2],
	]) {
		const m = b.mesh(flatMat(off))
		if (m) g.add(m)
	}
	g.userData.tubes = tubes
	return g
}
