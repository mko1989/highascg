/**
 * Friendly slapstick on the presenter's avatar (WO-1089 §0 / §6 / §11) — never injury, never "knocked out":
 *   splat decals in the vegetable's colour on the part that was hit (≤ MAX_DECALS, fading over DECAL_MS);
 *   a wobble spring (the figure rocks away from the impact and settles);
 *   sparkle stars circling the head after a head hit; a cabbage-leaf hat for HAT_MS after a cabbage on the head;
 *   the umbrella prop (flag 8 / `umbrella` window), popping open and closed.
 * Built on an avatar-model.js figure; ducks / side-steps are applied by avatars.js (the pose's duck / off).
 */
import { toUnit, surfacePoint } from './avatar-spec.js'
import { scaleOf, HEAD_Y } from './avatar-body.js'

export const MAX_DECALS = 12
export const DECAL_MS = 6000
export const HAT_MS = 5000
export const STAR_MS = 1300
const SPRING_W = 11 // rad/s
const SPRING_Z = 0.22
const UMB_COLORS = [0xf2c14e, 0xe8eef7, 0x5bb6a8, 0xe8eef7] // our own warm / white / teal panels

let ballGeo = null
let starGeo = null

function shared(THREE) {
	if (!ballGeo) ballGeo = new THREE.SphereGeometry(1, 14, 10)
	if (!starGeo) starGeo = new THREE.OctahedronGeometry(1, 0)
}

function buildUmbrella(THREE) {
	const g = new THREE.Group()
	const canopy = new THREE.Group()
	const n = 8
	for (let k = 0; k < n; k++) {
		const geo = new THREE.SphereGeometry(0.5, 4, 6, (k / n) * Math.PI * 2, (Math.PI * 2) / n, 0, Math.PI * 0.42)
		const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: UMB_COLORS[k % UMB_COLORS.length], side: THREE.DoubleSide, emissive: 0x332a18 }))
		canopy.add(m)
	}
	canopy.position.y = -0.36 // the dome's rim sits low around the head
	const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3a2a1a }))
	tip.position.y = 0.15
	const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6), new THREE.MeshLambertMaterial({ color: 0x3a2a1a }))
	shaft.position.y = -0.2
	g.add(canopy, tip, shaft)
	g.position.set(0.02, 1.02, 0.08)
	g.rotation.x = 0.42 // tipped towards the audience (+Z, the avatar faces the room)
	return g
}

