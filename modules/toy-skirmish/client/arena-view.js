/**
 * The arena's own things in three.js (WO-1081 §4/§9): a faint play-area plate with a grid, a low toy picket fence on
 * the rect's edge, the generated toy building blocks (studded bricks in BLOCK_COLORS) and the pick-ups — each a model
 * that bobs and spins over a glowing pad in its kind's colour; a taken pick-up leaves a dim pad until it is back.
 * Everything is game geometry in u × the scene scale (none of it is cut by the room's clipping plane).
 *
 *   const av = createArenaView(arena, s)    → { group, update(t, serverNow), setTaken(id, until), dispose() }
 */
import * as THREE from 'three'
import { canvasTexture, disposeGroup } from './kit/mesh-util.js'
import { BLOCK_COLORS } from './sk-const.js'
import { blockRect } from './grid.js'
import { buildPickupModel, pickupColor } from './weapon-model.js'

const FENCE_H = 0.38
const POST_GAP = 0.8
const STUD = 0.2

function plate(rect, y, s) {
	const [x0, z0, x1, z1] = rect
	const w = x1 - x0
	const d = z1 - z0
	const cellsX = Math.max(1, Math.round(w / (2 * s)))
	const cellsZ = Math.max(1, Math.round(d / (2 * s)))
	const tex = canvasTexture(512, 512, (ctx, W, H) => {
		ctx.clearRect(0, 0, W, H)
		ctx.strokeStyle = 'rgba(255,255,255,0.07)'
		ctx.lineWidth = 2
		ctx.strokeRect(1, 1, W - 2, H - 2)
	})
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping
	tex.repeat.set(cellsX, cellsZ)
	const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)
	const mat = new THREE.MeshBasicMaterial({
		map: tex,
		color: 0xffffff,
		transparent: true,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -2,
	})
	const m = new THREE.Mesh(geo, mat)
	m.position.set((x0 + x1) / 2, y + 0.002 * s, (z0 + z1) / 2)
	m.renderOrder = 0
	return m
}

function fence(rect, y, s) {
	const g = new THREE.Group()
	const [x0, z0, x1, z1] = rect
	const wood = new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.6 })
	const trim = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 })
	const posts = []
	const sides = [
		[x0, z0, x1, z0],
		[x1, z0, x1, z1],
		[x1, z1, x0, z1],
		[x0, z1, x0, z0],
	]
	for (const [ax, az, bx, bz] of sides) {
		const len = Math.hypot(bx - ax, bz - az)
		const n = Math.max(1, Math.round(len / (POST_GAP * s)))
		for (let k = 0; k < n; k++) posts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n])
		for (const [h, mat] of [
			[0.12, wood],
			[0.28, trim],
		]) {
			const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05 * s, 0.05 * s), mat)
			rail.position.set((ax + bx) / 2, y + h * s, (az + bz) / 2)
			rail.rotation.y = -Math.atan2(bz - az, bx - ax)
			g.add(rail)
		}
	}
	const postGeo = new THREE.BoxGeometry(0.08 * s, FENCE_H * s, 0.08 * s)
	postGeo.translate(0, (FENCE_H * s) / 2, 0)
	const inst = new THREE.InstancedMesh(postGeo, wood, posts.length)
	const m4 = new THREE.Matrix4()
	posts.forEach(([x, z], i) => inst.setMatrixAt(i, m4.makeTranslation(x, y, z)))
	inst.instanceMatrix.needsUpdate = true
	g.add(inst)
	return g
}

function blocks(list, y, s) {
	const g = new THREE.Group()
	const mats = BLOCK_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.02 }))
	const studGeo = new THREE.CylinderGeometry(0.075 * s, 0.075 * s, 0.06 * s, 12)
	for (const b of list || []) {
		if (![b?.x, b?.z, b?.w, b?.d].every(Number.isFinite)) continue
		const [rx0, rz0, rx1, rz1] = blockRect(b)
		const w = rx1 - rx0
		const d = rz1 - rz0
		const h = Math.max(0.6 * s, Number(b.h) || 0.6 * s)
		const mat = mats[Math.abs(b.c | 0) % mats.length]
		const box = new THREE.Mesh(new THREE.BoxGeometry(w * 0.985, h, d * 0.985), mat)
		box.position.set((rx0 + rx1) / 2, y + h / 2, (rz0 + rz1) / 2)
		g.add(box)
		const nx = Math.max(1, Math.round(w / (STUD * s)))
		const nz = Math.max(1, Math.round(d / (STUD * s)))
		const studs = new THREE.InstancedMesh(studGeo, mat, nx * nz)
		const m4 = new THREE.Matrix4()
		let k = 0
		for (let i = 0; i < nx; i++)
			for (let j = 0; j < nz; j++)
				studs.setMatrixAt(
					k++,
					m4.makeTranslation(rx0 + ((i + 0.5) * w) / nx, y + h + 0.03 * s, rz0 + ((j + 0.5) * d) / nz)
				)
		studs.instanceMatrix.needsUpdate = true
		g.add(studs)
	}
	return g
}

