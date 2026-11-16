/* global window, document, WebSocket, performance, setTimeout */
/**
 * Player + spectator session of Stage Skirmish (WO-1081): waits until the game is enabled, builds the world (the
 * kit's world with the cut-away room, sk-world.js), the live room (the kit's stage-fx), loads the scene (GLB in the
 * background with a loading bar), sets up the arena the server names (solid grid, blocks, fence, pick-ups), joins
 * over the WebSocket and follows the phases (lobby / warm-up → countdown → match → results). Messages: session.js;
 * per-frame work: loop.js; shooting: combat.js.
 */
import * as THREE from 'three'
import { $, apiGet, isPhone, isTouchDevice, storeGet, storeSet, sessGet, sessSet } from './dom.js'
import { createSkWorld } from './sk-world.js'
import { createStageFx } from './kit/stage-fx.js'
import { createWorldJoin } from './world-join.js'
import { createScreens } from './sk-screens.js'
import { fullscreenButton } from './kit/fullscreen.js'
import { sceneScale } from './kit/scale.js'
import { prepareOcc } from './kit/occ.js'
import { createHud, toolButton } from './hud.js'
import { createLobby } from './lobby.js'
import { createInput } from './input.js'
import { createAudio } from './sk-audio.js'
import { createFx } from './fx.js'
import { buildArenaGrid } from './grid.js'
import { createArenaView } from './arena-view.js'
import { placeSoldier, createStepper } from './move.js'
import { createShotCounter } from './shots.js'
import { SkNet, wsUrlFor } from './net.js'
import { phaseOf } from './protocol.js'
import { onMessage } from './session.js'
import { startLoop } from './loop.js'
import { tuneStageFx } from './stage-look.js'
import { installDevHook } from './dev-hook.js'
import { WEAPONS, MODES } from './sk-const.js'

const STATE_POLL_MS = 4000

export async function startGame({ spectator = false } = {}) {
	const phone = isPhone()
	const screens = createScreens($('#screen'), $('#loading'))
	const G = {
		spectator,
		phone,
		screens,
		state: null,
		phase: 'lobby',
		meId: null,
		me: { hp: 100, ar: 0, w: { pea: -1 }, surge: 0 },
		held: 'pea',
		spent: 0,
		my: null,
		myModel: null,
		alive: false,
		deadAt: null,
		protUntil: 0,
		remotes: new Map(),
		rockets: [],
		ownShots: new Set(),
		booms: new Set(),
		nextShot: createShotCounter(Math.floor(Math.random() * 1000) * 1000),
		stepper: createStepper(),
		audio: createAudio(),
		arena: null,
		grid: null,
		arenaView: null,
		arenas: new Map(),
		s: 1,
		camPose: null,
		boardOn: false,
	}
	G.ctl = {
		setArena: (id) => setArena(G, id),
		toSpawn: () => toSpawn(G),
		gameOff: () => gameOff(G),
		hold: (w, toast) => hold(G, w, toast),
		scoreInfo: () => ({
			mode: MODES.includes(G.state?.mode) ? G.state.mode : 'dm',
			phase: G.phase,
			players: G.state?.players || [],
			teams: G.state?.teams || [0, 0],
			meId: G.meId,
			limits: G.state?.limits,
		}),
		boardInfo: () => boardInfo(G),
	}

	const st = await waitEnabled(screens)
	G.state = st
	G.phase = phaseOf(st)

	const quality = storeGet('quality', phone ? 'low' : 'high') === 'low' ? 'low' : 'high'
	G.world = createSkWorld($('#view'), { phone, quality })
	G.skfx = createFx(G.world.scene, 1)
	G.fx = createStageFx({ THREE, scene: G.world.scene, quality, send: (m) => G.net?.send(m) ?? false,
		onHouse: (level) => G.world.setHouse(level) }) // WO-1099 house lights (players and spectators alike)
	tuneStageFx(G.fx)
	G.wj = createWorldJoin(G, { send: (m) => G.net?.send(m) ?? false }) // WO-1101 Game World (idle without the world module)
	document.addEventListener('visibilitychange', () => G.fx?.setEnabled(!document.hidden))
	window.addEventListener('pagehide', () => G.fx?.dispose())
	window.addEventListener('resize', () => G.world.resize())
	window.addEventListener('orientationchange', () => setTimeout(() => G.world.resize(), 250))

	const toolbar = []
	if (!spectator) {
		toolbar.push(toolButton('TAB', 'Scores (Tab)', (el) => el.classList.toggle('on', (G.boardOn = !G.boardOn))))
		toolbar.push(toolButton('SND', 'Sound on / off (M)', (el) => toggleMute(G, el)))
		toolbar.push(
			toolButton(quality === 'low' ? 'LQ' : 'HQ', 'Quality low / high', (el) => {
				const q = G.world.quality === 'low' ? 'high' : 'low'
				G.world.setQuality(q)
				G.fx?.setQuality(q)
				G.wj?.setQuality(q)
				storeSet('quality', q)
				el.textContent = q === 'low' ? 'LQ' : 'HQ'
			})
		)
	}
	const fsEl = fullscreenButton() // spectators too (a wall-sized browser window)
	if (fsEl) toolbar.push({ el: fsEl })
	G.hud = createHud($('#hud'), { spectator, toolbar })
	G.muteBtn = toolbar.find((b) => b.el.title.startsWith('Sound'))?.el || null
	document.body.classList.toggle('touch', isTouchDevice())

	if (!spectator) {
		G.input = createInput({
			canvas: $('#view'),
			moveZone: $('#tz-move'),
			aimZone: $('#tz-aim'),
			weaponBtn: $('#t-weapon'),
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

	if (!(await loadScene(G))) return

	G.net = new SkNet({
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
		screens.show('The game is not running', 'Ask the host to start Stage Skirmish. This page checks again every few seconds.')
		await new Promise((res) => setTimeout(res, STATE_POLL_MS))
	}
}

async function loadScene(G) {
	const r = await apiGet('/scene')
	if (!r.ok || !r.data) {
		if (r.status === 403) return gameOff(G)
		G.screens.show('Could not load the arena', `The box answered ${r.status || 'nothing'}. Retrying…`)
		await new Promise((res) => setTimeout(res, STATE_POLL_MS))
		return loadScene(G)
	}
	G.screens.hide()
	G.scene = r.data
	G.s = sceneScale(G.scene)
	G.occ = prepareOcc(G.scene.occ)
	G.skfx.dispose()
	G.skfx = createFx(G.world.scene, G.s)
	G.world.setNear(G.s)
	G.fx?.load(G.scene)
	G.world.clipScreens() // new pictures: those over the arena get the cut (setArena below may return early)
	G.arenas = new Map((G.scene.arenas || []).filter((a) => a?.id && Array.isArray(a.rect)).map((a) => [a.id, a]))
	setArena(G, G.state?.arenaId)
	G.screens.loading(0, 'Loading the room…')
	G.world
		.loadScene(G.scene, (loaded, total) => {
			const mb = (n) => (n / 1048576).toFixed(1)
			G.screens.loading(total ? loaded / total : 0.5, total ? `Loading the room ${mb(loaded)} / ${mb(total)} MB` : `Loading the room ${mb(loaded)} MB`)
		})
		.then((res) => {
			G.screens.loading(null)
			if (!res.ok) G.hud.toast('Room model unavailable — plain arena')
		})
	return true
}

export function setArena(G, id) {
	const a = G.arenas.get(id) || G.arenas.values().next().value
	if (!a || a === G.arena) return
	G.arena = { ...a, y: Number(a.y) || 0 }
	G.grid = buildArenaGrid(G.arena, G.occ, G.s)
	G.arenaView?.dispose()
	G.arenaView = createArenaView(G.arena, G.s)
	G.world.scene.add(G.arenaView.group)
	G.world.setCut(G.arena.y, G.s, G.arena.rect)
	G.hud.minimap.setArena(G.grid)
	G.camPose = null
	for (const r of G.rockets) r.handle?.end()
	G.rockets = []
	if (G.my) toSpawn(G)
}

/** Until the server's `spawn` arrives: the arena's spawn farthest from the other soldiers (or its first one). */
export function toSpawn(G) {
	if (!G.my || !G.arena) return
	const spawns = (G.arena.spawns || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z))
	if (!spawns.length) {
		const [x0, z0, x1, z1] = G.arena.rect
		placeSoldier(G.my, (x0 + x1) / 2, (z0 + z1) / 2, 0)
	} else {
		const others = [...G.remotes.values()].filter((r) => r.pose).map((r) => r.pose)
		let best = spawns[0]
		let bestD = -1
		for (const sp of spawns) {
			const d = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - sp.x, o.z - sp.z))) : 0
			if (d > bestD) {
				bestD = d
				best = sp
			}
		}
		placeSoldier(G.my, best.x, best.z, Number(best.yaw) || 0)
	}
	G.alive = true
	G.camPose = null
}

