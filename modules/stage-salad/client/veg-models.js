/**
 * Procedural low-poly vegetables of Stage Salad (WO-1089 §4 / §11) — our own simple shapes, no assets:
 *   tomato   a squat red ball with a green star calyx and a stub of stem
 *   potato   a lumpy brown pebble (seeded vertex noise, flat shaded)
 *   carrot   an orange cone (tip forward along +Z) with a green leaf tuft at the back
 *   cabbage  a big green ball wrapped in a few loose leaves
 *   onion    a golden bulb (lathe) with a tuft on top
 *   peas     small green balls
 * Built at real size (radius = the ammo table's r) and cached per kind; vegMesh() returns a cheap copy that shares the
 * geometry and materials. A gentle emissive keeps them readable in a dark room.
 */
import { VEGGIES } from './veggies.js'

const cache = new Map()

function mat(THREE, hex, opt = {}) {
	const c = new THREE.Color(hex)
	return new THREE.MeshLambertMaterial({ color: c, emissive: c.clone().multiplyScalar(0.22), flatShading: !!opt.flat, side: opt.side ?? THREE.FrontSide })
}

/** Deterministic little noise for the potato's lumps. */
function lumpy(THREE, geo, amp, seed = 7) {
	const pos = geo.attributes.position
	const v = new THREE.Vector3()
	const seen = new Map()
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i)
		const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`
		let k = seen.get(key)
		if (k == null) {
			k = 1 + amp * Math.sin(v.x * 37 + seed) * Math.cos(v.y * 29 - seed) * Math.sin(v.z * 23 + seed * 0.5)
			seen.set(key, k)
		}
		v.multiplyScalar(k)
		pos.setXYZ(i, v.x, v.y, v.z)
	}
	geo.computeVertexNormals()
	return geo
}

const BUILD = {
	tomato(THREE, r) {
		const g = new THREE.Group()
		const body = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(THREE, VEGGIES.tomato.color))
		body.scale.set(1.05, 0.86, 1.05)
		g.add(body)
		const green = mat(THREE, '#3f8f2e', { side: THREE.DoubleSide })
		const leaf = new THREE.SphereGeometry(1, 6, 4)
		for (let k = 0; k < 5; k++) {
			const a = (k / 5) * Math.PI * 2
			const m = new THREE.Mesh(leaf, green)
			m.scale.set(r * 0.42, r * 0.06, r * 0.14)
			m.position.set(Math.cos(a) * r * 0.32, r * 0.84, Math.sin(a) * r * 0.32)
			m.rotation.y = -a
			g.add(m)
		}
		const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.07, r * 0.09, r * 0.3, 5), green)
		stem.position.y = r * 0.98
		g.add(stem)
		return g
	},
	potato(THREE, r) {
		const m = new THREE.Mesh(lumpy(THREE, new THREE.IcosahedronGeometry(r, 1), 0.16), mat(THREE, VEGGIES.potato.color, { flat: true }))
		m.scale.set(1.35, 0.88, 1.0)
		return m
	},
	carrot(THREE, r) {
		const g = new THREE.Group()
		const len = r * 6.5
		const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 1.1, len, 8, 1), mat(THREE, VEGGIES.carrot.color, { flat: true }))
		cone.rotation.x = Math.PI / 2 // the tip (+Y) forward along +Z
		g.add(cone)
		const green = mat(THREE, '#4caf3a', { flat: true })
		for (let k = 0; k < 3; k++) {
			const l = new THREE.Mesh(new THREE.ConeGeometry(r * 0.28, len * 0.45, 4), green)
			l.rotation.x = -Math.PI / 2 + (k - 1) * 0.35
			l.rotation.z = (k - 1) * 0.3
			l.position.set((k - 1) * r * 0.3, 0, -len * 0.62)
			g.add(l)
		}
		return g
	},
	cabbage(THREE, r) {
		const g = new THREE.Group()
		g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.9, 1), mat(THREE, '#a6d97a', { flat: true })))
		const leafMat = mat(THREE, VEGGIES.cabbage.color, { flat: true, side: THREE.DoubleSide })
		for (let k = 0; k < 6; k++) {
			const geo = new THREE.SphereGeometry(r, 5, 4, 0, Math.PI * 0.8, Math.PI * 0.12, Math.PI * 0.7)
			const m = new THREE.Mesh(geo, leafMat)
			m.rotation.set((k % 3) * 0.9, (k / 6) * Math.PI * 2, (k % 2) * 0.6)
			g.add(m)
		}
		return g
	},
	onion(THREE, r) {
		const g = new THREE.Group()
		const pts = []
		for (let k = 0; k <= 10; k++) {
			const t = k / 10
			const y = -r + t * r * 2.3
			const w = t < 0.75 ? Math.sin((t / 0.75) * Math.PI) * r * 1.02 + (t < 0.05 ? 0 : r * 0.02) : r * 0.12 * (1 - (t - 0.75) / 0.25) + 0.001
			pts.push(new THREE.Vector2(Math.max(0.0005, w), y))
		}
		g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 10), mat(THREE, VEGGIES.onion.color, { flat: true })))
		const tuft = new THREE.Mesh(new THREE.ConeGeometry(r * 0.08, r * 0.5, 4), mat(THREE, '#8f6a2a'))
		tuft.position.y = r * 1.45
		g.add(tuft)
		return g
	},
	peas(THREE, r) {
		return new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat(THREE, VEGGIES.peas.color))
	},
}

/** A vegetable of kind `id` (cached build, a shallow copy sharing geometry / materials). */
export function vegMesh(THREE, id) {
	const v = VEGGIES[id] || VEGGIES.tomato
	if (!cache.has(v.id)) cache.set(v.id, BUILD[v.id](THREE, v.r))
	const o = cache.get(v.id).clone()
	o.name = `veg:${v.id}`
	return o
}

/** A small display version for the slingshot's pouch / the crate (a pea burst shows as a little cluster). */
export function pouchMesh(THREE, id) {
	if (id !== 'peas') return vegMesh(THREE, id)
	const g = new THREE.Group()
	for (let k = 0; k < 5; k++) {
		const p = vegMesh(THREE, 'peas')
		const a = (k / 5) * Math.PI * 2
		p.position.set(Math.cos(a) * 0.022, (k % 2) * 0.015, Math.sin(a) * 0.022)
		g.add(p)
	}
	return g
}
