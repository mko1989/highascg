/* global window, document, performance, setTimeout, WebSocket */
/**
 * WO-1101 — the world spectator (`/game/world/?spectate=1`): ONE wide camera of the room (the RC kit's world.js +
 * stage-fx.js, imported from a running game's `paths.kit`; the scene JSON + GLB from `state.scene`), every game's
 * entities drawn by visitors.js from the world feed `/api/game/world/ws` (hello / wst / wv / board / xev — no own-game
 * exclusion, cap 80), and a strip with each game's top 3, phase and clock plus the last cross-game events. No buttons; a
 * slow automatic camera drift. It is just a page: it never puts anything on a screen by itself.
 */
import * as THREE from 'three'
import { h, setText, getState, getJson, wsUrl } from './world-dom.js'
import { gamesOf, kitOf, okPath, createClock, floorFn, roomCam, normGame, boardLine, eventText } from './world-logic.js'
import { okModelUrl } from './world-wire.js'
import { createVisitors } from './visitors.js'

const POLL_MS = 4000
const TICKER_N = 4
const TICKER_MS = 12000

export async function startSpectate(root) {
	root.textContent = ''
	const msg = h('div.card.wait', h('h1', { text: 'Game World' }), h('p', { text: 'Waiting for a game to run…' }))
	root.append(msg)
	const state = await waitRunning(msg)
	const games = gamesOf(state)
	const kit = kitOf(games)
	const wUrl = kit && kit + 'world.js'
	const fUrl = kit && kit + 'stage-fx.js'
	if (!okModelUrl(wUrl)) throw new Error('no game kit')
	const { createWorld } = await import(wUrl)
	let createStageFx = null
	try {
		if (okModelUrl(fUrl)) ({ createStageFx } = await import(fUrl))
	} catch {
		/* the room without the live rig */
	}
	msg.remove()
	const canvas = document.getElementById('view')
	canvas.hidden = false
	const phone = Math.min(window.screen?.width || 9999, window.screen?.height || 9999) < 600
	const world = createWorld(canvas, { phone, quality: phone ? 'low' : 'high' })
	world.setFov(50)
	const fx = createStageFx ? createStageFx({ THREE, scene: world.scene, quality: phone ? 'low' : 'high', onHouse: (lv) => world.setHouse(lv) }) : null
	const strip = h('div.strip')
	const ticker = h('ul.ticker', { 'aria-live': 'polite' })
	root.append(h('div.overlay', strip, ticker))
	window.addEventListener('resize', () => world.resize())
	world.resize()

	const S = { scene: null, sceneUrl: null, floor: () => 0, board: games, events: [], cam: null }
	const clock = createClock()
	const vis = createVisitors(THREE, world.scene, { view: 'world', quality: phone ? 'low' : 'high', tags: true, floorY: (x, z) => S.floor(x, z) })

	async function loadScene(st) {
		const sc = st?.scene
		const ju = sc && okPath(sc.json) ? sc.json : null
		if (!ju || ju === S.sceneUrl) return
		S.sceneUrl = ju
		const json = await getJson(ju)
		if (!json || typeof json !== 'object') return (S.sceneUrl = null)
		if (!okPath(json.glb)) json.glb = okPath(sc.glb) ? sc.glb : null
		S.scene = json
		S.floor = floorFn(json)
		S.cam = null
		try {
			fx?.load(json)
		} catch {
			/* the live rig is optional */
		}
		await world.loadScene(json)
	}

	function applyState(st) {
		if (!st || typeof st !== 'object') return
		if (Array.isArray(st.games)) S.board = gamesOf(st)
		if (typeof st.house === 'number' || typeof st.house === 'boolean') world.setHouse(st.house)
		loadScene(st)
	}
	applyState(state)

	function onMessage(m) {
		if (!m || typeof m !== 'object') return
		if (typeof m.ts === 'number') clock.sync(m.ts, performance.now())
		if (m.t === 'wst' || m.t === 'wv') vis.ingest(m)
		else if (m.t === 'hello') applyState(m.state)
		else if (m.t === 'board' && Array.isArray(m.games)) S.board = m.games.slice(0, 8).map(normGame).filter(Boolean)
		else if (m.t === 'xev') {
			const text = eventText(m)
			if (text) S.events.unshift({ text, at: performance.now() })
			S.events.length = Math.min(S.events.length, TICKER_N)
			paintTicker()
		}
	}

	let backoff = 1000
	function connect() {
		let ws
		try {
			ws = new WebSocket(wsUrl())
		} catch {
			return setTimeout(connect, backoff)
		}
		ws.onopen = () => (backoff = 1000)
		ws.onmessage = (ev) => {
			if (typeof ev.data !== 'string' || ev.data.length > 65536) return
			try {
				onMessage(JSON.parse(ev.data))
			} catch {
				/* malformed: dropped */
			}
		}
		ws.onclose = () => {
			vis.ingest({ t: 'wst', v: 1, on: false })
			backoff = Math.min(10000, backoff * 1.6)
			setTimeout(connect, backoff)
		}
	}
	connect()

	function paintTicker() {
		const now = performance.now()
		ticker.textContent = ''
		for (const e of S.events) if (now - e.at < TICKER_MS) ticker.append(h('li', { text: e.text }))
	}

	let lastStrip = ''
	function paintStrip(sNow) {
		const lines = S.board.filter((g) => g.enabled || g.phase).map((g) => boardLine(g, sNow))
		const key = lines.join('\n')
		if (key === lastStrip) return
		lastStrip = key
		strip.textContent = ''
		for (const l of lines) strip.append(h('div.strip-line', { text: l }))
	}

	let last = performance.now()
	let t = 0
	let paintAt = 0
	function frame() {
		const now = performance.now()
		const dt = Math.min(0.1, (now - last) / 1000)
		last = now
		t += dt
		const want = roomCam(S.scene, t)
		S.cam = S.cam ? ease(S.cam, want, dt) : want
		world.setCamera(S.cam)
		const sNow = clock.now(now)
		vis.update(sNow ?? 0, dt, world.camera)
		fx?.update(dt)
		world.render()
		if (now - paintAt > 500) {
			paintAt = now
			paintStrip(sNow)
			paintTicker()
		}
		window.requestAnimationFrame(frame)
	}
	window.requestAnimationFrame(frame)
}

function ease(cur, want, dt) {
	const k = 1 - Math.exp(-dt / 1.2)
	const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * k)
	return { eye: mix(cur.eye, want.eye), target: mix(cur.target, want.target) }
}

/** Poll the world state until a game runs (the state and the feed are public only then). */
async function waitRunning(msg) {
	for (;;) {
		const r = await getState()
		const games = r.ok && r.data ? gamesOf(r.data) : []
		if (games.some((g) => g.enabled) && kitOf(games)) return r.data
		setText(msg.querySelector('p'), r.status === 0 ? 'No connection to the box. Trying again…' : 'No game is running right now. This page checks again every few seconds.')
		await new Promise((res) => setTimeout(res, POLL_MS))
	}
}
