/**
 * The Stage Salad slingshot (WO-1089 §11) — our own design: a big wooden Y-frame stage prop on a weighted base (a
 * low pallet with two sandbags and a turntable), wraps in the player's colour on the grips, a fabric band from the
 * fork tips to a leather pouch that holds the chosen vegetable, and a small slatted crate of vegetables beside it.
 * Local frame: the slot's floor point, facing the slot's yaw (forward −Z); the fork turns on the turntable to the aim's
 * yaw. The pouch's rest point is the launch point (venue.js pouch(): 1.25 m up); pulling moves it back against the
 * launch direction by up to PULL_M.
 *
 *   const s = createSlingshot(THREE, { color, name, slotYaw })   s.setAim(yaw, pitch, pull) · s.setVeg(id | null)
 */
import { vegMesh, pouchMesh } from './veg-models.js'
import { makeTag } from './avatar-model.js'
import { POUCH_H } from './venue.js'

export const PULL_M = 0.62
const WOOD = 0x9c6a3c
const WOOD_DARK = 0x5e3d22
const SAND = 0xc9b48a
const LEATHER = 0x6b4426
const BAND = 0xe9e2d0
const TIP = [0.3, 1.43, -0.06]

function lam(THREE, color, extra = {}) {
	return new THREE.MeshLambertMaterial({ color, ...extra })
}

/** A unit cylinder (height 1 along Y) stretched from a to b. */
function stretch(mesh, a, b, tmp) {
	tmp.set(b.x - a.x, b.y - a.y, b.z - a.z)
	const len = tmp.length() || 1e-4
	mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
	mesh.quaternion.setFromUnitVectors(Y_AXIS, tmp.normalize())
	mesh.scale.y = len
}

let Y_AXIS = null

