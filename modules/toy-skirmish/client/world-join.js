/**
 * WO-1081 Stage Skirmish · WO-1101 / WO-1102 — this game in the Game World (work/notes/game-world-contract.md §1, §2, §6.2). Only a `wst`
 * with `on: true` (sent by the world module, never by this game) loads the visitors renderer from its `client` URL; a
 * game alone never gets one, so nothing here loads, draws or sends.
 *   const wj = createWorldJoin(G, { send })
 *   wj.onMessage(m)       wst / wv / xfx / xbonus → true when it was one (session.js stops there); peeks at `state`
 *   wj.wish(input, sNow)  the move wish after the world: held while stunned, × 0.75 on a slick splat (R2)
 *   wj.held(sNow)         true while stunned (no fire)   wj.jitter(now) → an aim offset (rad) while pea-scattered (R5)
 *   wj.frame(sNow, dt)    every rendered frame: the visitors (flying vegetables above the cut-away: a shadow / marker)
 *   wj.setQuality(q)  wj.paused
 */
import * as THREE from 'three'

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
const CUT_ABOVE = 0.4 // m above the arena floor: the cut-away (contract §2)
const SLICK_SPEED = 0.75 // R2: a soldier on a slick splat
const KNOCK_U = 4 // u/s along the effect's direction (≈ 1.2 u over 0.3 s as the soldier slows)
const SCATTER_RAD = (6 * Math.PI) / 180
const SCATTER_MS = 1500

export function createWorldJoin(G, { send }) {
	let vis = null
	let loading = null
	let on = false
	let paused = false
	const queue = [] // world messages that arrive while the renderer loads (replayed in order)
	let stunUntil = 0
	let scatterUntil = 0

	function start(m) {
		if (vis) return vis.ingest(m)
		queue.push(m)
		if (loading) return
		loading = import(m.client)
			.then((mod) => {
				loading = null
				if (!on || vis) return
				vis = mod.createVisitors(THREE, G.world.scene, {
					view: 'sk',
					scale: G.s ?? 0.1,
					quality: G.world.quality,
					tags: true,
					floorY: () => G.arena?.y ?? 0,
					camY: () => G.world.camera.position.y,
					cutY: () => (G.arena?.y ?? 0) + CUT_ABOVE,
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
		G.hud?.banner(p ? 'PAUSED' : 'GO!', p ? 'dead' : 'info', p ? 600000 : 1200)
	}

	function onFx(m, sNow) {
		if (m.id !== G.meId || m.soft) return
		if (m.k === 'stun') {
			stunUntil = sNow + m.dur * 1000
			if (G.my && m.dir) {
				const l = Math.hypot(m.dir[0], m.dir[1]) || 1
				G.my.vx = (m.dir[0] / l) * KNOCK_U * (G.s ?? 0.1)
				G.my.vz = (m.dir[1] / l) * KNOCK_U * (G.s ?? 0.1)
			}
			G.hud?.banner(`Stunned${m.by?.n ? ` — ${m.by.n}` : ''}`, 'dead', Math.max(600, m.dur * 1000))
		} else if (m.k === 'scatter') {
			scatterUntil = sNow + SCATTER_MS
			G.hud?.toast('Peas in your eyes!', 1200)
		}
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
					onFx(m, G.net ? G.net.serverNow() : Date.now())
					return true
				case 'xbonus':
					G.hud?.banner(`${BONUS_TEXT[m.kind] || 'World bonus'}${m.pts ? ` +${m.pts}` : ''}`, 'info', 1300)
					return true
				default:
					return false
			}
		},
		wish(input, sNow) {
			if (sNow < stunUntil) return { mx: 0, mz: 0 }
			if (!vis || !G.my) return input
			const r = G.my
			for (const s of vis.patches()) {
				const dx = r.x - s.x
				const dz = r.z - s.z
				if (dx * dx + dz * dz <= s.r * s.r)
					return { ...input, mx: (Number(input.mx) || 0) * SLICK_SPEED, mz: (Number(input.mz) || 0) * SLICK_SPEED }
			}
			return input
		},
		held: (sNow) => sNow < stunUntil,
		jitter(sNow) {
			return sNow < scatterUntil ? (Math.random() * 2 - 1) * SCATTER_RAD : 0
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
