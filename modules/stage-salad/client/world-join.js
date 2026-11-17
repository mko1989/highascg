/**
 * WO-1089 Stage Salad · WO-1101 / WO-1102 — this game in the Game World (work/notes/game-world-contract.md §1, §2, §6.1). Only a `wst` with
 * `on: true` (sent by the world module, never by this game) loads the visitors renderer from its `client` URL; a game
 * alone never gets one, so nothing here loads, draws or sends. A world pause is this game's own presenter-safe.
 *   const wj = createWorldJoin(G, { send, importer? })
 *   wj.onMessage(m)       wst / wv / xb / xbonus → true when it was one (session.js stops there); `welcome` resets the
 *                         visitors (a new socket = a fresh world view) and returns false so the session still sees it
 *   wj.frame(sNow, dt)    every rendered frame: the visitors (cars driving through, soldiers, the other games' slingshots)
 *   wj.setQuality(q)
 */
import * as THREE from 'three'
import { floorYAt } from './venue.js'

const okClient = (u) =>
	typeof u === 'string' &&
	u.startsWith('/game/world/') &&
	u.endsWith('.js') &&
	!u.includes('..') &&
	!u.includes('//') &&
	u.length < 120
const BONUS_TEXT = { hop: 'Splat on a car!', bounce: 'Bounce!', scatter: 'Pea storm!', spot: 'Spotlight!' }
const MAX_QUEUE = 64
const WST_OFF = Object.freeze({ t: 'wst', v: 1, on: false })

export function createWorldJoin(G, { send, importer = (u) => import(u) }) {
	let vis = null
	let loading = null
	let on = false
	let stale = false // WO-1106 A32 / A4: the queued view is broken — wv is dropped until the next wst starts afresh
	const queue = []

	function start(m) {
		stale = false
		if (vis) return vis.ingest(m)
		queue.push(m)
		if (loading) return
		loading = importer(m.client)
			.then((mod) => {
				loading = null
				if (!on || vis) return
				vis = mod.createVisitors(THREE, G.world.scene, {
					view: 'salad', // no scale: cars / soldiers at the world's toy scale (wst.scale), never Salad's life size
					quality: G.world.quality,
					tags: true,
					floorY: (x, z) => floorYAt(G.venue, x, z), // WO-1106 A36: the stage top over the stage, else the hall floor
					camY: () => G.world.camera.position.y,
				})
				for (const q of queue.splice(0)) vis.ingest(q)
				send(vis.setQuality(G.world.quality))
			})
			.catch(() => ((loading = null), (queue.length = 0)))
	}

	/** Drop what was queued; wv waits for the next wst (a fresh view: its `add`s for everything). */
	function restart() {
		queue.length = 0
		stale = true
	}

	return {
		onMessage(m) {
			switch (m?.t) {
				case 'welcome':
					// WO-1106 A4: a (re)joined socket is a new world view — the hub sends it a fresh wst + every add; the old
					// visitors / slick patches never get their `gone`, and the server forgot this socket's quality tier
					restart()
					if (vis) {
						vis.ingest(WST_OFF)
						send(vis.wq())
					}
					return false
				case 'wst':
					on = m.on === true && okClient(m.client)
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
						if (queue.length < MAX_QUEUE) queue.push(m)
						else {
							// WO-1106 A32: a full queue would drop newest adds / gones for good — start over from a fresh wst,
							// asking the server to re-send this socket's world view (wq re: salad-world.js)
							restart()
							send({ t: 'wq', re: true })
						}
					}
					return true
				case 'xb':
					G.book?.onBounce(m)
					return true
				case 'xbonus':
					G.hud?.banner(`${BONUS_TEXT[m.kind] || 'World bonus'}${m.pts ? ` +${m.pts}` : ''}`, 'info', 1400)
					return true
				default:
					return false
			}
		},
		frame(sNow, dt) {
			if (!vis) return
			try {
				vis.update(sNow, dt, G.world.camera)
			} catch {
				/* the visitors never break the game loop */
			}
		},
		setQuality(q) {
			if (vis) send(vis.setQuality(q))
		},
	}
}
