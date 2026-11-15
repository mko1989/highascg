/**
 * Stage Skirmish (WO-1081): the spotlight pool of the `spot` mode ("Spotlight", WO-1083) in three.js — a warm disc
 * on the arena floor with a dark outer ring and a bright inner ring (normal blending: an additive glow vanishes on the
 * white hall floor, WO-1081 play test 1) and a soft additive halo on top. Colour: free = warm white, held by you =
 * green, held by another = their colour, contested = flashing orange-red; it blinks in the last seconds before it
 * moves. Pure view: the state's `spot` (server metres / ms) comes in through update().
 *
 *   const sv = createSpotView(s)   → { group, update(spot, { t, sNow, meId, colorOf }), dispose() }
 */
import * as THREE from 'three'
import { canvasTexture, disposeGroup } from './kit/mesh-util.js'
import { SPOT_WARN_S } from './sk-const.js'

const FREE = new THREE.Color(0xffd23a) // warm yellow: a near-white pool vanished on the light hall floor
const MINE = new THREE.Color(0x4dff7a)
const FIGHT = new THREE.Color(0xff5a2a)

function haloTexture() {
	return canvasTexture(128, 128, (ctx, W) => {
		const gr = ctx.createRadialGradient(W / 2, W / 2, 2, W / 2, W / 2, W / 2)
		gr.addColorStop(0, 'rgba(255,255,255,0.55)')
		gr.addColorStop(0.7, 'rgba(255,255,255,0.25)')
		gr.addColorStop(1, 'rgba(255,255,255,0)')
		ctx.fillStyle = gr
		ctx.fillRect(0, 0, W, W)
	})
}

export function createSpotView(s = 1) {
	const group = new THREE.Group()
	group.name = 'spot'
	group.visible = false
	const flat = (geo) => geo.rotateX(-Math.PI / 2)
	const discMat = new THREE.MeshBasicMaterial({ color: FREE.clone(), transparent: true, opacity: 0.32, depthWrite: false })
	const edgeMat = new THREE.MeshBasicMaterial({ color: 0x14161c, transparent: true, opacity: 0.85, depthWrite: false })
	const ringMat = new THREE.MeshBasicMaterial({ color: FREE.clone(), transparent: true, opacity: 0.95, depthWrite: false })
	const haloMat = new THREE.MeshBasicMaterial({
		map: haloTexture(),
		color: FREE.clone(),
		transparent: true,
		opacity: 0.5,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	})
	const disc = new THREE.Mesh(flat(new THREE.CircleGeometry(1, 48)), discMat)
	const edge = new THREE.Mesh(flat(new THREE.RingGeometry(1, 1.12, 64)), edgeMat)
	const ring = new THREE.Mesh(flat(new THREE.RingGeometry(0.88, 1, 64)), ringMat)
	const halo = new THREE.Mesh(flat(new THREE.PlaneGeometry(2.4, 2.4)), haloMat)
	// above the floor by more than depth precision at the overview distance (0.4 mm z-fought there), under the pad
	disc.position.y = 0.012 * s
	edge.position.y = ring.position.y = 0.016 * s
	halo.position.y = 0.02 * s
	for (const [m, o] of [
		[disc, 1],
		[edge, 2],
		[ring, 3],
		[halo, 4],
	])
		m.renderOrder = o
	group.add(disc, edge, ring, halo)
	const tmp = new THREE.Color()

	return {
		group,
		/**
		 * @param {{ x: number, z: number, r: number, movesAt: number, holder: any, contested: boolean }|null} spot
		 * @param {{ t: number, sNow: number, y: number, meId: any, colorOf: (id: any) => string|null }} o
		 */
		update(spot, o) {
			const ok = spot && [spot.x, spot.z, spot.r].every(Number.isFinite) && spot.r > 0
			group.visible = !!ok
			if (!ok) return
			group.position.set(spot.x, o.y, spot.z)
			group.scale.set(spot.r, 1, spot.r)
			let c = FREE
			if (spot.contested) c = Math.sin(o.t * 12) > 0 ? FIGHT : FREE
			else if (spot.holder != null && spot.holder === o.meId) c = MINE
			else if (spot.holder != null) c = tmp.set(o.colorOf(spot.holder) || '#ffffff')
			discMat.color.copy(c)
			ringMat.color.copy(c)
			haloMat.color.copy(c)
			const left = (spot.movesAt - o.sNow) / 1000
			const blink = left > 0 && left < SPOT_WARN_S ? 0.5 + 0.5 * Math.sin(o.t * 10) : 1
			const pulse = 0.85 + 0.15 * Math.sin(o.t * 2.5)
			discMat.opacity = (spot.holder != null ? 0.5 : 0.4) * blink
			ringMat.opacity = 0.95 * blink
			haloMat.opacity = 0.45 * pulse * blink
		},
		dispose() {
			disposeGroup(group)
			group.removeFromParent()
		},
	}
}
