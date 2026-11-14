/**
 * Animated track props (WO-1074 v2): boost pads (glowing plates with chevrons that scroll forward) and item boxes —
 * our own look: a spinning, bobbing faceted prism-gem in a soft halo, hidden while taken and popping back in when it
 * returns. One shared texture per kind, so every pad animates with one offset. §3: sizes × T.scale (pads from
 * physFor(T.scale), the gems through their holder's scale).
 */
import * as THREE from 'three'
import { physFor } from './scale.js'
import { canvasTexture } from './mesh-util.js'

function padTexture() {
	const tex = canvasTexture(64, 128, (ctx, w, h) => {
		ctx.fillStyle = 'rgba(255,140,26,0.55)'
		ctx.fillRect(0, 0, w, h)
		ctx.fillStyle = '#ffe14a'
		for (const y0 of [8, 72]) {
			ctx.beginPath()
			ctx.moveTo(6, y0 + 40)
			ctx.lineTo(w / 2, y0)
			ctx.lineTo(w - 6, y0 + 40)
			ctx.lineTo(w - 6, y0 + 56)
			ctx.lineTo(w / 2, y0 + 16)
			ctx.lineTo(6, y0 + 56)
			ctx.closePath()
			ctx.fill()
		}
	})
	tex.wrapS = THREE.RepeatWrapping
	tex.wrapT = THREE.RepeatWrapping
	tex.repeat.set(2, 2)
	return tex
}

function haloTexture() {
	return canvasTexture(64, 64, (ctx) => {
		const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
		g.addColorStop(0, 'rgba(255,255,255,0.9)')
		g.addColorStop(0.35, 'rgba(120,230,255,0.45)')
		g.addColorStop(1, 'rgba(120,230,255,0)')
		ctx.fillStyle = g
		ctx.fillRect(0, 0, 64, 64)
	})
}

/** Gem geometry: an octahedron with per-face rainbow colours. */
function gemGeometry() {
	const g = new THREE.OctahedronGeometry(0.26, 0).toNonIndexed()
	const cols = ['#ff3b8b', '#ffd23a', '#40e68c', '#3ee6ff', '#8a3dff', '#ff7a1a', '#ffffff', '#3aa0ff']
	const c = new THREE.Color()
	const arr = []
	for (let f = 0; f < g.attributes.position.count / 3; f++) {
		c.set(cols[f % cols.length])
		for (let k = 0; k < 3; k++) arr.push(c.r, c.g, c.b)
	}
	g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3))
	g.scale(1, 1.35, 1)
	return g
}

/**
 * @param {object} T prepared track (pads, boxes with heights)
 * @returns {{ group: THREE.Group, update: (t: number, isTaken: (id: any) => boolean) => void, dispose: () => void }}
 */
export function createProps(T) {
	const group = new THREE.Group()
	group.name = 'props'
	const padTex = padTexture()
	const padMat = new THREE.MeshBasicMaterial({
		map: padTex,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	})
	const rimMat = new THREE.MeshBasicMaterial({ color: 0xffa21f })
	const k = T.scale ?? 1
	const PHYS = physFor(k)
	for (const p of T.pads || []) {
		const hw = Math.min(PHYS.PAD_HALF_W, T.half)
		const geo = new THREE.PlaneGeometry(hw * 2, PHYS.PAD_LEN)
		geo.rotateX(-Math.PI / 2)
		const m = new THREE.Mesh(geo, padMat)
		m.position.set(p.x, p.y + 0.035 * k, p.z)
		m.rotation.y = p.yaw
		m.renderOrder = 2
		group.add(m)
		for (const sgn of [1, -1]) {
			const rim = new THREE.Mesh(new THREE.BoxGeometry(0.07 * k, 0.04 * k, PHYS.PAD_LEN), rimMat)
			rim.position.set(sgn * hw, 0, 0)
			m.add(rim)
		}
	}
	const gemGeo = gemGeometry()
	const gemMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 })
	const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
	const coreGeo = new THREE.OctahedronGeometry(0.08, 0)
	const haloMat = new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, depthWrite: false })
	const boxes = []
	for (const b of T.boxes || []) {
		const holder = new THREE.Group()
		holder.position.set(b.x, b.y, b.z)
		const gem = new THREE.Mesh(gemGeo, gemMat)
		gem.add(new THREE.Mesh(coreGeo, coreMat))
		const halo = new THREE.Sprite(haloMat)
		halo.scale.set(1.1, 1.1, 1)
		holder.add(halo, gem)
		group.add(holder)
		boxes.push({ id: b.id, holder, gem, phase: (Number(b.id) || boxes.length) * 1.7, shown: 1 })
	}

	return {
		group,
		/** @param {number} t seconds @param {(id: any) => boolean} isTaken */
		update(t, isTaken, dt = 1 / 60) {
			padTex.offset.y = -(t * 1.6) % 1
			for (const b of boxes) {
				const want = isTaken(b.id) ? 0 : 1
				/* pop in quickly with an overshoot, vanish at once */
				b.shown = want ? Math.min(1, b.shown + dt * 3.5) : 0
				const f = b.shown
				const s = f <= 0 ? 0 : f < 1 ? 1.15 * Math.sin((f * Math.PI) / 2) + 0.1 * (1 - f) : 1
				b.holder.visible = f > 0
				b.holder.scale.setScalar(Math.max(0.001, s) * f * k) // §3: the gem, its core, halo and bob × toy scale
				b.gem.rotation.y = t * 2.2 + b.phase
				b.gem.rotation.z = Math.sin(t * 1.3 + b.phase) * 0.25
				b.gem.position.y = Math.sin(t * 2.6 + b.phase) * 0.08
			}
		},
		dispose() {
			group.traverse((o) => o.geometry?.dispose?.())
			padTex.dispose()
			for (const m of [padMat, rimMat, gemMat, coreMat, haloMat]) m.dispose()
			haloMat.map?.dispose()
		},
	}
}
