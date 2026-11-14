/**
 * WO-1074 §2.6 — LED wall pictures for stage-fx.js: one textured strip per scene `screens` entry, 2 cm in front of the
 * baked wall body, and ONE texture per role shared by every screen of that role (each maps its own `uv` crop).
 * Frames arrive as JPEG bytes; `createImageBitmap(Blob)` decodes them off the main thread (no <img>, no blob: URL, so
 * the page's CSP img-src is not involved). At most one decode per role runs; a frame arriving meanwhile replaces the
 * waiting one (latest wins). A screen stays hidden until its role's first picture — the GLB's wall body shows instead.
 */
import { screenStrip } from './stage-fx-math.js'

const DEG = Math.PI / 180

/**
 * @param {typeof import('three')} THREE
 * @param {{ createImageBitmap?: Function, Blob?: any }} [env]
 */
export function createWall(THREE, env = {}) {
	const decode = env.createImageBitmap || globalThis.createImageBitmap?.bind(globalThis)
	const BlobCtor = env.Blob || globalThis.Blob
	const group = new THREE.Group()
	group.name = 'stage-fx-screens'
	const roles = new Map() // role → { tex, mats: [], busy, pending, size }
	const meshes = []
	let disposed = false
	const stats = { frames: 0, decoded: 0, dropped: 0, errors: 0 }

	function roleOf(role) {
		let r = roles.get(role)
		if (!r) {
			const tex = new THREE.Texture()
			tex.flipY = false // ImageBitmap uploads ignore flipY anyway; the UVs are v-down (stage-fx-math screenStrip)
			tex.colorSpace = THREE.SRGBColorSpace
			tex.generateMipmaps = false
			tex.minFilter = THREE.LinearFilter
			tex.magFilter = THREE.LinearFilter
			r = { tex, mats: [], busy: false, pending: null, size: '' }
			roles.set(role, r)
		}
		return r
	}

	function clear() {
		for (const m of meshes) {
			m.geometry.dispose()
			m.material.dispose()
			m.removeFromParent()
		}
		meshes.length = 0
		for (const r of roles.values()) r.mats = []
	}

	/** Build the screens of a scene (`screens` array of the scene JSON). */
	function load(screens) {
		clear()
		for (const s of Array.isArray(screens) ? screens : []) {
			if (!s || typeof s.role !== 'string' || !Array.isArray(s.p) || !Array.isArray(s.size)) continue
			const strip = screenStrip(s)
			const geo = new THREE.BufferGeometry()
			geo.setAttribute('position', new THREE.BufferAttribute(strip.positions, 3))
			geo.setAttribute('uv', new THREE.BufferAttribute(strip.uvs, 2))
			geo.setIndex(new THREE.BufferAttribute(strip.indices, 1))
			geo.computeBoundingSphere()
			const r = roleOf(s.role)
			const mat = new THREE.MeshBasicMaterial({ map: r.tex, toneMapped: false })
			r.mats.push(mat)
			const mesh = new THREE.Mesh(geo, mat)
			mesh.name = `screen:${s.id}`
			const rot = Array.isArray(s.rot) ? s.rot : [0, 0, 0]
			mesh.position.set(s.p[0], s.p[1], s.p[2])
			mesh.rotation.set((rot[0] || 0) * DEG, (rot[1] || 0) * DEG, (rot[2] || 0) * DEG, 'YXZ') // Godot rotation_degrees
			mesh.visible = !!r.size // hidden until the role's first picture
			mesh.userData.role = s.role
			group.add(mesh)
			meshes.push(mesh)
		}
		return meshes.length
	}

	/** The roles the current screens show (what the server should send). */
	const wanted = () => [...new Set(meshes.map((m) => m.userData.role))]

	function show(role) {
		for (const m of meshes) if (m.userData.role === role) m.visible = true
	}

	async function run(role, r) {
		r.busy = true
		while (r.pending && !disposed) {
			const blob = r.pending
			r.pending = null
			try {
				const bmp = await decode(blob)
				if (disposed) {
					bmp.close?.()
					break
				}
				const size = `${bmp.width}x${bmp.height}`
				const old = r.tex.image
				if (size !== r.size) {
					r.tex.dispose() // a new size re-allocates the GPU texture
					r.size = size
				}
				r.tex.image = bmp
				r.tex.needsUpdate = true
				if (old && old !== bmp && typeof old.close === 'function') old.close()
				stats.decoded++
				show(role)
			} catch {
				stats.errors++
			}
		}
		r.busy = false
	}

	/** One JPEG for `role` (Uint8Array or Blob). Drops it when no screen shows that role. */
	function onFrame(role, jpeg) {
		if (disposed || !decode || !BlobCtor) return false
		const r = roles.get(role)
		if (!r || !r.mats.length) return false
		stats.frames++
		if (r.pending) stats.dropped++
		r.pending = jpeg instanceof BlobCtor ? jpeg : new BlobCtor([jpeg], { type: 'image/jpeg' })
		if (!r.busy) run(role, r)
		return true
	}

	return {
		group,
		load,
		wanted,
		onFrame,
		stats: () => ({ ...stats, screens: meshes.length }),
		setVisible(on) {
			group.visible = !!on
		},
		dispose() {
			disposed = true
			clear()
			for (const r of roles.values()) {
				r.tex.image?.close?.()
				r.tex.dispose()
			}
			roles.clear()
			group.removeFromParent()
		},
	}
}
