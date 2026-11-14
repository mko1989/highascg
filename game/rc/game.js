/* global window, document, WebSocket, performance, setTimeout */
/**
 * Player + spectator session of the RC game (WO-1074): waits until the game is enabled, loads the scene (GLB in the
 * background with a loading bar), joins over the WebSocket and follows the server's phases
 * (lobby → countdown → race → results). Messages: session.js (+ item-play.js); per-frame work: loop.js.
 */
import * as THREE from 'three'
import { $, apiGet, isPhone, storeGet, storeSet, sessGet, sessSet } from './dom.js'
import { createWorld } from './world.js'
import { buildTrackMesh, disposeGroup } from './track-mesh.js'
import { createProps } from './props.js'
import { createFxView } from './fx-view.js'
import { createHud, toolButton } from './hud.js'
import { createLobby } from './lobby.js'
import { createInput } from './input.js'
import { createAudio } from './audio.js'
import { createScreens } from './screens.js'
import { prepareTrack, gridPose, respawnPose } from './track-math.js'
import { createEnv, createStepper, placeCar, ceilingOf, eyeBlockedOf } from './physics.js'
import { sceneScale } from './scale.js'
import { prepareOcc } from './occ.js'
import { RaceTracker } from './standings.js'
import { Director } from './cameras.js'
import { RcNet, wsUrlFor } from './net.js'
import { ItemState } from './items.js'
import { onMessage, mySlot } from './session.js'
import { startLoop } from './loop.js'
import { createStageFx } from './stage-fx.js'

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
		me: null,
		scene: null,
		tracks: new Map(),
		T: null,
		trackGroup: null,
		env: null,
		car: null,
		myModel: null,
		remotes: new Map(),
		race: new RaceTracker(null),
		bests: new Map(),
		startAt: null,
		results: null,
		resultsFinal: false,
		camMode: 'chase',
		director: new Director(),
		stepper: createStepper(),
		audio: createAudio(),
		joinInfo: null,
		items: new ItemState(),
		props: null,
		fxView: null,
		fx: null, // §2.6 stage-fx.js
		launch: null,
	}
	G.ctl = { setTrack: (id) => setTrack(G, id), toGrid: () => toGrid(G), gameOff: () => gameOff(G) }

	/* ---------- wait for the game to be enabled ---------- */
	const st = await waitEnabled(screens)
	G.state = st

	/* ---------- world ---------- */
	const quality = storeGet('quality', phone ? 'low' : 'high') === 'low' ? 'low' : 'high'
	G.world = createWorld($('#view'), { phone, quality })
	G.fxView = createFxView(G.world.scene)
	/* §2.6 live lights + wall pictures: before the scene loads (lxfull arrives as soon as the socket opens) */
	G.fx = createStageFx({ THREE, scene: G.world.scene, quality, send: (m) => G.net?._sendRaw(m) ?? false })
	document.addEventListener('visibilitychange', () => G.fx?.setEnabled(!document.hidden)) // hidden tab: no pictures
	window.addEventListener('pagehide', () => G.fx?.dispose())
	window.addEventListener('resize', () => G.world.resize())
	window.addEventListener('orientationchange', () => setTimeout(() => G.world.resize(), 250))

	const toolbar = []
	if (!spectator) {
		toolbar.push(
			toolButton('CAM', 'Camera: chase / top (C)', () => (G.camMode = G.camMode === 'chase' ? 'top' : 'chase'))
		)
		toolbar.push(toolButton('↺', 'Back to the last checkpoint (R)', () => respawn(G)))
		const tiltBtn = toolButton('📱', 'Tilt to steer', async (el) => {
			const ok = await G.input.setTilt(!G.input.tiltOn)
			el.classList.toggle('on', ok && G.input.tiltOn)
			if (!ok && !G.input.tiltOn) G.hud.toast('Tilt steering is not available on this device')
		})
		if (phone && typeof window.DeviceOrientationEvent !== 'undefined') toolbar.push(tiltBtn)
		toolbar.push(toolButton('SND', 'Sound on / off (M)', (el) => toggleMute(G, el)))
	}
	const qBtn = toolButton(quality === 'low' ? 'LQ' : 'HQ', 'Quality low / high', (el) => {
		const q = G.world.quality === 'low' ? 'high' : 'low'
		G.world.setQuality(q)
		G.fx?.setQuality(q)
		storeSet('quality', q)
		el.textContent = q === 'low' ? 'LQ' : 'HQ'
	})
	if (!spectator) toolbar.push(qBtn) // the spectator page (maybe on a wall) shows no buttons at all
	G.hud = createHud($('#hud'), { spectator, toolbar, itemButton: spectator ? null : $('#t-item') })
	G.muteBtn = toolbar.find((b) => b.el.title.startsWith('Sound'))?.el || null

	if (!spectator) {
		G.input = createInput({
			stickEl: $('#stick'),
			knobEl: $('#knob'),
			zones: { gas: $('#t-gas'), brake: $('#t-brake'), drift: $('#t-drift'), item: $('#t-item') },
			onRespawn: () => respawn(G),
			onCamera: () => (G.camMode = G.camMode === 'chase' ? 'top' : 'chase'),
			onMute: () => toggleMute(G, G.muteBtn),
		})
		G.lobby = createLobby($('#lobby'), {
			onJoin: (name, color) => join(G, name, color),
			onReady: (r) => G.net?.setReady(r),
			onRejoin: () => {
				G.net?.close()
				sessSet('joined', null)
				G.lobby.showJoin(G.T)
			},
		})
	}

	/* ---------- scene ---------- */
	if (!(await loadScene(G))) return

	/* ---------- network ---------- */
	G.net = new RcNet({
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
		const prev = sessGet('joined')
		if (prev) {
			try {
				const j = JSON.parse(prev)
				join(G, j.name, j.color)
			} catch {
				G.lobby.showJoin(G.T)
			}
		} else G.lobby.showJoin(G.T)
	}
	startLoop(G)
}

