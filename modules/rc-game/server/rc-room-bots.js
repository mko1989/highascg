'use strict'

/**
 * WO-1082 — race bots on the server. Each bot is a virtual socket (`conn.botSink`) that joins the room like a browser
 * and is driven by client/bot-brain.js (the client's own physics, items and lap code, import()ed once per enable). The
 * room cannot tell it from a player except for the `bot` flag it sets from the conn: same join, same `s` / `box` /
 * `use` / `hit` messages, same referee. One 30 Hz timer (two 60 Hz physics steps per bot) runs only while bots exist.
 * The scene's tracks become physics worlds lazily (one per track a bot is on; the occupancy grids decoded once).
 *
 *   createRoomBots({ connect(conn), handle(conn, msg), disconnect(conn), now?, timers?, rng?, log?, load?, patches? })
 *     patches() → the Game World's live R2 slick patches [{ x, y, z, r, until }] (rc-world.js; WO-1106 A35): handed to
 *     every bot's step as `world.patches`, so a splat slows a bot as it slows a player's car; none → the step is as before
 *     setScene(scene)      the baked scene JSON (floors, obstacles, occ, tracks, scale)
 *     setCount(n, level?)  → { ok, count }: bots join / leave until n (0 … MAX_BOTS); level easy | normal | hard
 *     preload()            → Promise: load the brain + physics modules (enable() calls it; setCount waits for it)
 *     deliver(conn, msg)   what the room sends to a bot conn (rc-game.js sendTo hands it over)
 *     count(), dispose()
 */

const path = require('path')
const { freshImport } = require('./rc-fresh-import')

const MAX_BOTS = 9
const TICK_MS = Math.round(1000 / 30)
const STEPS = 2
const LEVELS = { easy: [0.7, 0.8], normal: [0.82, 0.92], hard: [0.93, 1] }
const NAMES = ['Sprocket', 'Nitro Nell', 'Gizmo', 'Pixel', 'Rusty', 'Comet', 'Bolt', 'Zippy', 'Widget']

const CLIENT_DIR = path.join(__dirname, '..', 'client')
// WO-1106 B51: versioned URLs (rc-fresh-import.js) — an upgraded / edited client reaches the bots at the next enable
const loadAll = () => freshImport(CLIENT_DIR, ['bot-brain.js', 'physics.js', 'track-math.js', 'occ.js']).then(([B, ...W]) => [B, W])

function createRoomBots(deps) {
	const now = deps.now || Date.now
	const T = deps.timers || { setInterval, clearInterval }
	const rng = deps.rng || Math.random
	const log = deps.log || (() => {})
	const load = deps.load || loadAll
	const bots = [] // { conn, brain, name }
	let mods = null
	let scene = null
	let occ = null // decoded once per scene
	const worlds = new Map() // track id → { T, env }
	let timer = null
	let level = 'normal'

	function worldOf(trackId) {
		if (!mods || !scene || trackId == null) return null
		let w = worlds.get(trackId)
		if (w) return w
		const raw = (scene.tracks || []).find((t) => t.id === trackId)
		if (!raw) return null
		const [, [PH, TM, OC]] = mods
		const s = typeof scene.scale === 'number' && scene.scale > 0 ? scene.scale : 1
		occ ??= OC.prepareOcc(scene.occ)
		const Tr = TM.prepareTrack(raw, s)
		w = { T: Tr, env: PH.createEnv(Tr, scene.floors || [], scene.obstacles || [], { scale: s, occ }) }
		worlds.set(trackId, w)
		return w
	}

	/** WO-1106 A35: the slick patches once per tick ([] when none or the call fails — a world never stops the bots). */
	function livePatches() {
		if (typeof deps.patches !== 'function') return null
		try {
			const list = deps.patches()
			return Array.isArray(list) && list.length ? list : null
		} catch {
			return null
		}
	}

	function tick() {
		const t = now()
		const pl = livePatches()
		for (const b of bots) {
			if (!bots.includes(b)) continue // removed while an earlier bot's messages were handled
			let msgs
			try {
				const w = worldOf(b.brain.trackId)
				msgs = b.brain.step(w && pl ? { T: w.T, env: w.env, patches: pl } : w, t, STEPS)
			} catch (e) {
				log('warn', `[rc-game] bot ${b.name} stopped: ${e.message}`)
				remove(b)
				continue
			}
			if (!msgs.length && t - b.sent >= 1000) msgs = [{ t: 'ping', c: t }] // no world yet: keep the seat (room SILENT_MS)
			if (msgs.length) b.sent = t
			for (const m of msgs) deps.handle(b.conn, m)
		}
	}

	function syncTimer() {
		if (bots.length && !timer) timer = T.setInterval(tick, TICK_MS)
		else if (!bots.length && timer) {
			T.clearInterval(timer)
			timer = null
		}
	}

	function add() {
		const [B] = mods
		const [lo, hi] = LEVELS[level]
		const used = new Set(bots.map((b) => b.name))
		const name = NAMES.find((n) => !used.has(`Bot ${n}`)) || `${bots.length + 1}`
		const b = { name: `Bot ${name}`, brain: B.createBot({ skill: lo + rng() * (hi - lo), rng }), conn: null, sent: now() }
		b.conn = {
			readyState: 1,
			botSink: (m) => b.brain.onMessage(m, now()),
			close: () => remove(b), // kicked by the host / dropped by the room
		}
		bots.push(b)
		deps.connect(b.conn)
		deps.handle(b.conn, { t: 'join', name: b.name, spectator: false })
		if (b.brain.id == null) remove(b) // the room is full: no welcome
	}

	function remove(b) {
		const i = bots.indexOf(b)
		if (i < 0) return
		bots.splice(i, 1)
		b.conn.botSink = () => {}
		deps.disconnect(b.conn)
		syncTimer()
	}

	let want = 0
	let loading = null
	function apply() {
		while (bots.length > want) remove(bots[bots.length - 1])
		while (bots.length < want) {
			const before = bots.length
			add()
			if (bots.length === before) break // the room is full
		}
		syncTimer()
	}
	function preload() {
		loading ||= load().then(
			(m) => {
				mods = m
				if (!disposed) apply()
			},
			(e) => log('warn', `[rc-game] bots unavailable: ${e.message}`)
		)
		return loading
	}
	let disposed = false

	return {
		setScene(s) {
			scene = s || null
			occ = null
			worlds.clear()
		},
		/** Bots join / leave until n (applied once the brain is loaded — preload() at enable makes that immediate). */
		setCount(n, lvl) {
			want = Math.max(0, Math.min(MAX_BOTS, n | 0))
			if (lvl && Object.hasOwn(LEVELS, lvl) && lvl !== level) { // WO-1106 A23: `constructor` is no level
				level = lvl
				for (const b of [...bots]) remove(b) // a new level: the field is drawn again
			}
			if (mods) apply()
			else if (want) preload()
			return { ok: true, count: want }
		},
		preload,
		deliver(conn, m) {
			conn.botSink(m)
		},
		count: () => bots.length,
		level: () => level,
		timerRunning: () => !!timer,
		dispose() {
			disposed = true
			want = 0
			for (const b of [...bots]) remove(b)
			worlds.clear()
			scene = occ = null
		},
	}
}

module.exports = { createRoomBots, MAX_BOTS, LEVELS, TICK_MS }
