/**
 * The three.js world of Stage Skirmish (WO-1081 §9): the kit's world.js (renderer, camera, scene GLB, quality — reused
 * unchanged from modules/rc-game/client) plus the cut-away room: ONE clipping plane that removes the scene's own
 * geometry above CUT_H u over the arena floor (table tops, chairs' backs, trusses, the ceiling), so the play under the
 * tables is visible from the top-down camera. Only the scene's materials get the plane (the GLB, and the plain arena
 * the kit builds when there is no GLB); soldiers, blocks, effects, light pools / beams and LED wall pictures are not
 * cut. The "low" quality swaps the scene to Lambert copies — the plane is re-applied after every swap.
 */
import * as THREE from 'three'
import { createWorld } from './kit/world.js'
import { CUT_H } from './sk-const.js'
import { FOV_DEG } from './cam.js'

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
	/** Cut the room `CUT_H` u above the floor at y (scale s); null = no cut (host preview / no arena yet). */
	world.setCut = (y, s) => {
		plane.constant = y == null ? 1e6 : y + CUT_H * s
		clipAll()
	}
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
