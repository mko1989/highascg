'use strict'

/**
 * WO-1087 — the test puppet PERSON's walk and look, pure and seeded (src/tracking/puppet-people.js runs it).
 *
 * Owner, 15.11: "show me an avatar with random look. make it a test puppet. make sure the test puppet doesnt leave the
 * stage". A wanderer walks to a random point of the tracking stage, pauses there (sometimes looking round), and picks
 * the next one — human speeds, a bounded turn rate and acceleration, so the previs avatar walks instead of sliding.
 *
 * The stage is project.previs.tracking.grid (auto-split.normalizeGrid: width along X, depth along Y, centred on
 * x_offset / y_offset, floor at z_offset). The puppet's floor point stays inside that rectangle inset by MARGIN on
 * every side — a HARD invariant: every step ends with a clamp into the inset rectangle, whatever the steering did, and
 * a grid moved under it pulls it straight back inside on the next step. A grid too small for the inset (or none) →
 * it stands still in the stage centre.
 *
 * Looks are drawn from the sidecar's own trait palettes (tools/tracking-detect/traits.py CLOTH / HAIR / SKIN —
 * smoke-wo1087 checks the copies match), with a height of HEIGHT_M. Everything random comes from `rng(seed)`.
 */

const { normalizeGrid } = require('./auto-split')

const MARGIN = 0.45 // m from every stage edge to the floor point (a body is ~0.25 m each side of it)
const V_MAX = 1.4 // m/s — a brisk walk
const CRUISE = [0.6, 1.25] // m/s — each leg's walking speed
const ACCEL = 0.8 // m/s² — speed change per second, up or down
const TURN = 1.6 // rad/s — at most ~92° a second
const PAUSE_S = [1, 4]
const LOOK_ROUND = 0.35 // chance a pause turns to look somewhere else
const ARRIVE_M = 0.15
const MAX_DT = 0.25 // s — a stalled timer never turns into a jump
const HEIGHT_M = [1.55, 1.95]

// tools/tracking-detect/traits.py (kept equal by smoke-wo1087-puppet-people)
const CLOTH = [[28, 28, 30], [64, 66, 72], [128, 130, 134], [190, 192, 196], [236, 236, 232], [226, 214, 180],
	[196, 170, 130], [110, 74, 48], [120, 32, 44], [200, 40, 44], [232, 120, 40], [236, 200, 60], [110, 112, 50],
	[50, 140, 70], [30, 130, 130], [110, 170, 220], [40, 90, 190], [30, 40, 80], [70, 100, 140], [110, 60, 150],
	[230, 130, 170]]
const HAIR = [[25, 22, 22], [60, 40, 28], [110, 72, 44], [140, 60, 34], [196, 104, 52], [220, 190, 120], [236, 224, 190],
	[150, 150, 150], [230, 230, 226]]
const SKIN = [[247, 224, 206], [234, 196, 166], [214, 165, 128], [176, 124, 88], [128, 86, 58], [88, 58, 40]]
const HAIR_LEN = ['short', 'long', 'bald']

