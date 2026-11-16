/**
 * WO-1089 Stage Salad · WO-1101 / WO-1102 — this game in the Game World (work/notes/game-world-contract.md §1, §2, §6.1). Only a `wst` with
 * `on: true` (sent by the world module, never by this game) loads the visitors renderer from its `client` URL; a game
 * alone never gets one, so nothing here loads, draws or sends. A world pause is this game's own presenter-safe.
 *   const wj = createWorldJoin(G, { send })
 *   wj.onMessage(m)       wst / wv / xb / xbonus → true when it was one (session.js stops there)
 *   wj.frame(sNow, dt)    every rendered frame: the visitors (cars driving through, soldiers, the other games' slingshots)
 *   wj.setQuality(q)
 */
import * as THREE from 'three'

const okClient = (u) =>
	typeof u === 'string' &&
	u.startsWith('/game/world/') &&
	u.endsWith('.js') &&
	!u.includes('..') &&
	!u.includes('//') &&
	u.length < 120
const BONUS_TEXT = { hop: 'Splat on a car!', bounce: 'Bounce!', scatter: 'Pea storm!', spot: 'Spotlight!' }
const MAX_QUEUE = 64

export function createWorldJoin(G, { send }) {
	let vis = null
	let loading = null
	let on = false
	const queue = []

	function start(m) {
		if (vis) return vis.ingest(m)
		queue.push(m)
		if (loading) return
		loading = import(m.client)
			.then((mod) => {
				loading = null
				if (!on || vis) return
				vis = mod.createVisitors(THREE, G.world.scene, {
					view: 'salad', // no scale: cars / soldiers at the world's toy scale (wst.scale), never Salad's life size
					quality: G.world.quality,
					tags: true,
					floorY: () => G.venue?.hall?.y ?? 0,
					camY: () => G.world.camera.position.y,
				})
				for (const q of queue.splice(0)) vis.ingest(q)
				send(vis.setQuality(G.world.quality))
			})
			.catch(() => ((loading = null), (queue.length = 0)))
	}

	return {
		onMessage(m) {
			switch (m?.t) {
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
					else if (loading && queue.length < MAX_QUEUE) queue.push(m)
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
