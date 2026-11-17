'use strict'

/**
 * WO-1101 / WO-1102 — the Game World hub (work/notes/game-world-contract.md §0–§1, §6). Set as `reg.hub` by register.js
 * while the module is loaded. The games call it (always inside their own try/catch); every call it makes into an
 * adapter is wrapped here too: a failing game never breaks the world and vice versa.
 *
 * API the games call:
 *   hub.attach(adapter)            a game's session was enabled (§0.2 adapter); while the world is safe → adapter.pause(true)
 *   hub.detach(id)                 its session was disabled
 *   hub.quality(gameId, key, n)    the viewer's `wq` (6 | 12 | 20; anything else 12)
 *   hub.colliders(gameId)          → [{ k: 'sph', c, r, tag: 'car'|'soldier', w }] of the OTHER games (fresh, ≤ 25 ms old);
 *                                    [] while safe or while the world does not run; cars / live unprotected soldiers whose
 *                                    game's affect is not 'off'
 *   hub.contact({ g, pid, veg, p, v, tag, w }) → { end }   R1 / R6 (end: a splat vegetable ends on it)
 *   hub.landed({ g, pid, veg, p, tag })        → true      R2 slick patch / R5 pea scatter
 *   hub.shot({ g, pid, o, yaw, range, los })   → { hit }   R4 (o = muzzle, range in metres, los(a, b) → true when clear)
 *   hub.wantsFrame(gameId)         → true while the world tick runs and that game is attached (cheap)
 *   hub.isSafe()                   → presenter safe on?
 *   hub.affect(gameId)             → 'on' | 'soft' | 'off'
 * Effects / bonuses decided in contact / landed / shot reach the adapters through `defer` (a microtask by default), never
 * re-entering the calling game's step. Bonus kinds: 'hop' R1, 'bounce' R6, 'scatter' R5, 'sparks' R4, 'bowl' R3, 'spot' R9.
 *
 * Used by the world module itself: openWorld(send, off?) → { close } | null (≤ 20; the last game gone → off()),
 * setSafe(on), setAffect(g, mode), startEvent(kind, secs), endEvent(kind), events(), boards(), setBoardInfo(fn),
 * adapters(), sync(), stats(), running(), tick(), dispose().
 *
 * The world tick (10 Hz) runs ONLY while ≥ 2 rooms are attached or a world-page socket is open — otherwise no timer at
 * all. Each tick: entities() / board() / area() of every room (+ the referee's rain and patches), the referee's tick
 * rules, then per viewer the interest set (world-interest.js), `wst` when it changes, `wv` when there is anything to say.
 * A viewer that never had a foreign entity gets nothing; one that disappears from viewers() is forgotten. When the
 * tick stops, every viewer that had `wst` gets `{ t: 'wst', v: 1, on: false }`.
 */

const { requireWire } = require('./world-wire-load')
const { createReferee } = require('./world-referee')
const { createIdMap, collectGame } = require('./world-ents')
const { selectInterest, buildWv, capFor, qualityCap } = require('./world-interest')

const TICK_MS = 100
const BOARD_EVERY = 5 // ticks → 2 Hz
const MAX_WORLD = 20
const FRESH_MS = 25
const CLIENT = '/game/world/visitors.js'
const MODES = new Set(['on', 'soft', 'off'])
const COLL = Object.freeze({ car: { dy: 0.025, r: 0.04 }, soldier: { dy: 0.03, r: 0.025 } })
const WST_OFF = Object.freeze({ t: 'wst', v: 1, on: false })
const WORLD_OFF = Object.freeze({ t: 'off' })

/**
 * @param {{ now?: () => number, timers?: { setInterval, clearInterval }, registry?: object, referee?: object,
 *   seed?: number, log?: (level, msg) => void, defer?: (fn) => void }} opts
 */
