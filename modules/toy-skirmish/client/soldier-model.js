/* global document */
/**
 * Procedural toy soldier of Stage Skirmish (WO-1081 §9): a moulded-plastic figure of our own design — a round base
 * disc, two legs, a chunky torso with a belt, arms reaching to the held weapon, a round head under a domed helmet
 * with a brim — all in the player's (or team's) colour, the base a shade darker. The held weapon (weapon-model.js)
 * is swapped live. Screen-sized name tag and, for enemies hit recently, a health bar (sprites, never hidden by the
 * room); a blob shadow; a surge glow ring; spawn protection blinks; a hit flashes the plastic white.
 * Built in u (H = 0.55 u tall) inside `body`, scaled by the scene scale; the root sits at the floor point.
 */
import * as THREE from 'three'
import { buildWeapon, muzzleZ } from './weapon-model.js'
import { SOLDIER } from './sk-const.js'

let S = null

function shared() {
	if (S) return S
	const blob = document.createElement('canvas')
	blob.width = blob.height = 64
	const ctx = blob.getContext('2d')
	const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
	grad.addColorStop(0, 'rgba(0,0,0,0.5)')
	grad.addColorStop(1, 'rgba(0,0,0,0)')
	ctx.fillStyle = grad
	ctx.fillRect(0, 0, 64, 64)
	const shadowTex = new THREE.CanvasTexture(blob)
	const glow = document.createElement('canvas')
	glow.width = glow.height = 64
	const g2 = glow.getContext('2d')
	const gr2 = g2.createRadialGradient(32, 32, 10, 32, 32, 32)
	gr2.addColorStop(0, 'rgba(255,255,255,0)')
	gr2.addColorStop(0.55, 'rgba(255,255,255,0.9)')
	gr2.addColorStop(1, 'rgba(255,255,255,0)')
	g2.fillStyle = gr2
	g2.fillRect(0, 0, 64, 64)
	S = {
		shadowGeo: new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2),
		shadowMat: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
		glowGeo: new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
		glowTex: new THREE.CanvasTexture(glow),
		base: new THREE.CylinderGeometry(0.2, 0.21, 0.04, 20),
		leg: new THREE.BoxGeometry(0.075, 0.2, 0.09),
		torso: new THREE.BoxGeometry(0.2, 0.18, 0.13),
		belt: new THREE.BoxGeometry(0.21, 0.03, 0.14),
		arm: new THREE.BoxGeometry(0.06, 0.06, 0.18),
		head: new THREE.SphereGeometry(0.065, 14, 10),
		helmet: new THREE.SphereGeometry(0.085, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
		brim: new THREE.CylinderGeometry(0.1, 0.1, 0.012, 18),
		pack: new THREE.BoxGeometry(0.14, 0.12, 0.06),
		barGeo: new THREE.PlaneGeometry(1, 1),
	}
	return S
}

function plastic(hex, k = 1) {
	const c = new THREE.Color(hex).multiplyScalar(k)
	return new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.02, emissive: 0x000000 })
}

function nameTag(name, color) {
	const c = document.createElement('canvas')
	c.width = 256
	c.height = 64
	const ctx = c.getContext('2d')
	ctx.font = 'bold 30px system-ui, sans-serif'
	const w = Math.min(248, ctx.measureText(name).width + 34)
	ctx.fillStyle = 'rgba(10,12,18,0.7)'
	ctx.beginPath()
	ctx.roundRect((256 - w) / 2, 12, w, 42, 12)
	ctx.fill()
	ctx.fillStyle = color
	ctx.fillRect((256 - w) / 2 + 10, 28, 9, 9)
	ctx.fillStyle = '#ffffff'
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(name, 128 + 7, 34, 214)
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	const spr = new THREE.Sprite(
		new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true })
	)
	spr.renderOrder = 20
	return spr
}

function barSprite(color, renderOrder) {
	const spr = new THREE.Sprite(
		new THREE.SpriteMaterial({ color, sizeAttenuation: false, depthTest: false, transparent: true })
	)
	spr.renderOrder = renderOrder
	return spr
}

/**
 * @param {{ color: string, name?: string, tag?: boolean, tagSize?: number, scale?: number }} o
 */
