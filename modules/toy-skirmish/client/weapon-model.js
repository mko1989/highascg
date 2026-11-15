/**
 * Procedural toy weapons of Stage Skirmish (WO-1081 §9) — one look per weapon, our own designs, chunky enough to read
 * from above: the soldier holds one, and the pick-up pads show a bigger copy. Built in u (the caller scales by the
 * scene scale), barrel along −Z from the grip at the origin. Shared geometries and materials (never disposed per
 * model); `muzzleZ(id)` = how far ahead of the grip the barrel ends.
 */
import * as THREE from 'three'

let S = null

function shared() {
	if (S) return S
	const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1, ...extra })
	S = {
		dark: mat(0x2a2d34),
		metal: mat(0x8d96a3, { metalness: 0.5, roughness: 0.35 }),
		orange: mat(0xff8a1f),
		lime: mat(0x9be22d),
		cyan: mat(0x38d9ff, { emissive: 0x0b5f73 }),
		violet: mat(0x8a5cff),
		yellow: mat(0xffd23a),
		box: new THREE.BoxGeometry(1, 1, 1),
		cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateX(Math.PI / 2),
		sph: new THREE.SphereGeometry(0.5, 12, 8),
	}
	return S
}

function part(geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) {
	const m = new THREE.Mesh(geo, mat)
	m.scale.set(sx, sy, sz)
	m.position.set(x, y, z)
	return m
}

/** Muzzle distance ahead of the grip (u). */
const MUZZLE = { pea: 0.3, rattler: 0.42, scatter: 0.36, longshot: 0.62, thumper: 0.46 }

export function muzzleZ(id) {
	return MUZZLE[id] ?? 0.3
}

/** A weapon model (u). */
export function buildWeapon(id) {
	const s = shared()
	const g = new THREE.Group()
	g.name = 'weapon-' + id
	const add = (...a) => g.add(part(...a))
	switch (id) {
		case 'rattler': // stubby body, long barrel, drum magazine, orange stock
			add(s.box, s.dark, 0.09, 0.09, 0.26, 0, 0, -0.05)
			add(s.cyl, s.metal, 0.045, 0.045, 0.2, 0, 0.01, -0.3)
			add(s.cyl, s.orange, 0.1, 0.1, 0.06, 0, -0.07, -0.08)
			add(s.box, s.orange, 0.07, 0.07, 0.1, 0, -0.01, 0.12)
			break
		case 'scatter': // two fat barrels side by side, lime pump
			add(s.box, s.dark, 0.13, 0.08, 0.2, 0, 0, 0.02)
			add(s.cyl, s.metal, 0.06, 0.06, 0.26, -0.035, 0.01, -0.22)
			add(s.cyl, s.metal, 0.06, 0.06, 0.26, 0.035, 0.01, -0.22)
			add(s.box, s.lime, 0.12, 0.06, 0.08, 0, -0.04, -0.17)
			break
		case 'longshot': // very long thin barrel, glowing cyan scope and coil rings
			add(s.box, s.dark, 0.07, 0.08, 0.3, 0, 0, 0)
			add(s.cyl, s.metal, 0.03, 0.03, 0.42, 0, 0.01, -0.4)
			add(s.cyl, s.cyan, 0.05, 0.05, 0.14, 0, 0.08, -0.06)
			add(s.cyl, s.cyan, 0.055, 0.055, 0.02, 0, 0.01, -0.3)
			add(s.cyl, s.cyan, 0.055, 0.055, 0.02, 0, 0.01, -0.45)
			break
		case 'thumper': // fat violet tube with a yellow mouth ring
			add(s.cyl, s.violet, 0.14, 0.14, 0.52, 0, 0.03, -0.18)
			add(s.cyl, s.yellow, 0.16, 0.16, 0.04, 0, 0.03, -0.44)
			add(s.box, s.dark, 0.06, 0.1, 0.08, 0, -0.07, -0.02)
			break
		default: // pea: small pistol, bright green barrel tip
			add(s.box, s.dark, 0.07, 0.08, 0.18, 0, 0, -0.05)
			add(s.cyl, s.metal, 0.035, 0.035, 0.12, 0, 0.015, -0.2)
			add(s.sph, s.lime, 0.05, 0.05, 0.05, 0, 0.015, -0.27)
			add(s.box, s.dark, 0.05, 0.1, 0.05, 0, -0.07, 0.01)
	}
	return g
}

/** Health: a chunky white plus on a red box. Armour: a blue vest plate. Surge: a spiky magenta star. (u) */
export function buildPickupModel(kind) {
	if (MUZZLE[kind] != null) return buildWeapon(kind)
	const s = shared()
	const g = new THREE.Group()
	if (kind === 'health') {
		g.add(part(s.box, new THREE.MeshStandardMaterial({ color: 0xf03a3a, roughness: 0.5 }), 0.34, 0.2, 0.34))
		const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0x333333 })
		g.add(part(s.box, white, 0.24, 0.06, 0.08, 0, 0.12, 0))
		g.add(part(s.box, white, 0.08, 0.06, 0.24, 0, 0.12, 0))
	} else if (kind === 'armour') {
		const blue = new THREE.MeshStandardMaterial({ color: 0x3a8cff, roughness: 0.35, metalness: 0.4 })
		g.add(part(s.box, blue, 0.36, 0.1, 0.4))
		g.add(part(s.box, blue, 0.12, 0.1, 0.14, -0.12, 0.08, -0.12))
		g.add(part(s.box, blue, 0.12, 0.1, 0.14, 0.12, 0.08, -0.12))
		g.add(part(s.box, s.yellow, 0.06, 0.12, 0.06, 0, 0.08, 0.06))
	} else {
		const mag = new THREE.MeshStandardMaterial({ color: 0xff3fd8, emissive: 0x7a0a66, roughness: 0.3 })
		g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), mag))
		const spikes = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), mag)
		spikes.rotation.set(Math.PI / 4, Math.PI / 4, 0)
		g.add(spikes)
	}
	return g
}

/** Pad colour of a pick-up kind (hex). */
export function pickupColor(kind) {
	return (
		{
			rattler: 0xff8a1f,
			scatter: 0x9be22d,
			longshot: 0x38d9ff,
			thumper: 0x8a5cff,
			health: 0xff4a4a,
			armour: 0x3a8cff,
			surge: 0xff3fd8,
		}[kind] ?? 0xffffff
	)
}
