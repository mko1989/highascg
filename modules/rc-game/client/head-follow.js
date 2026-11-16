/**
 * WO-1090 — the patched heads' own models turn with the live lights. The scene GLB carries each moving head's parts in
 * nodes of their own (userData { rcHead: fixture id, rcAxis: 'pan' | 'tilt' }, server rc-scene-fixtures.js) at rest;
 * the scene JSON's `heads` says where the axes are at rest ({ o: world origin, a: unit axis }) and the beam's rest
 * direction `d`. Each frame stage-fx.js hands over the (smoothed) beam direction it draws for that head, and the head is
 * turned so its beam points there: tilt about its rest axis, then pan about the pan axis (the previs's chain: pan outer).
 *
 *   const hf = createHeadFollow(THREE, scene)
 *   hf.load(heads)      the scene JSON's `heads` (or nothing): forget the old binding
 *   hf.turn(id, d)      the beam of head `id` now points along d (unit, world)
 *   hf.tick(nowMs)      every frame: (re)binds the GLB nodes at most once a second while some are missing
 *   solveHead(h, d, prevTilt) → { pan, tilt } (radians; pure — the smoke checks it)
 */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v) => {
	const l = Math.hypot(v[0], v[1], v[2]) || 1
	return [v[0] / l, v[1] / l, v[2] / l]
}

/** v turned by `ang` about unit axis a (Rodrigues). */
export function rotate(v, a, ang) {
	const c = Math.cos(ang), s = Math.sin(ang), k = dot(a, v) * (1 - c), x = cross(a, v)
	return [v[0] * c + x[0] * s + a[0] * k, v[1] * c + x[1] * s + a[1] * k, v[2] * c + x[2] * s + a[2] * k]
}

/** The angle about unit axis a that takes u's projection onto v's (both off the axis). */
function about(u, v, a) {
	const pu = [0, 1, 2].map((i) => u[i] - a[i] * dot(a, u))
	const pv = [0, 1, 2].map((i) => v[i] - a[i] * dot(a, v))
	if (Math.hypot(...pu) < 1e-6 || Math.hypot(...pv) < 1e-6) return 0
	return Math.atan2(dot(cross(pu, pv), a), dot(pu, pv))
}

const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x))

/**
 * Pan / tilt (radians) that turn the rest beam h.d onto d: R_pan(pan) · R_tilt(tilt) · h.d = d. The tilt keeps the
 * beam's component along the pan axis (A cos φ + B sin φ = K); of its two solutions the one nearer `prevTilt` wins, so
 * a head sweeping through its pan axis does not flip.
 */
export function solveHead(h, d, prevTilt = 0) {
	const r = unit(h.d || [0, -1, 0]), t = unit(d)
	const P = h.pan?.a ? unit(h.pan.a) : null, T = h.tilt?.a ? unit(h.tilt.a) : null
	if (P && T) {
		const rt = dot(T, r), tp = dot(T, P)
		const A = dot(r, P) - rt * tp, B = dot(cross(T, r), P), K = dot(t, P) - rt * tp
		const R = Math.hypot(A, B)
		let tilt = 0
		if (R > 1e-6) {
			const phi = Math.atan2(B, A), del = Math.acos(Math.max(-1, Math.min(1, K / R)))
			const c1 = wrap(phi + del), c2 = wrap(phi - del)
			tilt = Math.abs(wrap(c1 - prevTilt)) <= Math.abs(wrap(c2 - prevTilt)) ? c1 : c2
		}
		return { pan: about(rotate(r, T, tilt), t, P), tilt }
	}
	if (P) return { pan: about(r, t, P), tilt: 0 }
	if (T) return { pan: 0, tilt: about(r, t, T) }
	return { pan: 0, tilt: 0 }
}

export function createHeadFollow(THREE, scene) {
	let heads = new Map() // id → { h, pan: Object3D | null, tilt: Object3D | null, tiltA, d }
	let lastBind = -Infinity
	const mp = new THREE.Matrix4(), mt = new THREE.Matrix4(), mr = new THREE.Matrix4(), v = new THREE.Vector3(), ax = new THREE.Vector3()

	/** Rotation by ang about the axis { o, a } through its origin → into m. */
	function rotAbout(m, axis, ang) {
		m.makeRotationAxis(ax.set(axis.a[0], axis.a[1], axis.a[2]).normalize(), ang)
		v.set(axis.o[0], axis.o[1], axis.o[2]).applyMatrix4(m)
		m.setPosition(axis.o[0] - v.x, axis.o[1] - v.y, axis.o[2] - v.z)
		return m
	}

	function apply(e) {
		if (!e.d || (!e.pan && !e.tilt)) return
		const s = solveHead(e.h, e.d, e.tiltA)
		e.tiltA = s.tilt
		if (e.h.pan) rotAbout(mp, e.h.pan, s.pan)
		else mp.identity()
		for (const [obj, m] of [[e.pan, mp], [e.tilt, e.h.tilt ? mt.copy(mp).multiply(rotAbout(mr, e.h.tilt, s.tilt)) : mp]]) {
			if (!obj) continue
			obj.matrixAutoUpdate = false
			obj.matrix.copy(m)
			obj.matrixWorldNeedsUpdate = true
		}
	}

	const attached = (o) => {
		for (let p = o; p; p = p.parent) if (p === scene) return true
		return false
	}

	function bind() {
		for (const e of heads.values()) e.pan = e.tilt = null
		scene.traverse((o) => {
			const e = o.userData?.rcHead != null ? heads.get(String(o.userData.rcHead)) : null
			if (e && (o.userData.rcAxis === 'pan' || o.userData.rcAxis === 'tilt')) e[o.userData.rcAxis] = o
		})
		for (const e of heads.values()) apply(e)
	}

	return {
		load(list) {
			heads = new Map()
			for (const h of Array.isArray(list) ? list : []) {
				if (h && typeof h.id === 'string' && Array.isArray(h.d) && (h.pan || h.tilt)) heads.set(h.id, { h, pan: null, tilt: null, tiltA: 0, d: null })
			}
			lastBind = -Infinity
		},
		turn(id, d) {
			const e = heads.get(id)
			if (!e || !Array.isArray(d)) return
			e.d = d
			apply(e)
		},
		tick(now) {
			if (!heads.size || now - lastBind < 1000) return
			let stale = false
			for (const e of heads.values()) {
				if ((!e.pan && !e.tilt) || (e.pan && !attached(e.pan)) || (e.tilt && !attached(e.tilt))) stale = true
			}
			if (!stale) return
			lastBind = now
			bind()
		},
		stats: () => ({ heads: heads.size, bound: [...heads.values()].filter((e) => e.pan || e.tilt).length }),
	}
}