export function createSoldierModel({ color = '#5ee06b', name = '', tag = true, tagSize = 0.032, scale = 1 } = {}) {
	const s = shared()
	const root = new THREE.Group()
	root.name = 'soldier'
	const body = new THREE.Group()
	body.scale.setScalar(scale)
	root.add(body)
	const main = plastic(color)
	const dark = plastic(color, 0.62)
	const skin = plastic(color, 0.9)
	const mats = [main, dark, skin]
	const mesh = (geo, mat, x, y, z) => {
		const m = new THREE.Mesh(geo, mat)
		m.position.set(x, y, z)
		body.add(m)
		return m
	}
	const shadow = new THREE.Mesh(s.shadowGeo, s.shadowMat)
	shadow.position.y = 0.004
	shadow.renderOrder = 1
	body.add(shadow)
	mesh(s.base, dark, 0, 0.02, 0)
	const legL = mesh(s.leg, main, -0.055, 0.14, 0)
	const legR = mesh(s.leg, main, 0.055, 0.14, 0)
	const upper = new THREE.Group()
	upper.position.y = 0.24
	body.add(upper)
	const add = (geo, mat, x, y, z) => {
		const m = new THREE.Mesh(geo, mat)
		m.position.set(x, y, z)
		upper.add(m)
		return m
	}
	add(s.torso, main, 0, 0.09, 0)
	add(s.belt, dark, 0, 0.005, 0)
	add(s.pack, dark, 0, 0.1, 0.09)
	const armL = add(s.arm, main, -0.1, 0.12, -0.07)
	const armR = add(s.arm, main, 0.1, 0.12, -0.07)
	armL.rotation.y = -0.35
	armR.rotation.y = 0.35
	add(s.head, skin, 0, 0.245, 0)
	add(s.helmet, dark, 0, 0.265, 0)
	add(s.brim, dark, 0, 0.265, 0)
	const gunMount = new THREE.Group()
	gunMount.position.set(0, SOLDIER.MUZZLE_H - 0.24, -0.14)
	upper.add(gunMount)
	let gun = null
	let gunId = null

	const glowMat = new THREE.MeshBasicMaterial({
		map: s.glowTex,
		color: 0xff3fd8,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	})
	const glow = new THREE.Mesh(s.glowGeo, glowMat)
	glow.position.y = 0.01
	glow.visible = false
	body.add(glow)

	/* screen-sized overlays (not under the scaled body) */
	let tagSpr = null
	const bar = new THREE.Group()
	const barBg = barSprite(0x101218, 21)
	const barFill = barSprite(0x55e07a, 22)
	bar.add(barBg, barFill)
	bar.visible = false
	root.add(bar)
	const overlayY = SOLDIER.H * scale * 1.25
	bar.position.y = overlayY
	function setTag(nm) {
		if (tagSpr) {
			root.remove(tagSpr)
			tagSpr.material.map.dispose()
			tagSpr.material.dispose()
			tagSpr = null
		}
		if (!nm) return
		tagSpr = nameTag(nm, color)
		tagSpr.scale.set(tagSize * 4, tagSize, 1)
		tagSpr.center.set(0.5, -0.35)
		tagSpr.position.y = overlayY
		root.add(tagSpr)
	}
	if (tag && name) setTag(name)
	barBg.scale.set(tagSize * 1.6, tagSize * 0.22, 1)
	barBg.center.set(0.5, 1.6)

	function setWeapon(id) {
		if (id === gunId) return
		if (gun) gunMount.remove(gun)
		gun = buildWeapon(id)
		gunId = id
		gunMount.add(gun)
	}
	setWeapon('pea')

	let flashT = 0
	let pop = 0
	return {
		group: root,
		body,
		get weapon() {
			return gunId
		},
		setWeapon,
		setName: setTag,
		/** Health bar 0…1 (null hides). */
		setHealth(frac) {
			if (frac == null) {
				bar.visible = false
				return
			}
			const f = Math.max(0.02, Math.min(1, frac))
			bar.visible = true
			barFill.scale.set(tagSize * 1.6 * f, tagSize * 0.22, 1)
			barFill.center.set(0.5 / f, 1.6)
			barFill.material.color.setHex(f > 0.6 ? 0x55e07a : f > 0.3 ? 0xffc23a : 0xff4a3a)
		},
		hitFlash() {
			flashT = 0.12
		},
		/** Death: shrink away (k 0…1 of the pop; null = alive). */
		setPop(k) {
			pop = k == null ? 0 : k
		},
		/** World point of the muzzle (for the flash and tracers). */
		muzzle(out = new THREE.Vector3()) {
			out.set(0, 0, -muzzleZ(gunId))
			return gun ? gun.localToWorld(out) : root.localToWorld(out)
		},
		/**
		 * @param {{ x: number, y: number, z: number, yaw: number, moving?: boolean, protectedBlink?: boolean,
		 *   surge?: boolean, t: number, dt: number }} p
		 */
		update(p) {
			root.position.set(p.x, p.y, p.z)
			body.rotation.y = p.yaw
			const walk = p.moving ? Math.sin(p.t * 16) : 0
			legL.rotation.x = walk * 0.5
			legR.rotation.x = -walk * 0.5
			upper.position.y = 0.24 + (p.moving ? Math.abs(walk) * 0.012 : 0)
			flashT = Math.max(0, flashT - (p.dt || 0))
			const e = flashT > 0 ? 0.9 : 0
			for (const m of mats) m.emissive.setScalar(e)
			glow.visible = !!p.surge
			if (p.surge) {
				glowMat.opacity = 0.55 + 0.35 * Math.sin(p.t * 9)
				glow.scale.setScalar(1 + 0.12 * Math.sin(p.t * 9))
			}
			const sc = pop > 0 ? Math.max(0.001, 1 - pop) * (1 + pop * 0.6) : 1
			body.scale.setScalar(scale * sc)
			body.visible = !(p.protectedBlink && Math.floor(p.t * 10) % 2 === 0) && pop < 1
		},
		/** Show or hide the whole figure (dead and popped, not yet respawned). */
		setVisible(on) {
			root.visible = !!on
		},
		dispose() {
			setTag(null)
			for (const m of mats) m.dispose()
			glowMat.dispose()
			barBg.material.dispose()
			barFill.material.dispose()
			root.removeFromParent()
		},
	}
}
