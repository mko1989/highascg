/* global window */
/**
 * Server messages → game state of the RC client (WO-1074): welcome / state (phases, players, track, late-join
 * startAt), countdown, `w` snapshots, laps, results; v2 item messages go through item-play.js. Unknown message types
 * are ignored (protocol.decode drops them). Track / grid / game-off actions come from game.js via G.ctl.
 */
import { safeColor, sessGet, sessSet, COLORS } from './dom.js'
import { createCarModel } from './car-model.js'
import { gridPose } from './track-math.js'
import { createCar } from './physics.js'
import { SnapshotBuffer, SNAP_DIST } from './interp.js'
import { onItemMessage } from './item-play.js'

function mySlot(G) {
	return Number.isFinite(G.me?.slot) ? G.me.slot : 0
}

export { mySlot }

export function ensureMyCar(G) {
	if (G.spectator || G.car || !G.T) return
	G.car = createCar(gridPose(G.T, mySlot(G)))
	G.myModel = createCarModel({ color: safeColor(G.me?.color, COLORS[0]), scale: G.s ?? 1 })
	G.world.scene.add(G.myModel.group)
	G.race.move(G.meId, G.car.x, G.car.z, null, true, G.car.y)
}

function dropRemote(G, id, r) {
	G.world.scene.remove(r.model.group)
	r.model.dispose()
	G.remotes.delete(id)
}

function syncRemotes(G, players) {
	const ids = new Set(players.map((p) => p.id))
	for (const [id, r] of G.remotes) {
		if (!ids.has(id) || id === G.meId) {
			dropRemote(G, id, r)
			G.race.remove(id)
		}
	}
	for (const p of players) {
		if (p.id === G.meId) continue
		const r = G.remotes.get(p.id)
		if (r && (r.name !== p.name || r.color !== p.color)) dropRemote(G, p.id, r)
		if (!G.remotes.has(p.id)) {
			const model = createCarModel({
				color: safeColor(p.color),
				name: p.name,
				tag: true,
				tagScale: G.spectator ? 0.07 : 0.05,
				scale: G.s ?? 1,
			})
			model.group.visible = false
			G.world.scene.add(model.group)
			G.remotes.set(p.id, {
				id: p.id,
				name: p.name,
				color: p.color,
				buf: new SnapshotBuffer({ snapDist: SNAP_DIST * (G.s ?? 1) }), // §3 × toy scale
				model,
				pose: null,
				seen: false,
				fx: 0,
				spinAdd: 0,
			})
		}
		/* WO-1106 B35: a racer whose socket is gone stays listed until the lobby (rc-room.js drop): its frozen car is
		   not drawn, collided with or followed (loop.js remoteCars); back online it starts from fresh snapshots */
		const rr = G.remotes.get(p.id)
		const off = p.connected === false
		if (rr.off && !off) {
			rr.buf = new SnapshotBuffer({ snapDist: SNAP_DIST * (G.s ?? 1) })
			rr.seen = false
		}
		rr.off = off
	}
}

