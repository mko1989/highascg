/**
 * Item effects in the world (WO-1074 v2): slick puddles (violet goo with a sheen), rockets (posed every frame from the
 * shared closed-form path, rocket.js), and one-shots — the pulse "POW" ring (comic burst word + expanding ring of the
 * 7 m radius), turbo burst, shield pop and spin-out stars. Procedural geometry and canvas sprites only.
 */
import * as THREE from 'three'
import { canvasTexture } from './mesh-util.js'
import { SLICK_R, PULSE_R } from './items.js'

function wordTexture(word, fill, stroke) {
	return canvasTexture(256, 128, (ctx, w, h) => {
		ctx.fillStyle = '#ffe14a'
		ctx.beginPath()
		for (let i = 0; i < 24; i++) {
			const a = (i / 24) * Math.PI * 2
			const r = i % 2 ? 0.6 : 1
			ctx.lineTo(w / 2 + Math.cos(a) * (w / 2 - 4) * r, h / 2 + Math.sin(a) * (h / 2 - 4) * r)
		}
		ctx.fill()
		ctx.font = 'bold 64px system-ui, sans-serif'
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.lineWidth = 10
		ctx.strokeStyle = stroke
		ctx.strokeText(word, w / 2, h / 2 + 4)
		ctx.fillStyle = fill
		ctx.fillText(word, w / 2, h / 2 + 4)
	})
}

function slickGeometry() {
	const shape = new THREE.Shape()
	const N = 18
	for (let i = 0; i <= N; i++) {
		const a = (i / N) * Math.PI * 2
		const r = SLICK_R * (0.82 + 0.18 * Math.sin(a * 3 + 1) * Math.cos(a * 2))
		if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r)
		else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r)
	}
	const g = new THREE.ShapeGeometry(shape)
	g.rotateX(-Math.PI / 2)
	return g
}

function rocketModel(mats) {
	const g = new THREE.Group()
	const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.42, 10), mats.red)
	body.rotation.x = -Math.PI / 2
	const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 10), mats.white)
	nose.rotation.x = -Math.PI / 2
	nose.position.z = -0.29
	const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 8), mats.flame)
	flame.rotation.x = Math.PI / 2
	flame.position.z = 0.38
	g.add(body, nose, flame)
	for (let k = 0; k < 3; k++) {
		const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.12), mats.white)
		const a = (k / 3) * Math.PI * 2
		fin.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.15)
		fin.rotation.z = a
		g.add(fin)
	}
	g.userData.flame = flame
	return g
}

