/* global window, document, WebSocket, performance, setTimeout */
/**
 * Player + spectator session of Stage Salad (WO-1089): waits until the host enabled the game, builds the world (the
 * kit's world.js), the live room (the kit's stage-fx: live lights, LED wall pictures), loads the scene JSON (with the
 * `salad` venue) and the GLB in the background with a loading bar, joins over the WebSocket and follows the phases
 * (lobby practice → countdown → round → results). Messages: session.js; per-frame work: loop.js; firing: fire() here.
 */
import * as THREE from 'three'
import { $, apiGet, isPhone, isTouchDevice, storeGet, storeSet, sessGet, sessSet } from './dom.js'
import { createWorld } from './kit/world.js'
import { createStageFx } from './kit/stage-fx.js'
import { fullscreenButton } from './kit/fullscreen.js'
import { createScreens } from './screens.js'
import { createHud, toolButton } from './hud.js'
import { createLobby } from './lobby.js'
import { createInput } from './input.js'
import { createAudio } from './audio.js'
import { createAvatars } from './avatars.js'
import { createSlings } from './slings.js'
import { createProjectileView } from './projectiles.js'
import { createAimView } from './aim-view.js'
import { ShotBook } from './shots.js'
import { SaladNet, wsUrlFor } from './net.js'
import { canFire, fireMsg } from './protocol.js'
import { onMessage, mySlot } from './session.js'
import { startLoop } from './loop.js'
import { installDevHook } from './dev-hook.js'
import { buildVenue, pouch } from './venue.js'
import { VEGGIES, VEG_IDS } from './veggies.js'

const STATE_POLL_MS = 4000
const SLACK_MS = 60 // the server's reload slack

export async function startGame({ spectator = false } = {}) {
	const phone = isPhone()
	const screens = createScreens($('#screen'), $('#loading'))
	const G = {
		spectator,
		phone,
		screens,
		state: null,
		phase: null,
		meId: null,
		you: null,
		me: null,
		venue: null,
		scene: null,
		startAt: null,
		results: null,
		reloadMs: 1000,
		localReady: 0,
		later: [],
		joinInfo: null,
		ownEnded: 0,
		sel: Math.max(0, VEG_IDS.indexOf(storeGet('veg', 'tomato'))),
		shots: 0,
		follow: null,
		boardOn: false,
		audio: createAudio(),
		book: new ShotBook(),
	}
	G.ctl = {
		gameOff: () => gameOff(G),
		reloadScene: (withGlb) => loadScene(G, withGlb),
		fire: (aim) => fire(G, aim),
		join: (name, color) => join(G, name, color),
		pick: (i) => pick(G, i),
		readyAt: () => readyAt(G),
		canPull: () => canPull(G),
		boardInfo: () => boardInfo(G),
	}

	const st = await waitEnabled(screens)
	G.state = st

	const quality = storeGet('quality', phone ? 'low' : 'high') === 'low' ? 'low' : 'high'
	G.world = createWorld($('#view'), { phone, quality })
	G.world.setFov(spectator ? 50 : 55)
	const scene = G.world.scene
	G.fx = createStageFx({ THREE, scene, quality, send: (m) => G.net?.send(m) ?? false,
		onHouse: (on) => G.world.setHouse(on) }) // WO-1099 house lights (players and spectators alike)
	G.avatars = createAvatars(THREE, scene, { quality })
	G.slings = createSlings(THREE, scene)
	G.proj = createProjectileView(THREE, scene)
	G.aimView = createAimView(THREE, scene)
	document.addEventListener('visibilitychange', () => G.fx?.setEnabled(!document.hidden))
	window.addEventListener('pagehide', () => G.fx?.dispose())
	window.addEventListener('resize', () => G.world.resize())
	window.addEventListener('orientationchange', () => setTimeout(() => G.world.resize(), 250))

	const toolbar = []
	if (!spectator) toolbar.push(toolButton('TAB', 'Scores (Tab)', (el) => el.classList.toggle('on', (G.boardOn = !G.boardOn))))
	toolbar.push(toolButton('SND', 'Sound on / off (M)', (el) => toggleMute(G, el)))
	toolbar.push(
		toolButton(quality === 'low' ? 'LQ' : 'HQ', 'Quality low / high', (el) => {
			const q = G.world.quality === 'low' ? 'high' : 'low'
			G.world.setQuality(q)
			G.fx?.setQuality(q)
			G.avatars.setQuality(q)
			storeSet('quality', q)
			el.textContent = q === 'low' ? 'LQ' : 'HQ'
		})
	)
	const fsEl = fullscreenButton() // spectators too (a wall-sized browser window)
	if (fsEl) toolbar.push({ el: fsEl })
	G.hud = createHud($('#hud'), {
		spectator,
		toolbar,
		onPick: (i) => pick(G, i),
		onPitch: (off) => G.input?.aim.setPitchOff(off),
	})
	G.muteBtn = toolbar.find((b) => b.el.title.startsWith('Sound'))?.el || null
	toggleMute(G, G.muteBtn, true)
	document.body.classList.toggle('touch', isTouchDevice())

	if (!spectator) {
		G.input = createInput({
			canvas: $('#view'),
			canPull: () => canPull(G),
			onKey: (code) => {
				if (code === 'KeyM') toggleMute(G, G.muteBtn)
			},
		})
		G.lobby = createLobby($('#lobby'), {
			onJoin: (name, color) => join(G, name, color),
			onRejoin: () => {
				G.net?.close()
				sessSet('joined', null)
				G.lobby.showJoin()
			},
			onWatch: () => (window.location.search = '?spectate=1'),
		})
	}

	if (!(await loadScene(G, true))) return

	G.net = new SaladNet({
		url: wsUrlFor(window.location),
		WebSocket,
		now: () => performance.now(),
		setTimeout: (f, ms) => window.setTimeout(f, ms),
		clearTimeout: (id) => window.clearTimeout(id),
		setInterval: (f, ms) => window.setInterval(f, ms),
		clearInterval: (id) => window.clearInterval(id),
		onMessage: (m) => onMessage(G, m),
		onStatus: (s) => onStatus(G, s),
		onBinary: (d) => G.fx?.onBinary(d),
	})
	if (spectator) G.net.connect('Spectator', '#ffffff', true)
	else {
		const j = parseJoined(sessGet('joined'))
		if (j?.name) join(G, j.name, j.color)
		else G.lobby.showJoin()
	}
	installDevHook(G)
	startLoop(G)
	return G
}

