'use strict'

/**
 * WO-765 — the calibrated rig as a position table (CSV) for a desk or a paperwork check, from the export's report
 * (mvr-rig-export.js: each head's FILE pose, the frame the MVR carries). One row per head: fixture ID, name, universe /
 * address, status, X / Y / Z in metres, rotation X / Y / Z in degrees. Pure.
 *
 *   desk 'mvr' (default; the MVR and grandMA3 frame — help.malighting.com grandMA3 2.5 patch_position_fixtures.html:
 *        "X … positive … stage left", "Y … positive … upstage", Z the height, "only works with meters and degrees";
 *        rotations: "X rotation … positive … top of the fixture towards downstage", "Y rotation … positive … top
 *        towards stage left", "Z rotation … positive … counter-clockwise, as seen from the top" — each a right-hand
 *        turn about that axis). Zero rotation = the GDTF's own drawing, which hangs (MVR spec: "The device shall be
 *        drawn in a hanging position"), so a head hung straight down reads 0 / 0 / 0 and a floor head 0 / 180 / 0.
 *        MA does not document the order the three turns combine in; this table writes R = Rz · Ry · Rx (X first,
 *        about the fixed axes) — exact for one turn, within 0.1° for the few-degree tilts a rig has, and the MVR
 *        itself carries the exact matrix.
 *   desk 'magicq' (docs.chamsys.co.uk/magicq 1.9.9.x trackers.html: "X and Z as horizontal … Y as vertical", "MagicQ
 *        has Z positive towards the audience"; patching.html CSV headings "Head no", "Head name", "Universe", "DMX",
 *        "X", "Y", "Z", "RotX", "RotY", "RotZ", metres): X = MVR X, Y = MVR Z, Z = −MVR Y — the format WO-1072
 *        (console-match.js exportCsv) proved on MagicQ PC 1.9.8.3: DMX as "<universe>-<address>" with Art-Net
 *        universes +1, and every row ends with a comma (MagicQ drops the last character of a line's last field).
 *        Load it with Patch → Import Heads, option "Vis data only" (positions + rotations, matched by DMX address).
 *        Rotations: MagicQ documents no order; its own MVR import (MagicQ PC 1.9.8.3, WO-765 test, Patch → View Vis)
 *        shows every head's matrix as R = Ry(RotY) · Rx(RotX) · Rz(RotZ) in its frame — eight calibrated heads with
 *        up to 5° pitch / roll matched that to the 0.1° it displays, and Rz · Ry · Rx missed head 6 by 0.3°. So this
 *        table writes that order: a hung head 0 / 0 / 0, RotY = −yaw, RotX = pitch, RotZ = roll (floor + 180).
 */

const r3 = (v) => Math.round(v * 1000) / 1000 || 0
const r2 = (v) => Math.round(v * 100) / 100 || 0
const DEG = 180 / Math.PI

/** Rotation (3×3 rows, unit columns) → [rx, ry, rz] degrees with R = Rz(rz) · Ry(ry) · Rx(rx). */
function eulerZYX(R) {
	const ry = Math.asin(Math.max(-1, Math.min(1, -R[2][0])))
	if (Math.abs(R[2][0]) > 0.99999) return [0, ry * DEG, Math.atan2(-R[0][1], R[1][1]) * DEG] // gimbal: rx folded into rz
	const e = [Math.atan2(R[2][1], R[2][2]) * DEG, ry * DEG, Math.atan2(R[1][0], R[0][0]) * DEG]
	// the same turn written the other way round (rx ± 180, 180 − ry, rz ± 180): keep the smaller one (floor = 0 / 180 / 0)
	const alt = [e[0] - Math.sign(e[0] || 1) * 180, Math.sign(e[1] || 1) * 180 - e[1], e[2] - Math.sign(e[2] || 1) * 180]
	const size = (v) => Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2])
	return (size(alt) < size(e) - 1e-9 ? alt : e).map((v) => (Math.abs(v + 180) < 1e-9 ? 180 : v))
}

