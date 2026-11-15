/**
 * Shot and hit effects of Stage Skirmish (WO-1081 §9) — short-lived additive meshes at muzzle height, drawn flat so
 * they read from the top-down camera: muzzle flash, tracers (per weapon: thin yellow for the Peashooter, orange
 * streaks for the Rattler, short lime pellets for the Scatter, a cyan beam that lingers for the Longshot), the
 * Thumper rocket with a smoke trail, the explosion ring (its splash radius), hit sparks, the death pop (a burst of the
 * victim's colour) and pick-up sparkles. All sizes in u × the scene scale; nothing is cut by the room's clip.
 *
 *   const fx = createFx(scene, s)   fx.tracer(ax, az, bx, bz, y, w) · fx.flash(x, y, z, w) · fx.explosion(x, y, z)
 *   fx.sparks(x, y, z, hex) · fx.pop(x, y, z, hex) · fx.rocket(r) → handle · fx.update(dt) · fx.dispose()
 */
import * as THREE from 'three'
import { canvasTexture } from './kit/mesh-util.js'
import { ROCKET } from './sk-const.js'

const MAX_LIVE = 400

const TRACER = {
	pea: { color: 0xfff27a, w: 0.05, life: 0.09 },
	rattler: { color: 0xffa040, w: 0.04, life: 0.06 },
	scatter: { color: 0xc8ff6a, w: 0.035, life: 0.08 },
	longshot: { color: 0x5ae8ff, w: 0.09, life: 0.45 },
	thumper: { color: 0xc49bff, w: 0.05, life: 0.1 },
}

