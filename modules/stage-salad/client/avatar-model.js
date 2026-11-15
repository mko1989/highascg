/* global document */
/**
 * The presenter's avatar in three.js (WO-1089 §6 / §11): a faithful twin of the previs "pebble person"
 * (godot/client/features/previs/tracking/person_avatar.gd, WO-1086), built from avatar-spec.js figureSpec() — the
 * shared avatar-body.js MESH table. Unit frame (feet y 0, top 1.02, front +Z, the person's left +X), uniform scale
 * height / 1.02, rotation.y = yaw. Matte colours with emissive = colour × SELF_LIGHT and the shader's soft rim
 * (onBeforeCompile), Lambert on "low". Motion as person_avatar.gd step(): walk swing of arms and legs, a small bob,
 * breathing. The upper body (torso, head, arms, hair) sits in its own group so a duck can sink it while the legs
 * squat. A floating name tag (canvas text, never HTML) and a fade for a lost person.
 *
 *   const av = createAvatarModel(THREE, { look, height, label, quality })
 *   av.update({ x, y, z, yaw, height, speed, duck (0…1), off: [dx, dz], tilt: [ax, az], alpha }, dt, t)
 */
import { figureSpec, stride, advancePhase, limbAngles, breath, blend, LIMB_RATE } from './avatar-spec.js'
import { HIP_Y, DUCK_DROP, UNIT_TOP, scaleOf } from './avatar-body.js'

const RIM = 0.2
const LOOK_MATS = ['top', 'bottom', 'skin', 'hair', 'shoes', 'blush']
const geoCache = new Map()

function geo(THREE, key, make) {
	if (!geoCache.has(key)) geoCache.set(key, make())
	return geoCache.get(key)
}

function addRim(m) {
	m.onBeforeCompile = (sh) => {
		sh.fragmentShader = sh.fragmentShader.replace(
			'#include <emissivemap_fragment>',
			`#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * ${RIM.toFixed(2)} * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);`
		)
	}
	m.customProgramCacheKey = () => 'salad-rim'
	return m
}

function makeMat(THREE, quality, color, emissive, unlit) {
	const c = new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace)
	if (unlit) return new THREE.MeshBasicMaterial({ color: c, transparent: true })
	const e = new THREE.Color().setRGB(emissive[0], emissive[1], emissive[2], THREE.SRGBColorSpace)
	const m = quality === 'low' ? new THREE.MeshLambertMaterial({ color: c, emissive: e }) : new THREE.MeshStandardMaterial({ color: c, emissive: e, roughness: 0.9, metalness: 0 })
	m.transparent = true
	return addRim(m)
}

function partMesh(THREE, p, mat) {
	let g
	if (p.kind === 'ball') g = geo(THREE, 'ball', () => new THREE.SphereGeometry(1, 24, 14))
	else if (p.kind === 'cap') g = geo(THREE, `cap:${p.r}:${p.h}`, () => new THREE.CapsuleGeometry(p.r, Math.max(0, p.h - 2 * p.r), 4, 16))
	else if (p.kind === 'tube') {
		const curve = new THREE.CatmullRomCurve3(p.path.map((v) => new THREE.Vector3(v[0], v[1], v[2])))
		g = geo(THREE, `tube:${p.r}`, () => new THREE.TubeGeometry(curve, 16, p.r, 8, false))
	} else return null
	const m = new THREE.Mesh(g, mat)
	m.position.set(p.at[0], p.at[1], p.at[2])
	if (p.kind !== 'tube') m.scale.set(p.s[0], p.s[1], p.s[2])
	return m
}

/** A name tag sprite (canvas text). */
export function makeTag(THREE, text, color = '#ffd24a') {
	const c = document.createElement('canvas')
	c.width = 512
	c.height = 96
	const g = c.getContext('2d')
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
	sprite.renderOrder = 5
	const paint = (t, col) => {
		if (!g) return
		g.clearRect(0, 0, c.width, c.height)
		g.font = 'bold 54px system-ui, sans-serif'
		g.textAlign = 'center'
		g.textBaseline = 'middle'
		g.lineWidth = 12
		g.strokeStyle = 'rgba(12, 10, 8, 0.9)'
		g.strokeText(String(t), c.width / 2, c.height / 2, c.width - 24)
		g.fillStyle = col
		g.fillText(String(t), c.width / 2, c.height / 2, c.width - 24)
		tex.needsUpdate = true
	}
	paint(text, color)
	return { sprite, paint, dispose: () => (tex.dispose(), sprite.material.dispose()) }
}

