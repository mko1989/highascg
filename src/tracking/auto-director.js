'use strict'

/**
 * WO-708 / WO-709 — the Auto director: Follow → Auto for several people (owner 23.10.26: "more than one presenter on
 * auto it should split the lights so they follow half front lights one presenter the other the second and so on";
 * "after a while with no person detected the fronts should reset to a home position which is lighting the stage
 * evenly"). Generalises WO-707 (auto-follow.js), whose single marker is A1 here.
 *
 * Pool = the heads whose follow is AUTO_MARKER_ID (64999). Each followed person is a LANE: one hub marker driven by
 * its own createAutoFollow (a replace DetectPin fed only that person: same pick, smoothing and floor-cast). Pinned
 * persons (slot k, operator) drive Pin k = PIN_BASE + k (64981…64989); up to AUTO_MAX unpinned persons drive A1…A9 =
 * 64999…64991, compacted so A1 is always the first. A marker exists only while its lane does.
 *   join    — the first person is followed at once (WO-707); with someone already followed, a newcomer must be seen
 *             for JOIN_S first, so a one-frame false detection never re-splits the rig.
 *   lost    — a lane whose person is gone holds (status 0) for LOST_S; a new person seen near where it was lost (the
 *             DetectPin re-acquire gates, same camera) inherits the lane — and its pin — instead (a track id churn
 *             is not a new person); after LOST_S the lane drops and a pin frees its key (the slot keeps its settings).
 *   split   — auto-split.js splitHeads, recomputed only when the signature changes (lanes, slot head counts, pool
 *             ids), never on position jitter. Heads map to a lane id, so a marker change (compaction) moves no head.
 *   home    — nobody seen for after_s (detection on), or POST home {now:true} until the next person (someone not in
 *             view when it was pressed): every pool head aims at its homeAssign point (target.home → engine state
 *             'home'). Any person seen leaves the timed home at once.
 * resolveAuto(fx, marks) is the follow engine's hook (follow-engine.js tick); ptzTargetOf(camId) is WO-711's.
 */

const { createAutoFollow, AUTO_MARKER_ID, AUTO_NAME } = require('./auto-follow')
const { REACQUIRE_MAX_CENTER_DIST, REACQUIRE_MAX_FLOOR_M } = require('./detect-pin')
const { boxPoint } = require('./detect-model')
const { splitHeads, homeAssign, normalizeGrid } = require('./auto-split')
const store = require('./auto-store')

const AUTO_MAX = 9
const PIN_BASE = 64980 // Pin k = 64980 + k
const LOST_S = 3
const JOIN_S = 0.4
const KEY_RE = /^\S+:\d+$/

const autoMarker = (i) => AUTO_MARKER_ID - i
const autoName = (i) => (i === 0 ? AUTO_NAME : `${AUTO_NAME} ${i + 1}`)
const centreOf = (p) => (p.world ? p.world : [(p.box[0] + p.box[2]) / 2, (p.box[1] + p.box[3]) / 2])
const sizeOf = (p) => (p.world ? Number(p.area) || 0 : (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]))
const r2 = (v) => Math.round(v * 100) / 100

/**
 * @param {{ file?: string, ptz?: { cameras(): object[], status(): object }, names?: () => { person?: string, name: string }[] }} [deps]
 */