export function createFxView(scene) {
	const root = new THREE.Group()
	root.name = 'fx'
	scene.add(root)
	const mats = {
		slick: new THREE.MeshBasicMaterial({ color: 0x6a2bd9, transparent: true, opacity: 0.85, depthWrite: false }),
		sheen: new THREE.MeshBasicMaterial({ color: 0xd8b8ff, transparent: true, opacity: 0.45, depthWrite: false }),
		red: new THREE.MeshLambertMaterial({ color: 0xff3b30 }),
		white: new THREE.MeshLambertMaterial({ color: 0xe9edf5 }),
		flame: new THREE.MeshBasicMaterial({
			color: 0xffa21f,
			transparent: true,
			opacity: 0.85,
			blending: THREE.AdditiveBlending,
		}),
	}
	const slickGeo = slickGeometry()
	const sheenGeo = new THREE.CircleGeometry(0.22, 12)
	sheenGeo.rotateX(-Math.PI / 2)
	const ringGeo = new THREE.RingGeometry(0.92, 1, 48)
	ringGeo.rotateX(-Math.PI / 2)
	const words = {
		pow: wordTexture('POW!', '#ff3b30', '#1b1020'),
		spin: wordTexture('SPIN!', '#8a3dff', '#1b1020'),
		zoom: wordTexture('ZOOM!', '#ff7a1a', '#1b1020'),
		bloop: wordTexture('BLOOP', '#40e68c', '#1b1020'),
	}
	/** hid → { kind, obj } */
	const hazObjs = new Map()
	const shots = []

	function hazObject(h) {
		if (h.kind === 'slick') {
			const g = new THREE.Group()
			const goo = new THREE.Mesh(slickGeo, mats.slick)
			const sheen = new THREE.Mesh(sheenGeo, mats.sheen)
			sheen.position.set(-0.25, 0.004, -0.2)
			sheen.scale.set(1.4, 1, 0.6)
			g.add(goo, sheen)
			g.position.set(h.p[0], h.p[1] + 0.025, h.p[2])
			g.rotation.y = h.yaw || 0
			g.renderOrder = 3
			return g
		}
		return rocketModel(mats)
	}

	function ringShot(p, color, maxR, life, word) {
		const mat = new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
			side: THREE.DoubleSide,
		})
		const ring = new THREE.Mesh(ringGeo, mat)
		ring.position.set(p[0], p[1] + 0.15, p[2])
		root.add(ring)
		let spr = null
		if (word) {
			spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: words[word], transparent: true, depthTest: false }))
			spr.position.set(p[0], p[1] + 1.1, p[2])
			spr.renderOrder = 12
			root.add(spr)
		}
		shots.push({ ring, spr, mat, age: 0, life, maxR })
	}

	return {
		/** Draw every hazard of the item state at server time sNow (rockets posed from their path). */
		sync(items, T, sNow, t) {
			for (const [hid, o] of hazObjs) {
				if (!items.hazards.has(hid)) {
					root.remove(o)
					if (o.userData.flame) o.traverse((x) => x.geometry?.dispose()) // rockets own their geometry
					hazObjs.delete(hid)
				}
			}
			for (const h of items.hazards.values()) {
				let o = hazObjs.get(h.hid)
				if (!o) {
					o = hazObject(h)
					hazObjs.set(h.hid, o)
					root.add(o)
				}
				if (h.kind === 'slick') {
					const age = Math.max(0, (sNow - h.ts) / 1000)
					o.scale.setScalar(Math.min(1, 0.3 + age * 3))
					continue
				}
				const r = T ? items.rocketOf(T, h, sNow) : null
				o.visible = !!r
				if (!r) continue
				o.position.set(r.x, r.y, r.z)
				o.rotation.set(0, r.yaw, Math.sin(t * 20) * 0.3)
				o.userData.flame.scale.set(1, 0.7 + Math.random() * 0.6, 1)
			}
		},
		/** One-shot effect `k` ('pulse' | 'turbo' | 'shield' | 'spin') at p. */
		oneShot(k, p) {
			if (!p) return
			if (k === 'pulse') ringShot(p, 0x3ee6ff, PULSE_R, 0.6, 'pow')
			else if (k === 'turbo') ringShot(p, 0xff7a1a, 1.4, 0.35, null)
			else if (k === 'shield') ringShot(p, 0x40e68c, 1.0, 0.4, null)
			else if (k === 'spin') ringShot(p, 0x8a3dff, 1.2, 0.5, 'spin')
		},
		/** A pop word over a point (e.g. a slick hit: "BLOOP"). */
		word(p, word) {
			ringShot(p, 0xffffff, 0.6, 0.6, word)
		},
		update(dt) {
			for (let i = shots.length - 1; i >= 0; i--) {
				const s = shots[i]
				s.age += dt
				const k = Math.min(1, s.age / s.life)
				const r = Math.max(0.01, s.maxR * (1 - (1 - k) * (1 - k)))
				s.ring.scale.set(r, 1, r)
				s.mat.opacity = 0.9 * (1 - k)
				if (s.spr) {
					const pop = k < 0.25 ? k / 0.25 : 1
					s.spr.scale.set(2.2 * pop, 1.1 * pop, 1)
					s.spr.material.opacity = k < 0.7 ? 1 : (1 - k) / 0.3
				}
				if (k >= 1) {
					root.remove(s.ring)
					s.mat.dispose()
					if (s.spr) {
						root.remove(s.spr)
						s.spr.material.dispose()
					}
					shots.splice(i, 1)
				}
			}
		},
		clear() {
			for (const o of hazObjs.values()) root.remove(o)
			hazObjs.clear()
		},
	}
}
