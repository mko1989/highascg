/**
 * WO-1074 §2.6 — the live show inside the RC game world: the rig's beams / floor pools / lens glows and the LED walls'
 * pictures (work/notes/rc-game-contract.md "2.6"; wiring: work/notes/rc-game-live-wiring.md).
 *
 *   const fx = createStageFx({ THREE, scene, send, quality, onHouse })   once, as soon as the world exists (before the scene loads:
 *                                                              `lxfull` arrives right after the socket opens)
 *   fx.load(sceneJson)          a scene was (re)loaded: floors, `lights`, `screens`, `heads` (WO-1090: the patched heads'
 *                               own models in the scene GLB turn with their beams — head-follow.js)
 *   fx.onMessage(m)             every decoded JSON message; → true when it was ours (`lx`, `lxfull`) — it also peeks at
 *                               `welcome` / `state` (host switches `lights` / `wall`; `house` (a level 0..1) → onHouse(level), WO-1099:
 *                               the game's world.setHouse) and returns false for them
 *   fx.onBinary(data)           every binary socket message (ArrayBuffer or Blob) → true when it was a wall picture
 *   fx.update(dt)               every rendered frame (seconds since the last)
 *   fx.setQuality('low'|'high') low = pools and lens glows only (no cones)
 *   fx.setEnabled(on)           hide everything and stop asking for pictures (e.g. the player's own toggle / tab hidden)
 *   fx.dispose()
 * Pictures are asked for with send({ t: 'video', on }) whenever that changes and again after every `welcome` (a new
 * socket has no subscription). Nothing but /api/game/rc/* is ever contacted — frames come through the game socket.
 */
import { parseEntry, parseFrame, smoothK, stepLight } from './stage-fx-math.js'
import { createBeamMeshes } from './stage-fx-beams.js'
import { createWall } from './stage-fx-wall.js'
import { createHeadFollow } from './head-follow.js'

const MAX_LIGHTS = 150

/**
 * @param {{ THREE: typeof import('three'), scene: any, send?: (m: object) => any, quality?: 'low'|'high',
 *   createImageBitmap?: Function, Blob?: any, onHouse?: (level: number) => void }} o
 */
