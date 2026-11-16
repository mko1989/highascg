/* global window, performance */
/**
 * Per-frame work of Stage Skirmish (WO-1081 §5/§9): input → the own soldier (fixed 60 Hz steps against the arena's
 * solid grid, screen-relative running, mouse / stick aim), the trigger (combat.js), pick-ups, the own-state send;
 * the other soldiers drawn from their snapshot buffers (interpolated 100 ms back), rockets, effects, the live room
 * (the kit's stage-fx), the top-down camera (spectators: the whole arena or one player at a time), HUD every 100 ms,
 * and in `spot` mode the spotlight pool (spot-view.js) with its HUD line and minimap ring (WO-1083).
 */
import { stepSoldier, isMoving } from './move.js'
import { stateMsg } from './protocol.js'
import { followCam, arenaCam, easePose, screenToPlane, FOV_DEG } from './cam.js'
import { tryFire, updateRockets, checkPickups } from './combat.js'
import { respawnLeft, nameOf } from './session.js'
import { rankOf, leaderOf, fmtClock, isEnemy, cycleWeapon, weaponForKey } from './score.js'
import { SOLDIER, FLAG, yawOf, fwd, SPOT_WARN_S } from './sk-const.js'
import { createSpotView } from './spot-view.js'
import { spotStatus } from './spot-status.js'

const HUD_EVERY_MS = 100
const SPEC_OVERVIEW_S = 10
const SPEC_FOLLOW_S = 7
const HEALTHBAR_MS = 3000

