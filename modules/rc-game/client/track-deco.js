/**
 * Track decoration (WO-1074 v2): the start gantry (two towers, a chequered banner, five start lights that follow the
 * countdown — see setGantryLights) over a chequered start line, and small checkpoint posts at the gate heights.
 * §3 toy scale: every size and offset × T.scale (k) — a toy gantry over a toy line.
 */
import * as THREE from 'three'
import { leftNormal, gateOf } from './track-math.js'
import { TriBatch, flatMat, canvasTexture, lin } from './mesh-util.js'

const GANTRY_H = 2.1

/** The banner's word: the track's name in capitals (≤ 18 characters, cut at a word), else STAGE SPRINT (WO-1082). */
export function bannerText(name) {
	const clean = Array.from(String(name ?? ''))
		.filter((ch) => ch.codePointAt(0) > 0x1f && !(ch.codePointAt(0) >= 0x7f && ch.codePointAt(0) <= 0x9f))
		.join('')
		.trim()
		.toUpperCase()
	if (!clean) return 'STAGE SPRINT'
	if (clean.length <= 18) return clean
	const cut = clean.slice(0, 18)
	const sp = cut.lastIndexOf(' ')
	return (sp > 6 ? cut.slice(0, sp) : cut).trim()
}

function bannerTexture(name) {
	const text = bannerText(name)
	return canvasTexture(512, 64, (ctx, w, h) => {
		const sq = h / 2
		for (let x = 0; x < w; x += sq) {
			for (let r = 0; r < 2; r++) {
				ctx.fillStyle = ((x / sq) | 0) % 2 === r ? '#111317' : '#f4f4f4'
				ctx.fillRect(x, r * sq, sq, sq)
			}
		}
		ctx.fillStyle = 'rgba(17,19,23,0.92)'
		ctx.fillRect(w * 0.25, 0, w * 0.5, h)
		ctx.fillStyle = '#ff7a1a'
		ctx.font = `bold ${text.length > 12 ? 30 : 40}px system-ui, sans-serif`
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.fillText(text, w / 2, h / 2 + 2, w * 0.48)
	})
}

/** Static decoration group; `group.userData.lights` = the five light materials. */
export function buildTrackDeco(T) {
	const group = new THREE.Group()
	group.name = 'track-deco'
	const g0 = gateOf(T, 0)
	const [lx, lz] = leftNormal(g0.tx, g0.tz)
	const y = g0.y
	const half = T.half
	const k = T.scale ?? 1
	const H = GANTRY_H * k

	/* chequered start line */
	const checks = new TriBatch()
	const cols = Math.max(4, Math.round(T.width / (0.25 * k)))
	const cw = T.width / cols
	for (let r = 0; r < 2; r++) {
		for (let c = 0; c < cols; c++) {
			const o0 = -half + c * cw
			const a0 = (r - 1) * 0.18 * k
			const P = (o, a) => [g0.x + lx * o + g0.tx * a, y + 0.03 * k, g0.z + lz * o + g0.tz * a]
			checks.quad(
				P(o0, a0),
				P(o0 + cw, a0),
				P(o0 + cw, a0 + 0.18 * k),
				P(o0, a0 + 0.18 * k),
				(r + c) % 2 ? lin('#111317') : lin('#f4f4f4')
			)
		}
	}
	group.add(checks.mesh(flatMat(5)))

	/* gantry */
	const yaw = Math.atan2(-g0.tx, -g0.tz)
	const towerMat = new THREE.MeshLambertMaterial({ color: 0x2a2e38 })
	const trimMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a })
	const towerGeo = new THREE.BoxGeometry(0.22 * k, H, 0.22 * k)
	const span = T.width + 1.0 * k
	for (const sgn of [1, -1]) {
		const t = new THREE.Mesh(towerGeo, towerMat)
		t.position.set(g0.x + lx * sgn * (span / 2), y + H / 2, g0.z + lz * sgn * (span / 2))
		t.rotation.y = yaw
		group.add(t)
		const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3 * k, 0.08 * k, 0.3 * k), trimMat)
		cap.position.set(t.position.x, y + H + 0.04 * k, t.position.z)
		group.add(cap)
	}
	const beam = new THREE.Mesh(
		new THREE.BoxGeometry(span + 0.22 * k, 0.42 * k, 0.12 * k),
		new THREE.MeshBasicMaterial({ map: bannerTexture(T.name) })
	)
	beam.position.set(g0.x, y + H - 0.25 * k, g0.z)
	beam.rotation.y = yaw
	group.add(beam)
	/* five start lights under the banner, facing the grid (behind the line = +tangent… the grid is before it) */
	const lights = []
	const lightGeo = new THREE.CircleGeometry(0.09 * k, 18)
	for (let q = 0; q < 5; q++) {
		const m = new THREE.MeshBasicMaterial({ color: 0x2a2a2e, side: THREE.DoubleSide })
		const l = new THREE.Mesh(lightGeo, m)
		const o = (2 - q) * 0.28 * k // lamp 0 on the driver's left: fills left → right like the HUD lights
		l.position.set(g0.x + lx * o - g0.tx * 0.07 * k, y + H - 0.62 * k, g0.z + lz * o - g0.tz * 0.07 * k)
		l.rotation.y = yaw
		group.add(l)
		lights.push(m)
	}
	const board = new THREE.Mesh(new THREE.BoxGeometry(1.55 * k, 0.3 * k, 0.06 * k), towerMat)
	board.position.set(g0.x - g0.tx * 0.01 * k, y + H - 0.62 * k, g0.z - g0.tz * 0.01 * k)
	board.rotation.y = yaw
	group.add(board)
	group.userData.lights = lights

	/* checkpoint posts (knee-high, both sides, at the gate height) */
	const cpGeo = new THREE.CylinderGeometry(0.03 * k, 0.03 * k, 0.4 * k, 6)
	const cpMat = new THREE.MeshLambertMaterial({ color: 0x55c6ff, transparent: true, opacity: 0.7 })
	for (let c = 1; c < T.checkpoints.length; c++) {
		const g = gateOf(T, c)
		const [nx, nz] = leftNormal(g.tx, g.tz)
		const off = half + 0.35 * k
		for (const sgn of [1, -1]) {
			const p = new THREE.Mesh(cpGeo, cpMat)
			p.position.set(g.x + nx * sgn * off, g.y + 0.2 * k, g.z + nz * sgn * off)
			group.add(p)
		}
	}
	return group
}

/** Start lights: remainMs > 0 → red lamps fill up one per second (5 … 1); ≤ 0 → all green for a second; null → off. */
export function setGantryLights(group, remainMs) {
	const lights = group?.userData?.lights
	if (!lights) return
	let mode = 'off'
	let lit = 0
	if (remainMs != null && remainMs > 0) {
		mode = 'red'
		lit = Math.min(5, 5 - Math.floor(remainMs / 1000))
	} else if (remainMs != null && remainMs > -1500) mode = 'green'
	lights.forEach((m, i) => {
		const hex = mode === 'green' ? 0x36e05c : mode === 'red' && i < lit ? 0xff2b1f : 0x2a2a2e
		if (m.color.getHex() !== hex) m.color.setHex(hex)
	})
}
