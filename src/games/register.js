'use strict'

/**
 * WO-1105 — Settings ▸ Games, the one global place to host the browser games and the Game World (always loaded; it
 * holds nothing while no game module is installed). src/bootstrap/modules.js registers it like an in-tree module.
 *   GET  /api/games/hosting   → games-hosting.js state (every game + the world + join addresses + QR matrices)
 *   POST /api/games/hosting   { action: module | session | start | stop | bots | main | affect | safe | lights | wall | house, … }
 *   WS   `games:hosting` {state}   broadcast when the state changed (1 s look while a game module is loaded, and right
 *        after every POST) — a change made on a game's web host page reaches Settings within a second.
 * Normal API auth on both routes (the games' host routes need it too, WO-1089); the module switch (action `module`) also
 * needs the password or a request from the box itself, like POST /api/modules/* (WO-1106 B1, code-change-gate.js). `games.autoOpen` (default off) opens the
 * loaded games' sessions 5 s after the server started: lobby only, never a round.
 * WO-1125 `games.selfService` (default on): the same opening at the start, and from then on the 1 s tick runs the hosting's
 * selfTick() (each loaded game told `self`, a closed session nobody closed on purpose re-opened). POST {action:'selfService', on}
 * saves the setting through the config manager (the `games` section, like POST /api/settings {games}).
 */

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('../api/response')
const { createGamesHosting } = require('./games-hosting')
const { normalizeGamesSettings, mergeGamesSettings } = require('./games-settings')
const { qrRows } = require('./games-qr')
const { mayChangeInstalledCode } = require('../module-host/code-change-gate')

const TICK_MS = 1000
// WO-1106 A19: the module list (module dirs + manifests, read from disk) was re-read on every 1 s tick. Now it is
// re-read when the set of loaded modules changes (an enable / disable from here or from the Modules page, in memory)
// and otherwise at most every 30 s (a module installed but not loaded, a manifest edited).
const MODS_MS = 30000
const AUTO_OPEN_MS = 5000

let _ctx = null
let _timer = null
let _sent = ''
let _hosting = null
let _mods = null
let _modsAt = 0
let _modsKey = ''
let _boot = null
let _selfReady = false // WO-1125: the self-service tick waits for the start delay (modules loaded, as autoOpen does)

/** The names of the loaded modules (in memory, cheap): a change means a module was enabled or disabled somewhere. */
function loadedKey() {
	try {
		return require('../module-registry').describe().modules.join(',')
	} catch {
		return ''
	}
}

/** The installed modules with a manifest `game` (a game, or `world`), cached briefly. */
function gameModules() {
	const key = loadedKey()
	if (!_mods || key !== _modsKey || Date.now() - _modsAt > MODS_MS) {
		_mods = require('../module-host/module-loader').listAvailable().filter((m) => typeof m.game === 'string')
		_modsAt = Date.now()
		_modsKey = key
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
		mayChangeCode: (req) => mayChangeInstalledCode(req, c), // WO-1106 B1: the module switch, like POST /api/modules/*
		saveSettings: (patch) => saveGames(c, patch), // WO-1125 selfService
	})
	if (ctx) _ctx = ctx
	return _hosting
}

/** WO-1125: merge `patch` into the saved `games` section (config manager) and the running config → true when saved. */
function saveGames(c, patch) {
	const cm = c?.configManager
	if (!cm || typeof cm.get !== 'function' || typeof cm.save !== 'function') return false
	const cur = cm.get() || {}
	const games = mergeGamesSettings(cur.games, patch)
	if (cm.save({ ...cur, games }) === false) return false
	if (c.config && typeof c.config === 'object') c.config.games = games
	return true
}

const reply = (status, o) => ({ status, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' }, body: jsonBody(o) })

/** Send `games:hosting` when the state changed since the last one sent. */
async function tick(force = false) {
	if (!_ctx || typeof _ctx._wsBroadcast !== 'function') return
	const idle = !gameModules().some((m) => m.loaded)
	if (_selfReady && !idle) {
		try {
			hosting().selfTick() // WO-1125: `self` to every loaded game; re-open a session nobody closed on purpose
		} catch (e) {
			_ctx?.log?.('warn', `[games] self-service check failed: ${e?.message || e}`)
		}
	}
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
	routes.post('/api/games/hosting', async ({ ctx, body, req }) => {
		const b = parseBodyStrict(body)
		if (!b.ok || !b.value || typeof b.value !== 'object' || Array.isArray(b.value)) return reply(400, { ok: false, error: 'JSON object body expected' })
		const r = await hosting(ctx).host(b.value, req) // req: the module switch is gated (WO-1106 B1)
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
		_selfReady = false
		if (_boot) clearTimeout(_boot)
		if (_timer) clearInterval(_timer)
		_timer = setInterval(() => tick().catch(() => {}), TICK_MS)
		if (typeof _timer.unref === 'function') _timer.unref()
		const gs = normalizeGamesSettings(ctx?.config?.games)
		_boot = setTimeout(() => {
			_boot = null
			_selfReady = true // WO-1125: from now on the tick keeps the self-service sessions open
			if (!gs.autoOpen && !gs.selfService) return
			try {
				hosting(ctx).autoOpen()
			} catch (e) {
				ctx?.log?.('warn', `[games] auto-open failed: ${e?.message || e}`)
			}
		}, AUTO_OPEN_MS)
		if (typeof _boot.unref === 'function') _boot.unref()
	},
	async onShutdown() {
		if (_timer) clearInterval(_timer)
		if (_boot) clearTimeout(_boot)
		_timer = _boot = null
		_ctx = null
		_hosting = null
		_selfReady = false
	},
	_test: {
		tick,
		hosting,
		saveGames,
		selfReady: (on) => (_selfReady = on === true), // a smoke skips the start delay
		use: (h, mods) => {
			_hosting = h // a smoke's own service + module list behind the real routes + broadcast
			_mods = mods
			_modsAt = Infinity
			_modsKey = loadedKey()
		},
	},
}