function applyState(G, state) {
	if (!state) return
	if (state.enabled === false) {
		G.ctl.gameOff()
		return
	}
	const prevPhase = G.phase
	G.state = state
	G.phase = state.phase || 'lobby'
	if (G.scene?.rev && state.sceneRev && state.sceneRev !== G.scene.rev && sessGet('reloadedFor') !== state.sceneRev) {
		/* a new stage: reload (the join is remembered for this tab); at most once per rev */
		sessSet('reloadedFor', state.sceneRev)
		window.location.reload()
		return
	}
	G.ctl.setTrack(state.trackId)
	syncRemotes(G, state.players || [])
	/* joined during a countdown / race (missed the `countdown` message): the server's state carries startAt */
	if (G.startAt == null && Number.isFinite(state.startAt) && (G.phase === 'countdown' || G.phase === 'race')) {
		G.startAt = state.startAt
		G.race.reset(state.startAt)
	}
	const meP = (state.players || []).find((p) => p.id === G.meId)
	if (meP && G.me) G.me = { ...G.me, name: meP.name, color: meP.color }
	/* WO-1106 B46: a mid-race (re)join is listed with racing:false: no laps, position or catch-up until the next race */
	G.myRacing = meP?.racing !== false
	ensureMyCar(G)
	if (G.phase === 'lobby') {
		if (prevPhase !== 'lobby') {
			G.results = null
			G.hud.results(null)
			G.startAt = null
			G.lobby?.resetReady()
			G.ctl.toGrid()
		}
		G.lobby?.showLobby(state, G.meId, G.T, { reveal: prevPhase !== 'lobby' })
	} else {
		G.lobby?.hide()
		if (G.phase === 'countdown' && prevPhase !== 'countdown') G.ctl.toGrid()
	}
	if (G.phase === 'results' && prevPhase !== 'results') G.items.reset() // the server clears them at the end too
	if (G.phase !== 'results' && G.results) {
		G.results = null
		G.hud.results(null)
	}
}

export function onMessage(G, m) {
	if (G.fx?.onMessage(m)) return // §2.6 lx / lxfull; it only peeks at welcome / state (lights / wall switches)
	if (G.wj?.onMessage(m)) return // WO-1101 Game World: wst / wv / xfx / xbonus (it only peeks at welcome / state)
	const sNow = G.net ? G.net.serverNow() : 0
	if (onItemMessage(G, m, sNow)) return
	switch (m.t) {
		case 'welcome':
			if (G.meId != null && G.meId !== m.id) G.race.remove(G.meId) // rejoined under a new id
			G.meId = m.id
			G.me = m.you || { id: m.id }
			if (G.myModel && G.me.color) {
				G.world.scene.remove(G.myModel.group)
				G.myModel.dispose()
				G.myModel = createCarModel({ color: safeColor(G.me.color), scale: G.s ?? 1 })
				G.world.scene.add(G.myModel.group)
			}
			applyState(G, m.state)
			break
		case 'state':
			applyState(G, m.state)
			break
		case 'countdown':
			G.startAt = m.startAt
			G.phase = 'countdown'
			G.lobby?.hide()
			G.results = null
			G.hud.results(null)
			G.bests.clear()
			G.items.reset() // boxes and hazards are cleared when a race starts
			G.ctl.toGrid()
			G.race.reset(m.startAt)
			break
		case 'w':
			for (const c of m.cars) {
				if (c.id === G.meId) continue
				G.remotes.get(c.id)?.buf.push(m.ts, c)
			}
			break
		case 'lap':
			G.race.serverLap(m.id, m.lap)
			if (m.best != null) G.bests.set(m.id, m.best)
			if (m.id === G.meId) {
				const laps = G.state?.laps || 3
				if (m.lap === laps - 1 && laps > 1) G.hud.x.banner('FINAL LAP', 'final', 2000)
				else if (m.lap < laps) G.hud.x.banner(`LAP ${m.lap + 1}`, '', 1400)
				if (m.ms != null) G.hud.toast(`Lap ${m.lap}: ${(m.ms / 1000).toFixed(2)} s${m.best === m.ms ? ' · best!' : ''}`)
			}
			break
		case 'results':
			G.results = m.order
			G.resultsFinal = m.final !== false
			for (const r of m.order) if (r.totalMs != null) G.race.finish(r.id, r.totalMs)
			showResults(G)
			break
	}
}

export function showResults(G) {
	if (!G.results) return
	const byId = new Map((G.state?.players || []).map((p) => [p.id, p]))
	const rows = G.results.map((r) => ({ ...r, color: byId.get(r.id)?.color, me: r.id === G.meId }))
	G.hud.results(
		rows,
		G.resultsFinal ? 'Final results — the host starts the next race' : 'Waiting for the other drivers…'
	)
}
