/**
 * Server messages → game state of the Stage Skirmish client (WO-1081 §6/§7): welcome / state (phases, roster, arena,
 * mode), `w` snapshots of the other soldiers (the kit's SnapshotBuffer), shots of others (drawn from the server's
 * `seed`; the own echo is skipped — it was drawn at once), damage, frags, spawns, booms, the own `me` (health, armour,
 * ammo — the only source of those), pick-ups, count-down and results. The kit's stage-fx sees every message first
 * (live lights). Arena / game-off actions come from game.js through G.ctl.
 */
import { SnapshotBuffer } from './kit/interp.js'
import { safeColor, COLORS, sessSet } from './dom.js'
import { createSoldierModel } from './soldier-model.js'
import { placeSoldier, createSoldier } from './move.js'
import { autoSwitch } from './score.js'
import { phaseOf } from './protocol.js'
import { TEAM_COLORS, WEAPONS, PICKUPS, FLAG, RESPAWN_S } from './sk-const.js'
import { remoteShot, endRocketByBoom } from './combat.js'

const SNAP_U = 3 // a jump farther than this (u) is a respawn: snap, don't glide

/** The colour a player is drawn in: the team colour in `tdm`, else their own. */
export function colorOf(G, p) {
	if (G.state?.mode === 'tdm' && (p?.team === 0 || p?.team === 1)) return TEAM_COLORS[p.team]
	return safeColor(p?.color, COLORS[0])
}

function player(G, id) {
	return (G.state?.players || []).find((p) => p.id === id) || null
}

export function nameOf(G, id) {
	return player(G, id)?.name ?? (id === G.meId ? G.joinInfo?.name : null) ?? '?'
}

function dropRemote(G, id) {
	const r = G.remotes.get(id)
	if (!r) return
	r.model.dispose()
	G.remotes.delete(id)
}

/**
 * Remote soldiers follow the roster (models rebuilt when name / colour change). A disconnected player (listed with his
 * score until the lobby) is no soldier: not drawn, not in any ray, not followed (WO-1106 B35 — he never comes back).
 */
export function syncRemotes(G) {
	const players = (G.state?.players || []).filter((p) => p.connected !== false)
	const ids = new Set(players.map((p) => p.id))
	for (const id of [...G.remotes.keys()]) if (!ids.has(id) || id === G.meId) dropRemote(G, id)
	for (const p of players) {
		if (p.id === G.meId) continue
		const color = colorOf(G, p)
		const r = G.remotes.get(p.id)
		if (r && (r.name !== p.name || r.color !== color)) dropRemote(G, p.id)
		if (G.remotes.has(p.id)) continue
		const model = createSoldierModel({ color, name: String(p.name ?? ''), scale: G.s, tagSize: G.spectator ? 0.04 : 0.032 })
		model.group.visible = false
		G.world.scene.add(model.group)
		G.remotes.set(p.id, {
			id: p.id,
			name: p.name,
			color,
			buf: new SnapshotBuffer({ snapDist: SNAP_U * G.s }),
			model,
			pose: null,
			f: 0,
			hp: 100,
			hitAt: -1e9,
			alive: true,
			deadAt: 0,
		})
	}
	if (G.myModel && G.myColor !== colorOf(G, player(G, G.meId) || G.joinInfo)) ensureMine(G, true)
}

/** The own soldier (players only): created on the first welcome, recoloured on a team change. */
export function ensureMine(G, rebuild = false) {
	if (G.spectator || G.meId == null) return
	if (G.myModel && !rebuild) return
	const color = colorOf(G, player(G, G.meId) || G.joinInfo)
	if (G.myModel) G.myModel.dispose()
	G.myColor = color
	G.myModel = createSoldierModel({ color, name: '', tag: false, scale: G.s })
	G.myModel.setWeapon(G.held)
	G.world.scene.add(G.myModel.group)
	if (!G.my) {
		G.my = createSoldier(0, 0, 0)
		G.ctl.toSpawn()
	}
}

