/**
 * WO-1081 Stage Skirmish · WO-1101 / WO-1102 — this game in the Game World (work/notes/game-world-contract.md §1, §2, §6.2). Only a `wst`
 * with `on: true` (sent by the world module, never by this game) loads the visitors renderer from its `client` URL; a
 * game alone never gets one, so nothing here loads, draws or sends.
 *   const wj = createWorldJoin(G, { send, importer? })
 *   wj.onMessage(m)       wst / wv / xfx / xbonus → true when it was one (session.js stops there); peeks at `state`
 *   wj.wish(input, sNow)  the move wish after the world: held while stunned, × 0.75 on a slick splat (R2)
 *   wj.held(sNow)         true while stunned (no fire)   wj.jitter(now) → an aim offset (rad) while pea-scattered (R5)
 *   wj.knock(st, dt, grid, s)  each movement step: the stun's knock-back (1.2 u over 0.3 s, through the grid clamp)
 *   wj.frame(sNow, dt)    every rendered frame: the visitors (flying vegetables above the cut-away: a shadow / marker)
 *   wj.setQuality(q)  wj.paused
 */
import * as THREE from 'three'
import { SOLDIER } from './sk-const.js'
import { moveCircle } from './grid.js'

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
const KNOCK_U = 1.2 // §6.2: the stun knocks the soldier 1.2 u along the effect's direction …
const KNOCK_S = 0.3 // … over 0.3 s — its own displacement (WO-1106 A11: an impulse was eaten by the braking, ≈ 0.18 u)
const MAX_QUEUE = 64
const WST_OFF = Object.freeze({ t: 'wst', v: 1, on: false })
const SCATTER_RAD = (6 * Math.PI) / 180
const SCATTER_MS = 1500

export function createWorldJoin(G, { send, importer = (u) => import(u) }) {
	let vis = null
	let loading = null
	let on = false
	let paused = false
	let stale = false // WO-1106 A4 / A32: `wv` waits for a fresh `wst` (a new view: every `add` again)
	const queue = [] // world messages that arrive while the renderer loads (replayed in order)
	let stunUntil = 0
	let scatterUntil = 0
	let knock = null // { dx, dz, left (m) } while a knock-back runs

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

	/** Drop what was queued; wv waits for the next wst (a fresh view: its `add`s for everything). */
	function restart() {
		queue.length = 0
		stale = true
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
			const l = Array.isArray(m.dir) ? Math.hypot(m.dir[0], m.dir[1]) : 0
			if (G.my && l > 0) knock = { dx: m.dir[0] / l, dz: m.dir[1] / l, left: KNOCK_U * (G.s ?? 0.1) }
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
					// WO-1106 A4: a (re)joined socket is a new world view — the hub sends it a fresh wst + every add; the old
					// visitors / slick patches never get their `gone`, and the server forgot this socket's quality tier
					restart()
					knock = null
					if (vis) {
						vis.ingest(WST_OFF)
						send(vis.wq())
					}
					peekState(m.state)
					return false
				case 'state':
					peekState(m.state)
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
							// asking the server to re-send this socket's world view (wq re: sk-world.js)
							restart()
							send({ t: 'wq', re: true })
						}
					}
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
				if (!(s.until > sNow)) continue // WO-1106 A4: a patch past its `until` (its `gone` may never come) slows nothing
				const dx = r.x - s.x
				const dz = r.z - s.z
				if (dx * dx + dz * dz <= s.r * s.r)
					return { ...input, mx: (Number(input.mx) || 0) * SLICK_SPEED, mz: (Number(input.mz) || 0) * SLICK_SPEED }
			}
			return input
		},
		held: (sNow) => sNow < stunUntil,
		/** One movement step of `dt` s: the knock-back's share, slid along walls like any step (grid.js moveCircle). */
		knock(st, dt, grid, s = G.s ?? 0.1) {
			if (!knock || !st) return
			const d = Math.min(knock.left, ((KNOCK_U * s) / KNOCK_S) * dt)
			knock.left -= d
			const nx = st.x + knock.dx * d
			const nz = st.z + knock.dz * d
			const p = grid ? moveCircle(grid, st.x, st.z, nx, nz, SOLDIER.R * s) : [nx, nz]
			st.x = p[0]
			st.z = p[1]
			if (knock.left <= 1e-9) knock = null
		},
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
