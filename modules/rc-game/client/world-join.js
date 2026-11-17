/**
 * WO-1101 / WO-1102 — this game in the Game World (work/notes/game-world-contract.md §1, §2, §6.2). Only a `wst` with
 * `on: true` (sent by the world module, never by this game) loads the visitors renderer from its `client` URL; a game
 * alone never gets one, so nothing here loads, draws or sends.
 *   const wj = createWorldJoin(G, { send })   G: the game state (world, env, car, meId, hud); send(msg) on the socket
 *                                             (smokes may pass `load(url)` instead of the page's dynamic import)
 *   wj.onMessage(m)         wst / wv / xfx / xbonus → true when it was one (session.js stops there); peeks at `state`;
 *                           a `welcome` (= a new socket) clears the visitors and re-sends `wq` (WO-1106 A4); a full
 *                           pre-load queue is dropped and `{ t: 'wq', n, re: true }` asks for the view afresh (A32)
 *   wj.beforeStep(P)        once per frame before the physics steps: the queued effects on the own car
 *   wj.step(car, h)         after every stepCar(): the effect timers
 *   wj.frame(sNow, dt)      every rendered frame: the visitors, the slick patch under the own car — only while the last
 *                           `wst` says this game takes effects (affect 'on', no Presenter safe: WO-1106 "soft affect",
 *                           as world-hub.js patches() gates the server's bots)
 *   wj.setQuality(q)  wj.paused
 */
import * as THREE from 'three'
import { applyWorldFx, stepWorldFx, slickUnder } from './world-fx.js'
import { groundOf } from './physics.js'

const okClient = (u) =>
	typeof u === 'string' &&
	u.startsWith('/game/world/') &&
	u.endsWith('.js') &&
	!u.includes('..') &&
	!u.includes('//') &&
	u.length < 120
const QUEUE_MAX = 64
/* the visitor cap of a quality tier, as game-world/client/visitor-logic.js CAPS (this game: low | high) — for the
   `wq re` sent before the renderer has loaded (WO-1106 A32) */
const capOf = (q) => (q === 'low' ? 6 : 20)
const WST_OFF = { t: 'wst', v: 1, on: false }
/* WO-1106 "soft affect": a slick patch slows this car only when the world says others may affect this game ('on'; a
   missing value is 'on', as world-wire.js decodeWst) and Presenter safe is off — world-hub.js patches() for the bots */
const slickOn = (m) => m?.on === true && m.safe !== true && m.affect !== 'soft' && m.affect !== 'off'
const BONUS_TEXT = {
	hop: 'Splat!',
	bounce: 'Bounce!',
	bowl: 'Bowled over!',
	sparks: 'Sparks!',
	scatter: 'Pea storm!',
	spot: 'Spotlight!',
}

export function createWorldJoin(G, { send, load = (u) => import(u) }) {
	let vis = null
	let loading = null
	let on = false
	let paused = false
	let slick = false // the last `wst` lets slick patches slow the car (slickOn)
	const queue = [] // world messages that arrive while the renderer loads (replayed in order)
	let stale = false // WO-1106 A32 / A4: the queued view is broken — `wv` is dropped until the next `wst` starts afresh
	const fx = []

	/** Drop what was queued; `wv` waits for the next `wst` (a fresh view: its `add`s for everything). */
	function restart() {
		queue.length = 0
		stale = true
	}

	function start(m) {
		stale = false
		if (vis) return vis.ingest(m)
		queue.push(m)
		if (loading) return
		loading = load(m.client)
			.then((mod) => {
				loading = null
				if (!on || vis) return
				vis = mod.createVisitors(THREE, G.world.scene, {
					view: 'rc',
					scale: G.T?.scale ?? 1,
					quality: G.world.quality,
					tags: true,
					floorY: (x, z) => (G.env ? groundOf(G.env, x, z, 50) : 0),
					camY: () => G.world.camera.position.y,
				})
				for (const q of queue.splice(0)) vis.ingest(q)
				send(vis.setQuality(G.world.quality))
			})
			.catch(() => ((loading = null), (queue.length = 0)))
	}

	/** WO-1106 A4: a `welcome` comes on a new socket only (net.js joins on open): what the old one delivered is stale. */
	function onWelcome() {
		if (!vis && !loading) return // the first join: nothing from an older socket
		restart() // the new socket's view sends its own `wst` (then every `add`) before any `wv`
		if (vis) {
			vis.ingest(WST_OFF) // the visitors renderer forgets every visitor and slick patch
			send(vis.setQuality(G.world.quality)) // the hub keys the cap by socket: else back to 12
		}
	}

	function peekState(st) {
		const p = st?.paused === true
		if (p === paused) return
		paused = p
		G.hud?.x?.banner(p ? 'PAUSED' : 'GO!', p ? 'final' : '', p ? 600000 : 1200)
		if (!p && Number.isFinite(st.startAt) && G.startAt != null) G.startAt = st.startAt // the server shifted the clock
	}

	return {
		get paused() {
			return paused
		},
		onMessage(m) {
			switch (m?.t) {
				case 'welcome':
					onWelcome()
					peekState(m.state)
					return false
				case 'state':
					peekState(m.state)
					return false
				case 'wst':
					on = m.on === true && okClient(m.client)
					slick = on && slickOn(m)
					if (on) start(m)
					else {
						queue.length = 0
						stale = false
						if (vis) {
							vis.ingest(m)
							vis.dispose()
							vis = null
						}
					}
					return true
				case 'wv':
					if (stale) return true
					if (vis) vis.ingest(m)
					else if (loading) {
						if (queue.length < QUEUE_MAX) queue.push(m)
						else {
							/* WO-1106 A32: a full queue would lose the newest adds / gones for good (the hub sends nothing for an
							   unchanged entity, and `wst` only on a change) — drop it and ask the server to serve this socket's
							   view afresh: a new `wst`, then every `add` */
							restart()
							send({ t: 'wq', n: capOf(G.world.quality), re: true })
						}
					}
					return true
				case 'xfx':
					if (m.id === G.meId && fx.length < 4) fx.push(m)
					if (m.id === G.meId && m.by?.n)
						G.hud?.toast(`${m.k === 'boost' ? 'Boost' : 'Hit'} — ${String(m.by.n).slice(0, 16)}`, 1400)
					return true
				case 'xbonus':
					G.hud?.x?.banner(`${BONUS_TEXT[m.kind] || 'World bonus'}${m.pts ? ` +${m.pts}` : ''}`, '', 1300)
					return true
				default:
					return false
			}
		},
		beforeStep(P) {
			if (G.car) for (const m of fx.splice(0)) applyWorldFx(G.car, m, P)
		},
		step(car, h) {
			stepWorldFx(car, h)
		},
		frame(sNow, dt) {
			if (!vis) {
				if (G.car) G.car.wslick = 0
				return
			}
			try {
				vis.update(sNow, dt, G.world.camera)
				if (G.car) G.car.wslick = slick ? slickUnder(G.car, vis.patches(), sNow) : 0 // WO-1106 A4: expired patches never count
			} catch {
				/* the visitors never break the game loop */
			}
		},
		setQuality(q) {
			if (vis) send(vis.setQuality(q))
		},
	}
}
