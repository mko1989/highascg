/**
 * WO-1082 — a race bot: a virtual player that the SERVER runs (server/rc-room-bots.js). It is fed the same messages a
 * browser gets and answers with the same `s` / `box` / `use` / `hit` messages, through the room's own handler — so the
 * referee, the lap minimum, the item rules and the 20 Hz cap treat it like anyone. It drives with THIS folder's physics,
 * item and lap code (physics.js, item-play.js, standings.js), so a bot drives exactly like a browser car.
 * Pure: no clock, no timers, no I/O; the RNG is injected (tests pass a seeded one).
 *
 *   createBot({ skill?, rng? }) → bot
 *     bot.onMessage(m, sNow)            a server message (welcome / state / countdown / w / items / results)
 *     bot.step(world, sNow, steps)      `steps` physics steps of 1/60 s on world = { T, env } (the bot's track) → the
 *                                       messages to send (state ≤ 15 Hz while it drives, 1 Hz parked; claims; uses)
 *     bot.trackId / bot.id / bot.G      what the host needs (the world to hand in; diagnostics for the smokes)
 *   botInput(T, car, hint, skill, line) the steering rule alone: aim LOOK ahead on the centre line (+ the bot's lane),
 *                                       full gas on straights, slower into tight corners (× skill), no drift.
 */
import { createCar, stepCar, placeCar, forwardSpeed, frameYaw, PHYS } from './physics.js'
import { nearestHinted, pointAt, leftNormal, gridPose, respawnPose } from './track-math.js'
import { RaceTracker } from './standings.js'
import { ItemState } from './items.js'
import { fxFlags } from './drive-rules.js'
import { stateMsg } from './protocol.js'
import { onItemMessage, ownCarItems, launchTick } from './item-play.js'
import { applyWorldFx, stepWorldFx } from './world-fx.js'

export const SEND_MS = 66 // ≈ 15 Hz while driving (the room drops a player's states over 20 a second)
export const PARK_MS = 1000 // parked (lobby / results / waiting): one state a second keeps the bot from going silent
export const STUCK_S = 2.5 // slower than STUCK_V · scale with the gas down this long → back to the last checkpoint
export const STUCK_V = 0.4
export const OFF_S = 4 // off the ribbon this long → back to the last checkpoint

const wrap = (a) => {
	while (a > Math.PI) a -= 2 * Math.PI
	while (a < -Math.PI) a += 2 * Math.PI
	return a
}

/** One step's input for a bot car (see the header). `line` −1 … 1 = its lane (share of half the track width). */
export function botInput(T, car, hint, skill = 1, line = 0) {
	const k = T.scale ?? 1
	const n = nearestHinted(T, car.x, car.z, hint, car.y)
	const v = forwardSpeed(car)
	const look = (2 + Math.max(0, v / k) * 0.18) * k
	const tgt = pointAt(T, n.s + look)
	const a = pointAt(T, n.s + 1 * k)
	const b = pointAt(T, n.s + 7 * k)
	const turn = wrap(Math.atan2(b.ux, b.uz) - Math.atan2(a.ux, a.uz))
	const [lx, lz] = leftNormal(tgt.ux, tgt.uz)
	const lane = line * T.half * 0.5 * (Math.abs(turn) > 0.5 ? 0.3 : 1) // corners pull every bot back to the middle
	const want = Math.atan2(-(tgt.x + lx * lane - car.x), -(tgt.z + lz * lane - car.z))
	const err = wrap(want - car.yaw)
	const vWant = (Math.abs(turn) > 0.9 ? 7 : Math.abs(turn) > 0.5 ? 9 : 13) * k * skill
	return {
		near: n,
		input: {
			throttle: v < vWant ? 1 : 0,
			brake: v > vWant + 1.5 * k ? 1 : 0,
			steer: Math.max(-1, Math.min(1, err * 2.5)),
			drift: false,
			use: false,
		},
	}
}

