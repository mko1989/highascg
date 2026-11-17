'use strict'

/**
 * WO-1105 — the Settings ▸ Games state (GET /api/games/hosting, WS `games:hosting`) from the installed game modules,
 * their descriptors' state and the Game World's state. Pure apart from the QR encoder it is handed.
 *
 * {
 *   v: 1,
 *   join:   { addresses: [{ ip, iface, kind }], setting, ip, iface, kind, auto, warning },
 *   world:  { id: 'world', module, title, installed, moduleOn, on, safe, joinUrl, paths, qr } | null (not installed),
 *   global: { safe, lights, wall, house, open: n, running: n },
 *   games:  [{ id, module, title, moduleOn, error, open, phase, running, safe, players, spectators,
 *              bots: { n, level, max, levels } | null, main: { label, value, min, max } | null, affect,
 *              lights, wall, house, joinUrl, paths: { play, host, spectate }, qr, defaults }],
 * }
 * phase: 'off' (module off) | 'closed' (no session) | the game's phase (lobby, countdown, race, match, round, results)
 * | 'paused'. running: a round / race / match is on (not lobby / results / closed).
 */

const { joinUrl } = require('./games-join')

const IDLE = new Set(['lobby', 'results', 'closed', 'off'])

const pathsOf = (id, d) => {
	const p = d && d.paths && typeof d.paths === 'object' ? d.paths : {}
	const play = typeof p.play === 'string' ? p.play : `/game/${id}/`
	return { play, host: typeof p.host === 'string' ? p.host : `${play}?host=1`, spectate: typeof p.spectate === 'string' ? p.spectate : `${play}?spectate=1` }
}

const safeCall = (fn) => {
	try {
		return fn()
	} catch {
		return undefined
	}
}

function gameRow(m, { desc, hostingOf, stateOf, worldState, settings, ip, port }) {
	const moduleOn = m.enabled === true && m.loaded === true
	const d = moduleOn ? desc(m.game) : null
	const st = d ? stateOf(d) : null
	const open = !!st?.enabled
	const h = d ? hostingOf(d) : null
	const safe = open && typeof h?.isSafe === 'function' ? !!safeCall(() => h.isSafe(st)) : open && st.paused === true
	const phase = !moduleOn ? 'off' : !open ? 'closed' : st.paused || safe ? 'paused' : String(st.phase || 'lobby') // salad pauses as `safe`
	const people = open && Array.isArray(st.players) ? st.players : []
	const b = open && h?.bots ? safeCall(() => h.bots.read(st)) || {} : {}
	const mainVal = open && h?.main ? safeCall(() => h.main.read(st)) : null
	const paths = pathsOf(m.game, d)
	return {
		id: m.game,
		module: m.name,
		title: String(d?.title || m.title || m.game),
		moduleOn,
		error: m.error || null,
		open,
		phase,
		running: open && !IDLE.has(String(st.phase || 'lobby')), // a paused race still runs
		safe,
		players: people.filter((p) => p && !p.bot && p.connected !== false).length,
		spectators: open ? Number(st.spectators) || 0 : 0,
		bots: h?.bots ? { n: Number(b.n) || 0, level: typeof b.level === 'string' ? b.level : 'normal', max: Number(h.bots.max) || 0, levels: Array.isArray(h.bots.levels) ? h.bots.levels.slice() : [] } : null,
		main: h?.main ? { label: String(h.main.label || ''), value: Number.isFinite(mainVal) ? mainVal : null, min: Number(h.main.min) || 0, max: Number(h.main.max) || 0 } : null,
		affect: worldState?.on && worldState.affect ? worldState.affect[m.game] || null : null,
		lights: open ? st.lights === true : null,
		wall: open ? st.wall === true : null,
		house: open && Number.isFinite(st.house) ? st.house : null,
		joinUrl: moduleOn ? joinUrl(ip, port, paths.play) : null,
		paths,
		defaults: settings.defaults?.[m.game] || {},
	}
}

/**
 * @param {{ mods: object[], desc: Function, hostingOf: Function, stateOf: Function, worldState: object|null,
 *   settings: object, join: object, port: number, qr: (text: string) => Promise<object|null>, safe?: boolean }} a
 *   safe: PAUSE EVERYTHING pressed while the Game World is not loaded (games-hosting.js keeps it, WO-1106 A6)
 */
async function buildState(a) {
	const ctx = { ...a, ip: a.join.ip }
	const games = a.mods.filter((m) => m.game !== 'world').map((m) => gameRow(m, ctx))
	const wm = a.mods.find((m) => m.game === 'world') || null
	const ws = a.worldState
	const world = wm
		? { id: 'world', module: wm.name, title: wm.title || 'Game World', moduleOn: wm.enabled === true && wm.loaded === true, error: wm.error || null,
			on: !!ws?.on, safe: ws?.on ? ws.safe === true : false, paths: pathsOf('world', null), joinUrl: null, qr: null }
		: null
	if (world) world.joinUrl = world.moduleOn ? joinUrl(a.join.ip, a.port, world.paths.play) : null
	for (const r of [...games, world].filter(Boolean)) r.qr = r.joinUrl ? await a.qr(r.joinUrl).catch(() => null) : null
	const open = games.filter((g) => g.open)
	const all = (k) => (open.length ? open.every((g) => g[k] === true) : ws?.on ? ws[k] === true : false)
	return {
		v: 1,
		join: a.join,
		world,
		global: {
			safe: ws?.on ? ws.safe === true : a.safe === true || (open.length > 0 && open.every((g) => g.safe)),
			lights: all('lights'),
			wall: all('wall'),
			house: open.find((g) => g.house != null)?.house ?? (ws?.on && Number.isFinite(ws.house) ? ws.house : 1),
			open: open.length,
			running: open.filter((g) => g.running).length,
		},
		games,
	}
}

module.exports = { buildState, gameRow }
