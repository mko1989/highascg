/**
 * Server messages → game state of the Stage Salad client (WO-1089 §8 / §9): welcome / state (phases, roster, targets,
 * settings, the venue revision), `w` (avatars + the others' bands), shots and their ends (the shots.js book), dodges,
 * umbrellas, the own `me` (reload, streak, score), count-down and results. The kit's stage-fx sees every message first
 * (live lights). onEvents() turns finished projectiles into effects: bursts, avatar reactions, sounds, banners.
 */
import { sessSet } from './dom.js'
import { phaseOf } from './protocol.js'

const PART_WORD = { head: 'HEAD SPLAT!', body: 'SPLAT!', legs: 'Splat!' }
const BONK_WORD = { head: 'BONK!', body: 'Bonk!', legs: 'Bonk!' }

function player(G, id) {
	return (G.state?.players || []).find((p) => p.id === id) || null
}

export function mySlot(G) {
	const p = player(G, G.meId)
	const i = p?.slot ?? G.you?.slot
	return i != null && G.venue?.slots?.[i] ? G.venue.slots[i] : null
}

function applyState(G, state) {
	if (!state || typeof state !== 'object') return
	if (state.enabled === false) return void G.ctl.gameOff()
	const prev = G.phase
	const prevSafe = !!G.state?.safe
	const prevVenue = G.state?.venueRev
	const prevScene = G.state?.sceneRev
	G.state = state
	G.phase = phaseOf(state)
	if (Number.isFinite(state.startAt)) G.startAt = state.startAt
	if (G.scene && ((prevScene != null && state.sceneRev !== prevScene) || (prevVenue != null && state.venueRev !== prevVenue)))
		G.ctl.reloadScene(state.sceneRev !== prevScene)
	G.avatars?.sync(state, G.venue)
	G.slings?.sync(state, G.venue, G.meId)
	if (G.phase !== prev) onPhase(G, prev)
	if (!!state.safe !== prevSafe) {
		if (state.safe) {
			G.input?.cancel()
			G.hud.banner('Paused — presenter safe', 'info', 2200)
		} else if (prev != null) G.hud.toast('Back on — fire away', 1500)
	}
	if (!G.spectator && G.meId != null) {
		if (G.phase === 'lobby') G.lobby.showLobby(state, G.meId)
		else G.lobby.hide()
	}
}

function onPhase(G, prev) {
	if (G.phase === 'countdown') {
		G.results = null
		G.book.clear()
		G.input?.cancel()
		G.hud.banner('Get ready…', 'info', 1200)
		G.audio.play('tick')
	}
	if (G.phase === 'round' && prev === 'countdown') {
		G.hud.banner('Splat away!', 'splat', 1300)
		G.audio.play('start')
	}
	if (G.phase === 'results') {
		G.book.clear()
		G.input?.cancel()
		G.audio.play('end')
	}
	if (G.phase === 'lobby' && prev && prev !== 'lobby') G.book.clear()
	if (G.phase !== 'results') G.results = null
}

export function onMessage(G, m) {
	if (G.fx?.onMessage(m)) return
	if (G.wj?.onMessage(m)) return // WO-1101 Game World: wst / wv / xb / xbonus
	const sNow = G.net ? G.net.serverNow() : 0
	switch (m.t) {
		case 'welcome': {
			const again = m.resumed === true && G.meId === m.id // WO-1106 B34: this page's own player back (a reconnect)
			G.meId = m.id
			G.you = m.you || {}
			G.book.meId = m.id
			if (!again) G.book.clear() // a resume keeps the flights in the air (their `end` reaches this socket too)
			if (m.you?.color) G.joinInfo = { ...(G.joinInfo || {}), color: m.you.color, name: m.you.name ?? G.joinInfo?.name }
			if (!again) {
				G.state = null
				G.phase = null
			}
			applyState(G, m.state)
			if (!G.spectator && G.joinInfo) sessSet('joined', JSON.stringify(G.joinInfo))
			break
		}
		case 'state':
			applyState(G, m.state)
			break
		case 'w':
			G.avatars?.onW(m)
			G.slings?.onAims(m.sl)
			break
		case 'shot':
			G.book.onShot(m, sNow)
			if (m.id !== G.meId) {
				G.slings?.released(m.id)
				G.audio.play('twang', 0.25)
			}
			break
		case 'end':
			G.book.onEnd(m)
			break
		case 'dodge':
			G.avatars?.onDodge(m)
			if (G.book.live.some((p) => p.own && p.state === 'fly')) G.later.push({ at: m.from, fn: () => G.hud.banner('Dodged!', 'miss', 1200) })
			break
		case 'umbrella':
			G.avatars?.onUmbrella(m)
			break
		case 'me': {
			const left = m.ready - sNow
			if (left > 50) G.reloadMs = left
			G.me = m
			break
		}
		case 'countdown':
			G.startAt = m.startAt
			break
		case 'results':
			G.results = m
			break
		default:
			break
	}
}

/** Finished projectiles (shots.js events) → effects. `eye` = the camera position (for loudness). */
export function onEvents(G, events, sNow, eye) {
	for (const ev of events) {
		const veg = ev.veg
		const color = veg?.color || '#b9d36a'
		const far = eye ? Math.hypot(ev.p[0] - eye[0], ev.p[1] - eye[1], ev.p[2] - eye[2]) : 10
		const vol = ev.own ? 1 : Math.max(0.15, Math.min(0.7, 6 / Math.max(1, far)))
		const splat = !!veg?.splat
		G.avatars?.onEnd(ev, sNow)
		if (ev.k === 'hit') {
			G.proj.burst(ev.p, color, sNow, splat ? 14 : 6, splat ? 2.6 : 1.6, splat ? 0.022 : 0.016)
			G.audio.play(splat ? 'splat' : 'bonk', vol)
			if (ev.part === 'head') G.audio.play('sparkle', vol)
			if (ev.own) {
				const word = (splat ? PART_WORD : BONK_WORD)[ev.part] || 'SPLAT!'
				const bank = ev.bank ? 'Bank shot! ' : ''
				G.hud.banner(ev.pts != null ? `${bank}${word} +${ev.pts}` : `${bank}${word}`, 'splat', 1500)
			}
		} else if (ev.k === 'land') {
			if (splat) G.proj.burst(ev.p, color, sNow, ev.tag === 'umbrella' ? 8 : 6, 1.4, 0.016)
			if (ev.tag === 'umbrella') {
				G.audio.play('boing', vol)
				if (ev.own) G.hud.banner('Umbrella!', 'miss', 1200)
			} else G.audio.play(splat ? 'splat' : veg?.id === 'onion' ? 'boing' : 'bonk', vol * 0.6)
		}
		if (ev.own && ev.i === 0) G.ownEnded = sNow
	}
}
