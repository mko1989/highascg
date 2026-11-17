/**
 * Shooting on the client (WO-1081 §5): the own fire is predicted — sent as `fire`, drawn at once, its hitscan traced
 * against the soldiers AS DRAWN (interpolated) and the hits claimed with `hit` right behind it on the same socket;
 * the server's echoed `shot` of it is skipped (session.js). Others' shots are drawn from the server's `shot` with its
 * `seed`. Rockets fly on every client from their start; the OWNER reports the impact with `boom`, and an explosion is
 * drawn once per rocket (its own impact or the server's `boom`, whichever comes first). Pick-ups are claimed by
 * walking over them. Ammo and health are never changed here — the server's `me` is the only source.
 */
import { WEAPONS, SOLDIER, PICK_R, AR_MAX, HP_MAX, RAISE_MS, fwd } from './sk-const.js'
import { traceShot, createRocket, stepRocket, rocketAt } from './shots.js'
import { fireMsg, hitMsg, boomMsg, pickMsg } from './protocol.js'
import { usable, isEnemy, bestWeapon } from './score.js'

const OWN_SHOTS_KEEP = 64

/** The soldiers a ray can meet: drawn, alive remotes (+ the own soldier for others' shots). */
export function soldiersFor(G, ownerId, { claimable = false } = {}) {
	const out = []
	const sNow = G.net?.serverNow() ?? 0
	for (const r of G.remotes.values()) {
		if (!r.pose || !r.alive || r.id === ownerId) continue
		if (claimable && (!isEnemy(G.state, G.meId, r.id) || r.f & 4)) {
			out.push({ id: r.id, x: r.pose.x, z: r.pose.z, block: true })
			continue
		}
		out.push({ id: r.id, x: r.pose.x, z: r.pose.z })
	}
	if (G.my && G.alive && ownerId !== G.meId) out.push({ id: G.meId, x: G.my.x, z: G.my.z, prot: G.protUntil > sNow })
	return out
}

function muzzleOf(G, x, z, yaw) {
	const [dx, dz] = fwd(yaw)
	const k = 0.32 * G.s
	return [x + dx * k, z + dz * k]
}

function drawHitscan(G, shot, tr) {
	const y = G.arena.y + SOLDIER.MUZZLE_H * G.s
	const [mx, mz] = muzzleOf(G, shot.p[0], shot.p[1], shot.yaw)
	G.skfx.flash(mx, y, mz, shot.w)
	for (const ray of tr.rays) {
		const [dx, dz] = fwd(ray.yaw)
		const bx = shot.p[0] + dx * ray.len
		const bz = shot.p[1] + dz * ray.len
		G.skfx.tracer(mx, mz, bx, bz, y, shot.w)
		if (ray.hit != null) G.skfx.sparks(bx, y, bz, 0xff6050)
		else if (ray.len < WEAPONS[shot.w].range * G.s - 1e-6) G.skfx.sparks(bx, y, bz)
	}
}

function startRocket(G, shot, own) {
	const r = createRocket(shot, G.grid, G.s)
	r.own = own
	r.handle = G.skfx.rocket(G.arena.y + SOLDIER.MUZZLE_H * G.s)
	G.rockets.push(r)
	const [mx, mz] = muzzleOf(G, shot.p[0], shot.p[1], shot.yaw)
	G.skfx.flash(mx, G.arena.y + SOLDIER.MUZZLE_H * G.s, mz, 'thumper')
}

/** Volume of a sound at distance d (m) from the own soldier. */
function near(G, x, z) {
	if (!G.my) return 0.6
	const d = Math.hypot(x - G.my.x, z - G.my.z) / G.s
	return Math.max(0.15, 1 - d / 40)
}

/** Another player's shot (or an own one that was not predicted), from the server. */
export function remoteShot(G, m) {
	if (!G.arena || !G.grid) return
	const shot = { ...m, ts: m.ts ?? G.net.serverNow() }
	const who = G.remotes.get(m.id)
	if (who) who.w = m.w
	const W = WEAPONS[m.w]
	if (W.kind === 'rocket') startRocket(G, shot, m.id === G.meId)
	else drawHitscan(G, shot, traceShot(shot, G.grid, soldiersFor(G, m.id), G.s))
	G.audio.play(m.w, near(G, m.p[0], m.p[1]))
}

/**
 * Own trigger, every frame while held. Sends `fire` when the held weapon has ammo (the server's `me`, minus the shots
 * sent since that `me`) and its interval passed; then draws and claims hits at once.
 */