export function createFx(scene, s = 1) {
	const root = new THREE.Group()
	root.name = 'sk-fx'
	scene.add(root)
	const soft = canvasTexture(64, 64, (ctx, W) => {
		const gr = ctx.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2)
		gr.addColorStop(0, 'rgba(255,255,255,1)')
		gr.addColorStop(0.4, 'rgba(255,255,255,0.5)')
		gr.addColorStop(1, 'rgba(255,255,255,0)')
		ctx.fillStyle = gr
		ctx.fillRect(0, 0, W, W)
	})
	/* soft across the streak's width (the plane's u = its local x after rotateX) */
	const beamTex = canvasTexture(64, 8, (ctx, W, H) => {
		const gr = ctx.createLinearGradient(0, 0, W, 0)
		gr.addColorStop(0, 'rgba(255,255,255,0)')
		gr.addColorStop(0.5, 'rgba(255,255,255,1)')
		gr.addColorStop(1, 'rgba(255,255,255,0)')
		ctx.fillStyle = gr
		ctx.fillRect(0, 0, W, H)
	})
	const quadGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) // flat, 1 × 1 in x × z
	const ringGeo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2)
	const rocketGeo = new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.26 * s, 10).rotateX(Math.PI / 2)
	const rocketMat = new THREE.MeshStandardMaterial({ color: 0xb48bff, emissive: 0x3a1d80, roughness: 0.4 })
	const live = []

	const add = (mesh, life, tick) => {
		if (live.length >= MAX_LIVE) kill(0)
		root.add(mesh)
		live.push({ mesh, life, t: 0, tick })
		return mesh
	}
	function kill(i) {
		const e = live[i]
		root.remove(e.mesh)
		e.mesh.material?.dispose?.()
		live.splice(i, 1)
	}
	const glowMat = (color, map = soft, opacity = 1) =>
		new THREE.MeshBasicMaterial({
			map,
			color,
			transparent: true,
			opacity,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		})

	/** A flat streak from a to b at height y (beam texture across its width). */
	function tracer(ax, az, bx, bz, y, w = 'pea') {
		const st = TRACER[w] || TRACER.pea
		const len = Math.hypot(bx - ax, bz - az)
		if (len < 1e-5) return
		const m = new THREE.Mesh(quadGeo, glowMat(st.color, beamTex))
		m.scale.set(st.w * s, 1, len)
		m.position.set((ax + bx) / 2, y, (az + bz) / 2)
		m.rotation.y = Math.atan2(bx - ax, bz - az)
		m.renderOrder = 6
		add(m, st.life, (k) => {
			m.material.opacity = 1 - k
			if (w === 'longshot') m.scale.x = st.w * s * (1 + k * 1.5)
		})
		if (w === 'longshot') {
			const core = new THREE.Mesh(quadGeo, glowMat(0xffffff, null))
			core.scale.set(0.02 * s, 1, len)
			core.position.copy(m.position)
			core.rotation.y = m.rotation.y
			core.renderOrder = 7
			add(core, 0.18, (k) => (core.material.opacity = 1 - k))
		}
	}

	function flash(x, y, z, w = 'pea') {
		const big = w === 'scatter' || w === 'thumper' || w === 'longshot'
		const m = new THREE.Mesh(quadGeo, glowMat(w === 'longshot' ? 0x9af2ff : 0xffe7a0))
		m.position.set(x, y, z)
		const r = (big ? 0.55 : 0.36) * s
		m.scale.set(r, 1, r)
		m.renderOrder = 8
		add(m, 0.06, (k) => (m.material.opacity = 1 - k))
	}

	function ring(x, y, z, color, r0, r1, life) {
		const m = new THREE.Mesh(ringGeo, glowMat(color, null))
		m.position.set(x, y, z)
		m.renderOrder = 6
		add(m, life, (k) => {
			const r = r0 + (r1 - r0) * (1 - (1 - k) * (1 - k))
			m.scale.set(r, 1, r)
			m.material.opacity = 1 - k
		})
	}

	function burst(x, y, z, color, n, speed, size, life) {
		for (let i = 0; i < n; i++) {
			const a = (i / n) * Math.PI * 2 + Math.random() * 0.6
			const v = speed * (0.5 + Math.random() * 0.7) * s
			const vy = (0.5 + Math.random()) * speed * 0.6 * s
			const m = new THREE.Mesh(quadGeo, glowMat(color))
			m.position.set(x, y, z)
			const sz = size * s * (0.6 + Math.random() * 0.6)
			m.scale.set(sz, 1, sz)
			m.renderOrder = 7
			add(m, life * (0.7 + Math.random() * 0.5), (k, dt) => {
				m.position.x += Math.cos(a) * v * dt
				m.position.z += Math.sin(a) * v * dt
				m.position.y += (vy - 9 * s * k) * dt
				m.material.opacity = 1 - k
			})
		}
	}

	function explosion(x, y, z) {
		const m = new THREE.Mesh(quadGeo, glowMat(0xffb040))
		m.position.set(x, y + 0.1 * s, z)
		m.renderOrder = 8
		add(m, 0.35, (k) => {
			const r = (1.2 + 2.8 * k) * s
			m.scale.set(r, 1, r)
			m.material.opacity = 1 - k
		})
		ring(x, y + 0.04 * s, z, 0xff7a1a, 0.4 * s, ROCKET.SPLASH_R * s, 0.42)
		burst(x, y + 0.15 * s, z, 0xffd27a, 14, 6, 0.16, 0.45)
	}

	function sparks(x, y, z, color = 0xfff0b0) {
		burst(x, y, z, color, 6, 3.5, 0.09, 0.22)
	}

	function pop(x, y, z, color = 0xffffff) {
		ring(x, y + 0.03 * s, z, color, 0.2 * s, 1.4 * s, 0.4)
		burst(x, y + 0.25 * s, z, color, 16, 4, 0.14, 0.6)
		burst(x, y + 0.25 * s, z, 0xffffff, 6, 2.5, 0.1, 0.35)
	}

	function sparkle(x, y, z, color) {
		ring(x, y + 0.05 * s, z, color, 0.2 * s, 0.9 * s, 0.35)
		burst(x, y + 0.3 * s, z, color, 8, 2, 0.1, 0.4)
	}

	/** A flying rocket: a body + smoke puffs; handle.set(x, z, yaw) each frame, handle.end() when it is over. */
	function rocket(y) {
		const body = new THREE.Mesh(rocketGeo, rocketMat)
		body.position.y = y
		const tail = new THREE.Mesh(quadGeo, glowMat(0xffc860))
		tail.scale.set(0.28 * s, 1, 0.28 * s)
		tail.renderOrder = 8
		root.add(body, tail)
		let puffAt = 0
		return {
			set(x, z, yaw, t) {
				body.position.set(x, y, z)
				body.rotation.y = yaw
				tail.position.set(x + Math.sin(yaw) * 0.16 * s, y, z + Math.cos(yaw) * 0.16 * s)
				if (t - puffAt > 0.028) {
					puffAt = t
					const p = new THREE.Mesh(
						quadGeo,
						new THREE.MeshBasicMaterial({ map: soft, color: 0xb9bcc4, transparent: true, depthWrite: false })
					)
					p.position.copy(tail.position)
					p.renderOrder = 5
					add(p, 0.6, (k) => {
						const r = (0.18 + 0.5 * k) * s
						p.scale.set(r, 1, r)
						p.material.opacity = 0.55 * (1 - k)
					})
				}
			},
			end() {
				root.remove(body, tail)
				tail.material.dispose()
			},
		}
	}

	return {
		group: root,
		tracer,
		flash,
		explosion,
		sparks,
		pop,
		sparkle,
		rocket,
		update(dt) {
			for (let i = live.length - 1; i >= 0; i--) {
				const e = live[i]
				e.t += dt
				const k = Math.min(1, e.t / e.life)
				e.tick?.(k, dt)
				if (k >= 1) kill(i)
			}
		},
		get count() {
			return live.length
		},
		dispose() {
			while (live.length) kill(live.length - 1)
			quadGeo.dispose()
			ringGeo.dispose()
			rocketGeo.dispose()
			rocketMat.dispose()
			soft.dispose()
			beamTex.dispose()
			root.removeFromParent()
		},
	}
}
