'use strict'

/**
 * WO-1105 — Settings ▸ Games: one state and one host entry for every browser game and the Game World.
 *
 * Built only on what exists: the installed modules (module-loader listAvailable, manifest `game`), each loaded game's
 * descriptor (its module's `gameDescriptor()`: `state()` / `host()`, the very functions the game's own routes and web
 * host pages call — so the same validation, and a change made on a web host page shows here and the other way round),
 * the descriptor's `hosting` (its main number, bots and pause in its own host-body shape) and, while the module whose
 * manifest says `game: "world"` is loaded, its service (`/api/game/world/host` — presenter safe, affect, lights for the whole world). The core
 * never names a game: ids, titles and paths come from the manifests and descriptors (`/game/<id>/` when a descriptor
 * has none). No game logic here; sessions stay runtime state (opened only by an operator, or by `games.autoOpen`).
 *
 * state() → { v, join, world, global, games: [row] }   (games-hosting-rows.js builds the rows)
 * host({ action, … }) → { status, body: { ok, action, error?, results?, state } }
 *   module {game, on}            enable / disable the module (POST /api/modules/enable|disable, ~/.highascg/modules.json)
 *   session {game, open}         open (lobby) + this box's defaults (games.defaults) / close the game's session
 *   start / stop {game?}         one game, or every open game
 *   bots {game, n, level?}       main {game, value}       affect {game, mode}  (affect needs the Game World)
 *   safe {on} · lights {on} · wall {on} · house {level 0..1}   the world service when loaded, else every open game
 */

const { listAddresses, pickAddress } = require('./games-join')
const { buildState } = require('./games-hosting-rows')
const { GAME_ID, MODES } = require('./games-settings')

const ACTIONS = new Set(['module', 'session', 'start', 'stop', 'bots', 'main', 'affect', 'safe', 'lights', 'wall', 'house'])

const call = (fn, dflt = null) => {
	try {
		const r = fn()
		return r === undefined ? dflt : r
	} catch {
		return dflt
	}
}

/**
 * @param {{ descriptor: (id: string) => object|null, modules: () => object[], worldService: () => object|null,
 *   settings: () => object, port: () => number, nets?: () => object, qr: (text: string) => Promise<object|null>,
 *   enableModule: (name: string) => Promise<object>, disableModule: (name: string) => Promise<object>, log?: Function }} deps
 */
