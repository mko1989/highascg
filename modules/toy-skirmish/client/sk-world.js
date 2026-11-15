/**
 * The three.js world of Stage Skirmish (WO-1081 §9): the kit's world.js (renderer, camera, scene GLB, quality — reused
 * unchanged from modules/rc-game/client) plus the cut-away room: ONE clipping plane that removes the scene's own
 * geometry above CUT_H u over the arena floor (table tops, chairs' backs, trusses, the ceiling), so the play under the
 * tables is visible from the top-down camera. Only the scene's materials get the plane (the GLB, and the plain arena
 * the kit builds when there is no GLB); soldiers, blocks, effects and light pools / beams are not cut. LED wall
 * pictures (the kit's stage effects, `screen:<id>` quads on the scene root) are cut only when they stand over the
 * active arena (screen-cut.js: a wall in the middle of the `stage` arena hid the soldiers, WO-1083) — the rest show
 * the show uncut. The "low" quality swaps the scene to Lambert copies — the plane is re-applied after every swap.
 */
import * as THREE from 'three'
import { createWorld } from './kit/world.js'
import { CUT_H } from './sk-const.js'
import { FOV_DEG } from './cam.js'
import { screenOverArena } from './screen-cut.js'

export function createSkWorld(canvas, opts = {}) {
	const world = createWorld(canvas, opts)
	world.renderer.localClippingEnabled = true
	const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6)
	const planes = [plane]

	function clipAll() {
		world.statics.traverse((o) => {
			if (!o.isMesh || o.userData.skNoCut) return
			for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
				if (!m || m.clippingPlanes === planes) continue
				m.clippingPlanes = planes
				m.needsUpdate = true
			}
		})
	}
	/* the kit's ground plane lies below every floor: never cut, but harmless either way */
	const setQuality = world.setQuality
	world.setQuality = (q) => {
		setQuality(q)
		clipAll()
	}
	const loadScene = world.loadScene
	world.loadScene = async (info, onProgress) => {
		const res = await loadScene(info, onProgress)
		clipAll()
		return res
	}
	let arenaRect = null
	let arenaS = 1
	const box = new THREE.Box3()
	/** The LED wall pictures over the active arena get the plane, the others none (call again after new screens). */
	function clipScreens() {
		world.scene.traverse((o) => {
			if (!o.isMesh || typeof o.name !== 'string' || !o.name.startsWith('screen:')) return
			o.updateWorldMatrix(true, false)
			box.setFromObject(o)
			const want = arenaRect && screenOverArena({ min: box.min.toArray(), max: box.max.toArray() }, arenaRect, arenaS) ? planes : null
			if (o.material.clippingPlanes === want) return
			o.material.clippingPlanes = want
			o.material.needsUpdate = true
			o.userData.skCut = !!want
		})
	}
	/** Cut the room `CUT_H` u above the floor at y (scale s) and the pictures over `rect`; null = no cut (no arena). */
	world.setCut = (y, s, rect = null) => {
		plane.constant = y == null ? 1e6 : y + CUT_H * s
		arenaRect = y == null ? null : rect
		arenaS = s || 1
		clipAll()
		clipScreens()
	}
	world.clipScreens = clipScreens
	world.cutPlane = plane
	world.setFov(FOV_DEG)
	/* a dimmer room so the rig's light pools read on the floor; the toys still pop */
	world.scene.traverse((o) => {
		if (o.isHemisphereLight) o.intensity = 1.9
		if (o.isDirectionalLight) o.intensity = 1.5
	})
	clipAll()
	return world
}
