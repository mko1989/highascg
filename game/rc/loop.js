/* global window, performance */
/**
 * Per-frame work of the RC game (WO-1074): fixed-step physics for the own car (+ items, start launch, hits),
 * snapshot-interpolated remote cars with their `fx` effects, lap tracking, cameras (chase with an FOV kick / top,
 * spectator director), props and item effects, throttled HUD updates, sound, and the own-state send.
 */
import { stepCar, forwardSpeed, frameYaw, groundOf, ceilingOf } from './physics.js'
import { fxFlags, driftStage, FX } from './drive-rules.js'
import { stateMsg } from './protocol.js'
import { chaseTarget, topTarget, smoothCam, overviewTarget, fovFor, FOV } from './cameras.js'
import { lerpAngle } from './interp.js'
import { fmtTime } from './lap-logic.js'
import { safeColor } from './dom.js'
import { setGantryLights } from './track-deco.js'
import { ownCarItems, launchTick, drainEvents, updateCatchup } from './item-play.js'

const HUD_EVERY_MS = 100
const BOARD_EVERY_MS = 300
const REMOTE_SPIN_RATE = 10.5 // rad/s — remote spin-outs are drawn locally from the SPIN flag
const START_HINT = 'Gas just before GREEN = boost start · too early = stall'

export function startLoop(G) {
	let last = performance.now()
	let hudAt = 0
	let boardAt = 0
	let cam = null
	let fov = FOV
	let lastCdSec = null
	const prev = { x: 0, y: 0, z: 0, yaw: 0 }

	function frame(now) {
		window.requestAnimationFrame(frame)
		const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
		last = now
		const t = now / 1000
		G.animT = t
		const sNow = G.net ? G.net.serverNow() : now

		const others = remoteCars(G, sNow, now, dt, t)

		/* ---- own car ---- */
		let pose = null
		let v = 0
		if (G.car && G.T) {
			const input = G.input.read()
			const frozen = G.phase === 'countdown' && (G.startAt == null || sNow < G.startAt)
			launchTick(G, input.throttle, sNow, frozen)
			let useLeft = input.use
			const alpha = G.stepper.advance(dt, (h) => {
				prev.x = G.car.x
				prev.y = G.car.y
				prev.z = G.car.z
				prev.yaw = G.car.yaw
				if (frozen) return
				stepCar(G.car, input, G.env, others, h)
				ownCarItems(G, { ...input, use: useLeft }, sNow)
				useLeft = false
				const ev = G.race.move(G.meId, G.car.x, G.car.z, sNow, false, G.car.y)
				if (ev?.type === 'lap' && G.phase === 'race') G.audio.beep(988, 160)
			})
			drainEvents(G)
			const car = G.car
			v = forwardSpeed(car)
			pose = {
				x: prev.x + (car.x - prev.x) * alpha,
				y: prev.y + (car.y - prev.y) * alpha,
				z: prev.z + (car.z - prev.z) * alpha,
				yaw: lerpAngle(prev.yaw, car.yaw, alpha),
			}
			const fx = fxFlags(car)
			G.myModel.update(pose, v, car.st, dt, {
				fx,
				stage: car.drift ? driftStage(car.driftT) : 0,
				squash: car.squash,
				groundY: groundOf(G.env, pose.x, pose.z, pose.y),
				blink: car.immune > 0 && car.spin <= 0 && Math.floor(now / 90) % 2 === 0,
			})
			const rc = G.race.cars.get(G.meId)
			/* others see the travel heading while spinning (they draw the spin from the flag) */
			const sent = car.spin > 0 ? { ...car, yaw: frameYaw(car) } : car
			G.net?.sendState(stateMsg(sent, v, rc ? rc.lap.cp : 0, rc ? Math.min(rc.lap.lap, G.state?.laps || 99) : 0, fx))
			G.audio.engine(v, input.throttle)
			G.hud.x.speedLines(car.boost > 0 ? 0.85 : Math.max(0, (Math.abs(v) - 11) / 8) * 0.5)
			G.hud.x.item(G.items, now)
		}

		/* ---- props + item effects ---- */
		G.props?.update(t, (id) => G.items.boxTaken(id, sNow), dt)
		G.fxView?.sync(G.items, G.T, sNow, t)
		G.fxView?.update(dt)

		/* ---- camera ---- */
		if (G.T) {
			let want
			if (G.spectator) {
				want = G.director.update(t, dt, G.T, G.race.order(), (id) => G.remotes.get(id)?.pose || null)
				cam = want
			} else {
				if (pose) {
					const look = { ...pose, yaw: frameYaw(G.car) }
					want =
						G.camMode === 'top'
							? topTarget(pose, 7 + Math.abs(v) * 0.3)
							: chaseTarget(look, v, (x, z, y) => ceilingOf(G.env, x, z, y))
				} else want = overviewTarget(G.T)
				cam = smoothCam(cam, want, dt, G.camMode === 'top' ? 4 : 7)
				const fWant = G.camMode === 'chase' && G.car ? fovFor(v, G.car.boost > 0) : FOV
				fov += (fWant - fov) * (1 - Math.exp(-6 * dt))
				G.world.setFov(fov)
			}
			G.world.setCamera(cam)
		}

		/* ---- countdown lights (HUD + gantry) ---- */
		if (G.startAt != null && (G.phase === 'countdown' || G.phase === 'race')) {
			const remain = G.startAt - sNow
			G.hud.countdown(remain)
			setGantryLights(G.trackGroup, remain)
			G.hud.x.hint(!G.spectator && remain > 0 ? START_HINT : '')
			const sec = remain > 0 ? Math.ceil(remain / 1000) : 0
			if (sec !== lastCdSec && remain > -500) {
				if (sec <= 5) G.audio.beep(sec ? 523 : 1046, sec ? 120 : 400)
				lastCdSec = sec
			}
		} else {
			G.hud.countdown(null)
			setGantryLights(G.trackGroup, null)
			G.hud.x.hint('')
		}

		/* ---- HUD (throttled) ---- */
		if (now - hudAt > HUD_EVERY_MS) {
			hudAt = now
			updateHud(G, sNow, v)
		}
		if (G.spectator && now - boardAt > BOARD_EVERY_MS) {
			boardAt = now
			updateBoard(G)
		}

		G.fx?.update(dt) // §2.6 beams / pools / glows and the wall pictures
		G.world.render()
	}
	window.requestAnimationFrame(frame)
}