function createHub(opts = {}) {
	const now = opts.now || Date.now
	const T = opts.timers || { setInterval, clearInterval }
	const reg = opts.registry || require('./world-link').registry()
	const log = opts.log || (() => {})
	const defer = opts.defer || queueMicrotask
	const ref = opts.referee || createReferee({ seed: Number.isFinite(opts.seed) ? opts.seed : now() >>> 0, now })
	const wire = requireWire()
	const rooms = new Map() // id → adapter
	const ids = createIdMap()
	const views = new Map() // `${g}\0${key}` → { g, key, sent, tickN, wst }
	const quality = new Map() // `${g}\0${key}` → 6 | 12 | 20
	const worlds = new Map() // n → { send, sent, tickN, wst }
	const affect = {}
	const stats = { ticks: 0, entities: 0, bytes: {}, msgs: 0, events: {}, effects: 0, soft: 0, bonuses: 0, errors: 0 }
	let timer = null
	let tickN = 0
	let worldSeq = 0
	let safe = false
	let fxQueue = []
	let snap = { at: -Infinity, ents: [], byW: new Map(), boards: {}, areas: {} }
	let boardInfo = null // () => { house, scene } (world-service.js)

	const call = (fn) => {
		try {
			return fn()
		} catch (e) {
			stats.errors++
			if (stats.errors < 20) log('warn', `[game-world] ${e && e.message}`)
			return undefined
		}
	}
	/* a viewer key is the game's own socket object (or a string / number in tests): objects get a stable serial */
	const keyIds = new WeakMap()
	let keySeq = 0
	const keyId = (key) => (key && typeof key === 'object' ? keyIds.get(key) ?? (keyIds.set(key, `o${++keySeq}`), `o${keySeq}`) : key)
	const vkey = (g, key) => `${g}\0${keyId(key)}`
	const addBytes = (g, n) => {
		stats.bytes[g] = (stats.bytes[g] || 0) + n
		stats.msgs++
	}
	const phaseMap = () => Object.fromEntries(Object.entries(snap.boards).map(([g, b]) => [g, b && typeof b.phase === 'string' ? b.phase : null]))

	/* ---------- entities ---------- */

	function collect(t, full) {
		const ents = []
		const boards = {}
		const areas = {}
		for (const [g, a] of rooms) {
			if (full) {
				boards[g] = call(() => a.board()) || null
				areas[g] = typeof a.area === 'function' ? call(() => a.area()) || null : null
			}
			for (const e of collectGame(g, call(() => a.entities(t)), ids, t)) ents.push(e)
		}
		for (const e of collectGame('world', call(() => ref.ents(t)), ids, t)) ents.push(e)
		snap = { at: t, ents, byW: new Map(ents.map((e) => [e.w, e])), boards: full ? boards : snap.boards, areas: full ? areas : snap.areas }
		return snap
	}
	const fresh = () => (now() - snap.at > FRESH_MS ? collect(now(), false) : snap)

	/* ---------- delivery ---------- */

	/**
	 * WO-1106 A25: an effect the target game did not take (apply() returned false, threw, or the game is gone) sends no
	 * event and pays no bonus — both carry their effect as `of` (world-referee.js linkTo); unlinked ones (R9) always go.
	 */
	function deliver(out) {
		const refused = new Set()
		for (const e of out.effects) {
			stats.effects++
			if (e.soft) stats.soft++
			const a = rooms.get(e.g)
			if (!(a && typeof a.apply === 'function' && call(() => a.apply(e) !== false) === true)) refused.add(e)
		}
		const took = (x) => !(x.of && refused.has(x.of))
		for (const b of out.bonuses) {
			if (!took(b)) continue
			const a = rooms.get(b.g)
			if (a && typeof a.bonus === 'function' && call(() => a.bonus(b.pid, b.kind)) !== false) stats.bonuses++
		}
		for (const x of out.events) {
			if (!took(x)) continue
			stats.events[x.k] = (stats.events[x.k] || 0) + 1
			const m = { t: 'xev', ...x }
			for (const wv of worlds.values()) sendWorld(wv, m)
		}
		for (const f of out.fx) {
			const w = ids.lookup(f.g, f.k, f.id)
			if (w) fxQueue.push([w, f.kind, Math.max(0, Math.min(10000, Math.round(f.ms))), f.c || ''])
		}
	}
	const deliverLater = (out) => defer(() => call(() => deliver(out)))

	/* ---------- sending ---------- */

	/** WO-1106 A5: a send that returns a strict `false` (skipped for backpressure / closed) was not delivered. */
	function sendGame(g, key, msg) {
		const a = rooms.get(g)
		if (!a) return false
		const ok = call(() => a.send(key, msg) !== false)
		if (ok) addBytes(g, JSON.stringify(msg).length)
		return ok === true
	}
	function sendWorld(wv, msg) {
		const ok = call(() => wv.send(msg) !== false)
		if (ok) addBytes('world', JSON.stringify(msg).length)
		return ok === true
	}

	function models() {
		const m = {}
		for (const d of reg.games.values()) {
			if (!d || !d.models || typeof d.models !== 'object') continue
			for (const [k, u] of Object.entries(d.models)) if (wire.KINDS.includes(k) && wire.okModelUrl(u) && !m[k]) m[k] = u
		}
		return m
	}
	/** The toy scale (cars, soldiers): a game that brings a car or soldier model — never Salad's life-size 1 (box finding). */
	function scale() {
		for (const d of reg.games.values()) {
			const toy = d?.models && (d.models.car || d.models.soldier)
			if (toy && Number.isFinite(d.scale) && d.scale > 0 && d.scale < 1) return d.scale
		}
		return 0.1
	}
	function gamesList() {
		return [...rooms.keys()].sort().map((id) => {
			const d = reg.games.get(id)
			const b = snap.boards[id]
			return { id, title: wire.cleanName(d && d.title) || id, phase: b && typeof b.phase === 'string' ? b.phase.slice(0, 16) : '' }
		})
	}
	const wstFor = (g, base) => ({ ...base, affect: g ? affect[g] || 'on' : 'on' })

	/** One viewer's turn: wst when it changed (only once a foreign entity was ever in interest), then the wv. */
	function serveView(vs, view, base, send) {
		const picked = selectInterest(view, snap.ents)
		if (picked.length || vs.wst) {
			const w = wstFor(view.g, base)
			const k = JSON.stringify(w)
			if (k !== vs.wst && send(w)) vs.wst = k
		}
		if (!vs.wst) return
		const before = new Map(vs.sent)
		const msg = buildWv(vs, picked, { ts: now(), tags: view.tags, fx: fxQueue, wire })
		if (msg && !send(msg)) vs.sent = before // WO-1106 A5: not delivered → the next tick re-sends its add / gone / e
	}

	function roomCentre() {
		let n = 0
		const c = [0, 0, 0]
		for (const a of Object.values(snap.areas)) {
			if (!a || !Array.isArray(a.rect)) continue
			c[0] += (a.rect[0] + a.rect[2]) / 2
			c[1] += Number.isFinite(a.y) ? a.y : 0
			c[2] += (a.rect[1] + a.rect[3]) / 2
			n++
		}
		return n ? c.map((x) => x / n) : [0, 0, 0]
	}

	/* ---------- the tick ---------- */

	function tick() {
		const t = now()
		tickN++
		stats.ticks++
		collect(t, true)
		ref.setWorld({ safe, affect, phase: phaseMap() })
		const pools = {}
		if (ref.spotActive()) for (const [g, a] of rooms) pools[g] = typeof a.pools === 'function' ? call(() => a.pools()) || [] : []
		const out = call(() => ref.tick({ ents: snap.ents, areas: snap.areas, pools }))
		if (out) deliver(out)
		stats.entities = snap.ents.length
		const base = { t: 'wst', v: 1, on: true, client: CLIENT, models: models(), scale: scale(), safe, games: gamesList() }
		const centre = roomCentre()
		let board = null
		for (const [g, a] of rooms) {
			const list = call(() => a.viewers())
			const seen = new Set()
			for (const v of Array.isArray(list) ? list : []) {
				if (!v || (typeof v.key !== 'string' && typeof v.key !== 'number' && !(v.key && typeof v.key === 'object'))) continue
				const k = vkey(g, v.key)
				seen.add(k)
				let vs = views.get(k)
				if (!vs) views.set(k, (vs = { g, key: v.key, sent: new Map(), tickN: 0, wst: null }))
				const cap = capFor(quality.get(k) ?? v.cap, false)
				const p = Array.isArray(v.p) && v.p.length >= 3 && v.p.every(Number.isFinite) ? v.p : null
				serveView(vs, { g, p, cap, center: centre, tags: cap > 6 }, base, (m) => sendGame(g, v.key, m))
			}
			for (const [k, vs] of views) if (vs.g === g && !seen.has(k)) (views.delete(k), quality.delete(k))
		}
		for (const k of quality.keys()) if (!views.has(k)) quality.delete(k) // WO-1106 A16: only live viewers keep a wq
		for (const wv of worlds.values()) {
			serveView(wv, { g: null, p: null, cap: capFor(0, true), center: centre, tags: true }, base, (m) => sendWorld(wv, m))
			if (tickN % BOARD_EVERY === 0) sendWorld(wv, board || (board = boardMsg()))
		}
		fxQueue = []
		ids.gc(t)
	}

	/* ---------- lifecycle ---------- */

	const shouldRun = () => rooms.size >= 2 || worlds.size > 0
	function ensure() {
		if (shouldRun() && !timer) {
			timer = T.setInterval(() => call(tick), TICK_MS)
			log('info', `[game-world] world tick on (${rooms.size} rooms, ${worlds.size} world pages)`)
		} else if (!shouldRun() && timer) stop()
	}
	function stop() {
		if (timer) T.clearInterval(timer)
		timer = null
		for (const vs of views.values()) if (vs.wst) sendGame(vs.g, vs.key, WST_OFF)
		for (const wv of worlds.values()) if (wv.wst) sendWorld(wv, WST_OFF)
		for (const wv of worlds.values()) (wv.sent.clear(), (wv.wst = null))
		views.clear()
		quality.clear()
		ids.clear()
		fxQueue = []
		snap = { at: -Infinity, ents: [], byW: new Map(), boards: {}, areas: {} }
	}

	function attach(adapter) {
		if (!adapter || typeof adapter !== 'object' || typeof adapter.id !== 'string' || typeof adapter.entities !== 'function') return false
		const id = adapter.id
		if (rooms.get(id) === adapter) return true
		for (const [k, vs] of views) if (vs.g === id) views.delete(k)
		rooms.set(id, adapter)
		if (safe && typeof adapter.pause === 'function') call(() => adapter.pause(true))
		ensure()
		return true
	}
	function detach(id) {
		if (!rooms.delete(id)) return false
		for (const [k, vs] of views) if (vs.g === id) (views.delete(k), quality.delete(k))
		delete snap.boards[id]
		ensure()
		if (!rooms.size && worlds.size) defer(() => call(worldsOffIfIdle))
		return true
	}
	/**
	 * WO-1106 A18: the world pages are public only while a game runs. After the last detach (deferred: a game detaches
	 * before its room() goes null) the games are synced once more; still none → every page gets `{ t: 'off' }` and its
	 * close (world-ws.js: code 4403), and with no page left the tick stops.
	 */
	function worldsOffIfIdle() {
		sync()
		if (rooms.size) return
		const pages = [...worlds.values()]
		worlds.clear()
		for (const wv of pages) {
			if (typeof wv.off === 'function') call(wv.off)
			else sendWorld(wv, WORLD_OFF)
		}
		ensure()
	}
	/** Attach every registered game whose session runs (the world module loaded after the games were enabled). */
	function sync() {
		for (const d of reg.games.values()) {
			const a = d && typeof d.room === 'function' ? call(() => d.room()) : null
			if (a && rooms.get(a.id) !== a) attach(a)
		}
	}

	/** send(msg) → false when not delivered; off() (WO-1106 A18) says `off` and closes the page's socket. */
	function openWorld(send, off) {
		if (typeof send !== 'function' || worlds.size >= MAX_WORLD) return null
		const n = ++worldSeq
		worlds.set(n, { send, off: typeof off === 'function' ? off : null, sent: new Map(), tickN: 0, wst: null })
		ensure()
		return {
			close() {
				if (worlds.delete(n)) ensure()
			},
		}
	}

	function setSafe(on) {
		const was = safe
		safe = on === true
		ref.setWorld({ safe })
		if (was && !safe) for (const a of rooms.values()) if (typeof a.pause === 'function') call(() => a.pause(false))
		return safe
	}
	function setAffect(g, mode) {
		if (!MODES.has(mode)) return false
		affect[g] = mode
		ref.setWorld({ affect })
		return true
	}

	function boards() {
		return gamesList().map((x) => {
			const b = snap.boards[x.id] || {}
			const paused = b.paused === true || b.phase === 'paused' // WO-1106 A8: the games report a pause as phase 'paused'
			return { ...x, endsAt: Number.isFinite(b.endsAt) ? b.endsAt : null, top: Array.isArray(b.top) ? b.top.slice(0, 3) : [], players: b.players | 0, bots: b.bots | 0, paused }
		})
	}
	/** WO-1106 A8: the world pages' `board` also carries the house level and the scene (the service's provider). */
	function boardMsg() {
		const info = (boardInfo && call(boardInfo)) || {}
		const house = Number.isFinite(info.house) ? info.house : null
		return { t: 'board', games: boards(), house, scene: info.scene && typeof info.scene === 'object' ? info.scene : null }
	}

	/* ---------- contact queries (§6.1) ---------- */

	function colliders(gameId) {
		if (safe || !timer) return []
		const out = []
		for (const e of fresh().ents) {
			if (e.g === gameId || e.g === 'world' || (affect[e.g] || 'on') === 'off') continue
			if (e.k === 'car' || (e.k === 'soldier' && !(e.f & 2) && !(e.f & 4))) {
				const h = COLL[e.k]
				out.push({ k: 'sph', c: [e.p[0], e.p[1] + h.dy, e.p[2]], r: h.r, tag: e.k, w: e.w })
			}
		}
		return out
	}
	const nameOf = (g, pid) => {
		for (const e of snap.ents) if (e.g === g && e.id === pid && (e.k === 'sling' || e.k === 'car' || e.k === 'soldier')) return e.n
		return ''
	}
	function contact(q) {
		const splat = !!(q && ['tomato', 'cabbage', 'peas'].includes(q.veg))
		if (!q || !timer || safe) return { end: splat }
		const target = fresh().byW.get(q.w) || null
		const out = call(() => ref.contact({ ...q, name: q.name ?? nameOf(q.g, q.pid) }, target))
		if (!out) return { end: splat }
		deliverLater(out)
		return { end: out.end }
	}
	function landed(q) {
		if (!q || !timer || safe) return false
		const out = call(() => ref.landed({ ...q, name: q.name ?? nameOf(q.g, q.pid) }, fresh().ents))
		if (out) deliverLater(out)
		return true
	}
	function shot(q) {
		if (!q || !timer || safe) return { hit: false }
		const out = call(() => ref.shot({ ...q, name: q.name ?? nameOf(q.g, q.pid) }, fresh().ents))
		if (!out) return { hit: false }
		deliverLater(out)
		return { hit: out.effects.length > 0 }
	}

	/**
	 * WO-1106 A16: a viewer's `wq`, kept only while the tick runs and the game is attached (the tick sweeps keys that are
	 * not live viewers). A wq that is not kept costs nothing: the games pass the same cap in viewers() `cap`.
	 */
	function setQuality(g, key, n) {
		if (!timer || !rooms.has(g)) return false
		quality.set(vkey(g, key), qualityCap(n))
		return true
	}

	function dispose() {
		stop()
		rooms.clear()
		worlds.clear()
		quality.clear()
	}

	return {
		attach,
		detach,
		quality: setQuality,
		colliders,
		contact,
		landed,
		shot,
		wantsFrame: (g) => !!timer && rooms.has(g),
		isSafe: () => safe,
		affect: (g) => affect[g] || 'on',
		openWorld,
		setSafe,
		setAffect,
		startEvent: (kind, secs) => !safe && ref.startEvent(kind, secs),
		endEvent: (kind) => ref.endEvent(kind),
		events: () => ref.events(),
		boards,
		setBoardInfo: (fn) => ((boardInfo = typeof fn === 'function' ? fn : null), true),
		adapters: () => new Map(rooms),
		sync,
		stats: () => ({ ...stats, bytes: { ...stats.bytes }, events: { ...stats.events }, rooms: rooms.size, worldPages: worlds.size, ids: ids.size(), running: !!timer, viewers: views.size, wq: quality.size }),
		running: () => !!timer,
		tick: () => call(tick),
		dispose,
		referee: ref,
	}
}

module.exports = { createHub, TICK_MS, BOARD_EVERY, MAX_WORLD, CLIENT }
