/* global window */
/**
 * three.js world of the RC game (WO-1074): renderer, camera, simple lights, the scene GLB (with progress) or a plain
 * arena when there is none, and the quality setting (pixel-ratio cap, cheap materials on "low").
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyCut, setCut } from './tunnel-cut.js'

const BG = 0x151a26

export function createWorld(canvas, { phone = false, quality = 'high' } = {}) {
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: !phone,
		powerPreference: 'high-performance',
		alpha: false,
	})
	renderer.setClearColor(BG, 1)
	const scene = new THREE.Scene()
	scene.background = new THREE.Color(BG)
	const camera = new THREE.PerspectiveCamera(62, 1, NEAR, 400)
	let nearScale = 1
	camera.position.set(0, 8, 12)
	camera.lookAt(0, 0, 0)

	const hemi = new THREE.HemisphereLight(0xeef2ff, 0x4a4234, 2.6)
	scene.add(hemi)
	const sun = new THREE.DirectionalLight(0xffffff, 1.8)
	sun.position.set(-8, 20, 10)
	scene.add(sun)

	const statics = new THREE.Group()
	statics.name = 'scene-static'
	scene.add(statics)

	const world = {
		THREE,
		renderer,
		scene,
		camera,
		statics,
		phone,
		quality,
		model: null,
		setQuality(q) {
			world.quality = q === 'low' ? 'low' : 'high'
			const dpr = window.devicePixelRatio || 1
			const cap = world.quality === 'low' ? 1 : phone ? 1.5 : 2
			renderer.setPixelRatio(Math.min(dpr, cap))
			camera.far = world.quality === 'low' ? 160 : 400
			camera.updateProjectionMatrix()
			if (world.model) cheapMaterials(world.model, world.quality === 'low')
			applyCut(world.model) // §3.1 (the "low" Lambert copies too)
			world.resize()
		},
		resize() {
			const w = canvas.clientWidth || window.innerWidth
			const hgt = canvas.clientHeight || window.innerHeight
			renderer.setSize(w, hgt, false)
			camera.aspect = w / Math.max(1, hgt)
			camera.updateProjectionMatrix()
		},
		render() {
			renderer.render(scene, camera)
		},
		/** §3 toy scale: the near plane may come down to NEAR · s (a 6 cm car seen from a few cm never clips). */
		setNear(s) {
			nearScale = s > 0 ? Math.min(1, s) : 1
		},
		setCamera(pose) {
			camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2])
			camera.lookAt(pose.target[0], pose.target[1], pose.target[2])
			/* close shots get the toy near plane, far ones (overview) keep v2's — depth precision for the room */
			const d = Math.hypot(pose.eye[0] - pose.target[0], pose.eye[1] - pose.target[1], pose.eye[2] - pose.target[2])
			const near = Math.max(NEAR * nearScale, Math.min(NEAR, d * 0.025))
			if (Math.abs(camera.near - near) > camera.near * 0.1) {
				camera.near = near
				camera.updateProjectionMatrix()
			}
		},
		/** Field of view in degrees (v2: kicks wider while boosting). */
		setFov(fov) {
			if (Math.abs(camera.fov - fov) < 0.05) return
			camera.fov = fov
			camera.updateProjectionMatrix()
		},
		/** §3.1: the active track's tunnel volumes (tunnel.js cutSegments) — the scene's faces inside vanish. */
		setTunnelCut(list) {
			setCut(list)
		},
		/** Remove the previous scene content and load a new one. */
		async loadScene(info, onProgress) {
			clearGroup(statics)
			world.model = null
			addGround(statics, info)
			if (info?.glb) {
				try {
					const gltf = await loadGlb(info.glb, onProgress)
					world.model = gltf.scene
					freeze(world.model)
					statics.add(world.model)
					cheapMaterials(world.model, world.quality === 'low')
					applyCut(world.model)
					return { ok: true }
				} catch (e) {
					addArena(statics, info)
					return { ok: false, error: String(e?.message || e) }
				}
			}
			addArena(statics, info)
			return { ok: true, arena: true }
		},
	}
	world.setQuality(quality)
	return world
}

function loadGlb(url, onProgress) {
	const loader = new GLTFLoader()
	return new Promise((resolve, reject) => {
		loader.load(
			url,
			resolve,
			(ev) => onProgress?.(ev.loaded || 0, ev.lengthComputable ? ev.total : 0),
			(err) => reject(err instanceof Error ? err : new Error('GLB load failed'))
		)
	})
}

function freeze(root) {
	root.traverse((o) => {
		o.matrixAutoUpdate = false
		o.updateMatrix()
	})
	root.updateMatrixWorld(true)
}

