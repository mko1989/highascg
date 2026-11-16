/**
 * WO-1101 — the ONE place that knows each owning game's model code (work/notes/game-world-contract.md §2). The model
 * modules are loaded lazily, by URL, from `wst.models` (only same-origin paths under /game/, world-wire.js okModelUrl), with a
 * dynamic import(): they import 'three' through the page's import map, so they share the page's three.js. A module that
 * fails to load (or lacks its export) → a neutral coloured capsule of the right size; nothing here ever throws into the
 * game loop. MODEL_SIGS is pinned by tools/smoke/smoke-wo1101-world-client-props.test.js against the games' real files.
 *
 *   const props = createProps(THREE, { importer? })   props.setModels(wst.models)
 *   props.build(kind, info) → handle | null (still loading)   info = { w, c, n, s, yaw, scale, tag, quality }
 *   handle = { obj, kind, standIn, update(st), setTags(on), setQuality(q), clip(plane), dispose() }
 *     st = { yaw, f, s, dt, t, sNow, speed, ground (floor y − own y), alpha, vel: [vx, vy, vz] | null }
 *   Sizes: car / soldier at the scene scale (toys), veg / sling / av life-size (contract: a cabbage bigger than a car).
 */
import { okModelUrl } from './world-wire.js'
import { VEG_R, VEG_VIS, avHeight, slingPull, rgb255, boundsOf } from './visitor-logic.js'

/** Each kind's owning file, export and the option / method names props uses (the smoke reads the games' files). */
export const MODEL_SIGS = Object.freeze({
	car: { game: 'rc-game', file: 'car-model.js', fn: 'createCarModel', opts: ['color', 'name', 'tag', 'tagScale', 'scale'], api: ['update', 'setTag', 'dispose'] },
	soldier: { game: 'toy-skirmish', file: 'soldier-model.js', fn: 'createSoldierModel', opts: ['color', 'name', 'tag', 'tagSize', 'scale'], api: ['update', 'setWeapon', 'setName', 'setPop', 'setVisible', 'dispose'] },
	veg: { game: 'stage-salad', file: 'veg-models.js', fn: 'vegMesh', opts: [], api: [] },
	sling: { game: 'stage-salad', file: 'slingshot-model.js', fn: 'createSlingshot', opts: ['color', 'name', 'slotYaw'], api: ['setAim', 'setVeg', 'update', 'dispose'] },
	av: { game: 'stage-salad', file: 'avatar-model.js', fn: 'createAvatarModel', opts: ['look', 'height', 'label', 'quality'], api: ['update', 'setQuality', 'dispose'] },
})
/** The avatar's reactions (umbrella prop), a sibling file of the avatar model — optional. */
export const AV_REACT = Object.freeze({ game: 'stage-salad', file: 'avatar-react.js', fn: 'createReactions', api: ['update', 'dispose'] })

export const LOAD_TIMEOUT_MS = 8000
export const VEG_IDS = Object.freeze(Object.keys(VEG_R))

/** The sibling URL of a model URL (same folder), or null when it would not pass okModelUrl. */
export function siblingUrl(url, file) {
	if (!okModelUrl(url)) return null
	const base = url.split('?')[0]
	const u = base.slice(0, base.lastIndexOf('/') + 1) + file
	return okModelUrl(u) ? u : null
}

const ease = (dt, rate) => 1 - Math.exp(-rate * Math.max(0, dt))

export function createProps(THREE, { importer = (u) => import(u), now = () => Date.now() } = {}) {
	const models = {} // kind → url
	const mods = new Map() // kind → { url, state: 'loading' | 'ready' | 'failed', mod, react, at }

	function setModels(m) {
		if (!m || typeof m !== 'object') return
		for (const k of Object.keys(MODEL_SIGS)) {
			const u = okModelUrl(m[k]) ? m[k] : null
			if (u === (models[k] || null)) continue
			models[k] = u
			const cur = mods.get(k)
			if (cur && cur.url !== u && cur.state !== 'ready') mods.delete(k)
		}
	}

	function load(kind) {
		let e = mods.get(kind)
		if (e) {
			if (e.state === 'loading' && now() - e.at > LOAD_TIMEOUT_MS) e.state = 'failed'
			return e
		}
		const url = models[kind] || null
		e = { url, state: 'loading', mod: null, react: null, at: now() }
		mods.set(kind, e)
		if (!url) {
			e.state = 'failed'
			return e
		}
		const sig = MODEL_SIGS[kind]
		let p
		try {
			p = Promise.resolve(importer(url))
		} catch {
			p = Promise.reject(new Error('import failed'))
		}
		p.then(
			(mod) => {
				if (e.state !== 'loading') return
				if (mod && typeof mod[sig.fn] === 'function') (e.mod = mod), (e.state = 'ready')
				else e.state = 'failed'
			},
			() => {
				e.state = 'failed'
			}
		)
		if (kind === 'av') {
			const ru = siblingUrl(url, AV_REACT.file)
			if (ru)
				try {
					Promise.resolve(importer(ru)).then(
						(mod) => (e.react = mod && typeof mod[AV_REACT.fn] === 'function' ? mod : null),
						() => {}
					)
				} catch {
					/* optional */
				}
		}
		return e
	}

	/** A handle for a visitor, a stand-in when the model cannot be had, or null while its module is still loading. */
	function build(kind, info) {
		if (!MODEL_SIGS[kind]) return null
		const e = load(kind)
		if (e.state === 'loading') return null
		if (e.state === 'ready')
			try {
				return BUILD[kind](THREE, e, info)
			} catch {
				/* a model that throws while building → stand-in */
			}
		return standIn(THREE, kind, info)
	}

	return { setModels, build, standIn: (kind, info) => standIn(THREE, kind, info), state: (kind) => mods.get(kind)?.state || 'idle', pending: () => [...mods.values()].filter((e) => e.state === 'loading').length }
}

