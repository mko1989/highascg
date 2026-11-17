/**
 * WO-1101 — the Game World visitors (work/notes/game-world-contract.md §2): the OTHER games' cars, soldiers, vegetables,
 * slingshots, the presenter's avatar and the slick splats, drawn inside a game's own scene with each owning game's model
 * code (props.js, loaded by URL from `wst.models`). Loaded by a game page from `wst.client` only when the world is on, so
 * a game alone never fetches this file.
 *
 *   const vis = createVisitors(THREE, scene, { view: 'rc'|'sk'|'salad'|'world', scale, quality, tags, floorY(x, z),
 *     camY(), cutY?(x, z) → y | null })
 *   vis.ingest(msg)             a raw `wst` / `wv` (JSON text or object) or a decoded one → true when it was a world message
 *   vis.update(serverNow, dt, camera)   every rendered frame (server ms, seconds, the three.js camera)
 *   vis.effect([w, kind, ms, c]) a one-shot visual on a visitor (`wv.fx` are applied by ingest already)
 *   vis.setQuality(q)           → the `{ t: 'wq', n }` message to send on the game's socket
 *   vis.wq()  vis.patches(now?)  vis.count()  vis.info()  vis.dispose()
 * Nothing here throws into the game loop: every visitor is drawn inside its own try/catch, a broken model becomes a
 * neutral stand-in.
 */
import { decodeWv, WIRE_V } from './world-wire.js'
import {
	toWorldMsg, createTrack, pushSnap, sampleTrack, fadeOf, tierOf, tagsFor, wqOf, pickDrawn, pickSplats, cutMode,
	shadowRadius, shadowAlpha, boundsOf, insideSphere, splatRadius, patchOf,
} from './visitor-logic.js'
import { createProps, disposeClip } from './props.js'
import { createFxKit } from './visitor-fx.js'

const MAX_LIVE = 160
const MAX_FX = 4
const FADED_DROP_MS = 30000 // only a faded vegetable is dropped on silence (WO-1106 A1: every other kind waits for `gone`)