/** Lambert instead of PBR on "low" (much cheaper per pixel on phones); keeps colour / texture / vertex colours / opacity. */
function cheapMaterials(root, low) {
	root.traverse((o) => {
		if (!o.isMesh) return
		if (low) {
			if (o.userData.rcOrigMat) return
			const m = o.material
			if (!m || Array.isArray(m) || !m.isMeshStandardMaterial) return
			o.userData.rcOrigMat = m
			o.material = new THREE.MeshLambertMaterial({
				color: m.color,
				map: m.map, // WO-1082: the venue's textures (carpet, wood floor, truss) stay on "low"
				flatShading: m.flatShading, // the scene GLB has no normals
				vertexColors: m.vertexColors,
				side: m.side,
				transparent: m.transparent,
				opacity: m.opacity,
				emissive: m.emissive,
			})
		} else if (o.userData.rcOrigMat) {
			o.material.dispose()
			o.material = o.userData.rcOrigMat
			delete o.userData.rcOrigMat
		}
	})
}

function clearGroup(g) {
	for (const c of [...g.children]) {
		g.remove(c)
		c.traverse((o) => {
			o.geometry?.dispose?.()
			const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
			for (const m of mats) m.dispose?.()
		})
	}
}

/** v2 near plane (m); × the toy scale for close shots (setNear / setCamera). */
const NEAR = 0.05

/** A big dark ground under everything so the world never floats in the void. */
function addGround(g, info) {
	const b = info?.bounds
	const minY = b ? Number(b.min?.[1]) || 0 : 0
	const hall = (info?.floors || []).find((f) => f.id === 'hall') || (info?.floors || [])[0]
	const y = hall ? Number(hall.y) || 0 : Math.max(minY, 0)
	const geo = new THREE.PlaneGeometry(400, 400)
	geo.rotateX(-Math.PI / 2)
	/* pushed back in depth too: with the toy near plane the 3 cm gap to the hall floor must never z-fight */
	const mat = new THREE.MeshLambertMaterial({
		color: 0x23272f,
		polygonOffset: true,
		polygonOffsetFactor: 2,
		polygonOffsetUnits: 8,
	})
	const mesh = new THREE.Mesh(geo, mat)
	mesh.position.y = y - 0.03
	mesh.matrixAutoUpdate = false
	mesh.updateMatrix()
	g.add(mesh)
}

/** No GLB (or it failed): the floors as slabs, the obstacles as boxes, a low rim around each floor. */
function addArena(g, info) {
	const floors = info?.floors?.length ? info.floors : [{ id: 'hall', y: 0, rect: [-15, -10, 15, 10] }]
	const floorMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a })
	const stageMat = new THREE.MeshLambertMaterial({ color: 0x2c2f38 })
	const rimMat = new THREE.MeshLambertMaterial({ color: 0x5a6070 })
	for (const f of floors) {
		const [x0, z0, x1, z1] = f.rect
		const w = x1 - x0
		const d = z1 - z0
		const y = Number(f.y) || 0
		const thick = f.id === 'hall' ? 0.02 : Math.max(0.05, y - (floors[0].y || 0))
		const slab = new THREE.Mesh(new THREE.BoxGeometry(w, thick, d), f.id === 'hall' ? floorMat : stageMat)
		slab.position.set((x0 + x1) / 2, y - thick / 2, (z0 + z1) / 2)
		g.add(slab)
		const rimH = 0.12
		for (const [cx, cz, sx, sz] of [
			[(x0 + x1) / 2, z0, w, 0.06],
			[(x0 + x1) / 2, z1, w, 0.06],
			[x0, (z0 + z1) / 2, 0.06, d],
			[x1, (z0 + z1) / 2, 0.06, d],
		]) {
			const rim = new THREE.Mesh(new THREE.BoxGeometry(sx, rimH, sz), rimMat)
			rim.position.set(cx, y + rimH / 2, cz)
			g.add(rim)
		}
	}
	const obsMat = new THREE.MeshLambertMaterial({ color: 0x8a8f9c })
	for (const o of info?.obstacles || []) {
		const sx = o.max[0] - o.min[0]
		const sy = o.max[1] - o.min[1]
		const sz = o.max[2] - o.min[2]
		if (!(sx > 0 && sy > 0 && sz > 0)) continue
		const box = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), obsMat)
		box.position.set((o.min[0] + o.max[0]) / 2, (o.min[1] + o.max[1]) / 2, (o.min[2] + o.max[2]) / 2)
		g.add(box)
	}
	g.traverse((o) => {
		o.matrixAutoUpdate = false
		o.updateMatrix()
	})
}
