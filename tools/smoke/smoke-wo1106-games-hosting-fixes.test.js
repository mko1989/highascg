'use strict'

/**
 * WO-1106 — review fixes of Settings ▸ Games, the server side (src/games/*) and the web settings save:
 *   A6  PAUSE EVERYTHING without the Game World is sticky: a session opened afterwards opens paused; global.safe says so.
 *   A23 a bot `level` is forwarded only when it is one of the game's own `levels` (posted, and the box defaults).
 *   A7  link-local 169.254/16 and container / VM bridges are 'local' (after LAN and VPN, with a warning), never 'lan'.
 *   A19 the 1 s tick no longer re-reads the module dirs + manifests every second: only when the loaded set changes or 30 s on.
 *   A26 the web Settings save never re-posts its stale `games` section (it has no Games controls).
 *   B1  the module switch (action `module`) passes the code-change gate: the box itself or the password; a LAN device
 *       with auth off and a call without a request get 403 (session / start / bots … stay as they are).
 *   A30 a game hosting adapter that throws is a refusal (logged on open, an error answer on a press), never a 500.
 * Over the THREE REAL games registered like their modules do (the same setup as smoke-wo1105-games-hosting).
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-games-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token') // B1: never the box's real token file
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

/** The three real games registered like their modules do; a hosting service over them (`descriptor` may wrap them). */
function setup(t, { settings = {}, world = null, wrap = (d) => d, gate } = {}) {
	const games = {
		rc: createRcGame({ lanIps: () => ['192.0.2.15'], bakerDeps: bakerDeps('rc') }),
		sk: createSkGame({ lanIps: () => ['192.0.2.15'], bakerDeps: bakerDeps('sk') }),
		salad: createSaladGame({ lanIps: () => ['192.0.2.15'], readTracking: async () => null, bakerDeps: bakerDeps('salad') }),
	}
	RW.register(() => games.rc)
	KW.register(() => games.sk)
	SW.register(() => games.salad)
	const mods = MODS()
	const logs = []
	const calls = []
	let cfg = normalizeGamesSettings(settings)
	const h = createGamesHosting({
		descriptor: (id) => {
			const d = reg().games.get(id) || null
			return d ? wrap(d) : null
		},
		modules: () => mods,
		worldService: () => world,
		settings: () => cfg,
		port: () => 4200,
		nets: () => NETS,
		qr: qrRows,
		enableModule: async (name) => (calls.push(['enable', name]), { ok: true }),
		disableModule: async (name) => (calls.push(['disable', name]), { ok: true }),
		log: (level, msg) => logs.push([level, msg]),
		...(gate ? { mayChangeCode: gate } : {}),
	})
	t.after(() => {
		for (const g of Object.values(games)) g.host({ action: 'disable' })
		RW.unregister()
		KW.unregister()
		SW.unregister()
	})
	return { h, games, mods, logs, calls, set: (s) => (cfg = normalizeGamesSettings(s)) }
}
const row = (st, id) => st.games.find((g) => g.id === id)

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('A6: PAUSE EVERYTHING without the Game World is sticky — a session opened afterwards opens paused', async (t) => {
	const { h, games } = setup(t)
	await h.host({ action: 'session', game: 'rc', open: true })
	assert.equal((await h.host({ action: 'safe', on: true })).status, 200)
	assert.equal(games.rc.state().paused, true)
	const st = (await h.host({ action: 'session', game: 'salad', open: true })).body.state
	assert.equal(games.salad.state().safe, true, 'opened after the press → paused too (its own presenter safe)')
	assert.equal(row(st, 'salad').safe, true)
	assert.equal(st.global.safe, true, 'the button still reads PAUSED')
	await h.host({ action: 'session', game: 'rc', open: false })
	await h.host({ action: 'session', game: 'salad', open: false })
	const none = await h.state()
	assert.equal(none.global.open, 0)
	assert.equal(none.global.safe, true, 'no session open: still PAUSED, so the next one opens paused')
	await h.host({ action: 'session', game: 'sk', open: true })
	assert.equal(games.sk.state().paused, true)
	const off = (await h.host({ action: 'safe', on: false })).body.state
	assert.equal(off.global.safe, false)
	assert.equal(games.sk.state().paused === true, false, 'resume reaches the open game')
	await h.host({ action: 'session', game: 'rc', open: true })
	assert.equal(games.rc.state().paused === true, false, 'after resume a new session runs live')
})