function padGlowTexture() {
	return canvasTexture(128, 128, (ctx, W) => {
		const gr = ctx.createRadialGradient(W / 2, W / 2, 4, W / 2, W / 2, W / 2)
		gr.addColorStop(0, 'rgba(255,255,255,0.95)')
		gr.addColorStop(0.45, 'rgba(255,255,255,0.35)')
		gr.addColorStop(1, 'rgba(255,255,255,0)')
		ctx.fillStyle = gr
		ctx.fillRect(0, 0, W, W)
	})
}

function pickups(list, y, s) {
	const out = new Map()
	const g = new THREE.Group()
	const glowTex = padGlowTexture()
	const padGeo = new THREE.CylinderGeometry(0.34 * s, 0.38 * s, 0.05 * s, 24)
	const glowGeo = new THREE.PlaneGeometry(1.5 * s, 1.5 * s).rotateX(-Math.PI / 2)
	for (const p of list || []) {
		if (p?.id == null || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue
		const col = pickupColor(p.kind)
		const pg = new THREE.Group()
		pg.position.set(p.x, y, p.z)
		const padMat = new THREE.MeshStandardMaterial({ color: 0x23262e, emissive: col, emissiveIntensity: 0.7 })
		const pad = new THREE.Mesh(padGeo, padMat)
		pad.position.y = 0.025 * s
		const glowMat = new THREE.MeshBasicMaterial({
			map: glowTex,
			color: col,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		})
		const glow = new THREE.Mesh(glowGeo, glowMat)
		glow.position.y = 0.06 * s
		glow.renderOrder = 2
		const model = buildPickupModel(p.kind)
		const holder = new THREE.Group()
		holder.scale.setScalar(s * (p.kind === 'health' || p.kind === 'armour' || p.kind === 'surge' ? 1 : 1.6))
		holder.add(model)
		pg.add(pad, glow, holder)
		g.add(pg)
		out.set(p.id, { id: p.id, kind: p.kind, x: p.x, z: p.z, holder, padMat, glowMat, until: 0, phase: p.id * 1.7 })
	}
	return { group: g, items: out }
}

/** @param {{ rect: number[], y: number, blocks?: object[], pickups?: object[] }} arena @param {number} s scale */
export function createArenaView(arena, s = 1) {
	const group = new THREE.Group()
	group.name = 'arena'
	const y = Number(arena?.y) || 0
	const rect = arena?.rect || [0, 0, 1, 1]
	group.add(plate(rect, y, s), fence(rect, y, s), blocks(arena?.blocks, y, s))
	const pk = pickups(arena?.pickups, y, s)
	group.add(pk.group)
	return {
		group,
		pickups: pk.items,
		/** pick-up `id` gone until server time `until` (0 = there). */
		setTaken(id, until) {
			const it = pk.items.get(id)
			if (it) it.until = Number(until) || 0
		},
		available(id, serverNow) {
			const it = pk.items.get(id)
			return !!it && !(it.until > serverNow)
		},
		update(t, serverNow) {
			for (const it of pk.items.values()) {
				const gone = it.until > serverNow
				it.holder.visible = !gone
				it.padMat.emissiveIntensity = gone ? 0.08 : 0.55 + 0.25 * Math.sin(t * 3 + it.phase)
				it.glowMat.opacity = gone ? 0.08 : 0.6 + 0.25 * Math.sin(t * 3 + it.phase)
				if (gone) continue
				it.holder.position.y = (0.32 + 0.07 * Math.sin(t * 2.4 + it.phase)) * s
				it.holder.rotation.y = t * 1.6 + it.phase
			}
		},
		dispose() {
			disposeGroup(group)
			group.removeFromParent()
		},
	}
}
