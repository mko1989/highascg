'use strict'

/**
 * WO-1105 — Settings ▸ Games, the server: src/games/games-hosting.js (+ games-hosting-rows.js, register.js) over the
 * THREE REAL games (rc-game, toy-skirmish, stage-salad) registered in the Game World registry by their own *-world.js —
 * the very host / state functions the games' web routes call, so the aggregated state and the web host pages agree
 * both ways. Proves: one row per installed game module + the world row, module off → 'off'; sessions open with this
 * box's defaults (bots + level + the main number in each game's own host body) and close; start / stop; bots / main
 * refused while closed; presenter safe / lights / wall / house fan out to every open game without the world module and
 * go through the world service when it is loaded (affect needs it); every bad body is a 400 with the state; the module
 * switch calls the loader; a change made through the game's own host function shows in the next state; autoOpen opens
 * lobbies only; the routes (GET / POST /api/games/hosting) and the `games:hosting` broadcast on change.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createGamesHosting } = require('../../src/games/games-hosting')
const { normalizeGamesSettings } = require('../../src/games/games-settings')
const { qrRows } = require('../../src/games/games-qr')
const { createRcGame } = require('../../modules/rc-game/server/rc-game')
const { createSkGame } = require('../../modules/toy-skirmish/server/sk-game')
const { createSaladGame } = require('../../modules/stage-salad/server/salad-game')
const RW = require('../../modules/rc-game/server/rc-world')
const KW = require('../../modules/toy-skirmish/server/sk-world')
const SW = require('../../modules/stage-salad/server/salad-world')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1105-games-'))
const KEY = Symbol.for('highascg.game-world/1')
const reg = () => globalThis[KEY] || (globalThis[KEY] = { v: 1, games: new Map(), hub: null })
const bakerDeps = (name) => ({ loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null },
	cacheDir: path.join(TMP, name) })
const NETS = { lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }], eno1: [{ address: '192.0.2.15', family: 'IPv4', internal: false }] }

const MODS = () => [
	{ name: 'game-world', game: 'world', title: 'Game World', enabled: false, loaded: false },
	{ name: 'rc-game', game: 'rc', title: 'Stage Sprint RC', enabled: true, loaded: true },
	{ name: 'toy-skirmish', game: 'sk', title: 'Stage Skirmish', enabled: true, loaded: true },
	{ name: 'stage-salad', game: 'salad', title: 'Stage Salad', enabled: true, loaded: true },
]

/** The three real games registered like their modules do; a hosting service over them; cleanup after. */
function setup(t, { settings = {}, world = null } = {}) {
	const games = {
		rc: createRcGame({ lanIps: () => ['192.0.2.15'], bakerDeps: bakerDeps('rc') }),
		sk: createSkGame({ lanIps: () => ['192.0.2.15'], bakerDeps: bakerDeps('sk') }),
		salad: createSaladGame({ lanIps: () => ['192.0.2.15'], readTracking: async () => null, bakerDeps: bakerDeps('salad') }),
	}
	RW.register(() => games.rc)
	KW.register(() => games.sk)
	SW.register(() => games.salad)
	const mods = MODS()
	const calls = []
	let cfg = normalizeGamesSettings(settings)
	const h = createGamesHosting({
		descriptor: (id) => reg().games.get(id) || null, // in the box: the module's gameDescriptor() — the same object
		modules: () => mods,
		worldService: () => world,
		settings: () => cfg,
		port: () => 4200,
		nets: () => NETS,
		qr: qrRows,
		enableModule: async (name) => (calls.push(['enable', name]), { ok: true }),
		disableModule: async (name) => (calls.push(['disable', name]), name === 'nope' ? { ok: false } : { ok: true }),
	})
	t.after(() => {
		for (const g of Object.values(games)) g.host({ action: 'disable' })
		RW.unregister()
		KW.unregister()
		SW.unregister()
	})
	return { h, games, mods, calls, set: (s) => (cfg = normalizeGamesSettings(s)) }
}
const row = (st, id) => st.games.find((g) => g.id === id)

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('state: one row per installed game + the world; closed until opened; join address + QR for every module that is on', async (t) => {
	const { h, mods } = setup(t)
	mods[3].enabled = false
	mods[3].loaded = false
	const st = await h.state()
	assert.equal(st.v, 1)
	assert.deepEqual(st.games.map((g) => g.id), ['rc', 'sk', 'salad'])
	assert.deepEqual(st.games.map((g) => g.phase), ['closed', 'closed', 'off'])
	assert.equal(row(st, 'rc').title, 'Stage Sprint RC', 'the descriptor names it')
	assert.deepEqual(row(st, 'rc').main, { label: 'Laps', value: null, min: 1, max: 20 })
	assert.equal(row(st, 'rc').bots.max > 0, true)
	assert.deepEqual(row(st, 'rc').paths, { play: '/game/rc/', host: '/game/rc/?host=1', spectate: '/game/rc/?spectate=1' })
	assert.equal(row(st, 'rc').joinUrl, 'http://192.0.2.15:4200/game/rc/')
	assert.equal(row(st, 'rc').qr.n >= 21, true)
	assert.equal(row(st, 'salad').joinUrl, null, 'module off → no join code')
	assert.equal(row(st, 'salad').qr, null)
	assert.deepEqual({ ip: st.join.ip, iface: st.join.iface, auto: st.join.auto, warning: st.join.warning }, { ip: '192.0.2.15', iface: 'eno1', auto: true, warning: '' })
	assert.equal(st.world.moduleOn, false)
	assert.equal(st.world.joinUrl, null)
	assert.deepEqual(st.global, { safe: false, lights: false, wall: false, house: 1, open: 0, running: 0 })
})

