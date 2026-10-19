'use strict'

/**
 * WO-616 T11 / WO-615 T9 (first slice) — moving-head inverse kinematics for the generic profile: a stage point →
 * pan / tilt (degrees from the DMX centre) → channel bytes. Pure.
 *
 * Fixture frame (PSN: X stage left, Y upstage, Z up):
 *   u = base axis, +Z standing on the floor, −Z hung from a truss (the beam at tilt 0 points along u);
 *   f = (sin yaw, cos yaw, 0): where the beam swings at pan 0 with positive tilt (yaw as the camera: 0 upstage,
 *       90 stage left);
 *   g = positive pan's direction from f — clockwise seen from above when standing, mirrored when hung (a hung
 *       head is the same machine upside down).
 *   beam(pan, tilt) = cos(tilt)·u + sin(tilt)·(cos(pan)·f + sin(pan)·g)
 * Every target has the solutions (pan₀ + 360k, t) and (pan₀ + 180 + 360k, −t); the one inside the ranges nearest
 * the previous aim wins, so a 540° pan never whips round the long way. Inverts are applied at the DMX step.
 */

const DEG = 180 / Math.PI

function frame(pose) {
	const s = pose.hang === 'floor' ? 1 : -1
	const yaw = (Number(pose.yaw) || 0) / DEG
	const f = [Math.sin(yaw), Math.cos(yaw), 0]
	const g = [s * Math.cos(yaw), -s * Math.sin(yaw), 0]
	return { u: [0, 0, s], f, g }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Unit beam direction for pan / tilt degrees. */
function beam(pose, pan, tilt) {
	const { u, f, g } = frame(pose)
	const p = pan / DEG
	const t = tilt / DEG
	return [0, 1, 2].map((i) => Math.cos(t) * u[i] + Math.sin(t) * (Math.cos(p) * f[i] + Math.sin(p) * g[i]))
}

/**
 * @param {{ pose, pan: { range }, tilt: { range } }} fx
 * @param {number[]} target PSN [x, y, z]
 * @param {{ pan: number, tilt: number }} prev
 * @returns {{ pan: number, tilt: number } | null} null = unreachable inside the ranges (hold)
 */
function aim(fx, target, prev = { pan: 0, tilt: 0 }) {
	const d = [target[0] - fx.pose.x, target[1] - fx.pose.y, target[2] - fx.pose.z]
	const n = Math.hypot(d[0], d[1], d[2])
	if (n < 1e-6) return null
	const v = d.map((x) => x / n)
	const { u, f, g } = frame(fx.pose)
	const t0 = Math.acos(Math.max(-1, Math.min(1, dot(v, u)))) * DEG
	const hf = dot(v, f)
	const hg = dot(v, g)
	const p0 = Math.hypot(hf, hg) < 1e-9 ? prev.pan : Math.atan2(hg, hf) * DEG
	const pr = fx.pan.range / 2 + 1e-9
	const tr = fx.tilt.range / 2 + 1e-9
	let best = null
	let cost = Infinity
	for (const [p, t] of [[p0, t0], [p0 + 180, -t0]]) {
		for (let k = -3; k <= 3; k++) {
			const pk = p + 360 * k
			if (Math.abs(pk) > pr || Math.abs(t) > tr) continue
			const c = Math.abs(pk - prev.pan) + Math.abs(t - prev.tilt)
			if (c < cost) {
				cost = c
				best = { pan: pk, tilt: t }
			}
		}
	}
	return best
}

/** Degrees from centre → [coarse] or [coarse, fine] for a { range, invert, fine } axis. */
function axisBytes(ax, deg) {
	let n = Math.max(0, Math.min(1, (deg + ax.range / 2) / ax.range))
	if (ax.invert) n = 1 - n
	if (!ax.fine) return [Math.round(n * 255)]
	const v = Math.round(n * 65535)
	return [v >> 8, v & 0xff]
}

/**
 * Write one fixture into a 512-byte universe: pan / tilt (+ fine) and its fixed channels.
 * @param {Uint8Array} buf @param {object} fx normalized (follow-patch) @param {{ pan, tilt }} pt @param {Array} fixed
 */
function writeFixture(buf, fx, pt, fixed) {
	const at = (ch) => fx.address - 1 + ch - 1
	const put = (ch, v) => {
		const i = at(ch)
		if (i >= 0 && i < 512) buf[i] = v
	}
	for (const c of fixed) put(c.ch, c.value)
	for (const [ax, deg] of [[fx.pan, pt.pan], [fx.tilt, pt.tilt]]) {
		const b = axisBytes(ax, deg)
		put(ax.ch, b[0])
		if (ax.fine) put(ax.fine, b[1])
	}
}

module.exports = { aim, beam, axisBytes, writeFixture, frame }