function parseJoined(text) {
	try {
		return text ? JSON.parse(text) : null
	} catch {
		return null
	}
}

async function waitEnabled(screens) {
	for (;;) {
		const r = await apiGet('/state')
		if (r.ok && r.data && r.data.enabled) {
			screens.hide()
			return r.data
		}
		screens.show('The game is not running', 'Ask the host to start Stage Salad. This page checks again every few seconds.')
		await new Promise((res) => setTimeout(res, STATE_POLL_MS))
	}
}

/** The scene JSON (venue + live lights / screens) and, on the first load or a new bake, the room GLB. */
async function loadScene(G, withGlb) {
	const r = await apiGet('/scene')
	if (!r.ok || !r.data) {
		if (r.status === 403) return gameOff(G)
		G.screens.show('Could not load the room', `The box answered ${r.status || 'nothing'}. Retrying…`)
		await new Promise((res) => setTimeout(res, STATE_POLL_MS))
		return loadScene(G, withGlb)
	}
	G.screens.hide()
	const sc = r.data
	G.scene = sc
	G.venue = sc.salad && sc.salad.front && Array.isArray(sc.salad.slots) ? sc.salad : buildVenue(sc, { screens: sc.screens, lights: sc.lights })
	G.book.setVenue(G.venue)
	G.fx?.load(sc)
	G.slings.sync(G.state, G.venue, G.meId)
	G.avatars.sync(G.state, G.venue)
	G.camPose = null
	if (!withGlb) return true
	G.screens.loading(0, 'Loading the room…')
	G.world
		.loadScene(sc, (loaded, total) => {
			const mb = (n) => (n / 1048576).toFixed(1)
			G.screens.loading(total ? loaded / total : 0.5, total ? `Loading the room ${mb(loaded)} / ${mb(total)} MB` : `Loading the room ${mb(loaded)} MB`)
		})
		.then((res) => {
			G.screens.loading(null)
			if (!res.ok) G.hud.toast('Room model unavailable — plain floor')
		})
	return true
}

/** Server ms when the own slingshot is loaded again (the server's `me.ready`, or our own estimate after a fire). */
function readyAt(G) {
	return Math.max(Number(G.me?.ready) || 0, G.localReady || 0)
}

function canPull(G) {
	return !G.spectator && G.meId != null && !!mySlot(G) && canFire(G.state) && !G.lobby?.panelOpen
}

function pick(G, i) {
	const n = VEG_IDS.length
	const k = ((Math.round(i) % n) + n) % n
	if (k === G.sel) return
	G.sel = k
	storeSet('veg', VEG_IDS[k])
	G.audio.play('tick', 0.4)
}

/** The next shot counter: increasing for the life of this tab (the server drops n ≤ the last one). */
function nextShotN() {
	let n = Number(sessGet('shotN'))
	if (!Number.isInteger(n) || n < 0 || n > 2 ** 31 - 2000) n = Math.floor(Math.random() * 1e6) * 100
	n += 1
	sessSet('shotN', String(n))
	return n
}

/**
 * Let go of the band: { yaw, pitch, power } (world radians, power 0.15…1). The flight is drawn at once (shots.js
 * reconciles it with the server's echo); a refused shot fades after ORPHAN_MS. → true when sent.
 */