test('A6: with the Game World loaded the world keeps safe (the no-world flag is never reported)', async (t) => {
	const seen = []
	const world = { state: () => ({ on: true, safe: false, house: 1, affect: {} }), host: (b) => (seen.push(b), { status: 200, body: { ok: true } }) }
	const { h } = setup(t, { world })
	const st = (await h.host({ action: 'safe', on: true })).body.state
	assert.deepEqual(seen, [{ action: 'safe', on: true }])
	assert.equal(st.global.safe, false, 'the world’s own state says')
})

/** The rc descriptor with its hosting changed (a copy: the registry object stays as the game made it). */
const rcWith = (over) => (d) => (d.id === 'rc' ? { ...d, hosting: { ...d.hosting, ...over(d.hosting) } } : d)

test('A23: a bot level the game does not have is refused before it reaches the game; a known one goes through', async (t) => {
	const { h, games } = setup(t)
	await h.host({ action: 'session', game: 'rc', open: true })
	const before = games.rc.state().botLevel
	for (const level of ['constructor', '__proto__', 'toString', '']) {
		const r = await h.host({ action: 'bots', game: 'rc', n: 2, level })
		assert.equal(r.status, 400, level)
		assert.match(r.body.error, /`level` must be one of: easy, normal, hard/)
		assert.ok(r.body.state, 'the state comes back')
	}
	assert.equal((await h.host({ action: 'bots', game: 'rc', n: 2, level: 7 })).status, 400, 'not a string')
	assert.equal(games.rc.state().botLevel, before, 'the game never saw a bad level')
	assert.equal(games.rc.state().bots, 0)
	assert.equal((await h.host({ action: 'bots', game: 'rc', n: 2, level: 'hard' })).status, 200)
	assert.equal(games.rc.state().botLevel, 'hard')
	assert.equal((await h.host({ action: 'bots', game: 'rc', n: 1 })).status, 200, 'no level: the game keeps its own')
	assert.equal((await h.host({ action: 'bots', game: 'salad', n: 1, level: 'constructor' })).status, 409, 'closed comes first')
})

test('A23: a box default level the game does not list is not forwarded (the bots still are)', async (t) => {
	const { h, games, logs } = setup(t, { settings: { defaults: { rc: { bots: 2, botLevel: 'hard' } } },
		wrap: rcWith((hh) => ({ bots: { ...hh.bots, levels: ['easy', 'normal'] } })) })
	const sent = []
	const host = games.rc.host
	games.rc.host = (b) => (sent.push(b), host.call(games.rc, b))
	assert.equal((await h.host({ action: 'session', game: 'rc', open: true })).status, 200)
	assert.equal(games.rc.state().bots, 2)
	assert.ok(sent.every((b) => !('level' in b)), JSON.stringify(sent))
	assert.ok(logs.some(([l, m]) => l === 'warn' && /bot level hard is not one of rc/.test(m)))
})

test('A30: a hosting adapter that throws: the session still opens (refusal logged); a press answers an error, never throws', async (t) => {
	const boom = () => {
		throw new Error('adapter bug')
	}
	const { h, games, logs } = setup(t, { settings: { defaults: { rc: { bots: 2, main: 5 } } },
		wrap: rcWith((hh) => ({ bots: { ...hh.bots, body: boom }, main: { ...hh.main, body: () => undefined }, safe: boom })) })
	const open = await h.host({ action: 'session', game: 'rc', open: true })
	assert.equal(open.status, 200, JSON.stringify(open.body.error))
	assert.equal(games.rc.state().enabled, true)
	assert.equal(logs.filter(([l, m]) => l === 'warn' && /default for rc refused: the game failed/.test(m)).length, 2, 'bots + main')
	const bots = await h.host({ action: 'bots', game: 'rc', n: 1 })
	assert.deepEqual([bots.status, bots.body.ok, bots.body.error], [500, false, 'the game failed'])
	assert.equal((await h.host({ action: 'main', game: 'rc', value: 4 })).status, 500)
	const safe = await h.host({ action: 'safe', on: true })
	assert.equal(safe.status, 200, 'a throwing safe builder falls back to the plain pause body')
	assert.equal(games.rc.state().paused, true)
})

