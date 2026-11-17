/**
 * Drawing the flying vegetables of Stage Salad (WO-1089 §11): one veg-models.js mesh per live projectile of the
 * shots.js book (drawn VIS × real size so a 4.5 cm tomato reads from the back rows), a short fading trail, carrots
 * along their flight and spinning, the rest tumbling; vegetables lying where they stopped shrink away; ground / wall
 * splats as flat blobs on the surface fading out (ShotBook.markAlpha); a burst of bits at every splat / hit.
 */
import { vegMesh } from './veg-models.js'
import { ShotBook } from './shots.js'

export const VIS = 1.6
const TRAIL_N = 10
const MAX_BITS = 72
const BIT_MS = 600

export function createProjectileView(THREE, scene) {
	const root = new THREE.Group()
	root.name = 'salad-projectiles'
	scene.add(root)
	const shown = new Map() // key → { obj, trail, pts, spin, axis }
	const marks = new Map() // key → { g, mats }
	const bits = []
	const bitGeo = new THREE.SphereGeometry(1, 6, 4)
	const markGeo = new THREE.CircleGeometry(1, 14)
	const up = new THREE.Vector3(0, 0, 1)
	const tmp = new THREE.Vector3()

	function make(pr) {
		const obj = vegMesh(THREE, pr.veg.id)
		obj.scale.setScalar(VIS)
		const pts = new Float32Array(TRAIL_N * 3)
		for (let k = 0; k < TRAIL_N; k++) pts.set(pr.p, k * 3)
		const geo = new THREE.BufferGeometry()
		geo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
		const trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: pr.veg.color, transparent: true, opacity: 0.45, depthWrite: false }))
		trail.frustumCulled = false
		root.add(obj, trail)
		const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
		return { obj, trail, pts, spin: 0, axis }
	}

	function drop(key, s) {
		s.obj.removeFromParent()
		s.trail.removeFromParent()
		s.trail.geometry.dispose()
		s.trail.material.dispose()
		shown.delete(key)
	}

	function syncMarks(book, sNow) {
		const keep = new Set()
		for (const m of book.marks) {
			keep.add(m.key)
			let e = marks.get(m.key)
			if (!e) {
				const g = new THREE.Group()
				const mt = new THREE.MeshBasicMaterial({ color: m.color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide })
				const blob = new THREE.Mesh(markGeo, mt)
				blob.scale.set(m.r, m.r * 0.8, 1)
				g.add(blob)
				for (let k = 0; k < 4; k++) {
					const d = new THREE.Mesh(markGeo, mt)
					const a = Math.random() * Math.PI * 2
					const rr = m.r * (0.18 + Math.random() * 0.2)
					d.position.set(Math.cos(a) * m.r * 1.3, Math.sin(a) * m.r * 1.1, 0)
					d.scale.set(rr, rr, 1)
					g.add(d)
				}
				g.position.set(m.p[0] + m.n[0] * 0.006, m.p[1] + m.n[1] * 0.006, m.p[2] + m.n[2] * 0.006)
				g.quaternion.setFromUnitVectors(up, tmp.set(m.n[0], m.n[1], m.n[2]).normalize())
				g.rotateZ(Math.random() * Math.PI)
				root.add(g)
				e = { g, mt }
				marks.set(m.key, e)
			}
			e.mt.opacity = 0.92 * ShotBook.markAlpha(m, sNow)
		}
		for (const [k, e] of marks)
			if (!keep.has(k)) {
				e.g.removeFromParent()
				e.mt.dispose()
				marks.delete(k)
			}
	}

	return {
		group: root,
		/** Draw the book at server time sNow (dt s since the last frame). */
		sync(book, sNow, dt) {
			const keep = new Set()
			for (const pr of book.live) {
				keep.add(pr.key)
				let s = shown.get(pr.key)
				if (!s) shown.set(pr.key, (s = make(pr)))
				s.obj.position.set(pr.p[0], pr.p[1], pr.p[2])
				const flying = pr.state === 'fly' || pr.state === 'hold' || pr.state === 'fall'
				if (flying) {
					s.spin += dt * (pr.veg.id === 'carrot' ? 14 : 6)
					if (pr.veg.id === 'carrot') {
						tmp.set(pr.p[0] + pr.v[0], pr.p[1] + pr.v[1], pr.p[2] + pr.v[2])
						s.obj.lookAt(tmp)
						s.obj.rotateZ(s.spin)
					} else s.obj.quaternion.setFromAxisAngle(s.axis, s.spin)
					s.pts.copyWithin(3, 0, (TRAIL_N - 1) * 3)
					s.pts.set(pr.p, 0)
					s.trail.geometry.attributes.position.needsUpdate = true
					s.trail.visible = pr.state === 'fly'
				} else {
					s.trail.visible = false
					const left = 1 - (sNow - pr.doneAt) / 3000
					s.obj.scale.setScalar(VIS * Math.max(0.05, Math.min(1, left * 3)))
				}
			}
			for (const [k, s] of shown) if (!keep.has(k)) drop(k, s)
			syncMarks(book, sNow)
			for (let k = bits.length - 1; k >= 0; k--) {
				const b = bits[k]
				const age = (sNow - b.at) / BIT_MS
				if (age >= 1) {
					b.m.removeFromParent()
					b.m.material.dispose()
					bits.splice(k, 1)
					continue
				}
				b.v[1] -= 9.81 * dt
				b.m.position.x += b.v[0] * dt
				b.m.position.y += b.v[1] * dt
				b.m.position.z += b.v[2] * dt
				b.m.material.opacity = 1 - age
			}
		},
		/** Bits flying off a splat / hit at p (n of them, the vegetable's colour), at server time sNow. */
		burst(p, color, sNow, n = 8, speed = 2.2, size = 0.02) {
			for (let k = 0; k < n; k++) {
				if (bits.length >= MAX_BITS) {
					const old = bits.shift().m
					old.removeFromParent()
					old.material.dispose() // WO-1106 B61: each bit owns its material
				}
				const m = new THREE.Mesh(bitGeo, new THREE.MeshBasicMaterial({ color, transparent: true }))
				m.scale.setScalar(size * (0.6 + Math.random() * 0.8))
				m.position.set(p[0], p[1], p[2])
				const a = Math.random() * Math.PI * 2
				const e = Math.random() * 0.9 + 0.2
				root.add(m)
				bits.push({ m, at: sNow, v: [Math.cos(a) * Math.cos(e) * speed, Math.sin(e) * speed, Math.sin(a) * Math.cos(e) * speed] })
			}
		},
		get count() {
			return shown.size
		},
		clear() {
			for (const [k, s] of shown) drop(k, s)
		},
	}
}
