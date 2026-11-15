/**
 * The dotted aim preview of Stage Salad (WO-1089 §11): while the band is pulled, the first PREVIEW_S of the arc —
 * flight.js against the venue's colliders, exactly what the server will fly (minus the avatar) — as a row of dots in
 * the vegetable's colour, fading along the arc. Recomputed only when the aim moves.
 */
import { launches, simulate } from './flight.js'

export const PREVIEW_S = 0.5
const EVERY = 5 // flight steps per dot (1/24 s)
const MAX_DOTS = 16

/** The preview's points (pure): [[x, y, z], …] for a vegetable, a launch point and an aim. */
export function previewPath(veg, origin, yaw, pitch, power, venue) {
	if (!veg || !venue) return []
	const l = launches({ ...veg, n: 1 }, origin, yaw, pitch, power, 0)[0]
	const r = simulate(veg, l, venue, { record: EVERY, maxT: PREVIEW_S })
	return (r.path || []).slice(1, MAX_DOTS + 1)
}

export function createAimView(THREE, scene) {
	const pos = new Float32Array(MAX_DOTS * 3)
	const col = new Float32Array(MAX_DOTS * 3)
	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
	geo.setDrawRange(0, 0)
	const mat = new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, transparent: true, depthTest: false, depthWrite: false })
	const dots = new THREE.Points(geo, mat)
	dots.frustumCulled = false
	dots.renderOrder = 10
	scene.add(dots)
	const c = new THREE.Color()
	let key = ''

	return {
		/** aim = { veg, origin, yaw, pitch, power, venue } or null (hidden). */
		update(aim) {
			if (!aim) {
				dots.visible = false
				key = ''
				return
			}
			const k = `${aim.veg.id}|${aim.yaw.toFixed(4)}|${aim.pitch.toFixed(4)}|${aim.power.toFixed(3)}`
			dots.visible = true
			if (k === key) return
			key = k
			const pts = previewPath(aim.veg, aim.origin, aim.yaw, aim.pitch, aim.power, aim.venue)
			c.set(aim.veg.color).lerp(new THREE.Color(0xffffff), 0.35)
			pts.forEach((p, i) => {
				pos.set(p, i * 3)
				const fade = 1 - (i / Math.max(1, pts.length)) * 0.7
				col.set([c.r * fade, c.g * fade, c.b * fade], i * 3)
			})
			geo.setDrawRange(0, pts.length)
			geo.attributes.position.needsUpdate = true
			geo.attributes.color.needsUpdate = true
		},
	}
}
