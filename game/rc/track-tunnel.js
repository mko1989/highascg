/**
 * §3.1 tunnels through tables (WO-1074): the drawn tube of each tunnel of the active track (tunnel.js tubesOf) — a
 * dark arched corridor (walls + ceiling, ribbed in two dark shades so speed reads), a row of small glowing lights
 * along the ceiling, a stone shell outside and a striped arch frame at each portal. Unlit vertex colours (mesh-util.js),
 * every size × the track's scale. The table's own faces inside the tube are cut by tunnel-cut.js.
 */
import * as THREE from 'three'
import { TriBatch, flatMat, lin } from './mesh-util.js'
import { leftNormal } from './track-math.js'
import { tubesOf } from './tunnel.js'

const INNER_A = lin('#16171c')
const INNER_B = lin('#1f2129')
const CEIL = lin('#2a2c36')
const SHELL = lin('#8a7a68')
const SHELL_TOP = lin('#a18f7a')
const FRAME_A = lin('#ffc81a')
const FRAME_B = lin('#17181c')
const LAMP = lin('#fff1b8')
const ARC = 12 // arch pieces
const RIB = 0.6 // × scale: rib length along the tube
const LAMP_EVERY = 1.0 // × scale
const LAMP_LEN = 0.3 // × scale
const LAMP_W = 0.25 // × scale
const FRAME = 0.12 // × scale: the portal frame stands this far out of the shell

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

/** The tubes of a prepared track as one group (null without tunnels). */
export function buildTunnels(T) {
	const tubes = tubesOf(T)
	if (!tubes.length) return null
	const s = T.scale ?? 1
	const inner = new TriBatch()
	const shell = new TriBatch()
	const lamps = new TriBatch()
	for (const tube of tubes) {
		const at = (i, d, h) => {
			const [lx, lz] = leftNormal(...T.tangents[i])
			const p = T.pts[i]
			return [p[0] + lx * d, tube.y + h, p[1] + lz * d]
		}
		const pin = profile(tube.wi, tube.h0, tube.hi)
		const pout = profile(tube.wo, tube.h0, tube.ho)
		let sAcc = 0
		let lampAt = (LAMP_EVERY * s) / 2
		for (let i = tube.from; i < tube.to; i++) {
			const len = T.segs[i].len
			const rib = Math.floor(sAcc / (RIB * s)) % 2
			for (let j = 0; j + 1 < pin.length; j++) {
				const top = j > 0 && j < pin.length - 2 && pin[j][1] > tube.h0 && pin[j + 1][1] > tube.h0
				const c = top ? CEIL : rib ? INNER_A : INNER_B
				inner.quad(at(i, ...pin[j]), at(i + 1, ...pin[j]), at(i + 1, ...pin[j + 1]), at(i, ...pin[j + 1]), c)
				shell.quad(
					at(i, ...pout[j]),
					at(i + 1, ...pout[j]),
					at(i + 1, ...pout[j + 1]),
					at(i, ...pout[j + 1]),
					top ? SHELL_TOP : SHELL
				)
			}
			// lamps: small quads just under the apex
			while (lampAt < sAcc + len) {
				const u = (lampAt - sAcc) / len
				const p = [0, 1].map((q) => T.pts[i][q] + (T.pts[i + 1][q] - T.pts[i][q]) * u)
				const [tx, tz] = [T.segs[i].ux, T.segs[i].uz]
				const [lx, lz] = leftNormal(tx, tz)
				const y = tube.y + tube.hi - 0.004 * s
				const a = (LAMP_LEN * s) / 2,
					b = (LAMP_W * s) / 2
				const P = (fa, fb) => [p[0] + tx * fa + lx * fb, y, p[1] + tz * fa + lz * fb]
				lamps.quad(P(-a, -b), P(a, -b), P(a, b), P(-a, b), LAMP)
				lampAt += LAMP_EVERY * s
			}
			sAcc += len
		}
		// the portal frames: a striped arch ring from the inner profile out past the shell, at each end
		const pframe = profile(tube.wo + FRAME * s, tube.h0, tube.ho + FRAME * s)
		for (const i of [tube.from, tube.to]) {
			for (let j = 0; j + 1 < pin.length; j++) {
				const c = j % 2 ? FRAME_A : FRAME_B
				shell.quad(at(i, ...pin[j]), at(i, ...pin[j + 1]), at(i, ...pframe[j + 1]), at(i, ...pframe[j]), c)
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