function fire(G, aim) {
	if (G.spectator || G.meId == null || !G.net) return false
	const slot = mySlot(G)
	if (!slot || !canFire(G.state)) {
		G.audio.play('nope', 0.5)
		return false
	}
	const sNow = G.net.serverNow()
	if (sNow < readyAt(G) - SLACK_MS) {
		G.audio.play('nope', 0.5)
		G.hud.toast('Reloading…', 700)
		return false
	}
	const veg = VEGGIES[VEG_IDS[G.sel]]
	const n = nextShotN()
	if (!G.net.sendFire(fireMsg(n, veg.id, aim.yaw, aim.pitch, aim.power))) return false
	G.book.addOwn({ n, veg, o: pouch(slot), yaw: aim.yaw, pitch: aim.pitch, power: aim.power, sNow })
	G.reloadMs = veg.reload * 1000
	G.localReady = sNow + G.reloadMs
	G.shots++
	G.follow = { n, until: performance.now() + 1600 }
	G.audio.play('twang', 0.9)
	G.audio.resetCreak()
	return true
}

function boardInfo(G) {
	const st = G.state || {}
	const res = G.phase === 'results' ? G.results : null
	const roster = new Map((st.players || []).map((p) => [p.id, p]))
	const players = res?.order?.length ? res.order.map((p) => ({ ...roster.get(p.id), ...p })) : st.players || []
	const teamMode = !!(res ? res.teams : st.teams)
	const teams = res?.teams || st.teamScores || [0, 0]
	let sub = ''
	if (res) {
		const w = res.winner
		if (teamMode) sub = teams[0] === teams[1] ? 'A draw!' : `${teams[0] > teams[1] ? 'Left side' : 'Right side'} wins`
		else if (w?.id != null) sub = `${String(players.find((p) => p.id === w.id)?.name ?? '')} wins`
		else if (players[0]) sub = `${String(players[0].name ?? '')} wins`
	}
	return {
		title: res ? 'Round over' : G.phase === 'lobby' ? 'Practice — nothing counts yet' : 'Scores',
		sub,
		note: res ? backIn(G) : '',
		players,
		teams,
		teamMode,
		meId: G.meId,
		final: !!res,
	}
}

/** In `results` the state's endsAt is the end of the results screen. */
function backIn(G) {
	const left = G.state?.endsAt && G.net ? Math.ceil((G.state.endsAt - G.net.serverNow()) / 1000) : null
	return left > 0 ? `Back to the lobby in ${left} s.` : 'Back to the lobby in a moment.'
}

function toggleMute(G, el, keep = false) {
	if (!keep) {
		G.audio.setMuted(!G.audio.muted)
		storeSet('muted', G.audio.muted ? '1' : '0')
	} else G.audio.setMuted(storeGet('muted', '0') === '1')
	if (el) {
		el.textContent = G.audio.muted ? 'SND' : 'SND ON'
		el.classList.toggle('on', !G.audio.muted)
	}
}

function join(G, name, color) {
	G.joinInfo = { name, color }
	sessSet('joined', JSON.stringify(G.joinInfo))
	G.net.connect(name, color, false)
}

function gameOff(G) {
	if (G.off) return false
	G.off = true
	G.net?.close()
	G.input?.cancel()
	G.screens.show('The game is not running', 'The host switched the game off. This page reloads when it is back.')
	const poll = async () => {
		const r = await apiGet('/state')
		if (r.ok && r.data?.enabled) window.location.reload()
		else setTimeout(poll, STATE_POLL_MS)
	}
	setTimeout(poll, STATE_POLL_MS)
	return false
}

function onStatus(G, s) {
	G.hud.setConn(s, G.net?.clock.rtt)
	if (s === 'off') gameOff(G)
	else if (s === 'full') {
		sessSet('joined', null)
		G.screens.show('Every slingshot is taken', 'Twenty players are already in. You can watch, or try again later.', [
			{ label: 'Watch', onClick: () => (window.location.search = '?spectate=1') },
			{
				label: 'Try again',
				onClick: () => {
					G.screens.hide()
					if (G.joinInfo) join(G, G.joinInfo.name, G.joinInfo.color)
				},
			},
		])
	} else if (s === 'kicked') {
		sessSet('joined', null)
		G.meId = null
		G.screens.show('Disconnected', 'The host removed you from the game.', [
			{
				label: 'Join again',
				onClick: () => {
					G.screens.hide()
					G.lobby?.showJoin()
				},
			},
		])
	} else if (s === 'closed') G.hud.setStatus('Reconnecting…')
	else if (s === 'joined') G.hud.setStatus('')
	if (s === 'joined') document.body.classList.add('joined')
	else if (s === 'full' || s === 'kicked' || s === 'off' || s === 'idle') document.body.classList.remove('joined')
}