export function startLoop(G) {
	let last = performance.now()
	let hudAt = 0
	let specAt = 0
	let specTarget = null
	let lastCd = null

	function remotes(sNow, now, dt, t) {
		const y = G.arena?.y ?? 0
		for (const r of G.remotes.values()) {
			const pose = r.buf.render(sNow, now)
			r.pose = pose
			if (!pose) {
				r.model.setVisible(false)
				continue
			}
			if (!r.alive) {
				r.popK = Math.min(1, (r.popK || 0) + dt * 4)
				r.model.setPop(r.popK)
			} else r.popK = 0
			r.model.setVisible(r.alive || r.popK < 1)
			r.model.setWeapon(r.w || 'pea')
			r.model.update({
				x: pose.x,
				y,
				z: pose.z,
				yaw: pose.yaw,
				moving: !!(pose.fx & FLAG.MOVING),
				protectedBlink: !!(pose.fx & FLAG.PROTECTED),
				surge: !!(pose.fx & FLAG.SURGE),
				t,
				dt,
			})
			const showBar = r.alive && sNow - r.hitAt < HEALTHBAR_MS && isEnemy(G.state, G.meId, r.id)
			r.model.setHealth(showBar ? r.hp / 100 : null)
		}
	}

	function ownSoldier(dt, sNow, now, t) {
		if (!G.my || G.spectator) return
		const y = G.arena?.y ?? 0
		const input = G.input.read()
		G.boardHeld = input.board
		if (input.pick) {
			const w = weaponForKey(G.me?.w, input.pick)
			if (w) G.ctl.hold(w)
		}
		if (input.cycle) G.ctl.hold(cycleWeapon(G.me?.w, G.held, input.cycle))
		const frozen = G.phase === 'countdown' || G.phase === 'results' || !G.alive || !G.arena || !!G.wj?.paused // WO-1101 world pause
		const wish = frozen ? { mx: 0, mz: 0 } : G.wj ? G.wj.wish(input, sNow) : input // WO-1102 stun / slick splat
		G.stepper.advance(dt, (h) => stepSoldier(G.my, wish, h, G.grid, G.s))
		/* aim */
		if (!frozen && input.aim) {
			if (input.aim.yaw != null) G.my.yaw = input.aim.yaw
			else if (input.aim.ndc && G.camPose) {
				const aspect = G.world.camera.aspect
				const p = screenToPlane(G.camPose, input.aim.ndc, aspect, G.world.camera.fov, y + SOLDIER.MUZZLE_H * G.s)
				if (p && Math.hypot(p[0] - G.my.x, p[1] - G.my.z) > 0.05 * G.s) G.my.yaw = yawOf(p[0] - G.my.x, p[1] - G.my.z)
			}
		}
		if (!frozen && !G.wj?.held(sNow)) {
			const aim = G.my.yaw
			G.my.yaw += G.wj?.jitter(sNow) || 0 // WO-1102 R5 pea scatter: a wider cone while it lasts
			tryFire(G, input.fire, now)
			G.my.yaw = aim
		}
		checkPickups(G, sNow)
		const m = G.myModel
		if (m) {
			if (!G.alive) G.myPop = Math.min(1, (G.myPop || 0) + dt * 4)
			else G.myPop = 0
			m.setPop(G.alive ? null : G.myPop)
			m.setVisible(G.alive || G.myPop < 1)
			m.setWeapon(G.held)
			m.update({
				x: G.my.x,
				y,
				z: G.my.z,
				yaw: G.my.yaw,
				moving: isMoving(G.my, G.s),
				protectedBlink: G.protUntil > sNow,
				surge: (G.me?.surge || 0) > sNow,
				t,
				dt,
			})
		}
		if (G.alive && G.arena && G.phase !== 'countdown')
			G.net?.sendState(stateMsg(G.my.x, G.my.z, G.my.yaw, isMoving(G.my, G.s), G.held, G.s))
	}

	function camera(dt, t) {
		if (!G.arena) return
		const y = G.arena.y
		let want
		if (G.spectator) {
			if (t - specAt > (specTarget == null ? SPEC_OVERVIEW_S : SPEC_FOLLOW_S)) {
				specAt = t
				const alive = [...G.remotes.values()].filter((r) => r.alive && r.pose)
				specTarget = specTarget == null && alive.length ? alive[Math.floor(Math.random() * alive.length)].id : null
			}
			const r = specTarget != null ? G.remotes.get(specTarget) : null
			want = r?.pose && r.alive ? followCam(r.pose.x, y, r.pose.z, G.s, null, 18) : arenaCam(G.arena.rect, y, G.world.camera.aspect, FOV_DEG)
		} else if (G.my) {
			want = followCam(G.my.x, y, G.my.z, G.s, G.alive ? fwd(G.my.yaw) : null)
		} else want = arenaCam(G.arena.rect, y, G.world.camera.aspect, FOV_DEG)
		G.camPose = easePose(G.camPose, want, dt, G.spectator ? 0.5 : 0.1, 6 * G.s)
		G.world.setCamera(G.camPose)
	}

	const spotOf = () => (G.state?.mode === 'spot' && G.state.spot) || null
	const spotColor = (sp) => (sp.contested ? '#ff5a2a' : sp.holder == null ? '#ffd23a' : sp.holder === G.meId ? '#4dff7a' : G.remotes.get(sp.holder)?.color || '#ffffff')

	function spotlight(t, sNow) {
		const sp = spotOf()
		if (sp && !G.spotView && G.arena) {
			G.spotView = createSpotView(G.s)
			G.world.scene.add(G.spotView.group)
		}
		G.spotView?.update(sp, { t, sNow, y: G.arena?.y ?? 0, meId: G.meId, colorOf: (id) => G.remotes.get(id)?.color ?? null })
	}

	function hud(sNow) {
		const players = G.state?.players || []
		if (!G.spectator) G.hud.vitals(G.me, G.held)
		G.hud.score({ ...G.ctl.scoreInfo(), rank: rankOf(players, G.meId), leader: leaderOf(players) })
		/* clock / count-down (before the first pong the server clock is unknown) */
		const synced = !!G.net?.clock.samples.length
		if (G.phase === 'countdown' && G.startAt && synced) {
			const left = Math.ceil((G.startAt - sNow) / 1000)
			G.hud.big(left > 0 ? String(left) : null)
			if (left !== lastCd && left > 0) G.audio.beep(520, 110)
			lastCd = left
		} else G.hud.big(null)
		if (G.phase === 'match' && G.state?.endsAt && synced) G.hud.clock(fmtClock(G.state.endsAt - sNow))
		else G.hud.clock(G.phase === 'lobby' ? 'WARM UP' : G.phase === 'results' ? 'RESULTS' : '')
		const left = respawnLeft(G, sNow)
		G.hud.respawn(!G.spectator && left != null && G.meId != null ? (left > 0.05 ? `Back in ${Math.ceil(left)}` : 'Respawning…') : '')
		G.hud.surge(!G.spectator && (G.me?.surge || 0) > sNow)
		const sp = spotOf()
		const me = !G.spectator && G.my && G.alive ? G.my : null
		G.hud.spot(spotStatus(sp, { meId: G.meId, phase: G.phase, sNow, me, nameOf: (id) => nameOf(G, id), s: G.s, warnS: SPOT_WARN_S }))
		G.hud.feed.tick()
		/* minimap */
		const here = (id) => G.arenaView?.available(id, sNow)
		const pickups = G.arenaView ? [...G.arenaView.pickups.values()].map((p) => ({ ...p, here: here(p.id) })) : []
		const dots = []
		for (const r of G.remotes.values()) {
			if (!r.pose || !r.alive) continue
			const mate = G.state?.mode === 'tdm' && !isEnemy(G.state, G.meId, r.id)
			if (G.spectator || mate) dots.push({ x: r.pose.x, z: r.pose.z, color: r.color })
		}
		G.hud.minimap.draw({ pickups, dots, me: G.my && G.alive ? G.my : null, spot: sp ? { x: sp.x, z: sp.z, r: sp.r, color: spotColor(sp) } : null })
		/* the board: results, Tab / button, spectators always */
		const showBoard = G.phase === 'results' || G.boardHeld || G.boardOn || G.spectator
		if (showBoard) G.hud.board.render(G.ctl.boardInfo())
		else G.hud.board.render(null)
	}

	function frame(now) {
		window.requestAnimationFrame(frame)
		const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
		last = now
		const t = now / 1000
		const sNow = G.net ? G.net.serverNow() : now
		remotes(sNow, now, dt, t)
		ownSoldier(dt, sNow, now, t)
		if (G.arena) updateRockets(G, sNow, t)
		G.skfx.update(dt)
		G.fx?.update(dt)
		G.arenaView?.update(t, sNow)
		spotlight(t, sNow)
		camera(dt, t)
		G.wj?.frame(sNow, dt) // WO-1101 Game World visitors (nothing without the world)
		if (now - hudAt > HUD_EVERY_MS) {
			hudAt = now
			hud(sNow)
		}
		G.world.render()
	}
	window.requestAnimationFrame(frame)
}