test('session: open applies this box’s defaults in each game’s own host body; the game’s own host page sees it and back', async (t) => {
	const { h, games } = setup(t, { settings: { defaults: { rc: { bots: 2, botLevel: 'hard', main: 5 }, sk: { bots: 1, main: 4 }, salad: { main: 90 } } } })
	for (const id of ['rc', 'sk', 'salad']) {
		const r = await h.host({ action: 'session', game: id, open: true })
		assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.body.error)}`)
	}
	const st = (await h.host({ action: 'session', game: 'rc', open: true })).body.state // idempotent
	assert.deepEqual(st.games.map((g) => g.phase), ['lobby', 'lobby', 'lobby'])
	assert.deepEqual(row(st, 'rc').bots.n, 2)
	assert.equal(row(st, 'rc').bots.level, 'hard')
	assert.equal(row(st, 'rc').main.value, 5)
	assert.equal(games.rc.state().laps, 5, 'the game itself holds it (its web host page shows the same)')
	assert.equal(row(st, 'sk').bots.n, 1)
	assert.equal(row(st, 'sk').main.value, 4)
	assert.equal(games.salad.state().secs, 90, 'salad: its round length')
	assert.equal(st.global.open, 3)
	games.rc.host({ action: 'laps', laps: 7 }) // the web host page
	assert.equal(row(await h.state(), 'rc').main.value, 7, 'a change on the web host page shows here')
	const closed = await h.host({ action: 'session', game: 'sk', open: false })
	assert.equal(closed.status, 200)
	assert.equal(row(closed.body.state, 'sk').phase, 'closed')
	assert.equal(games.sk.state().enabled, false)
})

test('start / stop, bots, main: refused while closed; one game or every open one; the game’s own refusal comes back', async (t) => {
	const { h, games } = setup(t)
	assert.equal((await h.host({ action: 'bots', game: 'rc', n: 2 })).status, 409, 'closed')
	assert.match((await h.host({ action: 'main', game: 'rc', value: 4 })).body.error, /session is closed/)
	assert.equal((await h.host({ action: 'start' })).status, 409, 'nothing open')
	await h.host({ action: 'session', game: 'rc', open: true })
	await h.host({ action: 'session', game: 'salad', open: true })
	assert.equal((await h.host({ action: 'bots', game: 'rc', n: 3, level: 'easy' })).status, 200)
	assert.equal(games.rc.state().bots, 3)
	assert.equal(games.rc.state().botLevel, 'easy')
	assert.equal((await h.host({ action: 'bots', game: 'rc', n: 1 })).status, 200)
	assert.equal(games.rc.state().botLevel, 'easy', 'no level given → the game’s current one kept')
	assert.equal((await h.host({ action: 'bots', game: 'salad', n: 2 })).status, 200)
	assert.equal(games.salad.state().bots, 2)
	assert.equal((await h.host({ action: 'main', game: 'rc', value: 99 })).status, 400, 'the game refuses more than its laps')
	assert.equal((await h.host({ action: 'main', game: 'rc', value: 6 })).body.state.games[0].main.value, 6)
	// offline there is no stage model: the games refuse a round, and that refusal is what the pane shows
	const start = await h.host({ action: 'start' })
	assert.equal(start.status, 409)
	assert.deepEqual(start.body.results, { rc: { ok: false, status: 409, error: 'no track' }, salad: { ok: false, status: 409, error: 'no venue yet' } })
	assert.equal(start.body.error, 'no track')
	assert.equal(start.body.state.global.running, 0)
})

test('rows: running = a round is on (a paused one too), never lobby / results; players without bots; safe from the game', () => {
	const { gameRow } = require('../../src/games/games-hosting-rows')
	const hosting = require('../../modules/stage-salad/server/salad-hosting')
	const at = (st) => gameRow({ name: 'stage-salad', game: 'salad', enabled: true, loaded: true }, { desc: () => ({ title: 'Stage Salad' }),
		hostingOf: () => hosting, stateOf: () => st, worldState: null, settings: { defaults: {} }, ip: '192.0.2.15', port: 4200 })
	const base = { enabled: true, players: [{ bot: false }, { bot: true }, { bot: false, connected: false }], bots: 1, botLevel: 'hard' }
	assert.equal(at({ ...base, phase: 'lobby' }).running, false)
	assert.equal(at({ ...base, phase: 'results' }).running, false)
	assert.equal(at({ ...base, phase: 'round' }).running, true)
	const paused = at({ ...base, phase: 'round', paused: true, safe: true })
	assert.deepEqual([paused.running, paused.phase, paused.safe], [true, 'paused', true])
	assert.equal(at({ ...base, phase: 'round', safe: true }).phase, 'paused', 'salad pauses as `safe` (no `paused` key) — still shown paused')
	assert.equal(at({ ...base, phase: 'lobby' }).players, 1, 'connected humans only')
	assert.deepEqual(at({ ...base, phase: 'lobby' }).bots, { n: 1, level: 'hard', max: hosting.bots.max, levels: hosting.bots.levels })
	assert.equal(at({ enabled: false }).phase, 'closed')
})

test('presenter safe / lights / wall / house without the world module: every open game, in its own body', async (t) => {
	const { h, games } = setup(t)
	await h.host({ action: 'session', game: 'rc', open: true })
	await h.host({ action: 'session', game: 'salad', open: true })
	const on = await h.host({ action: 'safe', on: true })
	assert.equal(on.status, 200, JSON.stringify(on.body))
	assert.equal(games.rc.state().paused, true, 'rc: pause')
	assert.equal(games.salad.state().safe, true, 'salad: its presenter safe')
	assert.equal(on.body.state.global.safe, true)
	assert.equal(row(on.body.state, 'rc').safe, true)
	assert.equal((await h.host({ action: 'safe', on: false })).body.state.global.safe, false)
	assert.equal((await h.host({ action: 'house', level: 0.25 })).body.state.global.house, 0.25)
	assert.equal(games.salad.state().house, 0.25)
	assert.equal((await h.host({ action: 'affect', game: 'rc', mode: 'soft' })).status, 409, 'affect needs the Game World')
})

test('with the Game World loaded: safe / lights / affect / session go through its service (it tells the games)', async (t) => {
	const seen = []
	const world = { state: () => ({ on: true, safe: false, house: 1, affect: { rc: 'soft' } }), host: (b) => (seen.push(b), { status: 200, body: { ok: true } }) }
	const { h, mods } = setup(t, { world, settings: { defaults: { rc: { affect: 'off' } } } })
	mods[0].enabled = mods[0].loaded = true
	assert.equal((await h.host({ action: 'safe', on: true })).status, 200)
	assert.equal((await h.host({ action: 'affect', game: 'rc', mode: 'on' })).status, 200)
	const st = (await h.host({ action: 'session', game: 'rc', open: true })).body.state
	assert.deepEqual(seen, [{ action: 'safe', on: true }, { action: 'affect', game: 'rc', mode: 'on' }, { action: 'enable', game: 'rc' },
		{ action: 'affect', game: 'rc', mode: 'off' }])
	assert.equal(row(st, 'rc').affect, 'soft', 'the world’s own affect state')
	assert.equal(st.world.moduleOn, true)
	assert.equal(st.world.joinUrl, 'http://192.0.2.15:4200/game/world/')
	assert.equal(st.world.qr.n >= 21, true)
})

test('validation: every bad body is a 400 with the state; the module switch calls the loader', async (t) => {
	const { h, calls } = setup(t)
	for (const bad of [null, [], 'x', { action: 'boom' }, { action: 'bots', game: 'rc' }, { action: 'bots', game: 'rc', n: -1 },
		{ action: 'bots', game: 'rc', n: 1.5 }, { action: 'session', game: 'rc' }, { action: 'module', game: 'rc', on: 'yes' },
		{ action: 'safe' }, { action: 'house', level: 2 }, { action: 'house', level: '0.5' }, { action: 'affect', game: 'rc', mode: 'x' },
		{ action: 'main', game: 'rc', value: '5' }, { action: 'start', game: '../x' }, { action: 'session', open: true }]) {
		const r = await h.host(bad)
		assert.equal(r.status, 400, JSON.stringify(bad))
		assert.equal(r.body.ok, false)
		assert.ok(r.body.state && Array.isArray(r.body.state.games), 'the state comes back')
	}
	assert.equal((await h.host({ action: 'module', game: 'world', on: true })).status, 200)
	assert.equal((await h.host({ action: 'module', game: 'sk', on: false })).status, 200)
	assert.equal((await h.host({ action: 'module', game: 'nope', on: true })).status, 404)
	assert.deepEqual(calls, [['enable', 'game-world'], ['disable', 'toy-skirmish']])
	assert.equal(calls.length, 2, 'a refused body never reached the loader')
})

test('the core reaches a game through its module: gameDescriptor() is the registry descriptor (with its hosting)', () => {
	for (const [dir, W, id] of [['rc-game', RW, 'rc'], ['toy-skirmish', KW, 'sk'], ['stage-salad', SW, 'salad']]) {
		const src = fs.readFileSync(path.join(__dirname, `../../modules/${dir}/register.js`), 'utf8')
		assert.ok(src.includes('gameDescriptor: () => world.descriptor(),'), `${dir}/register.js hands its descriptor to the core`)
		W.register(() => ({ state: () => ({}) }))
		try {
			assert.equal(W.descriptor(), reg().games.get(id), `${dir}: the very registry object`)
			for (const k of ['main', 'bots', 'safe', 'isSafe']) assert.ok(W.descriptor().hosting[k], `${dir} hosting.${k}`)
		} finally {
			W.unregister()
		}
		assert.equal(W.descriptor(), null, 'gone after unregister')
	}
	for (const f of fs.readdirSync(path.join(__dirname, '../../src/games')).filter((x) => x.endsWith('.js'))) {
		assert.ok(!/Symbol\.for|globalThis/.test(fs.readFileSync(path.join(__dirname, '../../src/games', f), 'utf8')), `${f} never reads a process registry`)
	}
})

test('autoOpen: opens the loaded games’ lobbies (never a round, never the world); sessions are runtime state', async (t) => {
	const { h, games } = setup(t, { settings: { autoOpen: true } })
	assert.equal(h.autoOpen(), 3)
	assert.deepEqual([games.rc, games.sk, games.salad].map((g) => g.state().phase), ['lobby', 'lobby', 'lobby'])
	assert.equal(h.autoOpen(), 0, 'already open')
	const reg2 = require('../../src/games/register')
	assert.deepEqual(reg2.apiPathPrefixes, ['/api/games'])
	assert.deepEqual(reg2.wsNamespaces, ['games:'])
})

test('routes + broadcast: GET / POST /api/games/hosting (strict JSON), `games:hosting` sent on change only', async (t) => {
	let games
	const setupHosting = (tt) => {
		const s = setup(tt)
		games = s.games
		return [s.h, s.mods]
	}
	const R = require('../../src/games/register')
	const routes = {}
	R.registerRoutes({ get: (p, fn) => (routes['GET ' + p] = fn), post: (p, fn) => (routes['POST ' + p] = fn) })
	assert.deepEqual(Object.keys(routes), ['GET /api/games/hosting', 'POST /api/games/hosting'])
	const sent = []
	const ctx = { config: { games: {}, server: { httpPort: 4200 } }, _wsBroadcast: (type, d) => sent.push([type, d]), log: () => {} }
	R.onBoot(ctx)
	t.after(() => R.onShutdown())
	R._test.use(...setupHosting(t)) // the real routes + broadcast over this smoke's module list
	const g = await routes['GET /api/games/hosting']({ ctx })
	assert.equal(g.status, 200)
	assert.equal(g.headers['Cache-Control'], 'no-store')
	assert.deepEqual(JSON.parse(g.body).games.map((x) => x.id), ['rc', 'sk', 'salad'])
	assert.equal((await routes['POST /api/games/hosting']({ ctx, body: '{bad' })).status, 400)
	assert.equal((await routes['POST /api/games/hosting']({ ctx, body: '[]' })).status, 400)
	await R._test.tick(true)
	const n = sent.length
	assert.equal(sent.at(-1)[0], 'games:hosting')
	await R._test.tick()
	assert.equal(sent.length, n, 'unchanged → nothing sent')
	games.rc.host({ action: 'enable' }) // the game's own host page
	await R._test.tick()
	assert.equal(sent.length, n + 1, 'a change made elsewhere is sent')
})