/** Rotation → [rx, ry, rz] degrees with R = Ry(ry) · Rx(rx) · Rz(rz) (MagicQ's order). */
function eulerYXZ(R) {
	const rx = Math.asin(Math.max(-1, Math.min(1, -R[1][2])))
	if (Math.abs(R[1][2]) > 0.99999) return [rx * DEG, Math.atan2(-R[2][0], R[0][0]) * DEG, 0] // gimbal: rz folded into ry
	const e = [rx * DEG, Math.atan2(R[0][2], R[2][2]) * DEG, Math.atan2(R[1][0], R[1][1]) * DEG]
	const alt = [Math.sign(e[0] || 1) * 180 - e[0], e[1] - Math.sign(e[1] || 1) * 180, e[2] - Math.sign(e[2] || 1) * 180]
	const size = (v) => Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2])
	return (size(alt) < size(e) - 1e-9 ? alt : e).map((v) => (Math.abs(v + 180) < 1e-9 ? 180 : v))
}

/** Column-major 4×4 → unit 3×3 rows (scale removed; a mirrored frame's third column flipped back). */
function rotationOf(m) {
	const col = [0, 1, 2].map((c) => {
		const v = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]]
		const n = Math.hypot(...v) || 1
		return v.map((x) => x / n)
	})
	const det = col[0][0] * (col[1][1] * col[2][2] - col[1][2] * col[2][1]) - col[1][0] * (col[0][1] * col[2][2] - col[0][2] * col[2][1]) +
		col[2][0] * (col[0][1] * col[1][2] - col[0][2] * col[1][1])
	if (det < 0) col[2] = col[2].map((x) => -x)
	return [0, 1, 2].map((r) => [col[0][r], col[1][r], col[2][r]])
}

const cell = (v) => {
	const s = String(v ?? '')
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * @param {object[]} heads  mvr-rig-export.js report.heads (each with `matrix`, the world matrix written / kept)
 * @param {{ desk?: 'mvr' | 'magicq', addressOf?: (id: string) => { universe: number, address: number, protocol?: string } | null }} [opts]
 * @returns {string}
 */
function rigCsv(heads, opts = {}) {
	const magicq = opts.desk === 'magicq'
	const head = magicq
		? ['Head no', 'Head name', 'DMX', 'X', 'Y', 'Z', 'RotX', 'RotY', 'RotZ', '']
		: ['Fixture ID', 'Name', 'Universe', 'Address', 'X (m, stage left +)', 'Y (m, upstage +)', 'Z (m, up)',
			'Rot X (deg)', 'Rot Y (deg)', 'Rot Z (deg)', 'Status', 'Moved (m)', 'Turned (deg)', 'Fit', 'UUID']
	const rows = [head]
	for (const h of heads) {
		if (!Array.isArray(h.matrix)) continue
		const m = h.matrix
		const R = rotationOf(m)
		const a = opts.addressOf?.(h.id) || null
		if (magicq) {
			// MagicQ frame: X = MVR X, Y = MVR Z (up), Z = −MVR Y (towards the audience); same change for the rotation
			const C = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
			const Rq = C.map((row) => [0, 1, 2].map((c) => row.reduce((s, v, k) => s + v * [0, 1, 2].reduce((t, j) => t + R[k][j] * C[c][j], 0), 0)))
			const [rx, ry, rz] = eulerYXZ(Rq)
			const dmx = a ? `${a.universe + (a.protocol === 'sacn' ? 0 : 1)}-${String(a.address).padStart(3, '0')}` : ''
			rows.push([h.fid ?? '', h.name, dmx, r3(m[12]), r3(m[14]), r3(-m[13]), r2(rx), r2(ry), r2(rz), ''])
		} else {
			const [rx, ry, rz] = eulerZYX(R)
			rows.push([h.fid ?? '', h.name, a?.universe ?? '', a?.address ?? '', r3(m[12]), r3(m[13]), r3(m[14]), r2(rx), r2(ry), r2(rz),
				h.status, h.moved_m ?? '', h.turned_deg ?? '', h.fit || '', h.uuid || ''])
		}
	}
	return `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`
}

module.exports = { rigCsv, eulerZYX, eulerYXZ, rotationOf }
