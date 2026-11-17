'use strict'

/**
 * WO-1106 games-2 — B34 resume, the page half (modules/{rc-game,toy-skirmish,stage-salad}/client): each game's net
 * layer keeps the `welcome`'s resume token (memory + the page's store) and sends it in its next player join (never a
 * spectator's); 4409 kicked forgets it; 4410 (resumed on another page) stops reconnecting with status `replaced`; a junk
 * stored token is never sent. Salad's decode keeps the token. A resumed `welcome` does not rebuild the page as a new
 * player: RC keeps its own car model and takes the server's lap count (back to the server's checkpoint); Salad keeps
 * its state, phase and flights.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { pathToFileURL } = require('url')
const F = require('./lib/rc-client-fixtures.js')

const { registerHooks } = require('node:module')

const MOD = path.join(__dirname, '..', '..', 'modules')
/* Skirmish and Salad pages load the RC client's shared files as ./kit/ (the server maps it); here: the same files */
const KIT = pathToFileURL(path.join(MOD, 'rc-game', 'client') + path.sep).href
registerHooks({
	resolve(spec, ctx, next) {
		if (spec.startsWith('./kit/') && ctx.parentURL && /\/(toy-skirmish|stage-salad)\/client\//.test(ctx.parentURL)) return next(KIT + spec.slice(6), ctx)
		return next(spec, ctx)
	},
})
const load = (game, f) => import(pathToFileURL(path.join(MOD, game, 'client', f)).href)
const NETS = [['rc-game', 'RcNet'], ['toy-skirmish', 'SkNet'], ['stage-salad', 'SaladNet']]
const TOKEN = '7.AAAAAAAAAAAAAAAAAAAAAA'
const TOKEN2 = '7.BBBBBBBBBBBBBBBBBBBBBB'

/** A page around one net: a fake WebSocket class, hand-run timers, a store for the token. */
function page(Net, stored = null) {
	const sockets = []
	class FakeWs {
		constructor(url) {
			this.url = url
			this.readyState = 0
			this.sent = []
			sockets.push(this)
		}
		send(s) {
			this.sent.push(JSON.parse(s))
		}
		close() {
			this.readyState = 3
		}
		open() {
			this.readyState = 1
			this.onopen?.()
		}
		recv(m) {
			this.onmessage?.({ data: JSON.stringify(m) })
		}
		drop(code) {
			this.readyState = 3
			this.onclose?.({ code })
		}
	}
	const timeouts = []
	const store = { v: stored, sets: [] }
	const statuses = []
	const net = new Net({
		url: 'ws://x/ws', WebSocket: FakeWs, now: () => 0,
		setTimeout: (fn) => timeouts.push(fn), clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
		onStatus: (s) => statuses.push(s),
		resume: { get: () => store.v, set: (v) => (store.sets.push(v), (store.v = v)) },
	})
	const ws = () => sockets.at(-1)
	const joinSent = () => ws().sent.find((m) => m.t === 'join')
	const retry = () => timeouts.splice(0).forEach((fn) => fn())
	return { net, sockets, ws, joinSent, retry, store, statuses, timeouts }
}

for (const [game, cls] of NETS) {
	test(`B34 ${game}: the welcome's token is kept and sent in the next join after a drop; a spectator never sends one`, async () => {
		const Net = (await load(game, 'net.js'))[cls]
		const P = page(Net)
		P.net.connect('Ann', '#ff5533')
		P.ws().open()
		assert.equal(P.joinSent().resume, undefined, 'a first join carries no token')
		P.ws().recv({ t: 'welcome', id: 7, you: { id: 7 }, state: {}, resume: TOKEN })
		assert.deepEqual(P.store.sets, [TOKEN], 'stored for a reload of this tab')
		P.ws().drop(1006)
		P.retry()
		P.ws().open()
		assert.equal(P.joinSent().resume, TOKEN)
		assert.equal(P.joinSent().name, 'Ann')
		const reload = page(Net, TOKEN) // the same tab reloaded: the token comes from the store
		reload.net.connect('Ann', '#ff5533')
		reload.ws().open()
		assert.equal(reload.joinSent().resume, TOKEN)
		const spec = page(Net, TOKEN)
		spec.net.connect('Spectator', '#ffffff', true)
		spec.ws().open()
		assert.equal(spec.joinSent().resume, undefined)
		const junk = page(Net, '../../x')
		junk.net.connect('Ann', '#ff5533')
		junk.ws().open()
		assert.equal(junk.joinSent().resume, undefined, 'a junk stored value is never sent')
	})

	test(`B34 ${game}: 4410 (went on on another page) → status replaced, no reconnect; 4409 kicked forgets the token`, async () => {
		const Net = (await load(game, 'net.js'))[cls]
		assert.equal((await load(game, 'net.js')).REPLACED_CODE, 4410)
		const P = page(Net, TOKEN)
		P.net.connect('Ann', '#ff5533')
		P.ws().open()
		P.ws().recv({ t: 'welcome', id: 7, you: { id: 7 }, state: {}, resume: TOKEN2 })
		P.ws().drop(4410)
		assert.equal(P.net.status, 'replaced')
		assert.equal(P.timeouts.length, 0, 'no auto-rejoin (the two pages would take the seat from each other forever)')
		P.net.connect('Ann', '#ff5533') // "Play here"
		P.ws().open()
		assert.equal(P.joinSent().resume, TOKEN2, 'takes the seat back with the newest token')
		P.ws().drop(4409)
		assert.equal(P.net.status, 'kicked')
		assert.equal(P.store.v, null, 'a kicked player\'s token is gone')
		P.net.connect('Ann', '#ff5533')
		P.ws().open()
		assert.equal(P.joinSent().resume, undefined)
		P.net.forget() // the lobby's "change name": a new player
		assert.equal(P.net.token, null)
	})
}

test('B34 stage-salad: decode keeps the welcome\'s resume token and the resumed flag', async () => {
	const PR = await load('stage-salad', 'protocol.js')
	const w = PR.decode(JSON.stringify({ t: 'welcome', id: 3, you: {}, state: {}, resume: TOKEN, resumed: true }))
	assert.equal(w.resume, TOKEN)
	assert.equal(w.resumed, true)
	assert.deepEqual(Object.keys(PR.decode(JSON.stringify({ t: 'welcome', id: 3, state: {} }))), ['t', 'id', 'you', 'state'])
})

/** Anything: every property is a no-op function that returns undefined (HUD, audio, world views). */
const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : any()), apply: () => undefined })