test('A19: the 1 s tick reads the module list from disk once, again when a module loads / unloads, else every 30 s', async (t) => {
	const ML = require('../../src/module-host/module-loader')
	const MR = require('../../src/module-registry')
	const R = require('../../src/games/register')
	const orig = ML.listAvailable
	let reads = 0
	ML.listAvailable = () => (reads++, [])
	t.after(() => {
		ML.listAvailable = orig
		MR.unregister('wo1106-fake-game')
	})
	t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
	R.onBoot({ config: { games: {}, server: { httpPort: 4200 } }, _wsBroadcast: () => {}, log: () => {} })
	t.after(() => R.onShutdown())
	const ticks = async (n) => {
		for (let i = 0; i < n; i++) {
			t.mock.timers.tick(1000)
			await R._test.tick()
		}
	}
	await ticks(20)
	assert.equal(reads, 1, 'twenty ticks, one read (was one per tick)')
	MR.register({ name: 'wo1106-fake-game' }) // a module enabled from anywhere (the Modules page)
	await ticks(1)
	assert.equal(reads, 2, 'a module loaded → read at once')
	await ticks(5)
	assert.equal(reads, 2)
	MR.unregister('wo1106-fake-game')
	await ticks(1)
	assert.equal(reads, 3, 'unloaded → read at once')
	await ticks(31)
	assert.equal(reads, 4, 'otherwise every 30 s (a module installed but not loaded)')
})

test('A7: link-local and docker / VM bridge addresses are local-only — after LAN and VPN, with a warning when picked', () => {
	const J = require('../../src/games/games-join')
	const v4 = (address, internal = false) => [{ address, family: 'IPv4', internal }]
	const nets = { lo: v4('127.0.0.1', true), docker0: v4('172.17.0.1'), 'br-0123456789ab': v4('172.18.0.1'), virbr0: v4('192.168.122.1'),
		enp4s0: v4('169.254.10.2'), br0: v4('192.168.1.5'), eno1: v4('192.168.0.15'), tailscale0: v4('100.101.245.97') }
	const a = J.listAddresses(nets)
	assert.deepEqual(a.map((x) => [x.iface, x.kind]), [['eno1', 'lan'], ['br0', 'lan'], ['tailscale0', 'vpn'], ['enp4s0', 'local'],
		['docker0', 'local'], ['br-0123456789ab', 'local'], ['virbr0', 'local'], ['lo', 'loopback']], 'a plain br0 (the venue LAN bridged) stays lan')
	assert.equal(J.pickAddress(a, '').ip, '192.168.0.15', 'automatic never picks docker0 (172.17 sorted before 192.168 as lan)')
	const onlyLocal = J.pickAddress(J.listAddresses({ lo: nets.lo, docker0: nets.docker0, enp4s0: nets.enp4s0 }), '')
	assert.deepEqual([onlyLocal.ip, onlyLocal.kind, onlyLocal.auto], ['169.254.10.2', 'local', true])
	assert.match(onlyLocal.warning, /local-only address .*phones cannot reach it/)
	const picked = J.pickAddress(a, 'docker0')
	assert.deepEqual([picked.ip, picked.auto], ['172.17.0.1', false])
	assert.match(picked.warning, /^172\.17\.0\.1 \(docker0\) is a local-only address/)
	assert.equal(J.pickAddress(J.listAddresses({ lo: nets.lo, docker0: nets.docker0, tailscale0: nets.tailscale0 }), '').kind, 'vpn', 'a VPN beats local-only')
})

test('A26: the web Settings save leaves `games` out (its stale copy reverted a change made in Settings ▸ Games)', async (t) => {
	const hadDoc = 'document' in globalThis
	if (!hadDoc) globalThis.document = { dispatchEvent() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }
	t.after(() => {
		if (!hadDoc) delete globalThis.document
	})
	const root = path.join(__dirname, '../..')
	const { buildSettingsPayload } = await import(path.join(root, 'client/components/settings-modal-logic.js'))
	const { settingsState } = await import(path.join(root, 'client/lib/settings-state.js'))
	settingsState.settings = { games: { joinAddress: '10.0.0.1', autoOpen: true, defaults: { rc: { bots: 3 } } }, ui: {}, local_media_path: '/m' }
	const els = { '#set-companion-host': { value: '' }, '#set-companion-port': { value: '' } }
	const p = buildSettingsPayload({ querySelector: (s) => els[s] || null, querySelectorAll: () => [] })
	assert.equal('games' in p, false, JSON.stringify(p.games))
	assert.equal(p.local_media_path, '/m', 'the rest of the stored settings still go')
	const { mergeGamesSettings } = require('../../src/games/games-settings')
	assert.deepEqual(mergeGamesSettings({ joinAddress: 'eno1' }, { joinAddress: '10.0.0.1' }).joinAddress, '10.0.0.1', 'what a stale copy did (the server merges any `games` it gets)')
})