/** Remote cars: interpolated poses, their effects, lap tracking, director cues. Returns the poses for collisions. */
function remoteCars(G, sNow, now, dt, t) {
	const others = []
	for (const r of G.remotes.values()) {
		const pose = r.buf.render(sNow, now)
		if (!pose) continue
		const fx = pose.fx | 0
		if (fx & FX.AIR && !(r.fx & FX.AIR)) G.director.notify?.('jump', r.id, t)
		if (fx & FX.SPIN && !(r.fx & FX.SPIN)) G.director.notify?.('hit', r.id, t)
		r.spinAdd = fx & FX.SPIN ? r.spinAdd + dt * REMOTE_SPIN_RATE : 0
		r.fx = fx
		r.model.group.visible = true
		r.model.update(pose, pose.v, pose.st, dt, {
			fx,
			stage: 0, // remote cars: the first spark colour (the charge stage is not on the wire)
			groundY: G.env ? groundOf(G.env, pose.x, pose.z, pose.y) : null,
			yawAdd: r.spinAdd,
		})
		G.race.move(r.id, pose.x, pose.z, sNow, !r.seen, pose.y)
		r.seen = true
		r.pose = pose
		others.push(pose)
	}
	return others
}

function phaseLabel(G) {
	if (G.spectator) {
		if (G.phase === 'lobby') {
			const url = (G.state?.joinUrls || [])[0]
			return url ? `Join the race: ${url}` : 'Waiting for drivers'
		}
		return G.phase === 'results' ? 'Race over' : ''
	}
	if (G.phase === 'lobby') return G.car ? 'Free roam · try the items · waiting for the start' : ''
	if (G.phase === 'results') return 'Race over'
	return ''
}

function updateHud(G, sNow, v) {
	const laps = G.state?.laps || 3
	const rc = G.meId != null ? G.race.cars.get(G.meId) : null
	const racing = !G.spectator && !!rc && (G.phase === 'race' || G.phase === 'countdown')
	const done = rc ? G.race.lapsOf(G.meId) : 0
	const started = G.startAt != null && sNow >= G.startAt
	const lapStart = rc?.lap.lapStart
	const total = (G.state?.players || []).length || G.race.cars.size
	const pos = racing ? G.race.positionOf(G.meId) : 0
	updateCatchup(G, pos, total)
	const dots = []
	for (const r of G.remotes.values()) if (r.pose) dots.push({ x: r.pose.x, z: r.pose.z, color: safeColor(r.color) })
	if (G.car) dots.push({ x: G.car.x, z: G.car.z, color: safeColor(G.me?.color), me: true })
	G.hud.update({
		racing,
		pos,
		total,
		lap: Math.min(done, laps - 1),
		laps,
		curMs: racing && started && lapStart != null && done < laps ? sNow - lapStart : null,
		bestMs: G.spectator ? null : (G.bests.get(G.meId) ?? rc?.lap.bestMs ?? null),
		speed: v,
		onTrack: G.car ? G.car.onTrack : true,
		phaseLabel: phaseLabel(G),
		dots,
	})
	if (racing && done >= laps) G.hud.setStatus(`Finished · P${G.race.positionOf(G.meId)}`)
	else if (!G.spectator && G.net?.status === 'joined') G.hud.setStatus('')
	G.hud.setConn(G.net?.status || 'idle', G.net?.clock.rtt)
}

function updateBoard(G) {
	const laps = G.state?.laps || 3
	const players = G.state?.players || []
	const byId = new Map(players.map((p) => [p.id, p]))
	const ids =
		G.phase === 'results' && G.results ? G.results.map((r) => r.id) : G.race.order().filter((id) => byId.has(id))
	for (const p of players) if (!ids.includes(p.id) && p.id !== G.meId) ids.push(p.id)
	const rows = ids
		.filter((id) => byId.has(id))
		.map((id) => {
			const p = byId.get(id)
			const res = G.results?.find((r) => r.id === id)
			const done = G.race.lapsOf(id)
			let info = ''
			if (res && res.totalMs != null) info = fmtTime(res.totalMs)
			else if (G.phase === 'race' || G.phase === 'countdown') info = `Lap ${Math.min(done + 1, laps)}/${laps}`
			else if (G.phase === 'lobby') info = p.ready ? 'ready' : ''
			return { name: p.name, color: p.color, info }
		})
	G.hud.leaderboard(rows)
	G.hud.setStatus(phaseLabel(G))
}