/** @param {{ skill?: number, rng?: () => number }} [o] skill 0.5 … 1 (share of the cornering speeds; 1 = the test bot) */
export function createBot(o = {}) {
	const rng = o.rng || Math.random
	const skill = Math.max(0.5, Math.min(1, o.skill ?? 0.9))
	const line = (rng() * 2 - 1) * 0.6
	const G = {
		meId: null,
		me: null,
		phase: 'lobby',
		state: null,
		startAt: null,
		T: null,
		car: null,
		items: new ItemState(),
		race: new RaceTracker(null),
		launch: null,
		spectator: false,
	}
	const out = []
	G.net = { status: 'joined', sendEvent: (m) => (out.push(m), true) }
	let trackId = null
	const wfx = [] // WO-1102 Game World effects on this car, applied at the next step (the env's toy-scale P)
	let placedFor = null // `${trackId}|${startAt}`: the grid placement that was done
	let hint = -1
	let sentAt = -Infinity
	let stuck = 0
	let off = 0
	let useAt = null
	let pressLead = null
	let others = []

	function slot() {
		const p = (G.state?.players || []).find((x) => x.id === G.meId)
		return p?.slot ?? G.me?.slot ?? 0
	}

	function applyState(state) {
		if (!state) return
		const prev = G.phase
		G.state = state
		G.phase = state.phase || 'lobby'
		trackId = state.trackId ?? null
		if (G.startAt == null && Number.isFinite(state.startAt) && (G.phase === 'countdown' || G.phase === 'race'))
			G.startAt = state.startAt
		if (G.phase === 'lobby' && prev !== 'lobby') {
			G.startAt = null
			placedFor = null
		}
		if (G.phase === 'results' && prev !== 'results') G.items.reset()
	}

	function toGrid(T) {
		G.T = T
		G.race.setTrack(T)
		G.race.reset(G.startAt)
		if (!G.car) G.car = createCar(gridPose(T, slot()))
		else placeCar(G.car, gridPose(T, slot()))
		G.race.move(G.meId, G.car.x, G.car.z, null, true, G.car.y)
		hint = -1
		stuck = off = 0
		useAt = null
		G.launch = null
		/* a launch press somewhere in the last 0.1 … 0.9 s (START_WINDOW is the boost window: earlier stalls) */
		pressLead = (0.1 + rng() * 0.8 * (1.6 - skill)) * PHYS.START_WINDOW * 1000
	}

	function respawn() {
		const c = G.race.cars.get(G.meId)
		placeCar(G.car, respawnPose(G.T, c ? c.lap.cp : 0))
		G.race.move(G.meId, G.car.x, G.car.z, null, true, G.car.y)
		hint = -1
		stuck = off = 0
	}

	function sendState(sNow, every) {
		if (sNow - sentAt < every || !G.car) return
		sentAt = sNow
		const car = G.car
		const v = forwardSpeed(car)
		const sent = car.spin > 0 ? { ...car, yaw: frameYaw(car) } : car
		const rc = G.race.cars.get(G.meId)
		const lap = rc ? Math.min(rc.lap.lap, G.state?.laps || 99) : 0
		out.push(stateMsg(sent, v, rc ? rc.lap.cp : 0, lap, fxFlags(car), G.T?.scale ?? 1))
	}

	function drive(world, sNow, steps) {
		const T = world.T
		const k = T.scale ?? 1
		const racing = G.phase === 'race' || G.phase === 'countdown'
		const dt = PHYS.DT
		for (let i = 0; i < steps; i++) {
			const t = sNow - (steps - 1 - i) * dt * 1000
			const frozen = G.startAt == null || t < G.startAt // as loop.js: the lights, not the phase message, start the race
			const b = botInput(T, G.car, hint, skill, line)
			hint = b.near.seg
			if (frozen) {
				const press = G.startAt != null && t >= G.startAt - pressLead
				launchTick(G, press ? 1 : 0, t, true)
				continue
			}
			launchTick(G, 1, t, false)
			if (G.items.held && !G.items.rolling) {
				useAt ??= t + (G.items.held === 'shield' ? 300 : 800 + rng() * 2500)
				if (t >= useAt) {
					b.input.use = true
					useAt = null
				}
			}
			stepCar(G.car, b.input, world.env, others, dt)
			stepWorldFx(G.car, dt) // WO-1102: a Game World wobble / hop in progress
			G.car.ev.length = 0
			ownCarItems(G, b.input, t)
			if (racing) G.race.move(G.meId, G.car.x, G.car.z, t, false, G.car.y)
			const slow = Math.abs(forwardSpeed(G.car)) < STUCK_V * k && G.car.stall <= 0 && G.car.spin <= 0
			stuck = slow ? stuck + dt : 0
			off = G.car.onTrack ? 0 : off + dt
			if (stuck > STUCK_S || off > OFF_S) respawn()
		}
	}

	return {
		G,
		get id() {
			return G.meId
		},
		get trackId() {
			return trackId
		},
		onMessage(m, sNow) {
			if (!m || typeof m !== 'object') return
			if (onItemMessage(G, m, sNow)) return
			switch (m.t) {
				case 'welcome':
					G.meId = m.id
					G.me = m.you || { id: m.id }
					applyState(m.state)
					break
				case 'state':
					applyState(m.state)
					break
				case 'countdown':
					G.startAt = m.startAt
					G.phase = 'countdown'
					G.items.reset()
					placedFor = null
					break
				case 'w':
					others = []
					for (const c of m.cars || []) {
						if (c[0] === G.meId) continue
						others.push({ x: c[1], y: c[2], z: c[3], yaw: c[4], v: c[5] })
					}
					break
				case 'lap':
					if (m.id === G.meId) G.race.serverLap(m.id, m.lap)
					break
				case 'xfx': // WO-1102 Game World: an effect on this bot's car (the referee decided)
					if (m.id === G.meId && wfx.length < 4) wfx.push(m)
					break
			}
		},
		step(world, sNow, steps = 2) {
			out.length = 0
			if (G.meId == null || !world?.T) return []
			const key = `${trackId}|${G.phase === 'lobby' ? '' : G.startAt}`
			if (placedFor !== key || G.T !== world.T) {
				placedFor = key
				toGrid(world.T)
			}
			/* a bot that joined during a race waits for the next one; one that finished drives on (like a player) */
			const listed = G.state?.players?.find((p) => p.id === G.meId)
			const driving = (G.phase === 'race' || G.phase === 'countdown') && listed?.racing !== false && !G.state?.paused // WO-1101 pause
			if (G.car) for (const x of wfx.splice(0)) applyWorldFx(G.car, x, world.env?.P || PHYS)
			if (driving) drive(world, sNow, steps)
			sendState(sNow, driving && G.phase === 'race' ? SEND_MS : PARK_MS)
			return out.slice()
		},
	}
}