test('B1: the module switch needs the box itself or the password (code-change gate); sessions do not', async (t) => {
	const { mayChangeInstalledCode } = require('../../src/module-host/code-change-gate')
	const PW = 'wo1106-games-pw'
	const OFF = { config: {} }
	const ON = { config: { security: { enforceAuth: true, apiToken: PW } } }
	const BOX = { socket: { remoteAddress: '127.0.0.1', localPort: 4200 }, headers: { host: '127.0.0.1:4200' } }
	const LAN = { socket: { remoteAddress: '192.168.1.50', localPort: 4200 }, headers: { host: '192.168.1.17:4200' } }
	let ctx = OFF
	const { h, calls } = setup(t, { gate: (req) => mayChangeInstalledCode(req, ctx) })
	const lan = await h.host({ action: 'module', game: 'sk', on: false }, LAN)
	assert.equal(lan.status, 403, 'a LAN device with API auth off')
	assert.equal(lan.body.code, 'NOT_ALLOWED')
	assert.match(lan.body.error, /only allowed with a password or on the box itself/)
	assert.ok(lan.body.state, 'the state comes back')
	assert.equal((await h.host({ action: 'module', game: 'sk', on: false })).status, 403, 'no request = refused')
	assert.deepEqual(calls, [], 'the loader was never called')
	assert.equal((await h.host({ action: 'module', game: 'sk', on: false }, BOX)).status, 200, 'the on-box client')
	ctx = ON
	const authed = { ...LAN, headers: { ...LAN.headers, authorization: `Bearer ${PW}` } }
	assert.equal((await h.host({ action: 'module', game: 'world', on: true }, authed)).status, 200, 'the password, auth on')
	assert.equal((await h.host({ action: 'module', game: 'world', on: true }, LAN)).status, 403, 'auth on, no password')
	assert.deepEqual(calls, [['disable', 'toy-skirmish'], ['enable', 'game-world']])
	assert.equal((await h.host({ action: 'session', game: 'rc', open: true }, LAN)).status, 200, 'hosting a session stays as it was')
	assert.equal((await h.host({ action: 'session', game: 'rc', open: false })).status, 200)
	const { h: plain } = setup(t)
	assert.equal((await plain.host({ action: 'module', game: 'sk', on: true }, LAN)).status, 403, 'no gate handed in: only the box passes')
	assert.equal((await plain.host({ action: 'module', game: 'sk', on: true }, BOX)).status, 200)
})

test('B1: POST /api/games/hosting hands the request to the module switch', async (t) => {
	const R = require('../../src/games/register')
	const routes = {}
	R.registerRoutes({ get: (p, fn) => (routes['GET ' + p] = fn), post: (p, fn) => (routes['POST ' + p] = fn) })
	const ctx = { config: { games: {}, server: { httpPort: 4200 } }, _wsBroadcast: () => {}, log: () => {} }
	R.onBoot(ctx)
	t.after(() => R.onShutdown())
	R._test.use(null, [])
	const LAN = { socket: { remoteAddress: '192.168.1.50', localPort: 4200 }, headers: { host: '192.168.1.17:4200' } }
	const r = await routes['POST /api/games/hosting']({ ctx, req: LAN, body: JSON.stringify({ action: 'module', game: 'sk', on: true }) })
	assert.equal(r.status, 403, 'the real service (register.js) with the server config: auth off, a LAN device')
	assert.match(JSON.parse(r.body).error, /on the box itself/)
	const src = fs.readFileSync(path.join(__dirname, '../../src/games/register.js'), 'utf8')
	assert.ok(src.includes('mayChangeCode: (req) => mayChangeInstalledCode(req, c)'), 'the gate gets the server config (auth on + password passes)')
})