export function createVisitors(THREE, scene, opts = {}) {
	const view = ['rc', 'sk', 'salad', 'world'].includes(opts.view) ? opts.view : 'salad'
	let tier = tierOf(opts.quality, view)
	const tagsOn = opts.tags !== false
	const call = (f, ...a) => {
		if (typeof f !== 'function') return null
		try {
			const y = f(...a)
			return typeof y === 'number' && Number.isFinite(y) ? y : null
		} catch {
			return null
		}
	}
	const root = new THREE.Group()
	root.name = 'world-visitors'
	scene.add(root)
	const props = createProps(THREE, { importer: opts.importer })
	const kit = createFxKit(THREE)
	const map = new Map() // w → visitor
	let order = 0
	let clock = 0
	let drawn = 0
	let wst = null
	let lastNow = 0
	const cam = { x: 0, y: 0, z: 0 }

	const scaleNow = () => (Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : wst?.scale || 0.1)

	function add(a) {
		const [w, k, g, c, n, s] = a
		const old = map.get(w)
		if (old) {
			/* `s` changes (a soldier's weapon, a slingshot's pull) can only come as a repeated add: kept in place */
			if (old.kind === k && old.c === c && old.n === n && (k === 'soldier' || k === 'sling' || old.s === s)) {
				old.s = s
				return
			}
			drop(old)
		}
		const holder = new THREE.Group()
		holder.visible = false
		root.add(holder)
		map.set(w, { w, kind: k, g, c, n, s, track: createTrack(k), order: ++order, holder, handle: null, bounds: boundsOf(k, s, scaleNow()), fx: [], shadow: null, ring: null, splat: null, plane: null, p: null, fade: 1 })
	}

	function drop(v) {
		map.delete(v.w)
		try {
			v.handle?.dispose()
		} catch {
			/* a model's own dispose failing must not stop ours */
		}
		v.holder.traverse((o) => o.userData?.wvClip && disposeClip(o))
		v.holder.removeFromParent()
		for (const f of v.fx) f.dispose()
		for (const x of [v.shadow, v.ring, v.splat]) if (x) (x.obj.removeFromParent(), x.dispose())
	}

	function clear() {
		for (const v of [...map.values()]) drop(v)
	}

	function effect(x) {
		const d = decodeWv({ t: 'wv', v: WIRE_V, ts: 0, fx: [x] })
		const f = d?.fx?.[0]
		const v = f && map.get(f[0])
		if (!v || v.kind === 'splat') return false
		const fx = kit.effect(f[1], f[2], f[3] || v.c, v.bounds)
		if (v.fx.length >= MAX_FX) {
			const old = v.fx.shift()
			old.obj?.removeFromParent() // WO-1106 A14: out of the holder too, or every capped effect stays in the scene
			old.dispose()
		}
		if (fx.obj) v.holder.add(fx.obj)
		v.fx.push(fx)
		return true
	}

	function ingest(m) {
		const r = toWorldMsg(m)
		if (!r) return false
		if (r.t === 'wst') {
			if (!r.d.on) {
				/* WO-1106 A4: also what a game ingests on every socket `welcome` — nothing of the old feed may survive */
				wst = null
				clear()
				drawn = 0
			} else {
				wst = r.d
				props.setModels(r.d.models)
			}
			return true
		}
		const d = r.d
		if (!wst) return true // no world on: nothing to draw (a stray wv after wst off)
		for (const a of d.add) add(a)
		for (const e of d.e) {
			const v = map.get(e[0])
			if (v) pushSnap(v.track, d.ts, e)
		}
		for (const w of d.gone) {
			const v = map.get(w)
			if (v) drop(v)
		}
		for (const f of d.fx) effect(f)
		while (map.size > MAX_LIVE) drop([...map.values()].sort((a, b) => a.order - b.order)[0])
		return true
	}

	function info(v) {
		return { w: v.w, c: v.c, n: v.n, s: v.s, yaw: v.p ? v.p.yaw : 0, scale: scaleNow(), tag: tagsFor(v.kind, tier, tagsOn, v.n), quality: tier.q }
	}

	function ensureHandle(v) {
		if (v.handle && v.waitModel && props.want(v.kind) === 'ready') {
			/* WO-1106 A33: the model came in late (or on a retry): swap the stand-in for it, once */
			v.waitModel = false
			releaseHandle(v)
		}
		if (v.handle) return v.handle
		const h = props.build(v.kind, info(v))
		if (!h) return null
		v.handle = h
		v.waitModel = !!h.standIn && props.state(v.kind) !== 'ready'
		v.holder.add(h.obj)
		return h
	}

	function releaseHandle(v) {
		try {
			v.handle?.dispose()
		} catch {
			/* a model's own dispose failing must not stop ours */
		}
		if (v.handle) {
			disposeClip(v.handle.obj) // WO-1106 A21: the cut-away's material copies of the old handle
			v.handle.obj.removeFromParent()
		}
		v.handle = null
	}

	function breakHandle(v) {
		releaseHandle(v)
		v.waitModel = false
		v.handle = props.standIn(v.kind, info(v))
		v.holder.add(v.handle.obj)
		v.broken = (v.broken || 0) + 1
	}

	function floorAt(x, z, y) {
		const f = call(opts.floorY, x, z)
		return f == null ? y : f
	}

	function drawSplat(v, show) {
		if (!show) {
			if (v.splat) v.splat.obj.visible = false
			return
		}
		if (!v.splat) {
			v.splat = kit.floorSplat(v.c, splatRadius(v.s), v.w)
			root.add(v.splat.obj)
		}
		const p = v.p
		const cy = call(opts.cutY, p.x, p.z)
		const mode = cutMode('splat', p.y, cy)
		v.splat.obj.visible = mode !== 'hide'
		v.splat.set(p.x, p.y, p.z, v.fade, !!(p.f & 1))
	}

	function shadowFor(v, on, ring) {
		if (!on) {
			if (v.shadow) v.shadow.obj.visible = false
			if (v.ring) v.ring.obj.visible = false
			return
		}
		const p = v.p
		const fy = floorAt(p.x, p.z, Math.min(p.y, call(opts.cutY, p.x, p.z) ?? p.y))
		const h = Math.max(0, p.y - fy)
		const r = shadowRadius(h, v.bounds.r)
		if (!v.shadow) root.add((v.shadow = kit.shadow()).obj)
		v.shadow.obj.visible = true
		v.shadow.set(p.x, fy, p.z, r, shadowAlpha(h) * v.fade)
		if (!ring) {
			if (v.ring) v.ring.obj.visible = false
			return
		}
		if (!v.ring) root.add((v.ring = kit.ring(v.c)).obj)
		v.ring.obj.visible = true
		v.ring.set(p.x, fy, p.z, r * 1.15, 1 - Math.min(1, h / 3))
	}

	function drawOne(v, serverNow, dt) {
		const p = v.p
		const h = ensureHandle(v)
		if (!h) {
			v.holder.visible = false
			return false
		}
		let hopY = 0
		v.fx = v.fx.filter((f) => {
			const alive = f.update(dt)
			if (alive) hopY = Math.max(hopY, f.hopY || 0)
			else (f.obj?.removeFromParent(), f.dispose())
			return alive
		})
		if (v.kind === 'soldier' && p.f & 32 && !v.fx.some((f) => f.kind === 'stun')) effect([v.w, 'stun', 400, ''])
		const cy = call(opts.cutY, p.x, p.z)
		const bottom = v.kind === 'veg' ? p.y - v.bounds.r : p.y
		const mode = cutMode(v.kind, bottom, cy)
		shadowFor(v, mode === 'shadow', v.kind === 'veg')
		if (mode === 'shadow') {
			v.holder.visible = false
			return false
		}
		if (mode === 'clip') {
			if (!v.plane) v.plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), cy)
			v.plane.constant = cy
			h.clip(v.plane)
		} else if (v.plane) v.plane.constant = 1e6 // copies made in a cut stay, unclipped
		v.holder.position.set(p.x, p.y + hopY, p.z)
		v.holder.scale.setScalar(v.kind === 'av' ? 1 : Math.max(0.001, v.fade))
		const inside = insideSphere(cam, { x: p.x, y: p.y + hopY + v.bounds.cy, z: p.z }, v.bounds.r)
		v.holder.visible = !inside
		const last = v.track.snaps[v.track.snaps.length - 1]
		const speed = p.held ? 0 : hSpeed(v.track)
		const ground = v.kind === 'car' ? (p.f & 16 ? floorAt(p.x, p.z, p.y) - p.y : 0) : 0
		h.update({ yaw: p.yaw, f: p.f, s: v.s, dt, t: clock, sNow: serverNow, speed, ground, alpha: v.fade, vel: last?.v || null })
		return !inside
	}

	function update(serverNow, dt, camera) {
		dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0
		clock += dt
		lastNow = Number.isFinite(serverNow) ? serverNow : lastNow
		if (camera?.position) {
			cam.x = camera.position.x
			cam.y = camera.position.y
			cam.z = camera.position.z
		} else cam.y = call(opts.camY) ?? cam.y
		const list = []
		const splats = []
		for (const v of [...map.values()]) {
			v.p = sampleTrack(v.track, lastNow)
			v.fade = fadeOf(v.track, lastNow)
			if (v.fade <= 0 && lastNow - v.track.lastTs > FADED_DROP_MS) {
				drop(v)
				continue
			}
			if (!v.p || v.fade <= 0) continue
			if (v.kind === 'splat') splats.push({ w: v.w, order: v.order })
			else list.push({ w: v.w, kind: v.kind, x: v.p.x, z: v.p.z })
		}
		const want = pickDrawn(list, cam, tier.cap)
		const wantSplat = pickSplats(splats)
		drawn = 0
		for (const v of map.values()) {
			try {
				if (v.kind === 'splat') {
					drawSplat(v, !!v.p && v.fade > 0 && wantSplat.has(v.w))
					continue
				}
				if (!v.p || v.fade <= 0 || !want.has(v.w)) {
					v.holder.visible = false
					shadowFor(v, false)
					continue
				}
				if (drawOne(v, lastNow, dt)) drawn++
			} catch {
				v.holder.visible = false
				if ((v.broken || 0) < 2) breakHandle(v)
			}
		}
	}

	function hSpeed(track) {
		const sn = track.snaps
		const n = sn.length
		if (n < 2) return 0
		const a = sn[n - 2]
		const b = sn[n - 1]
		const dt = (b.ts - a.ts) / 1000
		return dt > 0 && dt < 2 ? Math.hypot(b.x - a.x, b.z - a.z) / dt : 0
	}

	return {
		group: root,
		ingest,
		update,
		effect,
		setQuality(q) {
			tier = tierOf(q, view)
			for (const v of map.values()) {
				if (!v.handle) continue
				try {
					v.handle.setTags(tagsFor(v.kind, tier, tagsOn, v.n))
					v.handle.setQuality(tier.q)
				} catch {
					/* ignore */
				}
			}
			return wqOf(tier.q)
		},
		/** The `{ t: 'wq', n }` of the current tier (send it when the world turns on). */
		wq: () => wqOf(tier.q),
		/**
		 * Live slick patches (§6 R2) [{ x, y, z, r, until (server ms) }] — the newest data, not the drawn delay.
		 * WO-1106 A4: only patches with until > now; now = the server ms given (optional), else the last update()'s
		 * serverNow — a patch the hub never sent `gone` for (a reconnect) stops slowing that spot after its 8 s.
		 */
		patches(now) {
			const t = Number.isFinite(now) ? now : lastNow
			const out = []
			for (const v of map.values()) {
				if (v.kind !== 'splat') continue
				const s = v.track.snaps[v.track.snaps.length - 1]
				const pt = s && patchOf({ p: { x: s.x, y: s.y, z: s.z }, s: v.s, f: s.f, firstTs: v.track.firstTs })
				if (pt && pt.until > t) out.push(pt)
			}
			return out
		},
		/** Live visitor entities (every kind, splats included). */
		count: () => map.size,
		info: () => ({ on: !!wst, live: map.size, drawn, standIns: [...map.values()].filter((v) => v.handle?.standIn).length, cap: tier.cap, quality: tier.q, loading: props.pending(), kinds: Object.fromEntries(['car', 'soldier', 'veg', 'sling', 'av', 'splat'].map((k) => [k, props.state(k)])) }),
		dispose() {
			clear()
			root.removeFromParent()
			kit.dispose()
		},
	}
}