export function createStageFx(o) {
	const { THREE } = o
	const send = typeof o.send === 'function' ? o.send : () => false
	const root = new THREE.Group()
	root.name = 'stage-fx'
	o.scene.add(root)
	const beams = createBeamMeshes(THREE, MAX_LIGHTS)
	const wall = createWall(THREE, { createImageBitmap: o.createImageBitmap, Blob: o.Blob })
	const follow = createHeadFollow(THREE, o.scene)
	root.add(beams.group)
	root.add(wall.group)
	let lights = [] // [{ i, p, kind, cur, tgt, moving }]
	let byIndex = new Map()
	let enabled = true
	let lightsOn = true
	let wallOn = true
	let videoAsked = null // what we last sent (null = nothing yet on this socket)
	let disposed = false
	const pendingEntries = new Map() // entries that arrived before their light list

	function setLights(list) {
		const next = []
		for (const l of Array.isArray(list) ? list : []) {
			if (next.length >= MAX_LIGHTS) break
			if (!l || !Number.isInteger(l.i) || !Array.isArray(l.p) || l.p.length !== 3) continue
			const old = byIndex.get(l.i)
			const keep = old && old.id === l.id
			next.push({
				i: l.i,
				id: l.id,
				p: l.p.map(Number),
				kind: String(l.kind || 'wash'),
				cur: keep ? old.cur : { d: [0, -1, 0], c: [1, 1, 1], a: 0, z: 25 },
				tgt: keep ? old.tgt : { d: [0, -1, 0], c: [1, 1, 1], a: 0, z: 25 },
				moving: true,
			})
		}
		// instance slot = list position; the server numbers i 0…n−1 in order
		lights = next
		byIndex = new Map(next.map((l) => [l.i, l]))
		beams.setCount(next.length)
		for (const [i, e] of pendingEntries) if (byIndex.has(i)) applyEntry(e)
		pendingEntries.clear()
	}

	function applyEntry(e) {
		const l = byIndex.get(e.i)
		if (!l) {
			if (pendingEntries.size < MAX_LIGHTS) pendingEntries.set(e.i, e)
			return
		}
		l.tgt = { d: e.d, c: e.c, a: lightsOn ? e.a : 0, z: e.z }
		l.moving = true
	}

	function syncVideo(force = false) {
		const want = enabled && wallOn && wall.wanted().length > 0
		if (!force && want === videoAsked) return
		if (!want && videoAsked === null && !force) return
		if (send({ t: 'video', on: want }) !== false) videoAsked = want
	}

	function applySwitches(state, sync = true) {
		if (!state || typeof state !== 'object') return sync && syncVideo()
		if (typeof state.lights === 'boolean' && state.lights !== lightsOn) {
			lightsOn = state.lights
			if (!lightsOn) for (const l of lights) ((l.tgt = { ...l.tgt, a: 0 }), (l.moving = true))
		}
		if (typeof state.house === 'number' || typeof state.house === 'boolean') o.onHouse?.(typeof state.house === 'boolean' ? (state.house ? 1 : 0) : state.house) // WO-1099 house lights (world.setHouse)
		if (typeof state.wall === 'boolean' && state.wall !== wallOn) {
			wallOn = state.wall
			wall.setVisible(enabled && wallOn)
		}
		if (sync) syncVideo()
	}

	function onMessage(m) {
		if (disposed || !m || typeof m !== 'object') return false
		if (m.t === 'lxfull') {
			if (m.on === false) {
				lightsOn = false
				for (const l of lights) ((l.tgt = { ...l.tgt, a: 0 }), (l.moving = true))
				return true
			}
			lightsOn = true
			if (Array.isArray(m.lights)) setLights(m.lights)
			for (const raw of Array.isArray(m.f) ? m.f : []) {
				const e = parseEntry(raw)
				if (e) applyEntry(e)
			}
			return true
		}
		if (m.t === 'lx') {
			for (const raw of Array.isArray(m.f) ? m.f : []) {
				const e = parseEntry(raw)
				if (e) applyEntry(e)
			}
			return true
		}
		if (m.t === 'welcome') {
			videoAsked = null // a fresh socket: the server has no subscription for it yet
			applySwitches(m.state, false)
			syncVideo(true)
		} else if (m.t === 'state') applySwitches(m.state)
		return false
	}

	function onBinary(data) {
		if (disposed || !enabled || !wallOn) return false
		if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
			const f = parseFrame(data)
			return f ? wall.onFrame(f.role, f.jpeg) : false
		}
		const BlobCtor = o.Blob || globalThis.Blob
		if (BlobCtor && data instanceof BlobCtor) {
			// binaryType 'blob': read the small header, hand the rest over without copying it into JS
			data
				.slice(0, 33)
				.arrayBuffer()
				.then((ab) => {
					const u8 = new Uint8Array(ab)
					const n = u8[0]
					if (!(n >= 1 && n <= 32) || u8.length < 1 + n) return
					let role = ''
					for (let k = 1; k <= n; k++) role += String.fromCharCode(u8[k])
					wall.onFrame(role, data.slice(1 + n, data.size, 'image/jpeg'))
				})
				.catch(() => {})
			return true
		}
		return false
	}

	function update(dt) {
		if (disposed || !enabled) return
		const k = smoothK(Math.min(0.25, Math.max(0, dt || 0)))
		let dirty = false
		follow.tick(Date.now())
		for (let slot = 0; slot < lights.length; slot++) {
			const l = lights[slot]
			if (!l.moving) continue
			l.moving = stepLight(l.cur, l.tgt, k)
			beams.write(slot, l, l.cur)
			follow.turn(l.id, l.cur.d)
			dirty = true
		}
		if (dirty) beams.flush()
	}

	return {
		group: root,
		load(sceneJson) {
			if (disposed) return
			const s = sceneJson && typeof sceneJson === 'object' ? sceneJson : {}
			beams.setFloors(s.floors)
			if (Array.isArray(s.lights) && (!lights.length || s.lights.length !== lights.length)) setLights(s.lights)
			follow.load(s.heads)
			for (const l of lights) l.moving = true // floors changed: recompute lengths and pools
			wall.load(s.screens)
			wall.setVisible(enabled && wallOn)
			syncVideo()
		},
		onMessage,
		onBinary,
		update,
		setQuality(q) {
			beams.setQuality(q === 'low' ? 'low' : 'high')
		},
		setEnabled(on) {
			enabled = !!on
			root.visible = enabled
			wall.setVisible(enabled && wallOn)
			if (enabled) for (const l of lights) l.moving = true
			syncVideo()
		},
		dispose() {
			if (disposed) return
			if (videoAsked) send({ t: 'video', on: false })
			disposed = true
			beams.dispose()
			wall.dispose()
			root.removeFromParent()
		},
		/** Probes / smokes. */
		stats: () => ({
			lights: lights.length,
			lit: lights.filter((l) => l.cur.a > 0.002).length,
			video: videoAsked,
			wall: wall.stats(),
			heads: follow.stats(),
		}),
	}
}
