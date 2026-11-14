/* global window, performance */
/**
 * Per-frame work of the RC game (WO-1074): fixed-step physics for the own car, snapshot-interpolated remote cars,
 * lap tracking, cameras (chase / top, spectator director), throttled HUD updates, sound, and the own-state send.
 */
import { stepCar, forwardSpeed } from './physics.js'
import { stateMsg } from './protocol.js'
import { chaseTarget, topTarget, smoothCam, overviewTarget } from './cameras.js'
import { lerpAngle } from './interp.js'
import { fmtTime } from './lap-logic.js'
import { safeColor } from './dom.js'

const HUD_EVERY_MS = 100
const BOARD_EVERY_MS = 300

export function startLoop(G) {
	let last = performance.now()
	let hudAt = 0
	let boardAt = 0
	let cam = null
	let lastCdSec = null
	const prev = { x: 0, z: 0, yaw: 0 }
	let input = { throttle: 0, brake: 0, steer: 0, hand: false }

	function frame(now) {
		window.requestAnimationFrame(frame)
		const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
		last = now
		const sNow = G.net ? G.net.serverNow() : now

		/* ---- remote cars ---- */
		const others = []
		for (const r of G.remotes.values()) {
			const pose = r.buf.render(sNow, now)
			if (!pose) continue
			r.model.group.visible = true
			r.model.update(pose, pose.v, pose.st, dt)
			G.race.move(r.id, pose.x, pose.z, sNow, !r.seen)
			r.seen = true
			r.pose = pose
			others.push(pose)
		}

		/* ---- own car ---- */
		let pose = null
		let v = 0
		if (G.car && G.T) {
			input = G.input.read()
			const frozen = G.phase === 'countdown' && (G.startAt == null || sNow < G.startAt)
			const alpha = G.stepper.advance(dt, (h) => {
				prev.x = G.car.x
				prev.z = G.car.z
				prev.yaw = G.car.yaw
				if (frozen) return
				stepCar(G.car, input, G.env, others, h)
				const ev = G.race.move(G.meId, G.car.x, G.car.z, sNow)
				if (ev?.type === 'lap' && G.phase === 'race') G.audio.beep(988, 160)
			})
			v = forwardSpeed(G.car)
			pose = {
				x: prev.x + (G.car.x - prev.x) * alpha,
				y: G.car.y,
				z: prev.z + (G.car.z - prev.z) * alpha,
				yaw: lerpAngle(prev.yaw, G.car.yaw, alpha),
			}
			G.myModel.update(pose, v, G.car.st, dt)
			const rc = G.race.cars.get(G.meId)
			G.net?.sendState(stateMsg(G.car, v, rc ? rc.lap.cp : 0, rc ? Math.min(rc.lap.lap, G.state?.laps || 99) : 0))
			G.audio.engine(v, input.throttle)
		}

		/* ---- camera ---- */
		if (G.T) {
			let want
			if (G.spectator) {
				want = G.director.update(now / 1000, dt, G.T, G.race.order(), (id) => G.remotes.get(id)?.pose || null)
				cam = want
			} else {
				if (pose) want = G.camMode === 'top' ? topTarget(pose, 7 + Math.abs(v) * 0.3) : chaseTarget(pose, v)
				else want = overviewTarget(G.T)
				cam = smoothCam(cam, want, dt, G.camMode === 'top' ? 4 : 7)
			}
			G.world.setCamera(cam)
		}

		/* ---- countdown lights ---- */
		if (G.startAt != null && (G.phase === 'countdown' || G.phase === 'race')) {
			const remain = G.startAt - sNow
			G.hud.countdown(remain)
			const sec = remain > 0 ? Math.ceil(remain / 1000) : 0
			if (sec !== lastCdSec && remain > -500) {
				if (sec <= 5) G.audio.beep(sec ? 523 : 1046, sec ? 120 : 400)
				lastCdSec = sec
			}
		} else G.hud.countdown(null)

		/* ---- HUD (throttled) ---- */
		if (now - hudAt > HUD_EVERY_MS) {
			hudAt = now
			updateHud(G, sNow, v)
		}
		if (G.spectator && now - boardAt > BOARD_EVERY_MS) {
			boardAt = now
			updateBoard(G)
		}

		G.world.render()
	}
	window.requestAnimationFrame(frame)
}

function phaseLabel(G) {
	if (G.spectator) {
		if (G.phase === 'lobby') {
			const url = (G.state?.joinUrls || [])[0]
			return url ? `Join the race: ${url}` : 'Waiting for drivers'
		}
		return G.phase === 'results' ? 'Race over' : ''
	}
	if (G.phase === 'lobby') return G.car ? 'Free roam · waiting for the start' : ''
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
	const dots = []
	for (const r of G.remotes.values()) if (r.pose) dots.push({ x: r.pose.x, z: r.pose.z, color: safeColor(r.color) })
	if (G.car) dots.push({ x: G.car.x, z: G.car.z, color: safeColor(G.me?.color), me: true })
	G.hud.update({
		racing,
		pos: racing ? G.race.positionOf(G.meId) : 0,
		total: (G.state?.players || []).length || G.race.cars.size,
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
