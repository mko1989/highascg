/* global document */
/**
 * Procedural RC buggy (WO-1074): chassis, body shell and rear wing in the player's colour, four wheels (the front
 * pair steers, all spin), an antenna with a coloured tip, a blob shadow (stays on the ground while airborne) and an
 * optional name tag. No external model. Built as the 0.45 × 0.25 m buggy and drawn at VIS_SCALE (1.4×, readable on a
 * phone; the physics circle is PHYS.RADIUS). Forward = −Z, like the physics. v2 effects: car-fx.js.
 */
import * as THREE from 'three'
import { maxSteerAngle } from './physics.js'
import { attachCarFx } from './car-fx.js'

export const VIS_SCALE = 1.4

const WHEEL_R = 0.055
let shared = null

function sharedParts() {
	if (shared) return shared
	const shadowCanvas = document.createElement('canvas')
	shadowCanvas.width = shadowCanvas.height = 64
	const ctx = shadowCanvas.getContext('2d')
	const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 32)
	grad.addColorStop(0, 'rgba(0,0,0,0.55)')
	grad.addColorStop(1, 'rgba(0,0,0,0)')
	ctx.fillStyle = grad
	ctx.fillRect(0, 0, 64, 64)
	const shadowTex = new THREE.CanvasTexture(shadowCanvas)
	const shadowGeo = new THREE.PlaneGeometry(0.62, 0.42)
	shadowGeo.rotateX(-Math.PI / 2)
	const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.05, 14)
	wheelGeo.rotateZ(Math.PI / 2)
	shared = {
		shadowGeo,
		shadowMat: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
		wheelGeo,
		hubGeo: new THREE.BoxGeometry(0.052, 0.07, 0.016),
		tyreMat: new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
		hubMat: new THREE.MeshLambertMaterial({ color: 0xc9c9c9 }),
		darkMat: new THREE.MeshLambertMaterial({ color: 0x2b2d33 }),
		glassMat: new THREE.MeshLambertMaterial({ color: 0x101820 }),
		chassisGeo: new THREE.BoxGeometry(0.2, 0.035, 0.4),
		bodyGeo: new THREE.BoxGeometry(0.17, 0.07, 0.24),
		noseGeo: new THREE.BoxGeometry(0.15, 0.04, 0.1),
		cabGeo: new THREE.BoxGeometry(0.11, 0.05, 0.1),
		wingGeo: new THREE.BoxGeometry(0.24, 0.012, 0.06),
		strutGeo: new THREE.BoxGeometry(0.012, 0.07, 0.02),
		antGeo: new THREE.CylinderGeometry(0.003, 0.003, 0.26, 4),
		tipGeo: new THREE.SphereGeometry(0.012, 8, 6),
	}
	return shared
}

function nameTag(name, color) {
	const c = document.createElement('canvas')
	c.width = 256
	c.height = 64
	const ctx = c.getContext('2d')
	ctx.font = 'bold 34px system-ui, sans-serif'
	const w = Math.min(248, ctx.measureText(name).width + 34)
	ctx.fillStyle = 'rgba(10,12,18,0.72)'
	ctx.beginPath()
	ctx.roundRect((256 - w) / 2, 8, w, 48, 14)
	ctx.fill()
	ctx.fillStyle = color
	ctx.fillRect((256 - w) / 2 + 12, 26, 10, 10)
	ctx.fillStyle = '#ffffff'
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(name, 128 + 8, 33, 220)
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	const mat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true })
	const spr = new THREE.Sprite(mat)
	spr.renderOrder = 10
	return spr
}

/**
 * @param {{ color: string, name?: string, tag?: boolean, tagScale?: number }} o
 * @returns {{ group: THREE.Group, update: Function, setTag: Function, dispose: Function }}
 */