export function createReactions(THREE, model) {
	shared(THREE)
	const decals = []
	const stars = []
	let hat = null
	let hatUntil = 0
	let starUntil = 0
	const tilt = [0, 0]
	const vel = [0, 0]
	const umbrella = buildUmbrella(THREE)
	umbrella.scale.setScalar(0.001)
	umbrella.visible = false
	model.upper.add(umbrella)
	let umbOpen = 0

	function addDecal(ev, pose, sNow) {
		const s = scaleOf(pose.height)
		const u = toUnit(pose, ev.p)
		const { p, n } = surfacePoint(ev.part, u)
		const color = ev.veg?.color || '#c8d26a'
		const r = Math.max(0.03, ((ev.veg?.r || 0.04) * (ev.veg?.splat ? 2.4 : 1.4)) / s)
		const g = new THREE.Group()
		const mat = new THREE.MeshLambertMaterial({ color, transparent: true, emissive: new THREE.Color(color).multiplyScalar(0.25), depthWrite: false })
		const blob = new THREE.Mesh(ballGeo, mat)
		blob.scale.set(r, r * 0.85, r * 0.2)
		g.add(blob)
		for (let k = 0; ev.veg?.splat && k < 3; k++) {
			const d = new THREE.Mesh(ballGeo, mat)
			const a = Math.random() * Math.PI * 2
			const rr = r * (0.25 + Math.random() * 0.2)
			d.position.set(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35, 0)
			d.scale.set(rr, rr, rr * 0.3)
			g.add(d)
		}
		g.position.set(p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004)
		g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0], n[1], n[2]))
		g.rotateZ(Math.random() * Math.PI)
		;(ev.part === 'legs' ? model.legs : model.upper).add(g)
		decals.push({ g, mat, at: sNow })
		while (decals.length > MAX_DECALS) dropDecal(decals.shift())
	}

	function dropDecal(d) {
		d.g.removeFromParent()
		d.mat.dispose()
	}

	function kick(ev, pose) {
		const v = ev.v || [0, 0, -1]
		const sy = Math.sin(pose.yaw || 0), cy = Math.cos(pose.yaw || 0)
		const lx = v[0] * cy - v[2] * sy
		const lz = v[0] * sy + v[2] * cy
		const L = Math.hypot(lx, lz) || 1
		const k = (ev.part === 'head' ? 1.5 : ev.part === 'legs' ? 0.6 : 1.0) * Math.min(1, Math.max(0.35, L / 14)) * (ev.veg?.id === 'cabbage' ? 1.4 : ev.veg?.id === 'peas' ? 0.35 : 1)
		vel[0] += (lz / L) * k
		vel[1] += (-lx / L) * k
	}

	function addStars(sNow) {
		starUntil = sNow + STAR_MS
		if (stars.length) return
		for (let k = 0; k < 5; k++) {
			const m = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: k % 2 ? 0xfff2a8 : 0xffd24a, transparent: true }))
			m.scale.setScalar(0.022)
			model.upper.add(m)
			stars.push(m)
		}
	}

	function dropHat() {
		hat.removeFromParent()
		hat.userData.mat.dispose() // WO-1106 B61 (the leaves share the module's ballGeo)
		hat = null
	}

	function addHat(sNow) {
		hatUntil = sNow + HAT_MS
		if (hat) return
		hat = new THREE.Group()
		const mat = (hat.userData.mat = new THREE.MeshLambertMaterial({ color: 0x7cc44e, emissive: 0x1c3010, side: THREE.DoubleSide, transparent: true }))
		for (let k = 0; k < 6; k++) {
			const leaf = new THREE.Mesh(ballGeo, mat)
			const a = (k / 6) * Math.PI * 2
			leaf.scale.set(0.11, 0.022, 0.07)
			leaf.position.set(Math.cos(a) * 0.07, 0.01 + (k % 2) * 0.012, Math.sin(a) * 0.07)
			leaf.rotation.set(0, -a, 0.35)
			hat.add(leaf)
		}
		const cap = new THREE.Mesh(ballGeo, mat)
		cap.scale.set(0.12, 0.05, 0.12)
		hat.add(cap)
		hat.position.set(0, HEAD_Y + 0.15, -0.01)
		model.upper.add(hat)
	}

	return {
		/** A server hit (ev from shots.js) on this avatar drawn at `pose`. */
		onHit(ev, pose, sNow) {
			addDecal(ev, pose, sNow)
			kick(ev, pose)
			if (ev.part === 'head') addStars(sNow)
			if (ev.part === 'head' && ev.veg?.id === 'cabbage') addHat(sNow)
		},
		/** A vegetable met the umbrella: a little shake of the canopy. */
		onUmbrella() {
			vel[0] += 0.25
		},
		/** Per frame → the tilt [ax, az] for the model's pose. */
		update(dt, sNow, umbrellaUp) {
			const h = Math.min(0.05, Math.max(0, dt))
			for (let j = 0; j < 2; j++) {
				const acc = -SPRING_W * SPRING_W * tilt[j] - 2 * SPRING_Z * SPRING_W * vel[j]
				vel[j] += acc * h
				tilt[j] = Math.max(-0.35, Math.min(0.35, tilt[j] + vel[j] * h))
			}
			for (let k = decals.length - 1; k >= 0; k--) {
				const d = decals[k]
				const age = (sNow - d.at) / DECAL_MS
				if (age >= 1) dropDecal(decals.splice(k, 1)[0])
				else d.mat.opacity = age < 0.66 ? 1 : 1 - (age - 0.66) / 0.34
			}
			const on = sNow < starUntil
			stars.forEach((m, k) => {
				m.visible = on
				if (!on) return
				const a = sNow / 260 + (k / stars.length) * Math.PI * 2
				m.position.set(Math.cos(a) * 0.24, HEAD_Y + 0.2 + Math.sin(a * 2) * 0.02, Math.sin(a) * 0.24)
				m.rotation.y = a * 2
				m.material.opacity = Math.min(1, (starUntil - sNow) / 300)
			})
			if (hat) {
				const left = hatUntil - sNow
				if (left <= 0) dropHat()
				else hat.scale.setScalar(Math.min(1, left / 600, (HAT_MS - left) / 150 + 0.2))
			}
			umbOpen += ((umbrellaUp ? 1 : 0) - umbOpen) * Math.min(1, dt * 8)
			umbrella.visible = umbOpen > 0.02
			umbrella.scale.set(Math.max(0.001, umbOpen), Math.max(0.001, 0.4 + 0.6 * umbOpen), Math.max(0.001, umbOpen))
			return tilt
		},
		get decals() {
			return decals.length
		},
		/** WO-1106 B61: everything this avatar's reactions own (the shared ball / star geometries stay). */
		dispose() {
			for (const d of decals) dropDecal(d)
			decals.length = 0
			if (hat) dropHat()
			for (const m of stars.splice(0)) (m.removeFromParent(), m.material.dispose())
			umbrella.removeFromParent()
			umbrella.traverse((o) => {
				o.geometry?.dispose()
				o.material?.dispose()
			})
		},
	}
}
