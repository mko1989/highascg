/**
 * Track drawing (WO-1074): asphalt ribbon, red/white kerbs, white edge lines, a chequered start/finish line with a
 * small arch, faint direction chevrons and subtle checkpoint posts — all flat vertex-coloured geometry on the track's
 * floor plane (track.y), a handful of draw calls.
 */
import * as THREE from 'three'
import { leftNormal, pointAt, gateOf } from './track-math.js'

const ASPHALT = [0.03, 0.032, 0.038] // linear (vertex colours are linear; ≈ #303236 on screen)
const KERB_A = [0.7, 0.02, 0.015]
const KERB_B = [0.85, 0.85, 0.85]
const LINE = [0.8, 0.8, 0.78]

/** Collects coloured triangles (non-indexed) into one BufferGeometry. */
class TriBatch {
	constructor() {
		this.pos = []
		this.col = []
	}
	tri(a, b, c, rgb) {
		this.pos.push(...a, ...b, ...c)
		for (let i = 0; i < 3; i++) this.col.push(...rgb)
	}
	quad(a, b, c, d, rgb) {
		this.tri(a, b, c, rgb)
		this.tri(a, c, d, rgb)
	}
	geometry() {
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
		g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
		g.computeBoundingSphere()
		return g
	}
}

/** Offset point i of the centre line sideways by `off` (+ = left) at height y. */
function sidePoint(T, i, off, y) {
	const [tx, tz] = T.tangents[i]
	const [lx, lz] = leftNormal(tx, tz)
	const p = T.pts[i]
	return [p[0] + lx * off, y, p[1] + lz * off]
}

function flatMat(polygonOffset) {
	return new THREE.MeshBasicMaterial({
		vertexColors: true,
		side: THREE.DoubleSide,
		polygonOffset: true,
		polygonOffsetFactor: -polygonOffset,
		polygonOffsetUnits: -polygonOffset * 4,
	})
}

