'use strict'

/**
 * WO-1074 §2.6 — the live lighting state in the RC game world (work/notes/rc-game-contract.md "2.6"). Reads what the
 * previs reads (src/fixtures/follow-service.js: the normalised patch `engine.fixtures` and `visual()` — axes + beams
 * decoded from the DMX the heads get) and turns it into one entry per head: a beam direction in the Godot frame
 * (rc-lights-fk.js, the previs's own forward kinematics), colour, intensity, zoom.
 *
 *   list()            → [{ i, id, name, p: [x, y, z], kind }] (≤ 150) — the scene JSON's `lights`
 *   attach(ws)        a game socket: gets `lxfull` now (while on); the 10 Hz producer runs while ≥ 1 socket is attached
 *   detach(ws)        socket closed; the last one stops the timer (nothing runs while nobody is connected)
 *   setOn(on) / isOn  the host switch: on → `lxfull` to everyone; off → `{ t: 'lxfull', on: false, f: [] }`, timer stops
 *   stop()            the game was disabled: forget every socket, stop the timer
 *
 * Messages (sent through deps.send(ws, msg), the game's JSON sender — one object per broadcast, so it is stringified once):
 *   { t: 'lxfull', ts, on: true, rev, lights: list(), f: [[i, dx, dy, dz, r, g, b, a, zoomDeg], …] }   every light
 *   { t: 'lx', ts, f: [[i, …], …] }   only the lights whose entry changed since the last broadcast; ≤ 10 / s; none idle
 * `lights` rides along on every lxfull (the patch can change while the scene JSON stays cached); `rev` names it.
 * Never touches Caspar, DMX output or the patch: read-only on the follow service.
 */

const { core } = require('./host')
const crypto = require('crypto')
const { lightOf, headFrame } = require('./rc-lights-fk')

const MAX_LIGHTS = 150
const HZ = 10

/**
 * @param {{ fixtures: () => any[] | null, visual: () => ({ fixtures: any[] } | null), rigOf: (typeId: string, mode: string) => any,
 *   typeName?: (typeId: string) => string, send: (ws: any, msg: object) => void, now?: () => number,
 *   setInterval?: Function, clearInterval?: Function, log?: Function, hz?: number }} deps
 */