export function createAvatarModel(THREE, { look, height = 1.75, label = '', quality = 'high' } = {}) {
	const root = new THREE.Group() // world: position, yaw, scale
	root.name = 'salad-avatar'
	const tilt = new THREE.Group() // the wobble (pivot at the feet)
	const bob = new THREE.Group()
	const legs = new THREE.Group()
	const upper = new THREE.Group()
	const hairShort = new THREE.Group()
	const hairLong = new THREE.Group()
	root.add(tilt)
	tilt.add(bob)
	bob.add(legs, upper)
	upper.add(hairShort, hairLong)
	const pivots = {}
	const mats = {}
	const fixed = []
	let spec = figureSpec(look, height)
	for (const p of spec.parts) {
		let mat
		if (LOOK_MATS.includes(p.mat)) mat = mats[p.mat] || (mats[p.mat] = makeMat(THREE, quality, p.color, p.emissive, false))
		else {
			mat = makeMat(THREE, quality, p.color, p.emissive, p.unlit)
			fixed.push(mat)
		}
		const mesh = partMesh(THREE, p, mat)
		if (!mesh) continue
		let parent = p.group === 'hair_short' ? hairShort : p.group === 'hair_long' ? hairLong : upper
		if (p.pivot) {
			if (!pivots[p.pivot]) {
				const pv = new THREE.Group()
				pv.position.set(p.pivotAt[0], p.pivotAt[1], p.pivotAt[2])
				;(p.group === 'legs' ? legs : upper).add(pv)
				pivots[p.pivot] = pv
			}
			parent = pivots[p.pivot]
		}
		parent.add(mesh)
	}
	const tag = makeTag(THREE, label || '')
	tag.sprite.position.set(0, UNIT_TOP + 0.16, 0)
	tag.sprite.scale.set(0.62, 0.116, 1)
	tag.sprite.visible = !!label
	root.add(tag.sprite)
	/** The head's world anchor for effects (unit frame inside `upper`). */
	const head = new THREE.Object3D()
	head.position.set(0, 0.82, 0)
	upper.add(head)

	let phase = 0
	let shownLabel = label
	let alpha = 1
	const hairVis = (len) => {
		hairShort.visible = len !== 'bald'
		hairLong.visible = len === 'long'
	}
	hairVis(spec.hair)

	function setLook(lk) {
		spec = figureSpec(lk, spec.height)
		for (const p of spec.parts) {
			const m = mats[p.mat]
			if (!m) continue
			m.color.setRGB(p.color[0], p.color[1], p.color[2], THREE.SRGBColorSpace)
			m.emissive.setRGB(p.emissive[0], p.emissive[1], p.emissive[2], THREE.SRGBColorSpace)
		}
		hairVis(lk.hair_len)
	}

	function setAlpha(a) {
		if (Math.abs(a - alpha) < 0.01) return
		alpha = a
		for (const m of [...Object.values(mats), ...fixed]) {
			m.opacity = a
			m.depthWrite = a > 0.98
		}
	}

	return {
		group: root,
		upper,
		legs,
		head,
		setLook,
		setLabel(text, color) {
			if (text === shownLabel) return
			shownLabel = text
			tag.paint(text, color || '#ffd24a')
			tag.sprite.visible = !!text
		},
		/** pose: { x, y, z, yaw, height, speed, duck, off, tilt, alpha } */
		update(pose, dt, t) {
			const s = scaleOf(pose.height)
			const off = pose.off || [0, 0]
			root.position.set(pose.x + off[0], pose.y, pose.z + off[1])
			root.rotation.y = pose.yaw
			root.scale.setScalar(s)
			const speed = pose.speed || 0
			phase = advancePhase(phase, dt, speed, pose.height)
			const [swing, lift] = stride(phase, speed)
			bob.position.y = lift
			upper.scale.y = breath(t)
			const drop = (pose.duck || 0) * DUCK_DROP
			upper.position.y = -drop
			const k = blend(dt, LIMB_RATE)
			for (const [name, pv] of Object.entries(pivots)) {
				const [ax, az] = limbAngles(name, swing)
				pv.rotation.x += (ax - pv.rotation.x) * k
				pv.rotation.z += (az - pv.rotation.z) * k
				if (name.startsWith('leg')) pv.scale.y = 1 - drop / HIP_Y // a squat keeps the feet on the floor
			}
			const tl = pose.tilt || [0, 0]
			tilt.rotation.set(tl[0], 0, tl[1])
			setAlpha(pose.alpha ?? 1)
		},
		setQuality(q) {
			for (const [key, m] of Object.entries(mats)) {
				const want = q === 'low' ? 'MeshLambertMaterial' : 'MeshStandardMaterial'
				if (m.type === want) continue
				const n = makeMat(THREE, q, [0, 0, 0], [0, 0, 0], false)
				n.color.copy(m.color)
				n.emissive.copy(m.emissive)
				n.opacity = m.opacity
				root.traverse((o) => {
					if (o.material === m) o.material = n
				})
				m.dispose()
				mats[key] = n
			}
		},
		dispose() {
			root.removeFromParent()
			for (const m of [...Object.values(mats), ...fixed]) m.dispose()
			tag.dispose()
		},
	}
}
