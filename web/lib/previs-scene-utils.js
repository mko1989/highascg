/**
 * Geometry and picking helpers for Previs scene.
 */
import { tagScreenMesh, readScreenTag, traverseMeshes } from './previs-mesh-info.js'

export function collectTaggedMeshes(root) { const out = []; traverseMeshes(root, m => { if (readScreenTag(m)) out.push(m) }); return out }

export function pickAutoScreen(root, THREE) {
	let best = null; let bestArea = 0; const box = new THREE.Box3(); const size = new THREE.Vector3()
	traverseMeshes(root, m => {
		try {
			box.setFromObject(m); box.getSize(size); const area = Math.max(size.x, size.z) * size.y
			if (area > bestArea && !(Math.min(size.x, size.z) > 0 && size.y < Math.min(size.x, size.z) * 0.2)) { best = m; bestArea = area }
		} catch {}
	})
	return best
}

export function buildDemoScreenMesh(THREE, texture, matFn, cfg) {
	const w = 6, h = 3.375; const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matFn(THREE, texture, cfg))
	m.position.set(0, h / 2 + 0.2, -2); m.name = 'previs:demo-screen'; m.userData.isPlaceholder = true; return m
}
