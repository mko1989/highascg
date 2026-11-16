/* global window, performance */
/**
 * Per-frame work of Stage Salad (WO-1089 §11): controls (aim, pull, the release → game.js fire), the own slingshot
 * and its aim to the server (≤ 10/s), the dotted preview of the arc, the avatars (interpolated `w`), the projectile
 * book (shots.js; finished projectiles → session.js onEvents), the others' slingshots, the live room (the kit's
 * stage-fx), the camera (behind the own slingshot, following the own vegetable ≤ FOLLOW_S; spectators and guests
 * without a slot: the wide stage camera) and the HUD every 100 ms.
 */
import { onEvents, mySlot } from './session.js'
import { slingCam, followCam, stageCam, easePose, FOLLOW_S } from './cam.js'
import { pouch } from './venue.js'
import { VEGGIES, VEG_IDS } from './veggies.js'
import { canFire, streakMult } from './protocol.js'
import { orderPlayers } from './hud-board.js'
import { powerOf } from './aim-input.js'

const HUD_EVERY_MS = 100

/** m:ss of a span in ms (pure). */
export function fmtClock(ms) {
	const s = Math.max(0, Math.ceil(ms / 1000))
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function startLoop(G) {
	let last = performance.now()
	let hudAt = 0
	let lastCd = null
	let aimKey = ''
	let wasPulling = false

	/** The own aim this frame: the input (or the dev hook's scripted pull). → { yaw, pitch, power, pull, veg } | null */
	function ownAim(dt) {
		const slot = mySlot(G)
		if (!G.input || !slot) return null
		const c = G.input.tick(dt)
		G.boardHeld = c.board
		if (c.pick != null) G.ctl.pick(c.pick)
		if (c.cycle) G.ctl.pick(G.sel + c.cycle)
		const veg = VEGGIES[VEG_IDS[G.sel]]
		const a = G.input.aim.aim(slot.yaw, veg)
		if (c.release?.fire && G.ctl.fire({ yaw: a.yaw, pitch: a.pitch, power: powerOf(c.release.pull) })) G.hud.hint(false)
		const d = G.dev?.pull
		if (d) return { yaw: d.yaw, pitch: d.pitch, power: powerOf(d.pull), pull: d.pull, veg, slot }
		return { ...a, veg, slot }
	}

	function ownSling(a, sNow) {
		if (!a) {
			G.aimView.update(null)
			return
		}
		const loaded = sNow >= G.ctl.readyAt() - 60
		G.slings.setOwn(a.yaw, a.pitch, a.pull, loaded ? a.veg.id : null)
		const pulling = a.pull > 0.005
		G.aimView.update(pulling && G.venue ? { veg: a.veg, origin: pouch(a.slot), yaw: a.yaw, pitch: a.pitch, power: a.power, venue: G.venue } : null)
		if (pulling) G.audio.creak(a.pull)
		else if (wasPulling) G.audio.resetCreak()
		wasPulling = pulling
		/* the others see the band: while pulling, and the release (pull 0) */
		const k = `${a.yaw.toFixed(3)}|${a.pitch.toFixed(3)}|${a.pull.toFixed(2)}`
		if (k !== aimKey) {
			aimKey = k
			G.net?.sendAim(a.yaw, a.pitch, a.pull)
		}
		G.net?.flushAim()
	}

	/** The own vegetable to follow: the newest own shot's first projectile, still flying, ≤ FOLLOW_S. */
	function followed(now) {
		const f = G.follow
		if (!f || now > f.until) return null
		const pr = G.book.live.find((p) => p.own && p.n === f.n && p.i === 0)
		if (!pr) return now - (f.until - FOLLOW_S * 1000) < 400 ? 'wait' : null
		return pr.state === 'fly' || pr.state === 'hold' ? pr : null
	}

	function camera(dt, now) {
		if (!G.venue) return
		const slot = !G.spectator ? mySlot(G) : null
		const cam = G.world.camera
		let want
		let tau = 0.12
		if (slot) {
			const pr = followed(now)
			if (pr && pr !== 'wait') {
				want = followCam(pr.p, pr.v)
				tau = 0.08
			} else want = slingCam(slot, G.venue, G.input?.aim.yawOff || 0)
		} else {
			want = stageCam(G.venue, cam.aspect, cam.fov)
			tau = 0.6
		}
		G.camPose = easePose(G.camPose, want, dt, tau, 12)
		G.world.setCamera(G.camPose)
	}

	function runLater(sNow) {
		if (!G.later.length) return
		const due = G.later.filter((x) => sNow >= x.at)
		G.later = G.later.filter((x) => sNow < x.at)
		for (const x of due) x.fn()
	}

	function hud(sNow) {
		const st = G.state || {}
		const synced = !!G.net?.synced
		const players = st.players || []
		const meP = players.find((p) => p.id === G.meId)
		/* score + streak */
		if (G.spectator) G.hud.score({ main: 'Stage Salad', sub: `${players.length} slingshots`, teams: st.teams ? st.teamScores || [0, 0] : null })
		else if (G.phase === 'lobby') G.hud.score({ main: 'Practice', sub: 'nothing counts until the round starts', teams: null })
		else {
			const streak = G.me?.streak || 0
			const score = G.me?.score ?? meP?.score ?? 0
			const rank = orderPlayers(players).findIndex((p) => p.id === G.meId) + 1
			const sub = [rank > 0 ? `#${rank} of ${players.length}` : '', streak > 1 ? `streak ${streak} · ×${streakMult(streak)}` : ''].filter(Boolean).join(' · ')
			G.hud.score({ main: `${score} pts`, sub, teams: st.teams ? st.teamScores || [0, 0] : null, myTeam: meP?.team })
		}
		/* count-down + clock */
		if (G.phase === 'countdown' && G.startAt && synced) {
			const left = Math.ceil((G.startAt - sNow) / 1000)
			G.hud.big(left > 0 ? String(left) : null)
			if (left !== lastCd && left > 0) G.audio.play('tick', 0.6)
			lastCd = left
		} else G.hud.big(null)
		if (G.phase === 'round' && st.endsAt && synced) G.hud.clock(fmtClock(st.endsAt - sNow))
		else G.hud.clock(G.phase === 'lobby' ? 'PRACTICE' : G.phase === 'results' ? 'RESULTS' : G.phase === 'countdown' ? 'GET READY' : '')
		G.hud.safe(!!st.safe)
		G.hud.leaders.render(players, G.meId, !!st.teams)
		/* tray + power + pitch */
		if (!G.spectator && G.input) {
			const left = Math.max(0, G.ctl.readyAt() - sNow)
			G.hud.tray(G.sel, G.reloadMs > 0 ? Math.min(1, left / G.reloadMs) : 0, canFire(st) && !!mySlot(G))
			const pull = G.dev?.pull ? G.dev.pull.pull : G.input.aim.pull
			G.hud.power(pull, powerOf(pull))
			const v = VEGGIES[VEG_IDS[G.sel]]
			const a = mySlot(G) ? G.input.aim.aim(mySlot(G).yaw, v) : { pitch: (v.pitch * Math.PI) / 180 }
			G.hud.pitch(G.input.aim.pitchOff, a.pitch)
			G.hud.hint(G.shots === 0 && G.meId != null && !!mySlot(G) && !G.lobby?.panelOpen && (G.phase === 'lobby' || G.phase === 'round'))
		}
		/* the board: results, Tab / button, spectators always */
		const show = G.phase === 'results' || G.boardHeld || G.boardOn || G.spectator
		G.hud.board.render(show ? G.ctl.boardInfo() : null)
	}

	function frame(now) {
		window.requestAnimationFrame(frame)
		const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
		last = now
		const t = now / 1000
		const sNow = G.net ? G.net.serverNow() : Date.now()
		const a = G.spectator ? null : ownAim(dt)
		G.avatars.update(sNow, now, dt, t)
		const events = G.book.update(sNow, { hitTest: G.avatars.hitTest(), dt })
		if (events.length) onEvents(G, events, sNow, G.camPose?.eye)
		G.proj.sync(G.book, sNow, dt)
		ownSling(a, sNow)
		G.slings.update(dt)
		G.fx?.update(dt)
		runLater(sNow)
		camera(dt, now)
		G.wj?.frame(sNow, dt) // WO-1101 Game World visitors (nothing without the world)
		if (now - hudAt > HUD_EVERY_MS) {
			hudAt = now
			hud(sNow)
		}
		G.world.render()
	}
	window.requestAnimationFrame(frame)
}
