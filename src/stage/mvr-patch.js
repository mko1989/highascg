'use strict'

/**
 * WO-615 T10 — fixtures of an imported MVR scene → `project.fixtures.patch` entries (typed GDTF fixtures), so the rig
 * arrives patched: the GDTF named by `GDTFSpec` (imported into gdtf-store.js by the caller), `GDTFMode`, the absolute
 * DMX address of the first break, and the pose from the fixture's world matrix. The client merges the entries into its
 * slice (`project.fixtures` is client-owned, CLIENT_OWNED_SLICES) — this only builds them. Pure.
 *
 *   address: MVR universe U (1-based, absolute 1…512 = U1) → Art-Net port-address U − 1 (a console's universe 1 is
 *            Art-Net 0) or sACN universe U.
 *   pose:    MVR and PSN share axes (x stage left, y upstage, z up, metres); the rotation is the GDTF rest pose (hung,
 *            beam down) turned by Godot YXZ Euler angles — yaw about up (negated, as pose.yaw), pitch, roll — with a roll
 *            past ±90° written as hang "floor" (the previs's turn-over about Z) plus the remainder.
 *   id:      "mvr-<uuid>" — stable, so a re-patch replaces the same entries and the previs hides the MVR scene's own
 *            static model of a patched fixture.
 */

const { GODOT_FROM_MVR } = require('./mvr-math')

const DEFAULT_DEST = '255.255.255.255'
const DEG = 180 / Math.PI

const r2 = (v) => {
	const n = Math.round(v * 100) / 100
	return n === 0 ? 0 : n
}
const r3 = (v) => {
	const n = Math.round(v * 1000) / 1000
	return n === 0 ? 0 : n
}

/** Absolute DMX address (1 = universe 1, channel 1) → { universe (MVR, 1-based), address 1–512 }, or null. */
function splitAddress(abs) {
	const a = Math.floor(Number(abs))
	if (!Number.isFinite(a) || a < 1) return null
	return { universe: Math.floor((a - 1) / 512) + 1, address: ((a - 1) % 512) + 1 }
}

/** The fixture's first-break address (lowest break number with an address). */
function firstAddress(addresses) {
	const list = (Array.isArray(addresses) ? addresses : []).filter((a) => Number(a?.address) >= 1)
	list.sort((a, b) => (Number(a.break) || 0) - (Number(b.break) || 0))
	return list.length ? splitAddress(list[0].address) : null
}

/** Column-major 4×4 → 3×3 rows, columns normalized (scale dropped); a mirrored frame gets its third column flipped. */
function rotationRows(m) {
	const col = (c) => {
		const v = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]].map(Number)
		const n = Math.hypot(...v) || 1
		return v.map((x) => x / n)
	}
	const [u, v, w] = [col(0), col(1), col(2)]
	const det = u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0])
	const mirrored = det < 0
	const z = mirrored ? w.map((x) => -x) : w
	return { rows: [0, 1, 2].map((r) => [u[r], v[r], z[r]]), mirrored }
}

/** Godot basis rows Q = C · R · C⁻¹ (C = GODOT_FROM_MVR: x → x, y → −z, z → y). */
function toGodotRows(R) {
	const C = [0, 1, 2].map((r) => [0, 1, 2].map((c) => GODOT_FROM_MVR[c * 4 + r]))
	const Ct = [0, 1, 2].map((r) => [0, 1, 2].map((c) => C[c][r])) // a rotation's inverse is its transpose
	const mm = (A, B) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c]))
	return mm(mm(C, R), Ct)
}

/** Godot Basis.get_euler(YXZ) for B = Ry(y) · Rx(x) · Rz(z), radians. */
function eulerYXZ(B) {
	const m12 = B[1][2]
	if (m12 >= 1 - 1e-9) return { x: -Math.PI / 2, y: -Math.atan2(B[0][1], B[0][0]), z: 0 }
	if (m12 <= -1 + 1e-9) return { x: Math.PI / 2, y: Math.atan2(B[0][1], B[0][0]), z: 0 }
	return { x: Math.asin(-m12), y: Math.atan2(B[0][2], B[2][2]), z: Math.atan2(B[1][0], B[1][1]) }
}

/**
 * MVR world matrix (column-major 4×4, metres) → patch pose { x, y, z, hang, yaw, pitch, roll } (+ mirrored when the file's
 * frame was left-handed and had to be flipped).
 */
