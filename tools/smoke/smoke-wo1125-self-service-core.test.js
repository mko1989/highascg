'use strict'

/**
 * WO-1125 — the core setting `games.selfService` (src/games/, work/notes/game-self-service-contract.md §2) over the THREE
 * REAL game services registered like their modules do: normalized default ON (only `false` turns it off), in the factory
 * defaults and carried by POST /api/settings {games}; selfTick() tells every loaded game `self` (once per value and
 * descriptor) and opens every closed session (lobby + this box's defaults); an explicit close from Settings ▸ Games or
 * from the game's own host page holds until the operator opens it again; a close nobody asked for (module shutdown) is
 * re-opened; off → `self: false` everywhere and nothing re-opened; POST {action:'selfService', on} saves through the
 * config manager and GET reports it; the register's 1 s tick runs selfTick only after the start delay.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1125-core-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token')

const { createGamesHosting } = require('../../src/games/games-hosting')
const GS = require('../../src/games/games-settings')
const { qrRows } = require('../../src/games/games-qr')
const R = require('../../src/games/register')
const { ConfigManager } = require('../../src/config/config-manager')
const { handlePost } = require('../../src/api/settings-post')
const defaults = require('../../src/config/defaults')
const { createRcGame } = require('../../modules/rc-game/server/rc-game')
const { createSkGame } = require('../../modules/toy-skirmish/server/sk-game')
const { createSaladGame } = require('../../modules/stage-salad/server/salad-game')
const RW = require('../../modules/rc-game/server/rc-world')
const KW = require('../../modules/toy-skirmish/server/sk-world')
const SW = require('../../modules/stage-salad/server/salad-world')

const KEY = Symbol.for('highascg.game-world/1')
const reg = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const never = { rev: () => 'r0', get: () => new Promise(() => {}), drop() {} } // no bake needed here

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

function setup(t, settings = {}) {
	const games = {
		rc: createRcGame({ baker: never, lanIps: () => [], loadBots: () => new Promise(() => {}) }),
		sk: createSkGame({ baker: never, lanIps: () => [] }),
		salad: createSaladGame({ baker: never, lanIps: () => [], readTracking: async () => null }),
	}
	RW.register(() => games.rc)
	KW.register(() => games.sk)
	SW.register(() => games.salad)
	const mods = [
		{ name: 'game-world', game: 'world', title: 'Game World', enabled: false, loaded: false },
		{ name: 'rc-game', game: 'rc', title: 'Stage Sprint RC', enabled: true, loaded: true },
		{ name: 'toy-skirmish', game: 'sk', title: 'Stage Skirmish', enabled: true, loaded: true },
		{ name: 'stage-salad', game: 'salad', title: 'Stage Salad', enabled: true, loaded: true },
	]
	let cfg = GS.normalizeGamesSettings(settings)
	const saves = []
	const logs = []
	const h = createGamesHosting({
		descriptor: (id) => reg().games.get(id) || null,
		modules: () => mods,
		worldService: () => null,
		settings: () => cfg,
		port: () => 4200,
		nets: () => ({}),
		qr: qrRows,
		enableModule: async () => ({ ok: true }),
		disableModule: async () => ({ ok: true }),
		log: (level, msg) => logs.push([level, msg]),
		saveSettings: (patch) => (saves.push(patch), patch.fail ? false : ((cfg = GS.mergeGamesSettings(cfg, patch)), true)),
	})
	t.after(() => {
		for (const g of Object.values(games)) g.disable()
		RW.unregister()
		KW.unregister()
		SW.unregister()
	})
	const open = () => Object.fromEntries(Object.entries(games).map(([id, g]) => [id, g.isEnabled()]))
	const selfs = () => Object.fromEntries(Object.entries(games).map(([id, g]) => [id, g.state().self ?? null]))
	return { h, games, mods, saves, logs, open, selfs, set: (s) => (cfg = GS.normalizeGamesSettings(s)) }
}

test('setting: default on (factory default, normalize); only `false` turns it off; merged like the other keys', () => {
	assert.equal(GS.normalizeGamesSettings(undefined).selfService, true)
	assert.equal(GS.normalizeGamesSettings({ selfService: false }).selfService, false)
	assert.equal(GS.normalizeGamesSettings({ selfService: 'no' }).selfService, true, 'junk → the default')
	assert.equal(GS.mergeGamesSettings({ selfService: false, autoOpen: true }, { joinAddress: 'eno1' }).selfService, false, 'kept by an unrelated patch')
	assert.equal(GS.mergeGamesSettings({ selfService: false }, { selfService: true }).selfService, true)
	assert.equal(defaults.games.selfService, true)
})

test('POST /api/settings {games:{selfService:false}}: in the hand-listed newConfig, saved, read back after a restart', async () => {
	const dir = fs.mkdtempSync(path.join(TMP, 'cfg-'))
	fs.writeFileSync(path.join(dir, 'general.json'), '{}')
	const quiet = { info() {}, warn() {}, error() {}, debug() {} }
	const cm = new ConfigManager(dir, quiet)
	cm.load()
	const ctx = { config: { streaming: {}, ...cm.get() }, configManager: cm, log: () => {} }
	const res = await handlePost('/api/settings', JSON.stringify({ games: { selfService: false } }), ctx)
	assert.equal(res.status, 200, String(res.body))
	await ConfigManager._saveChain
	assert.equal(ctx.config.games.selfService, false)
	const cm2 = new ConfigManager(dir, quiet)
	cm2.load()
	assert.equal(cm2.get().games.selfService, false)
	// the register's own save (POST /api/games/hosting {action:'selfService'}) through the same config manager
	assert.equal(R._test.saveGames(ctx, { selfService: true }), true)
	await ConfigManager._saveChain
	assert.equal(ctx.config.games.selfService, true, 'the running config follows')
	const cm3 = new ConfigManager(dir, quiet)
	cm3.load()
	assert.equal(cm3.get().games.selfService, true)
	assert.equal(R._test.saveGames({ config: {} }, { selfService: true }), false, 'no config manager → not saved')
})

test('selfTick: every loaded game told `self`, every closed session opened (lobby); once per value', async (t) => {
	const s = setup(t, { defaults: { rc: { main: 6 } } })
	assert.deepEqual(s.selfs(), { rc: null, sk: null, salad: null }, 'closed: no state')
	assert.equal(s.h.selfTick(), 3)
	assert.deepEqual(s.open(), { rc: true, sk: true, salad: true })
	assert.deepEqual(s.selfs(), { rc: true, sk: true, salad: true })
	assert.equal(s.games.rc.state().laps, 6, "this box's defaults applied like any open")
	assert.equal(s.games.rc.state().phase, 'lobby', 'never a round')
	assert.equal(s.h.selfTick(), 0, 'already open')
	assert.ok(s.logs.some(([lv, m]) => lv === 'info' && m === '[games] self-service opened 3 game session(s)'))
	const st = await s.h.state()
	assert.equal(st.selfService, true, 'GET /api/games/hosting reports it')
})

test('an explicit close holds — from Settings ▸ Games and from the game’s own host page — until the operator opens it again', async (t) => {
	const s = setup(t)
	s.h.selfTick()
	assert.equal((await s.h.host({ action: 'session', game: 'rc', open: false })).status, 200)
	reg().games.get('sk').host({ action: 'disable' }) // the game's own web host page
	assert.equal(s.h.selfTick(), 0)
	assert.deepEqual(s.open(), { rc: false, sk: false, salad: true })
	s.games.salad.disable() // module shutdown / not an operator's close
	assert.equal(s.h.selfTick(), 1)
	assert.deepEqual(s.open(), { rc: false, sk: false, salad: true }, 're-opened')
	assert.equal((await s.h.host({ action: 'session', game: 'rc', open: true })).status, 200, 'opened again here')
	reg().games.get('sk').host({ action: 'enable' }) // opened again on its host page
	s.games.rc.disable()
	s.games.sk.disable()
	assert.equal(s.h.selfTick(), 2, 'the holds are over')
	assert.deepEqual(s.open(), { rc: true, sk: true, salad: true })
	reg().games.get('rc').host({ action: 'disable' }) // a host page closes; Settings ▸ Games opens it
	assert.equal((await s.h.host({ action: 'session', game: 'rc', open: true })).status, 200)
	s.games.rc.disable()
	assert.equal(s.h.selfTick(), 1, 'an open from Settings ends a host page hold too')
})

test('off: `self: false` to every game (also the closed ones), nothing re-opened; on again: sent again', async (t) => {
	const s = setup(t)
	s.h.selfTick()
	s.set({ selfService: false }) // e.g. POST /api/settings {games:{selfService:false}} — the next tick sees it
	s.games.salad.disable()
	assert.equal(s.h.selfTick(), 0)
	assert.deepEqual(s.selfs(), { rc: false, sk: false, salad: null })
	assert.equal(s.open().salad, false)
	s.games.salad.enable()
	assert.equal(s.games.salad.state().self, false, 'a closed game got it too')
	s.games.salad.disable()
	s.set({ selfService: true })
	assert.equal(s.h.selfTick(), 1)
	assert.deepEqual(s.selfs(), { rc: true, sk: true, salad: true })
})

test('POST {action:"selfService", on}: validated, saved through saveSettings, applied at once; a failed save is a 500', async (t) => {
	const s = setup(t)
	assert.equal((await s.h.host({ action: 'selfService' })).status, 400)
	assert.equal((await s.h.host({ action: 'selfService', on: 'yes' })).status, 400)
	const off = await s.h.host({ action: 'selfService', on: false })
	assert.equal(off.status, 200)
	assert.deepEqual(s.saves, [{ selfService: false }])
	assert.equal(off.body.state.selfService, false)
	assert.deepEqual(s.open(), { rc: false, sk: false, salad: false }, 'off opens nothing')
	const on = await s.h.host({ action: 'selfService', on: true })
	assert.equal(on.status, 200)
	assert.equal(on.body.state.selfService, true)
	assert.deepEqual(s.open(), { rc: true, sk: true, salad: true }, 'on opens the closed sessions at once')
	assert.deepEqual(s.selfs(), { rc: true, sk: true, salad: true })
	const s2 = setup(t)
	const h2 = createGamesHosting({ descriptor: () => null, modules: () => [], worldService: () => null, settings: () => GS.normalizeGamesSettings({}),
		port: () => 4200, nets: () => ({}), qr: qrRows, enableModule: async () => ({}), disableModule: async () => ({}) })
	const r = await h2.host({ action: 'selfService', on: false })
	assert.equal(r.status, 500, 'no saveSettings → not saved')
	assert.ok(s2)
})

test('a session opened from Settings ▸ Games gets `self` right away (also with the setting off: `self: false`)', async (t) => {
	const s = setup(t, { selfService: false })
	assert.equal((await s.h.host({ action: 'session', game: 'sk', open: true })).status, 200)
	assert.equal(s.games.sk.state().self, false)
	s.set({})
	assert.equal((await s.h.host({ action: 'session', game: 'rc', open: true })).status, 200)
	assert.equal(s.games.rc.state().self, true)
})

test('register: the 1 s tick runs selfTick only after the start delay; the boot opens sessions with autoOpen OR selfService', async (t) => {
	const sent = []
	const ctx = { config: { games: { selfService: false }, server: { httpPort: 4200 } }, _wsBroadcast: (type, d) => sent.push([type, d]), log: () => {} }
	R.onBoot(ctx)
	t.after(() => R.onShutdown())
	const s = setup(t)
	R._test.use(s.h, s.mods)
	await R._test.tick(true)
	assert.deepEqual(s.open(), { rc: false, sk: false, salad: false }, 'not before the start delay')
	R._test.selfReady(true)
	await R._test.tick()
	assert.deepEqual(s.open(), { rc: true, sk: true, salad: true })
	assert.equal(sent.at(-1)[1].selfService, true)
	const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'games', 'register.js'), 'utf8')
	assert.match(src, /if \(!gs\.autoOpen && !gs\.selfService\) return/)
	assert.match(src, /hosting\(\)\.selfTick\(\)/)
})