test('B34 rc-game: a resumed welcome keeps the own car model and takes the server\'s lap count (back to its checkpoint)', async () => {
	const SESS = await load('rc-game', 'session.js')
	const ST = await load('rc-game', 'standings.js')
	const ITEMS = await load('rc-game', 'items.js')
	let respawns = 0
	const model = { group: {}, dispose() {
		throw new Error('the own car model was rebuilt')
	} }
	const G = {
		spectator: false, meId: 7, me: { id: 7, color: '#ff5533' }, phase: 'race', state: { phase: 'race' }, startAt: 1,
		remotes: new Map(), race: new ST.RaceTracker(null), items: new ITEMS.ItemState(), car: { x: 0, y: 0, z: 0 }, myModel: model, T: F.ovalTrack(),
		ctl: { setTrack() {}, toGrid() {}, gameOff() {}, respawn: () => respawns++ },
		hud: any(), lobby: any(), director: { notify() {} }, world: { scene: { add() {}, remove() {} } }, s: 1,
	}
	G.race._get(7).lap.lap = 2 // this page counted a lap the server never got (offline)
	const you = { id: 7, name: 'Ann', color: '#ff5533', slot: 0, spectator: false, race: { lap: 1, cp: 3 } }
	const state = { phase: 'race', startAt: 1, players: [{ id: 7, name: 'Ann', color: '#ff5533', connected: true, racing: true }] }
	SESS.onMessage(G, { t: 'welcome', id: 7, you, state, resume: TOKEN, resumed: true })
	assert.equal(G.myModel, model)
	assert.deepEqual([G.race._get(7).lap.lap, G.race._get(7).lap.cp], [1, 3])
	assert.equal(respawns, 1, 'back to the server\'s checkpoint')
	SESS.onMessage(G, { t: 'welcome', id: 7, you, state, resume: TOKEN, resumed: true })
	assert.equal(respawns, 1, 'already in step: stays where it is')
})

test('B34 stage-salad: a resumed welcome of this page\'s player keeps its state, phase and flights', async () => {
	const SESS = await load('stage-salad', 'session.js')
	let cleared = 0
	const state = { phase: 'round', players: [], sceneRev: 'r', venueRev: 'v' }
	const G = {
		spectator: false, meId: 4, state, phase: 'round', book: { clear: () => cleared++, meId: 4 },
		hud: any(), lobby: any(), avatars: any(), slings: any(), ctl: any(), input: any(), audio: any(),
	}
	SESS.onMessage(G, { t: 'welcome', id: 4, you: { id: 4, color: '#ff5533', name: 'Ann' }, state: { ...state }, resumed: true })
	assert.equal(cleared, 0, 'the flights in the air stay')
	assert.equal(G.phase, 'round')
	SESS.onMessage(G, { t: 'welcome', id: 9, you: { id: 9 }, state: { ...state } })
	assert.equal(cleared, 1, 'a new player starts clean')
})
