/**
 * WO-1101 / WO-1102 — the visuals the visitors layer draws itself (work/notes/game-world-contract.md §2, §6.4): the soft
 * floor shadow and the coloured warning ring of Skirmish's cut-away, the splat decals on the floor (slick patches), and
 * the one-shot effects of `wv.fx` on a visitor — a splat decal in the vegetable's colour, sparks, stun stars, a hop.
 * No DOM (the shadow's soft edge is a DataTexture), no files; every material is our own and freed with its owner.
 *
 *   const kit = createFxKit(THREE)
 *   kit.shadow() · kit.ring(color) · kit.floorSplat(color, r)   → { obj, set(…), dispose() }
 *   kit.effect(kind, ms, color, bounds) → { obj | null, hopY, update(dt) → alive, dispose() }
 */

const SPARK_N = 14

export function createFxKit(THREE) {
	const N = 32
	const px = new Uint8Array(N * N * 4)
	for (let y = 0; y < N; y++)
		for (let x = 0; x < N; x++) {
			const d = Math.hypot(x - (N - 1) / 2, y - (N - 1) / 2) / (N / 2)
			const a = Math.max(0, 1 - d)
			px.set([0, 0, 0, Math.round(255 * a * a)], (y * N + x) * 4)
		}
	const shadowTex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat)
	shadowTex.needsUpdate = true
	const flat = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
	const ringGeo = new THREE.RingGeometry(0.88, 1, 32).rotateX(-Math.PI / 2)
	const disc = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2)
	const ball = new THREE.SphereGeometry(1, 8, 6)
	const star = new THREE.OctahedronGeometry(1, 0)

	const basic = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...o })

	return {
		/** The soft dark floor shadow (a visitor above the cut): set(x, y, z, r, alpha). */
		shadow() {
			const mat = basic({ map: shadowTex, color: 0x000000 })
			const obj = new THREE.Mesh(flat, mat)
			obj.renderOrder = 2
			return {
				obj,
				set(x, y, z, r, alpha) {
					obj.position.set(x, y + 0.004, z)
					obj.scale.setScalar(r)
					mat.opacity = alpha
				},
				dispose: () => mat.dispose(),
			}
		},
		/** The thin ring in a vegetable's colour under an incoming one. */
		ring(color) {
			const mat = basic({ color: new THREE.Color(color || '#ffffff'), opacity: 0.85, side: THREE.DoubleSide })
			const obj = new THREE.Mesh(ringGeo, mat)
			obj.renderOrder = 3
			return {
				obj,
				set(x, y, z, r, alpha) {
					obj.position.set(x, y + 0.005, z)
					obj.scale.setScalar(r)
					mat.opacity = 0.35 + 0.55 * alpha
				},
				dispose: () => mat.dispose(),
			}
		},
		/** A splat lying on the floor (radius r m): a blob and four drops, translucent; a slick one a little glossier. */
		floorSplat(color, r, seed = 1) {
			const mat = basic({ color: new THREE.Color(color || '#e2392b'), opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
			const obj = new THREE.Group()
			const blob = new THREE.Mesh(disc, mat)
			blob.scale.set(r, 1, r * 0.82)
			obj.add(blob)
			for (let k = 0; k < 4; k++) {
				const a = ((seed * 7 + k * 97) % 360) * (Math.PI / 180)
				const d = new THREE.Mesh(disc, mat)
				const rr = r * (0.16 + ((seed + k) % 5) * 0.04)
				d.position.set(Math.cos(a) * r * 1.25, 0, Math.sin(a) * r * 1.05)
				d.scale.set(rr, 1, rr)
				obj.add(d)
			}
			obj.rotation.y = (seed % 628) / 100
			obj.renderOrder = 2
			return {
				obj,
				set(x, y, z, alpha, slick) {
					obj.position.set(x, y + 0.003, z)
					mat.opacity = (slick ? 0.72 : 0.55) * alpha
				},
				dispose: () => mat.dispose(),
			}
		},
		/**
		 * A one-shot effect on a visitor (`wv.fx` [w, kind, ms, c]) in the visitor's own frame (bounds { cy, r }).
		 * kinds: splat (decal in c on top), sparks / scatter (a burst), stun / bonk (stars circling over it), hop.
		 */
		effect(kind, ms, color, bounds) {
			const life = Math.max(0.05, Math.min(10, (ms || 600) / 1000))
			const r = Math.max(0.005, bounds.r)
			const cy = bounds.cy
			let age = 0
			const fx = { obj: null, hopY: 0, kind, update: (dt) => (age += dt) < life, dispose() {} }
			if (kind === 'hop') {
				const H = Math.max(0.01, r * 1.4)
				const T = Math.min(life, 0.8)
				fx.update = (dt) => {
					age += dt
					const u = Math.min(1, age / T)
					fx.hopY = 4 * H * u * (1 - u)
					return age < life
				}
				return fx
			}
			if (kind === 'splat') {
				const mat = basic({ color: new THREE.Color(color || '#e2392b'), opacity: 1, depthWrite: true })
				const g = new THREE.Group()
				for (let k = 0; k < 3; k++) {
					const m = new THREE.Mesh(ball, mat)
					m.scale.set(r * (0.42 - k * 0.08), r * 0.12, r * (0.36 - k * 0.06))
					m.position.set((k - 1) * r * 0.32, cy + r * (0.55 + k * 0.05), (k % 2) * r * 0.2)
					g.add(m)
				}
				fx.obj = g
				fx.update = (dt) => {
					age += dt
					const u = age / life
					mat.opacity = u < 0.7 ? 1 : Math.max(0, 1 - (u - 0.7) / 0.3)
					return age < life
				}
				fx.dispose = () => mat.dispose()
				return fx
			}
			if (kind === 'sparks' || kind === 'scatter') {
				const pos = new Float32Array(SPARK_N * 3)
				const vel = []
				for (let k = 0; k < SPARK_N; k++) {
					const a = (k / SPARK_N) * Math.PI * 2 + k * 0.7
					const up = 0.4 + ((k * 37) % 10) / 12
					vel.push([Math.cos(a) * r * 5, up * r * 6, Math.sin(a) * r * 5])
					pos.set([0, cy, 0], k * 3)
				}
				const geo = new THREE.BufferGeometry()
				geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
				const col = kind === 'sparks' ? 0xffd27a : color || '#7cd65a'
				const mat = new THREE.PointsMaterial({ color: new THREE.Color(col), size: Math.max(0.003, r * 0.22), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
				const pts = new THREE.Points(geo, mat)
				pts.frustumCulled = false
				fx.obj = pts
				const T = Math.min(life, 0.7)
				fx.update = (dt) => {
					age += dt
					for (let k = 0; k < SPARK_N; k++) {
						vel[k][1] -= r * 14 * dt
						pos[k * 3] += vel[k][0] * dt
						pos[k * 3 + 1] += vel[k][1] * dt
						pos[k * 3 + 2] += vel[k][2] * dt
					}
					geo.attributes.position.needsUpdate = true
					mat.opacity = Math.max(0, 1 - age / T)
					return age < T
				}
				fx.dispose = () => (geo.dispose(), mat.dispose())
				return fx
			}
			/* stun / bonk: three stars circling over the visitor */
			const mat = new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true })
			const g = new THREE.Group()
			const stars = []
			for (let k = 0; k < 3; k++) {
				const m = new THREE.Mesh(star, mat)
				m.scale.setScalar(r * 0.16)
				g.add(m)
				stars.push(m)
			}
			fx.obj = g
			fx.update = (dt) => {
				age += dt
				stars.forEach((m, k) => {
					const a = age * 7 + (k / 3) * Math.PI * 2
					m.position.set(Math.cos(a) * r * 0.6, cy + r * 1.05, Math.sin(a) * r * 0.6)
					m.rotation.y = a * 2
				})
				mat.opacity = Math.min(1, (life - age) / 0.3)
				return age < life
			}
			fx.dispose = () => mat.dispose()
			return fx
		},
		dispose() {
			shadowTex.dispose()
			for (const g of [flat, ringGeo, disc, ball, star]) g.dispose()
		},
	}
}