export function createSlingshot(THREE, { color = '#ffffff', name = '', slotYaw = 0 } = {}) {
	if (!Y_AXIS) Y_AXIS = new THREE.Vector3(0, 1, 0)
	const tmp = new THREE.Vector3()
	const root = new THREE.Group()
	root.name = 'salad-sling'
	root.rotation.y = slotYaw
	const wood = lam(THREE, WOOD)
	const dark = lam(THREE, WOOD_DARK)
	const grip = lam(THREE, color, { emissive: new THREE.Color(color).multiplyScalar(0.25) })

	/* the weighted base: pallet, two sandbags, the turntable */
	const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.09, 0.8), dark)
	pallet.position.y = 0.045
	root.add(pallet)
	for (let k = 0; k < 3; k++) {
		const slat = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.025, 0.16), wood)
		slat.position.set(0, 0.1, -0.28 + k * 0.28)
		root.add(slat)
	}
	const sandMat = lam(THREE, SAND)
	for (const x of [-0.34, 0.34]) {
		const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 3, 8), sandMat)
		bag.rotation.x = Math.PI / 2
		bag.scale.set(1, 1, 0.7)
		bag.position.set(x, 0.17, 0.2)
		root.add(bag)
	}
	const table = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.06, 18), lam(THREE, 0x3b3f48))
	table.position.y = 0.14
	root.add(table)

	/* the fork, on the turntable */
	const fork = new THREE.Group()
	root.add(fork)
	const unitCyl = (r) => new THREE.CylinderGeometry(r, r, 1, 10)
	const post = new THREE.Mesh(unitCyl(0.075), wood)
	stretch(post, new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0, 0.86, 0), tmp)
	fork.add(post)
	const crotch = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), wood)
	crotch.position.y = 0.86
	fork.add(crotch)
	const tips = []
	for (const side of [1, -1]) {
		const tip = new THREE.Vector3(TIP[0] * side, TIP[1], TIP[2])
		const arm = new THREE.Mesh(unitCyl(0.058), wood)
		stretch(arm, new THREE.Vector3(0, 0.86, 0), tip, tmp)
		fork.add(arm)
		const knob = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 8), dark)
		knob.position.copy(tip)
		fork.add(knob)
		const wrap = new THREE.Mesh(unitCyl(0.066), grip)
		const a = new THREE.Vector3(0, 0.86, 0).lerp(tip, 0.58)
		const b = new THREE.Vector3(0, 0.86, 0).lerp(tip, 0.86)
		stretch(wrap, a, b, tmp)
		fork.add(wrap)
		tips.push(tip)
	}
	const postWrap = new THREE.Mesh(unitCyl(0.083), grip)
	stretch(postWrap, new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(0, 0.62, 0), tmp)
	fork.add(postWrap)

	/* band + pouch */
	const bandMat = lam(THREE, BAND, { emissive: 0x2a2620 })
	const bands = [0, 1].map(() => {
		const m = new THREE.Mesh(unitCyl(0.022), bandMat)
		fork.add(m)
		return m
	})
	const pouch = new THREE.Group()
	const cup = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), lam(THREE, LEATHER, { side: THREE.DoubleSide }))
	cup.rotation.x = -Math.PI / 2 // the cup opens forward (−Z)
	cup.scale.set(1.25, 1, 0.8)
	pouch.add(cup)
	fork.add(pouch)
	const held = new THREE.Group()
	held.position.z = -0.03
	pouch.add(held)

	/* the crate of vegetables beside it */
	const crate = new THREE.Group()
	crate.position.set(0.85, 0, 0.35)
	crate.rotation.y = 0.3
	for (const [x, z, w, d] of [
		[0, -0.17, 0.46, 0.03],
		[0, 0.17, 0.46, 0.03],
		[-0.22, 0, 0.03, 0.34],
		[0.22, 0, 0.03, 0.34],
	]) {
		for (const y of [0.06, 0.17]) {
			const slat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), wood)
			slat.position.set(x, y, z)
			crate.add(slat)
		}
	}
	const floorBoard = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 0.32), dark)
	floorBoard.position.y = 0.02
	crate.add(floorBoard)
	;[
		['tomato', -0.1, 0.2, -0.06],
		['potato', 0.08, 0.2, 0.05],
		['onion', 0.1, 0.21, -0.07],
		['cabbage', -0.07, 0.24, 0.07],
		['carrot', 0.0, 0.25, 0.0],
	].forEach(([id, x, y, z]) => {
		const v = vegMesh(THREE, id)
		v.position.set(x, y, z)
		v.rotation.y = x * 9
		v.scale.setScalar(1.3)
		crate.add(v)
	})
	root.add(crate)

	let tag = null
	if (name) {
		tag = makeTag(THREE, name, color)
		tag.sprite.position.set(0, 1.95, 0)
		tag.sprite.scale.set(0.72, 0.135, 1)
		root.add(tag.sprite)
	}

	const rest = new THREE.Vector3(0, POUCH_H, 0)
	const pouchAt = new THREE.Vector3()
	let vegId = null
	let shownVeg = null
	let pop = 1

	function setAim(yaw, pitch, pull) {
		fork.rotation.y = Math.atan2(Math.sin(yaw - slotYaw), Math.cos(yaw - slotYaw))
		const k = Math.max(0, Math.min(1, pull || 0)) * PULL_M
		// back against the launch direction (forward −Z, pitched up)
		pouchAt.set(0, rest.y - Math.sin(pitch) * k, rest.z + Math.cos(pitch) * k)
		pouch.position.copy(pouchAt)
		pouch.rotation.x = pitch * 0.6
		for (let j = 0; j < 2; j++) {
			const side = j ? -1 : 1
			const end = tmp.set(pouchAt.x + side * 0.07, pouchAt.y, pouchAt.z).clone()
			stretch(bands[j], tips[j], end, tmp)
			bands[j].scale.x = bands[j].scale.z = 1 - k * 0.5 // a stretched band thins
		}
	}
	setAim(slotYaw, 0.35, 0)

	return {
		group: root,
		fork,
		setAim,
		/** The vegetable in the pouch (null = empty, reloading). */
		setVeg(id) {
			if (id === vegId) return
			vegId = id
			if (shownVeg) shownVeg.removeFromParent()
			shownVeg = null
			if (id) {
				shownVeg = pouchMesh(THREE, id)
				shownVeg.scale.setScalar(1.4)
				held.add(shownVeg)
				pop = 0
			}
		},
		update(dt) {
			if (shownVeg && pop < 1) {
				pop = Math.min(1, pop + dt * 5)
				shownVeg.scale.setScalar(1.4 * (0.3 + 0.7 * pop))
			}
		},
		dispose() {
			root.removeFromParent()
			tag?.dispose()
			grip.dispose() // the rest is a few small shared buffers: left to the GC with the group
		},
	}
}
