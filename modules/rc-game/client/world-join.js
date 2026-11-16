/**
 * WO-1101 / WO-1102 — this game in the Game World (work/notes/game-world-contract.md §1, §2, §6.2). Only a `wst` with
 * `on: true` (sent by the world module, never by this game) loads the visitors renderer from its `client` URL; a game
 * alone never gets one, so nothing here loads, draws or sends.
 *   const wj = createWorldJoin(G, { send })   G: the game state (world, env, car, meId, hud); send(msg) on the socket
 *   wj.onMessage(m)         wst / wv / xfx / xbonus → true when it was one (session.js stops there); peeks at `state`
 *   wj.beforeStep(P)        once per frame before the physics steps: the queued effects on the own car
 *   wj.step(car, h)         after every stepCar(): the effect timers
 *   wj.frame(sNow, dt)      every rendered frame: the visitors, the slick patch under the own car
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
const BONUS_TEXT = {
	hop: 'Splat!',
	bounce: 'Bounce!',
	bowl: 'Bowled over!',
	sparks: 'Sparks!',
	scatter: 'Pea storm!',
	spot: 'Spotlight!',
}

export function createWorldJoin(G, { send }) {
	let vis = null
	let loading = null
	let on = false
	let paused = false
	const queue = [] // world messages that arrive while the renderer loads (replayed in order)
	const fx = []

	function start(m) {
		if (vis) return vis.ingest(m)
		queue.push(m)
		if (loading) return
		loading = import(m.client)
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
				case 'state':
					peekState(m.state)
					return false
				case 'wst':
					on = m.on === true && okClient(m.client)
					if (on) start(m)
					else {
						queue.length = 0
						if (vis) {
							vis.ingest(m)
							vis.dispose()
							vis = null
						}
					}
					return true
				case 'wv':
					if (vis) vis.ingest(m)
					else if (loading && queue.length < 64) queue.push(m)
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
				if (G.car) G.car.wslick = slickUnder(G.car, vis.patches())
			} catch {
				/* the visitors never break the game loop */
			}
		},
		setQuality(q) {
			if (vis) send(vis.setQuality(q))
		},
	}
}