/* ---------------------------------------------------------------- one builder per kind */

function base(kind, obj, extra) {
	return { obj, kind, standIn: false, update() {}, setTags() {}, setQuality() {}, clip: (plane) => clipObj(obj, plane), dispose() {}, ...extra }
}

const BUILD = {
	car(THREE, e, info) {
		const m = e.mod.createCarModel({ color: info.c, name: info.n, tag: !!(info.tag && info.n), tagScale: 0.05, scale: info.scale })
		let spin = 0
		return base('car', m.group, {
			update(st) {
				spin = st.f & 4 ? spin + st.dt * 10.5 : 0 // RC draws remote spin-outs locally from the SPIN flag (loop.js)
				m.update({ x: 0, y: 0, z: 0, yaw: st.yaw }, st.speed, 0, st.dt, { fx: st.f & 31, stage: 0, groundY: st.ground, yawAdd: spin })
			},
			setTags: (on) => m.setTag(!!(on && info.n)),
			dispose: () => m.dispose(),
		})
	},
	soldier(THREE, e, info) {
		const m = e.mod.createSoldierModel({ color: info.c, name: info.n, tag: !!(info.tag && info.n), tagSize: 0.032, scale: info.scale })
		let pop = 0
		return base('soldier', m.group, {
			update(st) {
				const dead = !!(st.f & 2)
				pop = dead ? Math.min(1, pop + st.dt * 4) : 0
				m.setPop(dead ? pop : null)
				m.setVisible(!dead || pop < 1)
				m.setWeapon(typeof st.s === 'string' && st.s ? st.s : 'pea')
				m.update({ x: 0, y: 0, z: 0, yaw: st.yaw, moving: !!(st.f & 1), protectedBlink: !!(st.f & 4), surge: !!(st.f & 8), t: st.t, dt: st.dt })
			},
			setTags: (on) => m.setName(on && info.n ? info.n : null),
			dispose: () => m.dispose(),
		})
	},
	veg(THREE, e, info) {
		const id = VEG_IDS.includes(info.s) ? info.s : 'tomato'
		const obj = e.mod.vegMesh(THREE, id)
		obj.scale.setScalar(VEG_VIS) // drawn VIS × real size, as projectiles.js
		const seed = (info.w * 2654435761) >>> 0
		const axis = new THREE.Vector3(((seed & 255) / 255) - 0.5, (((seed >> 8) & 255) / 255) - 0.5, (((seed >> 16) & 255) / 255) - 0.5 + 0.01).normalize()
		const fwdZ = new THREE.Vector3(0, 0, 1)
		const dir = new THREE.Vector3()
		let spin = 0
		return base('veg', obj, {
			update(st) {
				const v = st.vel
				if (!v || Math.hypot(v[0], v[1], v[2]) < 0.3) return // lying still
				spin += st.dt * (id === 'carrot' ? 14 : 6)
				if (id === 'carrot') {
					obj.quaternion.setFromUnitVectors(fwdZ, dir.set(v[0], v[1], v[2]).normalize())
					obj.rotateZ(spin)
				} else obj.quaternion.setFromAxisAngle(axis, spin)
			},
			// vegMesh() copies share the cached geometry and materials: nothing of our own to free
		})
	},
	sling(THREE, e, info) {
		const m = e.mod.createSlingshot(THREE, { color: info.c, name: info.n, slotYaw: info.yaw || 0 })
		m.setVeg('tomato') // as slings.js shows the others' pouches
		const tags = []
		m.group.traverse((o) => o.isSprite && tags.push(o))
		for (const t of tags) t.visible = !!info.tag
		const aim = { yaw: info.yaw || 0, pull: 0 }
		return base('sling', m.group, {
			update(st) {
				const k = ease(st.dt, 12)
				aim.yaw += Math.atan2(Math.sin(st.yaw - aim.yaw), Math.cos(st.yaw - aim.yaw)) * k
				const want = slingPull(st.s)
				aim.pull += (want - aim.pull) * (want < aim.pull ? ease(st.dt, 30) : k)
				m.setAim(aim.yaw, 0.35, aim.pull)
				m.update(st.dt)
			},
			setTags: (on) => tags.forEach((t) => (t.visible = !!on)),
			dispose: () => m.dispose(),
		})
	},
	av(THREE, e, info) {
		const top = rgb255(info.c)
		const height = avHeight(info.s)
		const m = e.mod.createAvatarModel(THREE, { look: top ? { top } : null, height, label: '', quality: info.quality === 'low' ? 'low' : 'high' })
		let react = null
		try {
			react = e.react ? e.react.createReactions(THREE, m) : null
		} catch {
			react = null
		}
		let duck = 0
		let speed = 0
		return base('av', m.group, {
			update(st) {
				duck += ((st.f & 16 ? 1 : 0) - duck) * ease(st.dt, 8)
				speed += ((st.f & 1 ? Math.min(4, st.speed) : 0) - speed) * ease(st.dt, 6)
				const tilt = react ? react.update(st.dt, st.sNow, !!(st.f & 8)) : [0, 0]
				const alpha = (st.f & 2 ? 0.55 : 1) * (st.alpha ?? 1)
				m.update({ x: 0, y: 0, z: 0, yaw: st.yaw, height, speed, duck, off: [0, 0], tilt, alpha }, st.dt, st.t)
				syncClip(m.group)
			},
			setQuality: (q) => m.setQuality(q === 'low' ? 'low' : 'high'),
			dispose() {
				react?.dispose()
				m.dispose()
			},
		})
	},
}