export function tryFire(G, held, nowMs) {
	if (!held || !G.my || !G.alive || G.meId == null) return false
	if (G.phase === 'countdown' || G.phase === 'results' || !G.arena) return false
	const w = G.held
	const W = WEAPONS[w]
	const ammo = G.me?.w?.[w]
	if (!usable(G.me?.w, w) || (ammo !== -1 && ammo - G.spent <= 0)) {
		if (nowMs - (G.emptyAt || 0) > 400) {
			G.emptyAt = nowMs
			G.audio.play('empty')
			const best = bestWeapon(G.me?.w)
			if (best !== w) G.ctl.hold(best)
		}
		return false
	}
	if (nowMs - (G.lastFireAt || -1e9) < W.interval * 1000) return false
	if (G.firedW && G.firedW !== w && nowMs - G.firedAt < RAISE_MS) return false // WO-1106 B58: the server's raise gap
	G.lastFireAt = nowMs
	const n = G.nextShot()
	const p = [G.my.x, G.my.z]
	const yaw = G.my.yaw
	const seed = (Math.random() * 4294967296) >>> 0 // WO-1106 B59: sent along, so the others draw this very spread
	if (!G.net.sendEvent(fireMsg(w, n, p, yaw, G.s, seed))) return false
	G.firedW = w
	G.firedAt = nowMs
	G.ownShots.add(n)
	if (G.ownShots.size > OWN_SHOTS_KEEP) G.ownShots.delete(G.ownShots.values().next().value)
	if (ammo !== -1) G.spent++
	G.protUntil = 0 // spawn protection ends on the first shot
	const sNow = G.net.serverNow()
	const shot = { id: G.meId, w, n, p, yaw, ts: sNow, seed }
	if (W.kind === 'rocket') startRocket(G, shot, true)
	else {
		const targets = soldiersFor(G, G.meId, { claimable: true })
		const tr = traceShot(shot, G.grid, targets, G.s)
		drawHitscan(G, shot, tr)
		const blockers = new Set(targets.filter((v) => v.block).map((v) => v.id))
		for (const [id, k] of tr.hits) if (!blockers.has(id)) G.net.sendEvent(hitMsg(n, id, k))
	}
	G.audio.play(w)
	return true
}

function explode(G, r, x, z) {
	r.done = true
	r.exploded = true
	r.handle?.end()
	r.handle = null
	rememberBoom(G, r.owner, r.n)
	G.skfx.explosion(x, G.arena?.y ?? 0, z)
	G.audio.play('boom', near(G, x, z))
}

/** Fly every rocket to the current server time; the owner's client reports its impact. */
export function updateRockets(G, sNow, t) {
	for (let i = G.rockets.length - 1; i >= 0; i--) {
		const r = G.rockets[i]
		if (!r.exploded) {
			const end = stepRocket(r, (sNow - r.ts) / 1000, soldiersFor(G, r.owner), G.s)
			if (end) {
				explode(G, r, end.x, end.z)
				if (r.own) G.net.sendEvent(boomMsg(r.n, [end.x, end.z], G.s))
			} else {
				const [x, z] = rocketAt(r, (sNow - r.ts) / 1000, G.s)
				r.handle?.set(x, z, Math.atan2(-r.dx, -r.dz), t)
			}
		}
		if (r.exploded) G.rockets.splice(i, 1)
	}
}

/** The server's `boom`: draw it unless this rocket already blew up here. */
export function endRocketByBoom(G, m) {
	const r = G.rockets.find((q) => q.owner === m.by && q.n === m.n)
	if (r) {
		if (!r.exploded) explode(G, r, m.p[0], m.p[1])
		return
	}
	if (G.booms.has(`${m.by}:${m.n}`)) return
	rememberBoom(G, m.by, m.n)
	G.skfx.explosion(m.p[0], G.arena?.y ?? 0, m.p[1])
	G.audio.play('boom', near(G, m.p[0], m.p[1]))
}

/** Remember booms already drawn so a late server `boom` does not draw a second explosion. */
function rememberBoom(G, owner, n) {
	G.booms.add(`${owner}:${n}`)
	if (G.booms.size > 64) G.booms.delete(G.booms.values().next().value)
}

/** Walk over a pick-up → claim it (not when it would give nothing). */
export function checkPickups(G, sNow) {
	if (!G.my || !G.alive || !G.arenaView || G.phase === 'countdown' || G.phase === 'results') return
	const R = PICK_R * G.s
	for (const it of G.arenaView.pickups.values()) {
		if (!G.arenaView.available(it.id, sNow)) continue
		if (Math.hypot(it.x - G.my.x, it.z - G.my.z) > R) continue
		if (it.kind === 'health' && (G.me?.hp ?? 0) >= HP_MAX) continue
		if (it.kind === 'armour' && (G.me?.ar ?? 0) >= AR_MAX) continue
		const W = WEAPONS[it.kind]
		if (W && W.ammo.max > 0 && (G.me?.w?.[it.kind] ?? 0) >= W.ammo.max) continue
		G.net.sendEvent(pickMsg(it.id))
	}
}