/** Build the track group for a prepared track. */
export function buildTrackMesh(T) {
	const group = new THREE.Group()
	group.name = 'track-' + (T.id || '')
	const y = T.y
	const n = T.n
	const segs = T.closed ? n : n - 1
	const half = T.half

	/* asphalt (slightly lit look via MeshLambert would need normals — flat colour is fine and cheaper) */
	const road = new TriBatch()
	const kerbs = new TriBatch()
	const lines = new TriBatch()
	const kerbW = 0.16
	const lineW = 0.05
	let sAcc = 0
	for (let i = 0; i < segs; i++) {
		const j = (i + 1) % n
		road.quad(
			sidePoint(T, i, half, y + 0.004),
			sidePoint(T, j, half, y + 0.004),
			sidePoint(T, j, -half, y + 0.004),
			sidePoint(T, i, -half, y + 0.004),
			ASPHALT
		)
		const band = Math.floor(sAcc / 0.5) % 2 ? KERB_A : KERB_B
		sAcc += T.segs[i].len
		for (const sgn of [1, -1]) {
			const o0 = sgn * half
			const o1 = sgn * (half + kerbW)
			kerbs.quad(
				sidePoint(T, i, o0, y + 0.006),
				sidePoint(T, j, o0, y + 0.006),
				sidePoint(T, j, o1, y + 0.006),
				sidePoint(T, i, o1, y + 0.006),
				band
			)
			const l0 = sgn * (half - 0.08)
			const l1 = sgn * (half - 0.08 - lineW)
			lines.quad(
				sidePoint(T, i, l0, y + 0.008),
				sidePoint(T, j, l0, y + 0.008),
				sidePoint(T, j, l1, y + 0.008),
				sidePoint(T, i, l1, y + 0.008),
				LINE
			)
		}
	}
	group.add(new THREE.Mesh(road.geometry(), flatMat(1)))
	group.add(new THREE.Mesh(kerbs.geometry(), flatMat(2)))
	group.add(new THREE.Mesh(lines.geometry(), flatMat(3)))

	/* direction chevrons every ~5 m (skipping the start area) */
	const arrows = new TriBatch()
	const step = 5
	for (let s = 3; s < T.total - 2; s += step) {
		const p = pointAt(T, s)
		const [lx, lz] = leftNormal(p.ux, p.uz)
		const tip = [p.x + p.ux * 0.35, y + 0.01, p.z + p.uz * 0.35]
		const wing = half * 0.55
		const back = 0.25
		const thick = 0.18
		const lA = [p.x + lx * wing - p.ux * back, y + 0.01, p.z + lz * wing - p.uz * back]
		const rA = [p.x - lx * wing - p.ux * back, y + 0.01, p.z - lz * wing - p.uz * back]
		const tipIn = [tip[0] - p.ux * thick, y + 0.01, tip[2] - p.uz * thick]
		const lIn = [lA[0] - p.ux * thick, y + 0.01, lA[2] - p.uz * thick]
		const rIn = [rA[0] - p.ux * thick, y + 0.01, rA[2] - p.uz * thick]
		arrows.quad(lA, tip, tipIn, lIn, [1, 1, 1])
		arrows.quad(tip, rA, rIn, tipIn, [1, 1, 1])
	}
	const arrowMat = flatMat(4)
	arrowMat.transparent = true
	arrowMat.opacity = 0.22
	arrowMat.depthWrite = false
	group.add(new THREE.Mesh(arrows.geometry(), arrowMat))

	/* start / finish: two rows of checks across the road + an arch */
	const g0 = gateOf(T, 0)
	const [lx, lz] = leftNormal(g0.tx, g0.tz)
	const checks = new TriBatch()
	const cols = Math.max(4, Math.round(T.width / 0.2))
	const cw = T.width / cols
	const rowD = 0.14
	for (let r = 0; r < 2; r++) {
		for (let c = 0; c < cols; c++) {
			const o0 = -half + c * cw
			const o1 = o0 + cw
			const a0 = (r - 1) * rowD
			const a1 = a0 + rowD
			const P = (o, a) => [g0.x + lx * o + g0.tx * a, y + 0.012, g0.z + lz * o + g0.tz * a]
			checks.quad(P(o0, a0), P(o1, a0), P(o1, a1), P(o0, a1), (r + c) % 2 ? [0.004, 0.004, 0.004] : [0.9, 0.9, 0.9])
		}
	}
	group.add(new THREE.Mesh(checks.geometry(), flatMat(5)))

	const postMat = new THREE.MeshLambertMaterial({ color: 0xdddddd })
	const archH = 1.1
	const postGeo = new THREE.CylinderGeometry(0.035, 0.035, archH, 8)
	for (const sgn of [1, -1]) {
		const post = new THREE.Mesh(postGeo, postMat)
		post.position.set(g0.x + lx * sgn * (half + 0.25), y + archH / 2, g0.z + lz * sgn * (half + 0.25))
		group.add(post)
	}
	const bar = new THREE.Mesh(
		new THREE.BoxGeometry(T.width + 0.6, 0.16, 0.05),
		new THREE.MeshLambertMaterial({ color: 0xff7a1a })
	)
	bar.position.set(g0.x, y + archH, g0.z)
	bar.rotation.y = Math.atan2(-g0.tx, -g0.tz)
	group.add(bar)

	/* checkpoint posts (subtle, knee-high, both sides) */
	const cpGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6)
	const cpMat = new THREE.MeshLambertMaterial({ color: 0x55c6ff, transparent: true, opacity: 0.6 })
	for (let k = 1; k < T.checkpoints.length; k++) {
		const g = gateOf(T, k)
		const [nx, nz] = leftNormal(g.tx, g.tz)
		for (const sgn of [1, -1]) {
			const p = new THREE.Mesh(cpGeo, cpMat)
			p.position.set(g.x + nx * sgn * (half + 0.3), y + 0.175, g.z + nz * sgn * (half + 0.3))
			group.add(p)
		}
	}
	group.traverse((o) => {
		o.matrixAutoUpdate = false
		o.updateMatrix()
	})
	return group
}

export function disposeGroup(g) {
	g?.traverse((o) => {
		o.geometry?.dispose?.()
		const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
		for (const m of mats) m.dispose?.()
	})
}