function createGamesHosting(deps) {
	const log = deps.log || (() => {})
	const gameMods = () => (call(() => deps.modules(), []) || []).filter((m) => m && typeof m.game === 'string')
	const desc = (id) => call(() => deps.descriptor(id)) || null
	const hostingOf = (d) => (d ? call(() => d.hosting) : null)
	const svc = () => call(() => deps.worldService())
	const stateOf = (d) => (d && typeof d.state === 'function' ? call(() => d.state()) : null)
	const isOpen = (d) => !!stateOf(d)?.enabled

	async function state() {
		const addrs = call(() => listAddresses(deps.nets ? deps.nets() : undefined), []) || []
		const settings = deps.settings()
		const pick = pickAddress(addrs, settings.joinAddress)
		const w = svc()
		return buildState({ mods: gameMods(), desc, hostingOf, stateOf, worldState: w ? call(() => w.state()) : null, settings,
			join: { addresses: addrs, setting: settings.joinAddress, ...pick }, port: deps.port(), qr: deps.qr })
	}

	/** One game host body → { ok, status, error? } (a refusing game is reported, never thrown). */
	function hostOne(d, body) {
		const r = call(() => d.host(body), { status: 500, body: { ok: false, error: 'the game failed' } })
		const status = Number(r?.status) || 500
		const ok = status < 300 && r?.body?.ok !== false
		return ok ? { ok, status } : { ok, status, error: String(r?.body?.error || 'refused') }
	}
	/** Several bodies in order; stops at the first refusal. */
	function hostSeq(d, bodies) {
		let last = { ok: true, status: 200 }
		for (const b of bodies) {
			last = hostOne(d, b)
			if (!last.ok) break
		}
		return last
	}
	const viaWorld = (body) => {
		const s = svc()
		if (!s) return null
		const r = call(() => s.host(body), { status: 500, body: { ok: false, error: 'the Game World failed' } })
		const ok = Number(r?.status) < 300 && r?.body?.ok !== false
		return { ok, status: Number(r?.status) || 500, ...(ok ? {} : { error: String(r?.body?.error || 'refused') }), results: r?.body?.results }
	}
	const openDescs = () => gameMods().map((m) => (m.game === 'world' ? null : desc(m.game))).filter((d) => d && isOpen(d))

	/** The box's defaults onto a session just opened (bots + level, main number, affect). Refusals are logged only. */
	function applyDefaults(id, d) {
		const dflt = deps.settings().defaults?.[id] || {}
		const h = hostingOf(d)
		const out = []
		if (h?.bots && (dflt.bots != null || dflt.botLevel)) out.push(hostSeq(d, h.bots.body(dflt.bots ?? 0, dflt.botLevel)))
		if (h?.main && dflt.main != null) out.push(hostSeq(d, h.main.body(dflt.main)))
		if (dflt.affect && svc()) out.push(viaWorld({ action: 'affect', game: id, mode: dflt.affect }))
		for (const r of out) if (r && !r.ok) log('warn', `[games] default for ${id} refused: ${r.error}`)
	}

	async function moduleSwitch(a) {
		const m = gameMods().find((x) => x.game === a.game)
		if (!m) return { status: 404, error: `no game module: ${a.game}` }
		const r = await (a.on ? deps.enableModule(m.name) : deps.disableModule(m.name))
		if (!r?.ok) return { status: Number(r?.status) || 409, error: String(r?.error || 'refused') }
		if (a.on && a.game === 'world') for (const x of openDescs()) applyAffect(x.id)
		return { status: 200 }
	}
	const applyAffect = (id) => {
		const mode = deps.settings().defaults?.[id]?.affect
		if (mode) viaWorld({ action: 'affect', game: id, mode })
	}

	function session(a, d) {
		if (a.open) {
			if (isOpen(d)) return { status: 200 }
			const r = viaWorld({ action: 'enable', game: a.game }) || hostOne(d, { action: 'enable' }) // world: a safe world pauses it too
			if (!r.ok) return { status: r.status, error: r.error }
			applyDefaults(a.game, d)
			return { status: 200 }
		}
		const r = viaWorld({ action: 'disable', game: a.game }) || hostOne(d, { action: 'disable' })
		return r.ok ? { status: 200 } : { status: r.status, error: r.error }
	}

	function startStop(a) {
		const list = a.game ? [desc(a.game)].filter(Boolean) : openDescs()
		if (!list.length) return { status: 409, error: a.game ? 'the game is not running' : 'no open session' }
		const results = {}
		for (const d of list) results[d.id] = hostOne(d, { action: a.action })
		const bad = Object.values(results).find((r) => !r.ok)
		return { status: bad ? bad.status : 200, error: bad?.error, results }
	}

	/** safe / lights / wall / house: the world when loaded (it remembers them and tells every game), else each open game. */
	function worldWide(a, body) {
		const w = viaWorld(body)
		if (w) return { status: w.status, error: w.error, results: w.results }
		const results = {}
		for (const d of openDescs()) results[d.id] = hostOne(d, a.action === 'safe' ? hostingOf(d)?.safe?.(a.on) || { action: 'pause', on: a.on } : body)
		const bad = Object.values(results).find((r) => !r.ok)
		return { status: bad ? bad.status : 200, error: bad?.error, results }
	}

	function validate(a) {
		if (!a || typeof a !== 'object' || Array.isArray(a)) return 'JSON object body expected'
		if (!ACTIONS.has(a.action)) return 'unknown action'
		if (a.game != null && (typeof a.game !== 'string' || !GAME_ID.test(a.game))) return '`game` must be a game id'
		if (['module', 'session', 'bots', 'main', 'affect'].includes(a.action) && !a.game) return '`game` is required'
		if (['module', 'safe', 'lights', 'wall'].includes(a.action) && typeof a.on !== 'boolean') return '`on` must be true or false'
		if (a.action === 'session' && typeof a.open !== 'boolean') return '`open` must be true or false'
		if (a.action === 'bots' && (!Number.isInteger(a.n) || a.n < 0)) return '`n` must be a whole number ≥ 0'
		if (a.action === 'main' && !Number.isInteger(a.value)) return '`value` must be a whole number'
		if (a.action === 'affect' && !MODES.includes(a.mode)) return "`mode` must be 'on', 'soft' or 'off'"
		if (a.action === 'house' && !(typeof a.level === 'number' && a.level >= 0 && a.level <= 1)) return '`level` must be a number 0..1'
		return ''
	}

	async function run(a) {
		switch (a.action) {
			case 'module':
				return moduleSwitch(a)
			case 'start':
			case 'stop':
				return startStop(a)
			case 'safe':
			case 'lights':
			case 'wall':
				return worldWide(a, { action: a.action, on: a.on })
			case 'house':
				return worldWide(a, { action: 'house', level: a.level })
			case 'affect': {
				const r = viaWorld({ action: 'affect', game: a.game, mode: a.mode })
				return r ? { status: r.status, error: r.error } : { status: 409, error: 'the Game World is off (enable its module)' }
			}
		}
		const d = desc(a.game)
		if (!d) return { status: 409, error: 'the game module is off' }
		if (a.action === 'session') return session(a, d)
		if (!isOpen(d)) return { status: 409, error: 'the game session is closed' }
		const h = hostingOf(d)
		const part = a.action === 'bots' ? h?.bots : h?.main
		if (!part) return { status: 400, error: `this game has no ${a.action} setting` }
		const st = stateOf(d)
		const r = a.action === 'bots' ? hostSeq(d, part.body(a.n, a.level ?? call(() => part.read(st).level))) : hostSeq(d, part.body(a.value))
		return r.ok ? { status: 200 } : { status: r.status, error: r.error }
	}

	async function host(a) {
		const bad = validate(a)
		if (bad) return { status: 400, body: { ok: false, error: bad, state: await state() } }
		const r = await run(a)
		const ok = r.status < 300
		const body = { ok, action: a.action, ...(r.error && !ok ? { error: r.error } : {}), ...(r.results ? { results: r.results } : {}) }
		return { status: r.status, body: { ...body, state: await state() } }
	}

	/** Server start with `games.autoOpen`: every loaded game's session opens (lobby + defaults; never a round). */
	function autoOpen() {
		let n = 0
		for (const m of gameMods()) {
			if (m.game === 'world') continue
			const d = desc(m.game)
			if (!d || isOpen(d)) continue
			if (session({ game: m.game, open: true }, d).status === 200) n++
		}
		if (n) log('info', `[games] auto-opened ${n} game session(s) (games.autoOpen)`)
		return n
	}

	return { state, host, autoOpen }
}

module.exports = { createGamesHosting }
