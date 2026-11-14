/**
 * Items + start + catch-up glue between the network, the own car and the views (WO-1074 v2) — no DOM, no three.js
 * (node-tested with fakes). Views are optional callbacks on G: G.hud.x (banner / pop), G.audio.sfx, G.fxView
 * (oneShot / word), G.director.notify.
 *
 *  - onItemMessage(G, m, sNow): server `box` / `item` / `haz` / `hazgone` / `fx`, and welcome / state boxes + hazards;
 *  - ownCarItems(G, input, sNow): per physics step — box pickups, Use, hazard hits (→ `hit`, spin-out);
 *  - launchTick(G, throttle, sNow, frozen): the start boost / stall (press timing against the server's startAt);
 *  - drainEvents(G): the own car's physics events → sounds, pop words, director.
 */
import { spinOut, launchResult, applyLaunch, catchupFor } from './drive-rules.js'
import { hitHazMsg, hitByMsg, decodeHaz } from './protocol.js'
import { applyOwnUse } from './items.js'

const pick = (m, key) => (Array.isArray(m?.state?.[key]) ? m.state[key] : Array.isArray(m?.[key]) ? m[key] : null)

/** Server messages that concern items. Returns true when handled. */
export function onItemMessage(G, m, sNow) {
	const it = G.items
	switch (m.t) {
		case 'welcome':
		case 'state': {
			const boxes = pick(m, 'boxes')
			const hazards = pick(m, 'hazards')
			if (boxes) it.setBoxes(boxes)
			if (hazards) it.setHazards(hazards)
			return false // the session handles the rest of these
		}
		case 'box':
			if (it.onBox(m, G.meId, sNow)) G.audio?.sfx?.('pickup')
			return true
		case 'item':
			it.onItem(m, sNow)
			return true
		case 'haz':
			it.addHaz(decodeHaz(m))
			return true
		case 'hazgone':
			it.removeHaz(m.hid)
			if (m.hit != null) G.director?.notify?.('hit', m.hit, G.animT ?? 0)
			return true
		case 'fx':
			G.fxView?.oneShot?.(m.k, m.p)
			if (m.k === 'pulse') {
				G.director?.notify?.('pulse', m.id, G.animT ?? 0)
				if (G.car && !G.spectator && it.pulseHits(m, G.car, G.meId, G.T?.scale ?? 1)) {
					const r = spinOut(G.car)
					if (r === 'spin') {
						G.net?.sendEvent(hitByMsg(m.id, 'pulse'))
						G.hud?.x?.pop('ZAP!') // the 3D burst at the sender already says POW!
						G.audio?.sfx?.('hit')
					} else if (r === 'shield') G.hud?.x?.pop('BLOCKED')
				}
			}
			return true
		default:
			return false
	}
}

/** Own car, once per physics step while it may drive. */
export function ownCarItems(G, input, sNow) {
	const car = G.car
	const it = G.items
	if (!car || !G.T || G.spectator) return
	const landed = it.tick(sNow)
	if (landed) G.audio?.sfx?.('item')
	const claim = it.pickup(G.T, car, sNow)
	if (claim && !G.net?.sendEvent(claim)) it.pending.delete(claim.id)
	if (input.use && it.held && !it.rolling && G.net?.status === 'joined') {
		const u = it.use(car, G.T.scale ?? 1)
		if (u && G.net.sendEvent(u.msg)) {
			applyOwnUse(car, u.item)
			G.audio?.sfx?.(u.item === 'turbo' ? 'boost' : 'item')
		} else if (u) it.held = u.item // rate-limited: keep it
	}
	const hid = it.hazardHit(G.T, car, G.meId, sNow)
	if (hid != null) {
		const h = it.hazards.get(hid)
		/* a hit is reported even when the shield absorbs it: the hazard is used up for everyone */
		G.net?.sendEvent(hitHazMsg(hid))
		const r = spinOut(car)
		if (r === 'spin') {
			G.hud?.x?.pop(h?.kind === 'slick' ? 'BLOOP!' : 'POW!')
			G.audio?.sfx?.('hit')
		} else if (r === 'shield') G.hud?.x?.pop('BLOCKED')
	}
}

/**
 * Start boost / stall: the moment the gas goes down during the countdown is remembered (released = forgotten); at
 * GO the press time decides (drive-rules launchResult). Returns 'boost' | 'stall' | 'none' once, at GO, else null.
 */
export function launchTick(G, throttle, sNow, frozen) {
	const L = (G.launch ||= { pressAt: null, done: false, armed: false })
	if (frozen) {
		L.armed = G.startAt != null
		L.done = false
		if (throttle >= 0.5) L.pressAt ??= sNow
		else L.pressAt = null
		return null
	}
	if (!L.armed || L.done || !G.car) return null
	L.done = true
	L.armed = false
	const res = launchResult(L.pressAt, G.startAt)
	applyLaunch(G.car, res)
	L.pressAt = null
	if (res === 'boost') {
		G.hud?.x?.banner('BOOST START!', 'good', 1200)
		G.audio?.sfx?.('boost')
	} else if (res === 'stall') G.hud?.x?.banner('STALLED!', 'bad', 1000)
	return res
}

/** Catch-up by race position (never for the leader; only while racing). */
export function updateCatchup(G, pos, total) {
	if (G.car) G.car.catchup = G.phase === 'race' ? catchupFor(pos, total) : 0
}

/** Drain the own car's physics events into sounds / pop words. */
export function drainEvents(G) {
	const car = G.car
	if (!car) return
	for (const e of car.ev) {
		if (e.k === 'mini') {
			G.audio?.sfx?.('mini')
			if (e.stage >= 2) G.hud?.x?.pop('ZOOM!', 600)
		} else if (e.k === 'pad') G.audio?.sfx?.('boost')
		else if (e.k === 'land') G.audio?.sfx?.('land')
		else if (e.k === 'wall') G.audio?.sfx?.('wall')
	}
	car.ev.length = 0
}