/** mulberry32: seed (any number) → () => [0, 1). */
function rng(seed) {
	let a = (Number(seed) >>> 0) || 0x9e3779b9
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const between = (r, [lo, hi]) => lo + (hi - lo) * r()
const pickOf = (r, list) => list[Math.min(list.length - 1, Math.floor(r() * list.length))]
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const r3 = (v) => Math.round(v * 1000) / 1000

/** A random look: palette colours (a top and bottom that differ), a hair class, a plausible height. */
function randomLook(r) {
	const top = pickOf(r, CLOTH)
	let bottom = pickOf(r, CLOTH)
	for (let i = 0; i < 8 && bottom === top; i++) bottom = pickOf(r, CLOTH)
	const u = r()
	const hair_len = u < 0.12 ? 'bald' : u < 0.55 ? 'long' : 'short'
	return { traits: { top: top.slice(), bottom: bottom.slice(), skin: pickOf(r, SKIN).slice(), hair: pickOf(r, HAIR).slice(), hair_len, locked: true },
		height: r3(between(r, HEIGHT_M)) }
}

/** The grid → { lo: [x, y], hi: [x, y], centre: [x, y], z, degenerate } — lo / hi the inset rectangle. */
function stageRect(grid, margin = MARGIN) {
	const g = normalizeGrid(grid)
	const centre = [g.x_offset, g.y_offset]
	const hw = g.width / 2 - margin, hd = g.depth / 2 - margin
	const degenerate = !(hw > 0 && hd > 0)
	return { lo: degenerate ? centre.slice() : [centre[0] - hw, centre[1] - hd], hi: degenerate ? centre.slice() : [centre[0] + hw, centre[1] + hd],
		centre, z: g.z_offset, degenerate }
}

/** Inside the inset rectangle (with `eps` slack for float noise)? */
const inside = (rect, x, y, eps = 1e-9) => x >= rect.lo[0] - eps && x <= rect.hi[0] + eps && y >= rect.lo[1] - eps && y <= rect.hi[1] + eps

function randomPoint(r, rect, from) {
	let p = null
	for (let i = 0; i < 6; i++) {
		p = [between(r, [rect.lo[0], rect.hi[0]]), between(r, [rect.lo[1], rect.hi[1]])]
		if (!from || Math.hypot(p[0] - from[0], p[1] - from[1]) >= 1) break // a leg worth walking when the stage allows
	}
	return p
}

/** A new wanderer at a random point of `rect` (the centre on a degenerate stage), facing a random way, standing. */
function createWalker(r, rect) {
	const at = rect.degenerate ? rect.centre.slice() : randomPoint(r, rect, null)
	return { x: at[0], y: at[1], h: (r() * 2 - 1) * Math.PI, v: 0, cruise: between(r, CRUISE), target: null, pause: between(r, [0.5, 1.5]), look: null, vx: 0, vy: 0 }
}

/**
 * One step of `dt` seconds on `rect` (may differ from the last step's: a grid change). Mutates and returns `w`.
 * Steering: turn toward the target at ≤ TURN, walk at the leg's cruise speed scaled down while the heading is off
 * and while braking for the target; speed changes ≤ ACCEL·dt. Then the hard clamp into `rect`.
 */
function stepWalker(w, r, rect, dt) {
	const t = clamp(Number(dt) || 0, 0, MAX_DT)
	const x0 = w.x, y0 = w.y
	if (rect.degenerate) {
		Object.assign(w, { x: rect.centre[0], y: rect.centre[1], v: 0, target: null, vx: 0, vy: 0 })
		return w
	}
	if (w.target && !inside(rect, w.target[0], w.target[1])) w.target = null // the stage moved: aim somewhere still on it
	let wantH = w.h, wantV = 0
	if (w.pause > 0) {
		w.pause -= t
		if (w.look != null) wantH = w.look
	} else {
		if (!w.target) {
			w.target = randomPoint(r, rect, [w.x, w.y])
			w.cruise = between(r, CRUISE)
		}
		const dx = w.target[0] - w.x, dy = w.target[1] - w.y
		const d = Math.hypot(dx, dy)
		if (d <= ARRIVE_M) {
			w.target = null
			w.pause = between(r, PAUSE_S)
			w.look = r() < LOOK_ROUND ? (r() * 2 - 1) * Math.PI : null
		} else {
			wantH = Math.atan2(dy, dx)
			const facing = Math.max(0, Math.cos(wrap(wantH - w.h)))
			wantV = Math.min(w.cruise * facing * facing, Math.sqrt(2 * ACCEL * Math.max(0, d - ARRIVE_M / 2)))
		}
	}
	w.h = wrap(w.h + clamp(wrap(wantH - w.h), -TURN * t, TURN * t))
	w.v = clamp(clamp(wantV, w.v - ACCEL * t, w.v + ACCEL * t), 0, V_MAX)
	w.x = clamp(w.x + Math.cos(w.h) * w.v * t, rect.lo[0], rect.hi[0])
	w.y = clamp(w.y + Math.sin(w.h) * w.v * t, rect.lo[1], rect.hi[1])
	if (!inside(rect, x0, y0)) w.target = null // it stood off the (moved) stage: back inside now, the invariant beats smoothness
	w.vx = t > 0 ? (w.x - x0) / t : 0
	w.vy = t > 0 ? (w.y - y0) / t : 0
	return w
}

module.exports = { rng, randomLook, stageRect, inside, createWalker, stepWalker, CLOTH, HAIR, SKIN, HAIR_LEN, MARGIN, V_MAX, ACCEL, TURN, MAX_DT, HEIGHT_M }