function createRcLights(deps) {
	const now = deps.now || Date.now
	const every = deps.setInterval || setInterval
	const stopEvery = deps.clearInterval || clearInterval
	const log = deps.log || (() => {})
	const hz = Math.max(1, Math.min(HZ, Number(deps.hz) || HZ))
	const subs = new Set()
	let on = true
	let timer = null
	let fixturesRef = null
	let listKey = ''
	let rev = ''
	let lights = [] // [{ i, id, name, p, kind, rig, pose }]
	let baseline = new Map() // i → last broadcast entry (JSON)
	const memo = new Map() // i → { key: visual record JSON, entry }

	function safe(fn, fallback) {
		try {
			return fn()
		} catch (e) {
			log('warn', `[rc-lights] ${e?.message || e}`)
			return fallback
		}
	}

	/** Rebuild the static list when the patch changed. → true when it did. */
	function refreshList() {
		const fxs = safe(() => deps.fixtures(), null) || []
		if (fxs === fixturesRef && lights.length) return false
		fixturesRef = fxs
		const typed = fxs.filter((f) => f && f.enabled !== false && /^[0-9a-f]{12}$/.test(String(f.typeId || '')) && f.mode)
		const key = JSON.stringify(typed.map((f) => [f.id, f.name, f.typeId, f.mode, f.pose]))
		if (key === listKey) return false
		listKey = key
		const out = []
		for (const fx of typed) {
			if (out.length >= MAX_LIGHTS) break
			const rig = safe(() => deps.rigOf(fx.typeId, fx.mode), null)
			if (!rig || !Array.isArray(rig.nodes) || !rig.nodes.some((n) => n?.kind === 'Beam')) continue
			const typeName = safe(() => (deps.typeName ? deps.typeName(fx.typeId) : ''), '') || ''
			out.push({ i: out.length, ...lightOf(fx, rig, typeName), rig, pose: fx.pose })
		}
		lights = out
		rev = crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)
		baseline = new Map()
		memo.clear()
		if (typed.length > MAX_LIGHTS)
			log('info', `[rc-lights] ${typed.length} typed fixtures, the game shows the first ${MAX_LIGHTS}`)
		return true
	}

	const publicList = () => lights.map(({ i, id, name, p, kind }) => ({ i, id, name, p, kind }))

	/** Every light's current entry → Map(i → [i, …]). A head visual() does not list (problem, not output) is dark. */
	function frame() {
		const vis = safe(() => deps.visual(), null)
		const byId = new Map((Array.isArray(vis?.fixtures) ? vis.fixtures : []).map((v) => [String(v.id), v]))
		const out = new Map()
		for (const l of lights) {
			const v = byId.get(l.id) || null
			const key = v ? JSON.stringify([v.axes, v.beams]) : ''
			const m = memo.get(l.i)
			let entry
			if (m && m.key === key) entry = m.entry
			else {
				entry = [l.i, ...headFrame(l.rig, l.pose, v)]
				memo.set(l.i, { key, entry })
			}
			out.set(l.i, entry)
		}
		return out
	}

	function broadcast(msg) {
		for (const ws of subs) deps.send(ws, msg)
	}

	function fullMsg(f) {
		return { t: 'lxfull', ts: now(), on: true, rev, lights: publicList(), f: [...f.values()] }
	}

	/** The baseline becomes `f` (what everyone was just sent). */
	const setBaseline = (f) => {
		baseline = new Map([...f].map(([i, e]) => [i, JSON.stringify(e)]))
	}

	function tick() {
		if (!on || !subs.size) return
		if (refreshList()) {
			const f = frame()
			setBaseline(f)
			return broadcast(fullMsg(f))
		}
		const f = frame()
		const changed = []
		for (const [i, e] of f) {
			const s = JSON.stringify(e)
			if (baseline.get(i) !== s) {
				changed.push(e)
				baseline.set(i, s)
			}
		}
		if (changed.length) broadcast({ t: 'lx', ts: now(), f: changed })
	}

	function startTimer() {
		if (timer || !on || !subs.size) return
		timer = every(tick, Math.round(1000 / hz))
		if (timer && typeof timer.unref === 'function') timer.unref()
	}

	function stopTimer() {
		if (timer) stopEvery(timer)
		timer = null
	}

	return {
		list() {
			refreshList()
			return publicList()
		},
		attach(ws) {
			subs.add(ws)
			if (!on) return
			refreshList()
			const f = frame()
			if (!baseline.size) setBaseline(f)
			// the newcomer gets the current state; the shared baseline stays the last broadcast (others need those deltas)
			deps.send(ws, fullMsg(f))
			startTimer()
		},
		detach(ws) {
			subs.delete(ws)
			if (!subs.size) stopTimer()
		},
		setOn(v) {
			const want = v !== false
			if (want === on) return
			on = want
			if (!on) {
				stopTimer()
				return broadcast({ t: 'lxfull', ts: now(), on: false, rev, f: [] })
			}
			refreshList()
			const f = frame()
			setBaseline(f)
			broadcast(fullMsg(f))
			startTimer()
		},
		isOn: () => on,
		/**
		 * WO-1102 Game World (spotlight bonus): the pools the lit beams (intensity ≥ 0.3, pointing down) make on a floor at
		 * height y — [{ x, z, y, r }] (r = the beam's radius there from its zoom), ≤ 64; [] while off.
		 */
		pools(y) {
			if (!on || !Number.isFinite(y)) return []
			refreshList()
			const at = new Map(publicList().map((l) => [l.i, l.p]))
			const out = []
			for (const [i, dx, dy, dz, , , , a, zoom] of frame().values()) {
				const p = at.get(i)
				if (!p || !(a >= 0.3) || !(dy < -0.2)) continue
				const k = (p[1] - y) / -dy
				if (!(k > 0 && k < 40)) continue
				out.push({ x: p[0] + dx * k, z: p[2] + dz * k, y, r: Math.max(0.15, k * Math.tan(((zoom || 20) * Math.PI) / 360)) })
				if (out.length >= 64) break
			}
			return out
		},
		stop() {
			subs.clear()
			stopTimer()
		},
		/** Smokes / probes. */
		tick,
		subscribers: () => subs.size,
		running: () => !!timer,
	}
}

/**
 * The production deps for the running server (ctx = the app context). The follow service is `ctx.fixtureService`
 * (src/tracking/register.js); while it is not running (tracking module off) the list comes from the project's patch
 * and every light stays dark.
 */
function rcLightsDeps(ctx, { send, log } = {}) {
	const store = core('src/fixtures/gdtf-store')
	let fallback = { at: 0, list: null }
	const fromProject = () => {
		if (Date.now() - fallback.at < 2000) return fallback.list
		let list
		try {
			const project = core('src/engine/project-scenes').loadFullProject()
			list = core('src/fixtures/follow-patch').normalizePatch(project?.fixtures).fixtures
		} catch {
			list = []
		}
		fallback = { at: Date.now(), list }
		return list
	}
	return {
		fixtures: () => ctx?.fixtureService?.engine?.fixtures || fromProject(),
		visual: () => (ctx?.fixtureService?.visual ? ctx.fixtureService.visual() : null),
		rigOf: (typeId, mode) => store.visual(typeId, mode)?.rig || null,
		typeName: (typeId) => store.info(typeId)?.name || '',
		send,
		log: log || ((level, msg) => (typeof ctx?.log === 'function' ? ctx.log(level, msg) : undefined)),
	}
}

/**
 * The scene JSON text (the baker's cached `out.text`) with the live additions — `lights` and `screens` — spliced in, so
 * the cached bake (whose rev does not cover the patch) stays untouched. → JSON text.
 */
function withLiveScene(text, { lights = [], screens = [] } = {}) {
	const s = String(text || '').trimEnd()
	if (!s.endsWith('}')) return s
	const head = s.slice(0, -1).trimEnd()
	const sep = head.endsWith('{') ? '' : ','
	return `${head}${sep}"lights":${JSON.stringify(lights)},"screens":${JSON.stringify(screens)}}`
}

module.exports = { createRcLights, rcLightsDeps, withLiveScene, MAX_LIGHTS }