function applyState(G, state) {
	if (!state || typeof state !== 'object') return
	if (state.enabled === false) return void G.ctl.gameOff()
	const prev = G.phase
	G.state = state
	G.phase = phaseOf(state)
	if (Number.isFinite(state.startAt)) G.startAt = state.startAt // §12: state carries startAt in the countdown
	G.ctl.sceneRev?.(state.sceneRev) // WO-1106 B56: a new scene rev (lobby only) → the scene is fetched and rebuilt
	if (state.arenaId && state.arenaId !== G.arena?.id) G.ctl.setArena(state.arenaId)
	// WO-1106 B54: the state lists only what is gone now — a reset (start / lobby / stop) must bring the rest back
	for (const id of G.arenaView?.pickups.keys() || []) G.arenaView.setTaken(id, 0)
	for (const [id, until] of state.pk || []) G.arenaView?.setTaken(id, until)
	syncRemotes(G)
	if (G.phase !== prev) onPhase(G, prev)
	G.hud.score(G.ctl.scoreInfo())
	if (!G.spectator && G.meId != null) {
		if (G.phase === 'lobby') G.lobby.showLobby(state, G.meId, G.arena?.name)
		else G.lobby.hide()
	}
}

function onPhase(G, prev) {
	if (G.phase === 'countdown') {
		G.results = null
		G.hud.feed.clear()
		G.hud.banner('', 'info', 1) // the warm-up's banners / toasts end with it
		G.hud.toast('', 1)
		G.audio.beep(520, 120)
	}
	if (G.phase === 'match' && prev === 'countdown') {
		G.hud.banner('FIGHT!', 'frag', 1200)
		G.audio.beep(990, 260)
	}
	if (G.phase !== 'results') G.results = null
}

function onSnapshots(G, m) {
	for (const a of m.a) {
		if (a.id === G.meId) {
			G.myFlags = a.f
			if (a.f & FLAG.DEAD && G.alive) G.alive = false
			continue
		}
		const r = G.remotes.get(a.id)
		if (!r) continue
		r.f = a.f
		if (a.w) r.w = a.w
		r.buf.push(m.ts, { x: a.x, y: G.arena?.y ?? 0, z: a.z, yaw: a.yaw, v: 0, st: 0, fx: a.f })
		if (!(a.f & FLAG.DEAD) && !r.alive && m.ts > r.deadAt + 500) r.alive = true
		if (a.f & FLAG.DEAD) r.alive = false
	}
}

function onDmg(G, m) {
	const at = G.net.serverNow()
	if (m.id === G.meId) {
		G.hud.hurt()
		G.audio.play('hurt')
	} else {
		const r = G.remotes.get(m.id)
		if (r) {
			r.hp = m.hp
			r.hitAt = at
			r.model.hitFlash()
			if (r.pose) G.skfx.sparks(r.pose.x, (G.arena?.y ?? 0) + 0.35 * G.s, r.pose.z)
		}
	}
	if (m.by === G.meId && m.id !== G.meId) G.audio.play('hit')
}

function onKill(G, m) {
	const suicide = m.by === m.id
	const killer = suicide ? null : { name: nameOf(G, m.by), color: colorOf(G, player(G, m.by)) }
	const victim = { name: nameOf(G, m.id), color: colorOf(G, player(G, m.id)) }
	G.hud.feed.add({ killer, victim, w: m.w, suicide, mine: m.by === G.meId || m.id === G.meId })
	const y = G.arena?.y ?? 0
	if (m.id === G.meId) {
		G.alive = false
		G.deadAt = m.at ?? G.net.serverNow()
		if (G.my) G.skfx.pop(G.my.x, y, G.my.z, G.myColor)
		G.hud.banner(suicide ? 'Oops — your own blast' : `Fragged by ${killer.name}`, 'dead', 2600)
		G.audio.play('fragged')
	} else {
		const r = G.remotes.get(m.id)
		if (r) {
			r.alive = false
			r.deadAt = m.at ?? G.net.serverNow()
			if (r.pose) G.skfx.pop(r.pose.x, y, r.pose.z, r.color)
		}
		if (m.by === G.meId) {
			G.hud.banner(`FRAG · ${victim.name}`, 'frag', 1600)
			G.audio.play('frag')
		}
	}
}