function createAutoDirector(deps = {}) {
	const file = deps.file || store.autoFile()
	let settings = store.loadSettings(file)
	let ptz = deps.ptz || null
	const names = typeof deps.names === 'function' ? deps.names : () => []
	const slotKeys = new Array(store.SLOTS).fill(null) // pins: in memory only
	const slotLost = new Array(store.SLOTS).fill(null)
	let lanes = [] // { uid, key, marker, slot, follow, lostAt, pos, centre, camera }
	let uidSeq = 0
	let live = [] // persons seen now (coast included)
	const firstSeen = new Map()
	let pool = []
	let assignment = new Map() // fixture id → lane uid
	let sig = ''
	let homeMap = new Map()
	let homeSig = ''
	let grid = normalizeGrid(null)
	let lastSeen = null
	let forced = false
	let forcedExcept = new Set() // keys in view when home was forced: only someone else ends it
	let homeActive = false
	let idleS = 0
	let wanted = false
	let detecting = false
	let hub = null
	let planeZ = 0

	const posOf = (p) => {
		if (p.world) return [p.world[0], p.world[1]]
		const w = boxPoint(p.box, p.camEntry, planeZ, false)
		return w ? [w[0], w[1]] : null
	}
	const ptzCams = () => {
		try {
			return (ptz && ptz.cameras()) || []
		} catch (_) {
			return []
		}
	}
	const homeNow = () => wanted && (forced || (detecting && !live.length && idleS >= settings.after_s))
	const slotOfCam = (id) => settings.slots.findIndex((s) => s.ptz.includes(id)) + 1
	const ptzWanted = () => ptzCams().some((c) => c.enabled !== false && (c.auto || slotOfCam(c.id) > 0))

	function newLane(key, marker, slot, p) {
		const i = AUTO_MARKER_ID - marker
		const name = slot ? `Pin ${slot}` : autoName(i)
		const l = { uid: ++uidSeq, key, marker, slot, follow: createAutoFollow({ id: marker, name }), lostAt: null }
		Object.assign(l, { pos: p ? posOf(p) : null, centre: p ? centreOf(p) : null, camera: p?.camera ?? null })
		return l
	}

	function dropLane(l, ctx) {
		l.follow.step({ ...ctx, wanted: false })
	}

	/** Lost / found / re-acquired bookkeeping for lanes and pins (also while nothing follows Auto: pins expire). */
	function track(now) {
		const byKey = new Map(live.map((p) => [p.key, p]))
		for (const l of lanes) {
			const p = byKey.get(l.key)
			if (p) {
				l.lostAt = null
				l.camera = p.camera
				l.centre = centreOf(p)
				l.pos = posOf(p) || l.pos
			} else if (l.lostAt === null) l.lostAt = now
		}
		const claimed = new Set([...lanes.map((l) => l.key), ...slotKeys.filter(Boolean)])
		for (const l of lanes) {
			if (l.lostAt === null || !l.centre) continue
			let best = null
			let bd = (l.camera === 'world' ? REACQUIRE_MAX_FLOOR_M : REACQUIRE_MAX_CENTER_DIST) ** 2
			for (const p of live) {
				if (claimed.has(p.key) || p.camera !== l.camera || p.age_s > 0) continue
				const c = centreOf(p)
				const d = (c[0] - l.centre[0]) ** 2 + (c[1] - l.centre[1]) ** 2
				if (d <= bd) [bd, best] = [d, p]
			}
			if (!best) continue
			if (l.slot && slotKeys[l.slot - 1] === l.key) slotKeys[l.slot - 1] = best.key
			Object.assign(l, { key: best.key, lostAt: null, centre: centreOf(best), pos: posOf(best) || l.pos })
			claimed.add(best.key)
		}
		for (let k = 0; k < store.SLOTS; k++) {
			if (!slotKeys[k]) continue
			if (byKey.has(slotKeys[k])) slotLost[k] = null
			else if (slotLost[k] === null) slotLost[k] = now
			else if (now - slotLost[k] >= LOST_S * 1000) [slotKeys[k], slotLost[k]] = [null, null]
		}
	}

	/** The lanes wanted now: pinned slots in slot order, then up to AUTO_MAX unpinned (existing first, A1 first). */
	function layout(now, ctx) {
		const byKey = new Map(live.map((p) => [p.key, p]))
		const alive = lanes.filter((l) => l.lostAt === null || now - l.lostAt < LOST_S * 1000)
		for (const l of lanes) if (!alive.includes(l)) dropLane(l, ctx)
		const laneOf = new Map(alive.map((l) => [l.key, l]))
		const want = []
		slotKeys.forEach((key, k) => {
			if (key && (byKey.has(key) || laneOf.has(key))) want.push({ key, slot: k + 1, marker: PIN_BASE + k + 1 })
		})
		const pinned = new Set(want.map((w) => w.key))
		const unpinned = alive
			.filter((l) => !pinned.has(l.key))
			.sort((a, b) => (a.slot ? 1 : 0) - (b.slot ? 1 : 0) || b.marker - a.marker)
		const keys = unpinned.map((l) => l.key)
		const first = alive.length === 0
		const fresh = live
			.filter((p) => !pinned.has(p.key) && !laneOf.has(p.key) && firstSeen.has(p.key))
			.filter((p) => first || now - firstSeen.get(p.key) >= JOIN_S * 1000)
			.sort((a, b) => sizeOf(b) - sizeOf(a))
		for (const p of fresh) keys.push(p.key)
		keys.slice(0, AUTO_MAX).forEach((key, i) => want.push({ key, slot: 0, marker: autoMarker(i) }))
		const next = []
		for (const w of want) {
			const old = laneOf.get(w.key)
			laneOf.delete(w.key)
			if (old && old.marker === w.marker) {
				old.slot = w.slot
				next.push(old)
				continue
			}
			const l = newLane(w.key, w.marker, w.slot, byKey.get(w.key))
			if (old) {
				dropLane(old, ctx)
				Object.assign(l, { uid: old.uid, pos: l.pos || old.pos, lostAt: old.lostAt, centre: l.centre || old.centre })
				l.camera = l.camera ?? old.camera
			}
			next.push(l)
		}
		for (const l of laneOf.values()) dropLane(l, ctx)
		lanes = next
	}

	function resplit() {
		const heads = (l) => (l.slot ? settings.slots[l.slot - 1].heads : 0)
		const s = JSON.stringify([lanes.map((l) => [l.uid, l.slot, heads(l)]), pool.map((f) => f.id)])
		if (s === sig) return
		sig = s
		// lanes are keyed by uid (not marker): a compaction that renumbers a marker moves no head
		assignment = splitHeads({
			pool,
			lanes: lanes.map((l) => ({ marker: l.uid, slot: l.slot, heads: heads(l), pos: l.pos })),
			prev: assignment,
		})
	}

	/**
	 * One animate tick (register.js pinTick): persons as the operator pin gets them; fixtures = the follow engine's patch.
	 * @param {{ cfg: object, available: boolean, persons: object[], hub: object, planeZ: number, now: number, dt: number, fixtures: object[] }} o
	 */
	function step({ cfg, available, persons, hub: h, planeZ: z, now, dt, fixtures }) {
		hub = h
		planeZ = Number(z) || 0
		pool = (fixtures || []).filter((f) => f.follow === AUTO_MARKER_ID)
		const coastS = Math.max(cfg.grace_ms, cfg.interval_ms) / 1000
		live = cfg.enabled && available ? (persons || []).filter((p) => p.age_s <= coastS) : []
		for (const k of [...firstSeen.keys()]) if (!live.some((p) => p.key === k)) firstSeen.delete(k)
		for (const p of live) if (!firstSeen.has(p.key) && p.age_s <= 0) firstSeen.set(p.key, now)
		if (live.length || !cfg.enabled || lastSeen === null) lastSeen = now
		if (live.some((p) => !forcedExcept.has(p.key))) forced = false
		idleS = (now - lastSeen) / 1000
		wanted = pool.length > 0 || ptzWanted()
		detecting = !!cfg.enabled
		const ctx = { cfg, available, hub, planeZ, now, dt }
		track(now)
		if (wanted && cfg.enabled) layout(now, ctx)
		else {
			for (const l of lanes) dropLane(l, ctx)
			lanes = []
		}
		for (const l of lanes)
			l.follow.step({ ...ctx, wanted: true, persons: (persons || []).filter((p) => p.key === l.key) })
		resplit()
		homeActive = homeNow()
		const hs = JSON.stringify([pool.map((f) => [f.id, f.pose?.x, f.pose?.y]), grid])
		if (hs !== homeSig) [homeSig, homeMap] = [hs, homeAssign(pool, grid)]
	}

	/** Follow-engine hook: where Auto head fx aims now — its lane's marker, its home point, or null (hold). */
	function resolveAuto(fx, marks) {
		if (homeActive) {
			const p = homeMap.get(fx.id)
			if (p) return { x: p.x, y: p.y, z: p.z, status: 1, stale: false, home: true }
		}
		const uid = assignment.get(fx.id)
		const lane = uid === undefined ? null : lanes.find((l) => l.uid === uid)
		return lane ? marks.get(lane.marker) || null : null
	}

	const markerPos = (l) => {
		const m = l && l.lostAt === null ? hub?.markers.get(l.marker) : null
		return m ? { x: m.x, y: m.y, z: m.z } : null
	}
	/** The lane camera camId follows: its slot's person, else (auto) A1. */
	const ptzLane = (camId) => {
		const k = slotOfCam(camId)
		if (k) return lanes.find((l) => l.slot === k) || null
		return ptzCams().find((c) => c.id === camId)?.auto ? lanes.find((l) => l.marker === AUTO_MARKER_ID) || null : null
	}

	/** WO-711: { x, y, z } (aim here) | 'home' | null (leave the camera where it is). */
	function ptzTargetOf(camId) {
		const p = markerPos(ptzLane(camId))
		if (p) return p
		const managed = slotOfCam(camId) > 0 || !!ptzCams().find((c) => c.id === camId)?.auto
		return managed && homeActive ? 'home' : null
	}

	function attached() {
		return Object.assign({}, ...lanes.map((l) => l.follow.attached()))
	}

	/** GET /api/tracking/auto and WS tracking:auto (positions to cm, idle to whole seconds: it changes only on change). */
	function snapshot() {
		const nameOf = new Map(
			names()
				.filter((p) => p.person)
				.map((p) => [p.person, p.name])
		)
		const camIds = [...new Set([...settings.slots.flatMap((s) => s.ptz), ...ptzCams().map((c) => c.id)])]
		const view = (key, lane, p) => {
			const at = lane ? hub?.markers.get(lane.marker) : null
			const xy = at ? [at.x, at.y] : p ? posOf(p) : lane?.pos
			const o = {
				key,
				marker: lane ? lane.marker : 0,
				slot: slotKeys.indexOf(key) + 1,
				x: xy ? r2(xy[0]) : null,
				y: xy ? r2(xy[1]) : null,
			}
			if (nameOf.has(key)) o.name = nameOf.get(key)
			o.heads = lane && !homeActive ? pool.filter((f) => assignment.get(f.id) === lane.uid).map((f) => f.id) : []
			o.ptz = lane ? camIds.filter((c) => ptzLane(c) === lane) : []
			o.lost = !!lane && lane.lostAt !== null
			return o
		}
		const laneOf = new Map(lanes.map((l) => [l.key, l]))
		const persons = live.map((p) => view(p.key, laneOf.get(p.key), p))
		for (const l of lanes) if (!live.some((p) => p.key === l.key)) persons.push(view(l.key, l, null))
		const st = (() => {
			try {
				const s = ptz?.status()
				return Array.isArray(s) ? s : s?.cameras || []
			} catch (_) {
				return []
			}
		})()
		return {
			pool: pool.map((f) => f.id),
			primary: AUTO_MARKER_ID,
			persons,
			slots: settings.slots.map((s, k) => ({ slot: k + 1, key: slotKeys[k], heads: s.heads, ptz: s.ptz.slice() })),
			home: { active: homeActive, after_s: settings.after_s, idle_s: Math.floor(idleS), forced },
			ptz: ptzCams().map((c) => ({
				id: c.id,
				name: c.name,
				enabled: c.enabled !== false,
				state: st.find((q) => q.id === c.id)?.state ?? null,
			})),
		}
	}

	const ok = () => ({ status: 200, body: snapshot() })
	const bad = (error, status = 400) => ({ status, body: { error } })
	const save = () => store.saveSettings(settings, file)

	/** POST /api/tracking/auto/pin { key, slot }: slot 1–9 binds (moving the key / the slot's previous key), 0 unpins. */
	function pin(data) {
		const slot = data?.slot
		const key = String(data?.key ?? '')
		if (!Number.isInteger(slot) || slot < 0 || slot > store.SLOTS) return bad('slot must be an integer 0..9')
		if (!KEY_RE.test(key)) return bad('key must be camera:tid or w:<id>')
		const at = slotKeys.indexOf(key)
		if (slot === 0) {
			if (at >= 0) [slotKeys[at], slotLost[at]] = [null, null]
			return ok()
		}
		if (!live.some((p) => p.key === key) && !lanes.some((l) => l.key === key))
			return bad(`no detected person ${key} right now`, 404)
		if (at >= 0) [slotKeys[at], slotLost[at]] = [null, null]
		slotKeys[slot - 1] = key
		slotLost[slot - 1] = null
		return ok()
	}

	/** POST /api/tracking/auto/slot { slot, heads?, ptz? }: heads 0 (share) … pool size; a camera is in one slot. */
	function slot(data) {
		const k = data?.slot
		if (!Number.isInteger(k) || k < 1 || k > store.SLOTS) return bad('slot must be an integer 1..9')
		const heads = data.heads
		if (heads !== undefined && !(Number.isInteger(heads) && heads >= 0 && heads <= pool.length)) {
			return bad(`heads must be an integer 0..${pool.length} (the Auto pool)`)
		}
		let cams = null
		if (data.ptz !== undefined) {
			if (!Array.isArray(data.ptz) || !data.ptz.every((c) => typeof c === 'string' && store.CAM_RE.test(c)))
				return bad('ptz must be an array of camera ids')
			const known = ptzCams().map((c) => c.id)
			const unknown = ptz ? data.ptz.filter((c) => !known.includes(c)) : []
			if (unknown.length) return bad(`unknown PTZ camera ${unknown.join(', ')}`)
			cams = [...new Set(data.ptz)]
		}
		const next = settings.slots.map((s) => ({
			heads: s.heads,
			ptz: cams ? s.ptz.filter((c) => !cams.includes(c)) : s.ptz.slice(),
		}))
		if (heads !== undefined) next[k - 1].heads = heads
		if (cams) next[k - 1].ptz = cams
		settings = { ...settings, slots: next }
		save()
		return ok()
	}

	/** POST /api/tracking/auto/home { after_s?, now? }: now true forces home until the next person, false cancels. */
	function home(data) {
		const a = data?.after_s
		if (a !== undefined && !(typeof a === 'number' && a >= store.AFTER_S.min && a <= store.AFTER_S.max)) {
			return bad(`after_s must be a number ${store.AFTER_S.min}..${store.AFTER_S.max}`)
		}
		if (data?.now !== undefined && typeof data.now !== 'boolean') return bad('now must be true or false')
		if (a !== undefined) {
			settings = { ...settings, after_s: a }
			save()
		}
		if (data?.now !== undefined) {
			forced = data.now
			forcedExcept = new Set(live.map((p) => p.key))
		}
		homeActive = homeNow()
		return ok()
	}

	return {
		step,
		configure(project) {
			grid = normalizeGrid(project?.previs?.tracking?.grid)
		},
		resolveAuto,
		ptzTargetOf,
		attached,
		snapshot,
		pin,
		slot,
		home,
		setPtz(svc) {
			ptz = svc || null
		},
		get file() {
			return file
		},
	}
}

module.exports = { createAutoDirector, PIN_BASE, AUTO_MAX, LOST_S, JOIN_S }
