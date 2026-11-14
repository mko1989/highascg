/**
 * Effects on a car (WO-1074 v2), for the own car and every remote car (from the `fx` flags of `s` / `w`): twin boost
 * flames, drift sparks (white → cyan → magenta with the charge stage; remote cars show the first colour), the shield
 * bubble and orbiting spin-out stars. Model-local, procedural, cheap (one Points cloud per car).
 */
import * as THREE from 'three'
import { FX } from './drive-rules.js'

const SPARK_N = 28
const STAGE_COLORS = [0xfff2c0, 0x3ee6ff, 0xff3bd0]
let shared = null

function parts() {
	if (shared) return shared
	shared = {
		flameGeo: new THREE.ConeGeometry(0.035, 0.2, 8).rotateX(Math.PI / 2),
		flameMat: new THREE.MeshBasicMaterial({
			color: 0xff8a1f,
			transparent: true,
			opacity: 0.9,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		}),
		coreMat: new THREE.MeshBasicMaterial({
			color: 0xfff1a0,
			transparent: true,
			opacity: 0.9,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		}),
		bubbleGeo: new THREE.SphereGeometry(0.34, 20, 14),
		starGeo: new THREE.OctahedronGeometry(0.035, 0),
		starMat: new THREE.MeshBasicMaterial({ color: 0xffe14a }),
	}
	return shared
}

/**
 * @param {THREE.Group} group the car model group (model-local units: the 0.45 m buggy)
 */
export function attachCarFx(group) {
	const p = parts()
	const flames = new THREE.Group()
	for (const sx of [-0.045, 0.045]) {
		const f = new THREE.Mesh(p.flameGeo, p.flameMat)
		f.position.set(sx, 0.08, 0.3)
		const core = new THREE.Mesh(p.flameGeo, p.coreMat)
		core.scale.set(0.5, 0.5, 0.6)
		f.add(core)
		flames.add(f)
	}
	flames.visible = false
	group.add(flames)

	const bubbleMat = new THREE.MeshBasicMaterial({ color: 0x40e68c, transparent: true, opacity: 0.22, depthWrite: false })
	const bubble = new THREE.Mesh(p.bubbleGeo, bubbleMat)
	bubble.position.y = 0.12
	bubble.scale.set(1, 0.75, 1.2)
	bubble.visible = false
	group.add(bubble)

	const stars = new THREE.Group()
	for (let k = 0; k < 3; k++) stars.add(new THREE.Mesh(p.starGeo, p.starMat))
	stars.position.y = 0.36
	stars.visible = false
	group.add(stars)

	const pos = new Float32Array(SPARK_N * 3)
	const vel = new Float32Array(SPARK_N * 3)
	const life = new Float32Array(SPARK_N)
	const sparkGeo = new THREE.BufferGeometry()
	sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
	const sparkMat = new THREE.PointsMaterial({
		color: STAGE_COLORS[0],
		size: 0.05,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	})
	const sparks = new THREE.Points(sparkGeo, sparkMat)
	sparks.frustumCulled = false
	group.add(sparks)
	let next = 0
	let emitAcc = 0

	return {
		/**
		 * @param {{ fx: number, stage?: number, steer?: number }} s flags (drive-rules FX) + own drift stage
		 * @param {number} dt seconds @param {number} t seconds (animation clock)
		 */
		update(s, dt, t) {
			const fx = s.fx | 0
			flames.visible = !!(fx & FX.BOOST)
			if (flames.visible) for (const f of flames.children) f.scale.set(1, 1, 0.75 + Math.random() * 0.6)
			bubble.visible = !!(fx & FX.SHIELD)
			if (bubble.visible) bubbleMat.opacity = 0.18 + 0.08 * Math.sin(t * 6)
			stars.visible = !!(fx & FX.SPIN)
			if (stars.visible) {
				stars.children.forEach((m, k) => {
					const a = t * 7 + (k * Math.PI * 2) / 3
					m.position.set(Math.cos(a) * 0.16, Math.sin(t * 9 + k) * 0.02, Math.sin(a) * 0.16)
					m.rotation.y = a
				})
			}
			/* sparks from both rear wheels while drifting on the ground */
			const drifting = !!(fx & FX.DRIFT) && !(fx & FX.AIR)
			sparkMat.color.setHex(STAGE_COLORS[Math.max(0, Math.min(2, s.stage | 0))])
			sparkMat.size = s.stage >= 1 ? 0.07 : 0.045
			if (drifting) emitAcc += dt * (s.stage >= 1 ? 160 : 90)
			while (emitAcc >= 1) {
				emitAcc -= 1
				const i = next
				next = (next + 1) % SPARK_N
				const side = i % 2 ? 1 : -1
				pos[i * 3] = side * 0.13
				pos[i * 3 + 1] = 0.02
				pos[i * 3 + 2] = 0.15
				vel[i * 3] = side * (0.3 + Math.random() * 0.6)
				vel[i * 3 + 1] = 0.6 + Math.random() * 0.9
				vel[i * 3 + 2] = 0.8 + Math.random() * 1.2
				life[i] = 0.25 + Math.random() * 0.15
			}
			for (let i = 0; i < SPARK_N; i++) {
				if (life[i] <= 0) {
					pos[i * 3 + 1] = -100
					continue
				}
				life[i] -= dt
				vel[i * 3 + 1] -= 6 * dt
				for (let a = 0; a < 3; a++) pos[i * 3 + a] += vel[i * 3 + a] * dt
			}
			sparkGeo.attributes.position.needsUpdate = true
		},
		dispose() {
			bubbleMat.dispose()
			sparkMat.dispose()
			sparkGeo.dispose()
		},
	}
}