function onSpawn(G, m) {
	if (m.id === G.meId) {
		if (!G.my) return
		placeSoldier(G.my, m.p[0], m.p[1], m.yaw)
		G.alive = true
		G.spawned = true
		G.protUntil = m.until || 0
		G.camPose = null
		G.myModel?.setPop(null)
		return
	}
	const r = G.remotes.get(m.id)
	if (!r) return
	r.buf = new SnapshotBuffer({ snapDist: SNAP_U * G.s })
	r.buf.push(G.net.serverNow() - 1, { x: m.p[0], y: G.arena?.y ?? 0, z: m.p[1], yaw: m.yaw, v: 0, st: 0, fx: FLAG.PROTECTED })
	r.alive = true
	r.hp = 100
	r.hitAt = -1e9
	r.model.setPop(null)
}

function onMe(G, m) {
	const prev = G.me?.w || {}
	const prevHp = G.me?.hp ?? 0
	const prevAr = G.me?.ar ?? 0
	const wasSurge = G.me?.surge > G.net.serverNow()
	G.me = m
	G.spent = 0
	const held = autoSwitch(prev, m.w, G.held)
	if (held !== G.held) G.ctl.hold(held, held !== 'pea' && !(prev[held] > 0) ? `${WEAPONS[held].name}!` : '')
	const gained = Object.keys(m.w).some((w) => m.w[w] > 0 && m.w[w] > (prev[w] ?? 0))
	if (gained || m.hp > prevHp + 1 || m.ar > prevAr) G.audio.play('pickup')
	if (m.surge > G.net.serverNow() && !wasSurge) G.audio.play('surge')
}

function onPk(G, m) {
	G.arenaView?.setTaken(m.id, m.until)
	const it = G.arenaView?.pickups.get(m.id)
	if (!it) return
	G.skfx.sparkle(it.x, G.arena.y, it.z, 0xffffff)
	if (m.by === G.meId) G.hud.toast(PICKUPS[it.kind]?.name || 'Got it', 1100)
	else if (it.kind === 'surge') G.hud.toast(`${nameOf(G, m.by)} has the SURGE`, 2200)
}

export function onMessage(G, m) {
	if (G.fx?.onMessage(m)) return
	if (G.wj?.onMessage(m)) return // WO-1101 Game World: wst / wv / xfx / xbonus (it only peeks at welcome / state)
	switch (m.t) {
		case 'welcome':
			G.meId = m.id
			if (m.you?.color) G.joinInfo = { ...(G.joinInfo || {}), color: m.you.color, name: m.you.name ?? G.joinInfo?.name }
			G.ownShots.clear()
			applyState(G, m.state)
			ensureMine(G)
			if (!G.spectator && G.joinInfo) sessSet('joined', JSON.stringify(G.joinInfo))
			break
		case 'state':
			applyState(G, m.state)
			break
		case 'w':
			onSnapshots(G, m)
			break
		case 'shot':
			if (m.id === G.meId && G.ownShots.has(m.n)) break // drawn already (client-side prediction)
			remoteShot(G, m)
			break
		case 'dmg':
			onDmg(G, m)
			break
		case 'kill':
			onKill(G, m)
			break
		case 'spawn':
			onSpawn(G, m)
			break
		case 'boom':
			endRocketByBoom(G, m)
			break
		case 'me':
			onMe(G, m)
			break
		case 'pk':
			onPk(G, m)
			break
		case 'countdown':
			G.startAt = m.startAt
			break
		case 'results':
			G.results = m
			G.audio.beep(784, 300)
			break
		default:
			break
	}
}

/** Seconds until the own respawn (null when alive). */
export function respawnLeft(G, serverNow) {
	if (G.alive || G.deadAt == null) return null
	return Math.max(0, RESPAWN_S - (serverNow - G.deadAt) / 1000)
}