/* ---------------------------------------------------------------- stand-in */

/** A neutral coloured capsule of the visitor's size (a model module that did not load). */
export function standIn(THREE, kind, info) {
	const b = boundsOf(kind, info.s, info.scale)
	const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(info.c || '#cccccc') })
	let geo
	const g = new THREE.Group()
	let mesh
	if (kind === 'veg') {
		geo = new THREE.SphereGeometry((VEG_R[info.s] || VEG_R.tomato) * VEG_VIS, 10, 8)
		mesh = new THREE.Mesh(geo, mat)
	} else if (kind === 'car') {
		const r = 0.12 * 1.4 * info.scale
		geo = new THREE.CapsuleGeometry(r, 0.25 * 1.4 * info.scale, 3, 8)
		mesh = new THREE.Mesh(geo, mat)
		mesh.rotation.x = Math.PI / 2
		mesh.position.y = r
	} else {
		const h = kind === 'soldier' ? 0.55 * info.scale : kind === 'sling' ? 1.45 : avHeight(info.s)
		const r = kind === 'soldier' ? 0.18 * info.scale : kind === 'sling' ? 0.12 : h * 0.12
		geo = new THREE.CapsuleGeometry(r, Math.max(0.001, h - 2 * r), 3, 8)
		mesh = new THREE.Mesh(geo, mat)
		mesh.position.y = h / 2
	}
	g.add(mesh)
	return base(kind, g, {
		standIn: true,
		bounds: b,
		update(st) {
			g.rotation.y = st.yaw || 0
			g.visible = !(kind === 'soldier' && st.f & 2)
		},
		dispose() {
			geo.dispose()
			mat.dispose()
		},
	})
}

/* ---------------------------------------------------------------- the cut-away clipping plane */

/**
 * Give every mesh / sprite material under obj the clipping plane, through per-visitor copies (the games share cached
 * materials between instances — the vegetables in a crate, a car's parts — so the originals are never touched). Cheap
 * to call every frame: only materials not yet copied are copied. The copies follow the originals' opacity (syncClip).
 */
export function clipObj(obj, plane) {
	const ud = obj.userData
	const pairs = ud.wvClip || (ud.wvClip = new Map()) // original → copy
	const planes = ud.wvPlanes || (ud.wvPlanes = [plane])
	planes[0] = plane
	obj.traverse((o) => {
		if (!o.material) return
		const swap = (m) => {
			if (!m || m.userData?.wvCopyOf) return m
			let c = pairs.get(m)
			if (!c) {
				c = m.clone()
				c.userData = { ...c.userData, wvCopyOf: m }
				c.clippingPlanes = planes
				pairs.set(m, c)
			}
			return c
		}
		o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material)
	})
}

/** The copies take the originals' fade (the avatar's alpha is written to its own materials). */
export function syncClip(obj) {
	const pairs = obj.userData.wvClip
	if (!pairs) return
	for (const [m, c] of pairs) {
		c.opacity = m.opacity
		c.transparent = m.transparent
		c.depthWrite = m.depthWrite
		c.visible = m.visible
	}
}

/** Free the copies (the visitor is gone). */
export function disposeClip(obj) {
	const pairs = obj.userData.wvClip
	if (!pairs) return
	for (const c of pairs.values()) c.dispose()
	pairs.clear()
}