function poseFromMatrix(m) {
	const { rows, mirrored } = rotationRows(m)
	const e = eulerYXZ(toGodotRows(rows))
	let roll = e.z * DEG
	let hang = 'truss'
	if (Math.abs(roll) > 90) {
		hang = 'floor'
		roll -= Math.sign(roll) * 180
	}
	const pose = { x: r3(m[12]), y: r3(m[13]), z: r3(m[14]), hang, yaw: r2(-e.y * DEG), pitch: r2(e.x * DEG), roll: r2(roll) }
	if (mirrored) pose.mirrored = true
	return pose
}

/** The mode of a stored type that an MVR GDTFMode names (exact, then trimmed / case-insensitive), or ''. An empty GDTFMode
 * is not guessed: the type's first mode is usually its biggest and would overlap the next fixture (Basic Festival #327). */
function matchMode(modeNames, wanted) {
	const names = Array.isArray(modeNames) ? modeNames.map(String) : []
	const w = String(wanted ?? '')
	if (names.includes(w)) return w
	const key = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase()
	return w.trim() === '' ? '' : names.find((n) => key(n) === key(w)) || ''
}

/**
 * @param {object[]} objects mvr-scene.js objects (kind 'Fixture' carry `fixture { spec, mode, id, addresses, matrix }`)
 * @param {{ protocol?: 'artnet' | 'sacn', typeFor: (spec: string) => { id: string, modes: { name: string, breaks?: number }[] } |
 *   { error: string } | null }} opts  typeFor: the stored type of a GDTFSpec (null = not in the archive)
 * @returns {{ fixtures: object[], skipped: { uuid: string, name: string, reason: string }[], notes: string[] }}
 */
function buildMvrPatch(objects, { protocol = 'artnet', typeFor }) {
	const sacn = protocol === 'sacn'
	const fixtures = []
	const skipped = []
	const multiBreak = new Set()
	const names = new Map()
	let mirrored = 0
	for (const o of Array.isArray(objects) ? objects : []) {
		const f = o?.fixture
		if (!f) continue
		const uuid = String(o.uuid || '').trim()
		let name = [o.name, f.id].filter((v) => String(v ?? '').trim() !== '').join(' ').trim() || 'MVR fixture'
		const seen = names.get(name) || 0
		names.set(name, seen + 1)
		if (seen) name = `${name} (${seen + 1})` // no FixtureID in the file (Circle Stage): keep names apart
		const skip = (reason) => skipped.push({ uuid, name, reason })
		if (!uuid) {
			skip('no uuid in the MVR file')
			continue
		}
		const type = f.spec ? typeFor(f.spec) : null
		if (type?.error) {
			skip(type.error)
			continue
		}
		if (!type) {
			skip(f.spec ? `GDTF "${f.spec}" is not in the MVR file` : 'no GDTFSpec')
			continue
		}
		const modeName = matchMode(type.modes.map((m) => m.name), f.mode)
		if (!modeName) {
			skip(String(f.mode ?? '').trim() ? `mode "${f.mode}" not in ${f.spec}` : 'no GDTFMode in the MVR file')
			continue
		}
		const at = firstAddress(f.addresses)
		if (!at) {
			skip('no DMX address (unpatched in the MVR file)')
			continue
		}
		if ((type.modes.find((m) => m.name === modeName)?.breaks || 1) > 1) multiBreak.add(`${f.spec} · ${modeName}`)
		const pose = Array.isArray(f.matrix) && f.matrix.length === 16 ? poseFromMatrix(f.matrix) : { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0, pitch: 0, roll: 0 }
		if (pose.mirrored) {
			mirrored++
			delete pose.mirrored
		}
		fixtures.push({
			id: `mvr-${uuid.toLowerCase()}`,
			name: name.slice(0, 120),
			enabled: true,
			protocol: sacn ? 'sacn' : 'artnet',
			universe: sacn ? at.universe : at.universe - 1,
			address: at.address,
			dest: sacn ? '' : DEFAULT_DEST,
			typeId: type.id,
			mode: modeName,
			pose,
		})
	}
	const notes = []
	if (multiBreak.size) notes.push(`Only the first DMX break is output for: ${[...multiBreak].join(', ')}`)
	if (mirrored) notes.push(`${mirrored} fixture(s) had a mirrored matrix in the file — placed unmirrored`)
	return { fixtures, skipped, notes }
}

module.exports = { buildMvrPatch, poseFromMatrix, splitAddress, firstAddress, matchMode, eulerYXZ }
