'use strict'

/**
 * WO-1105 — Settings ▸ Games, the one global place to host the browser games and the Game World (always loaded; it
 * holds nothing while no game module is installed). src/bootstrap/modules.js registers it like an in-tree module.
 *   GET  /api/games/hosting   → games-hosting.js state (every game + the world + join addresses + QR matrices)
 *   POST /api/games/hosting   { action: module | session | start | stop | bots | main | affect | safe | lights | wall | house, … }
 *   WS   `games:hosting` {state}   broadcast when the state changed (1 s look while a game module is loaded, and right
 *        after every POST) — a change made on a game's web host page reaches Settings within a second.
 * Normal API auth on both routes (the games' host routes need it too, WO-1089). `games.autoOpen` (default off) opens the
 * loaded games' sessions 5 s after the server started: lobby only, never a round.
 */

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('../api/response')
const { createGamesHosting } = require('./games-hosting')
const { normalizeGamesSettings } = require('./games-settings')
const { qrRows } = require('./games-qr')

const TICK_MS = 1000
const MODS_MS = 500 // the module list (manifests on disk) is read at most twice a second
const AUTO_OPEN_MS = 5000

let _ctx = null
let _timer = null
let _sent = ''
let _hosting = null
let _mods = null
let _modsAt = 0

/** The installed modules with a manifest `game` (a game, or `world`), cached briefly. */
function gameModules() {
	if (!_mods || Date.now() - _modsAt > MODS_MS) {
		_mods = require('../module-host/module-loader').listAvailable().filter((m) => typeof m.game === 'string')
		_modsAt = Date.now()
	}
	return _mods
}
const forget = (r) => ((_mods = null), r)

function hosting(ctx) {
	if (_hosting && (!ctx || ctx === _ctx)) return _hosting
	const c = ctx || _ctx
	const loader = () => require('../module-host/module-loader')
	const moduleRegistry = require('../module-registry')
	const loadedMod = (id) => {
		const m = gameModules().find((x) => x.game === id && x.loaded)
		return (m && moduleRegistry.get(m.name)) || null
	}
	_hosting = createGamesHosting({
		descriptor: (id) => loadedMod(id)?.gameDescriptor?.() || null, // the game module's own descriptor (its register.js)
		modules: gameModules,
		worldService: () => loadedMod('world')?.service || null,
		settings: () => normalizeGamesSettings(c?.config?.games),
		port: () => Number(c?.config?.server?.httpPort) || 4200,
		qr: qrRows,
		enableModule: async (name) => forget(await loader().enableModule(name, c)),
		disableModule: async (name) => forget(await loader().disableModule(name, c)),
		log: (level, msg) => (typeof c?.log === 'function' ? c.log(level, msg) : undefined),
	})
	if (ctx) _ctx = ctx
	return _hosting
}

const reply = (status, o) => ({ status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' }, body: jsonBody(o) })

/** Send `games:hosting` when the state changed since the last one sent. */
async function tick(force = false) {
	if (!_ctx || typeof _ctx._wsBroadcast !== 'function') return
	const idle = !gameModules().some((m) => m.loaded)
	if (!force && idle && _sent === 'empty') return
	const st = await hosting().state()
	const json = JSON.stringify(st)
	if (json === _sent && !force) return
	_sent = idle ? 'empty' : json
	_ctx._wsBroadcast('games:hosting', st)
}

function registerRoutes(routes) {
	const o = { requireCaspar: false }
	routes.get('/api/games/hosting', async ({ ctx }) => reply(200, await hosting(ctx).state()), o)
	routes.post('/api/games/hosting', async ({ ctx, body }) => {
		const b = parseBodyStrict(body)
		if (!b.ok || !b.value || typeof b.value !== 'object' || Array.isArray(b.value)) return reply(400, { ok: false, error: 'JSON object body expected' })
		const r = await hosting(ctx).host(b.value)
		tick(true).catch(() => {})
		return reply(r.status, r.body)
	}, o)
}

module.exports = {
	name: 'games-hosting',
	apiPathPrefixes: ['/api/games'],
	registerRoutes,
	wsNamespaces: ['games:'],
	webBundles: [],
	onBoot(ctx) {
		_ctx = ctx
		_hosting = null
		_mods = null
		_sent = ''
		if (_timer) clearInterval(_timer)
		_timer = setInterval(() => tick().catch(() => {}), TICK_MS)
		if (typeof _timer.unref === 'function') _timer.unref()
		if (normalizeGamesSettings(ctx?.config?.games).autoOpen) {
			const t = setTimeout(() => {
				try {
					hosting(ctx).autoOpen()
				} catch (e) {
					ctx?.log?.('warn', `[games] auto-open failed: ${e?.message || e}`)
				}
			}, AUTO_OPEN_MS)
			if (typeof t.unref === 'function') t.unref()
		}
	},
	async onShutdown() {
		if (_timer) clearInterval(_timer)
		_timer = null
		_ctx = null
		_hosting = null
	},
	_test: {
		tick,
		hosting,
		use: (h, mods) => {
			_hosting = h // a smoke's own service + module list behind the real routes + broadcast
			_mods = mods
			_modsAt = Infinity
		},
	},
}