function hold(G, w, toast = '') {
	if (!WEAPONS[w] || w === G.held) return
	G.held = w
	G.lastFireAt = Math.min(G.lastFireAt || 0, performance.now() - 250) // a short raise time, not a full interval
	G.myModel?.setWeapon(w)
	if (toast) G.hud.toast(toast, 1000)
}

function boardInfo(G) {
	const st = G.state || {}
	const res = G.phase === 'results' ? G.results : null
	const roster = new Map((st.players || []).map((p) => [p.id, p]))
	// results rows carry no colour / bot flag (§7): take them from the roster
	const players = res?.order?.length ? res.order.map((p) => ({ ...roster.get(p.id), ...p })) : st.players || []
	const mode = res?.mode || (MODES.includes(st.mode) ? st.mode : 'dm')
	const teams = res?.teams || st.teams || [0, 0]
	let sub = ''
	if (res) {
		if (mode === 'tdm') sub = teams[0] === teams[1] ? 'A draw!' : `${teams[0] > teams[1] ? 'Red' : 'Blue'} team wins`
		else if (players[0]) sub = `${players[0].name} wins`
	}
	return {
		title: res ? 'Match over' : G.phase === 'lobby' ? 'Warm-up scores' : 'Scores',
		sub,
		note: res ? backIn(G) : '',
		mode,
		players,
		teams,
		meId: G.meId,
		final: !!res,
	}
}

/** §12: in `results` the state's endsAt is the end of the results screen. */
function backIn(G) {
	const left = G.state?.endsAt && G.net ? Math.ceil((G.state.endsAt - G.net.serverNow()) / 1000) : null
	return left > 0 ? `Back to the lobby in ${left} s.` : 'Back to the lobby in a moment.'
}

function toggleMute(G, el) {
	G.audio.setMuted(!G.audio.muted)
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
		G.screens.show('The skirmish is full', 'Ten soldiers are already in. You can watch, or try again later.', [
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