async function waitEnabled(screens) {
	for (;;) {
		const r = await apiGet('/state')
		if (r.ok && r.data && r.data.enabled) {
			screens.hide()
			return r.data
		}
		screens.show(
			'The game is not running',
			'Ask the host to start the RC game. This page checks again every few seconds.'
		)
		await new Promise((res) => setTimeout(res, STATE_POLL_MS))
	}
}

/** Fetch /scene, prepare its tracks and load the GLB in the background. */
async function loadScene(G) {
	const r = await apiGet('/scene')
	if (!r.ok || !r.data) {
		if (r.status === 403) return gameOff(G)
		G.screens.show('Could not load the stage', `The box answered ${r.status || 'nothing'}. Retrying…`)
		await new Promise((res) => setTimeout(res, STATE_POLL_MS))
		return loadScene(G)
	}
	G.screens.hide()
	G.scene = r.data
	G.fx?.load(G.scene)
	/* §3 toy scale: the scene's one `scale` (scale.js) goes into every prepared track; the occupancy grids decode once */
	G.s = sceneScale(G.scene)
	G.occ = prepareOcc(G.scene.occ)
	G.fxView?.setScale?.(G.s)
	G.tracks = new Map()
	for (const t of G.scene.tracks || []) if (t?.id && t.points?.length > 2) G.tracks.set(t.id, prepareTrack(t, G.s))
	if (!G.tracks.size) G.tracks.set('arena', prepareTrack(fallbackTrack(G.scene, G.s), G.s))
	setTrack(G, G.state?.trackId)
	G.screens.loading(0, 'Loading the stage…')
	G.world
		.loadScene(G.scene, (loaded, total) => {
			const mb = (n) => (n / 1048576).toFixed(1)
			G.screens.loading(
				total ? loaded / total : 0.5,
				total ? `Loading the stage ${mb(loaded)} / ${mb(total)} MB` : `Loading the stage ${mb(loaded)} MB`
			)
		})
		.then((res) => {
			G.screens.loading(null)
			if (!res.ok) G.hud.toast('Stage model unavailable — plain arena')
		})
	return true
}

/** A small flat oval on the first floor when the scene has no usable track (the server should always send some). */
function fallbackTrack(scene, s = 1) {
	const f = (scene?.floors || [])[0] || { id: 'hall', y: 0, rect: [-15, -10, 15, 10] }
	const cx = (f.rect[0] + f.rect[2]) / 2
	const cz = (f.rect[1] + f.rect[3]) / 2
	const a = Math.min(8 * s, (f.rect[2] - f.rect[0]) / 2 - 2 * s)
	const b = Math.min(5 * s, (f.rect[3] - f.rect[1]) / 2 - 2 * s)
	const points = []
	for (let i = 0; i < 80; i++) {
		const t = (-i / 80) * Math.PI * 2
		points.push([cx + a * Math.cos(t), Number(f.y) || 0, cz + b * Math.sin(t)])
	}
	return {
		id: 'arena',
		name: 'Arena',
		floor: f.id,
		width: 2.5 * s,
		closed: true,
		points,
		checkpoints: [0, 20, 40, 60],
		grid: [],
	}
}

export function setTrack(G, trackId) {
	const T = G.tracks.get(trackId) || G.tracks.values().next().value
	if (!T || T === G.T) return
	G.T = T
	if (G.trackGroup) {
		G.world.scene.remove(G.trackGroup)
		disposeGroup(G.trackGroup)
	}
	/* the ground model: every floor of the room + this track's ramps (physics + ramp skirts) */
	G.env = createEnv(T, G.scene?.floors || [], G.scene?.obstacles || [], { scale: T.scale, occ: G.occ })
	G.director.ceilAt = (x, z, y) => ceilingOf(G.env, x, z, y)
	G.director.blockedAt = (x, z, y) => eyeBlockedOf(G.env, x, z, y)
	G.trackGroup = buildTrackMesh(T, G.env.ground)
	G.world.scene.add(G.trackGroup)
	if (G.props) {
		G.world.scene.remove(G.props.group)
		G.props.dispose()
	}
	G.props = createProps(T)
	G.world.scene.add(G.props.group)
	G.race.setTrack(T)
	G.hud.setTrack(T)
	if (G.car) toGrid(G)
}

export function toGrid(G) {
	if (!G.car || !G.T) return
	placeCar(G.car, gridPose(G.T, mySlot(G)))
	G.race.move(G.meId, G.car.x, G.car.z, null, true, G.car.y)
}

export function respawn(G) {
	if (!G.car || !G.T || G.spectator) return
	if (G.phase === 'countdown') return
	const c = G.race.cars.get(G.meId)
	placeCar(G.car, respawnPose(G.T, c ? c.lap.cp : 0))
	G.race.move(G.meId, G.car.x, G.car.z, null, true, G.car.y)
}

function toggleMute(G, el) {
	G.audio.setMuted(!G.audio.muted)
	if (el) el.textContent = G.audio.muted ? 'SND' : 'SND ON'
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
		G.screens.show('The race is full', 'Ten drivers are already in. You can watch, or try again later.', [
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
		G.screens.show('Disconnected', 'The host removed you from the race.', [
			{
				label: 'Join again',
				onClick: () => {
					G.screens.hide()
					G.lobby?.showJoin(G.T)
				},
			},
		])
	} else if (s === 'closed') G.hud.setStatus('Reconnecting…')
	else if (s === 'joined') G.hud.setStatus('')
}