export function createCarModel({ color = '#ff4d3d', name = '', tag = false, tagScale = 0.05 } = {}) {
	const p = sharedParts()
	const group = new THREE.Group()
	group.scale.setScalar(VIS_SCALE)
	const body = new THREE.Group()
	group.add(body)
	const paint = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) })

	const chassis = new THREE.Mesh(p.chassisGeo, p.darkMat)
	chassis.position.y = 0.05
	body.add(chassis)
	const shell = new THREE.Mesh(p.bodyGeo, paint)
	shell.position.set(0, 0.1, 0.02)
	body.add(shell)
	const nose = new THREE.Mesh(p.noseGeo, paint)
	nose.position.set(0, 0.085, -0.15)
	nose.rotation.x = -0.25
	body.add(nose)
	const cab = new THREE.Mesh(p.cabGeo, p.glassMat)
	cab.position.set(0, 0.155, 0.0)
	body.add(cab)
	const wing = new THREE.Mesh(p.wingGeo, paint)
	wing.position.set(0, 0.2, 0.17)
	body.add(wing)
	for (const sx of [-0.06, 0.06]) {
		const strut = new THREE.Mesh(p.strutGeo, p.darkMat)
		strut.position.set(sx, 0.16, 0.17)
		body.add(strut)
	}
	const ant = new THREE.Mesh(p.antGeo, p.darkMat)
	ant.position.set(-0.07, 0.24, 0.12)
	ant.rotation.x = 0.12
	body.add(ant)
	const tip = new THREE.Mesh(p.tipGeo, paint)
	tip.position.set(-0.07, 0.37, 0.135)
	body.add(tip)

	/* wheels: pivot (steer, front only) → spin → tyre + hub */
	const wheels = []
	for (const [x, z, front] of [
		[-0.125, -0.13, true],
		[0.125, -0.13, true],
		[-0.125, 0.14, false],
		[0.125, 0.14, false],
	]) {
		const pivot = new THREE.Group()
		pivot.position.set(x, WHEEL_R, z)
		const spin = new THREE.Group()
		spin.add(new THREE.Mesh(p.wheelGeo, p.tyreMat))
		const hub = new THREE.Mesh(p.hubGeo, p.hubMat)
		hub.position.x = x < 0 ? -0.006 : 0.006
		spin.add(hub)
		pivot.add(spin)
		group.add(pivot)
		wheels.push({ pivot, spin, front })
	}

	const shadow = new THREE.Mesh(p.shadowGeo, p.shadowMat)
	shadow.position.y = 0.006
	shadow.renderOrder = 1
	group.add(shadow)

	let tagSprite = null
	function setTag(on, nm = name, scale = tagScale) {
		if (tagSprite) {
			group.remove(tagSprite)
			tagSprite.material.map.dispose()
			tagSprite.material.dispose()
			tagSprite = null
		}
		if (!on) return
		tagSprite = nameTag(nm, color)
		tagSprite.scale.set((scale * 4) / VIS_SCALE, scale / VIS_SCALE, 1)
		tagSprite.position.y = 0.55
		group.add(tagSprite)
	}
	if (tag) setTag(true)

	const fx = attachCarFx(group)
	let spinAngle = 0
	let clock = 0
	/**
	 * @param {{x:number,y:number,z:number,yaw:number}} s pose
	 * @param {number} v forward speed m/s
	 * @param {number} st steering −1…1 (+ = left)
	 * @param {number} dt seconds
	 * @param {{ fx?: number, stage?: number, squash?: number, groundY?: number|null, blink?: boolean, yawAdd?: number }} [e]
	 */
	function update(s, v, st, dt, e = {}) {
		clock += dt
		group.position.set(s.x, s.y, s.z)
		group.rotation.y = s.yaw + (e.yawAdd || 0)
		group.visible = !e.blink
		const q = Math.max(0, Math.min(1, e.squash || 0))
		body.scale.set(1 + 0.25 * q, 1 - 0.38 * q, 1 + 0.25 * q)
		/* the shadow stays on the ground under an airborne car, smaller the higher it flies */
		const above = e.groundY != null && Number.isFinite(e.groundY) ? Math.max(0, s.y - e.groundY) : 0
		shadow.position.y = 0.006 - above / VIS_SCALE
		shadow.scale.setScalar(Math.max(0.4, 1 - above * 0.35))
		fx.update({ fx: e.fx || 0, stage: e.stage || 0 }, dt, clock)
		spinAngle -= (v * dt) / WHEEL_R
		const steerAngle = st * maxSteerAngle(v) * 1.4
		for (const w of wheels) {
			w.spin.rotation.x = spinAngle
			if (w.front) w.pivot.rotation.y = steerAngle
		}
		/* a little body roll / squat for life */
		body.rotation.z = -st * Math.min(1, Math.abs(v) / 9) * 0.06
	}

	function dispose() {
		setTag(false)
		fx.dispose()
		paint.dispose()
	}
	return { group, update, setTag, dispose }
}
