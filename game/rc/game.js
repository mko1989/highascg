/* global window, WebSocket, performance, setTimeout */
/**
 * Player + spectator session of the RC game (WO-1074): waits until the game is enabled, loads the scene (GLB in the
 * background with a loading bar), joins over the WebSocket and follows the server's phases
 * (lobby → countdown → race → results). The per-frame work lives in loop.js.
 */
import { $, apiGet, isPhone, storeGet, storeSet, sessGet, sessSet, COLORS, safeColor } from './dom.js'
import { createWorld } from './world.js'
import { buildTrackMesh, disposeGroup } from './track-mesh.js'
import { createCarModel } from './car-model.js'
import { createHud, toolButton } from './hud.js'
import { createLobby } from './lobby.js'
import { createInput } from './input.js'
import { createAudio } from './audio.js'
import { createScreens } from './screens.js'
import { prepareTrack, gridPose, respawnPose } from './track-math.js'
import { createCar, createEnv, createStepper, placeCar } from './physics.js'
import { RaceTracker } from './standings.js'
import { SnapshotBuffer } from './interp.js'
import { Director } from './cameras.js'
import { RcNet, wsUrlFor } from './net.js'
import { startLoop } from './loop.js'

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
	}

	/* ---------- wait for the game to be enabled ---------- */
	const st = await waitEnabled(screens)
	G.state = st

	/* ---------- world ---------- */
	const quality = storeGet('quality', phone ? 'low' : 'high') === 'low' ? 'low' : 'high'
	G.world = createWorld($('#view'), { phone, quality })
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
		storeSet('quality', q)
		el.textContent = q === 'low' ? 'LQ' : 'HQ'
	})
	if (!spectator) toolbar.push(qBtn) // the spectator page (maybe on a wall) shows no buttons at all
	G.hud = createHud($('#hud'), { spectator, toolbar })
	G.muteBtn = toolbar.find((b) => b.el.title.startsWith('Sound'))?.el || null

	if (!spectator) {
		G.input = createInput({
			stickEl: $('#stick'),
			knobEl: $('#knob'),
			gasEl: $('#gas'),
			brakeEl: $('#brake'),
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
	G.tracks = new Map()
	for (const t of G.scene.tracks || []) if (t?.id && t.points?.length > 2) G.tracks.set(t.id, prepareTrack(t))
	if (!G.tracks.size) G.tracks.set('arena', prepareTrack(fallbackTrack(G.scene)))
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

/** A small oval when the scene has no usable track (the server should always send two). */
function fallbackTrack(scene) {
	const f = (scene?.floors || [])[0] || { id: 'hall', y: 0, rect: [-15, -10, 15, 10] }
	const cx = (f.rect[0] + f.rect[2]) / 2
	const cz = (f.rect[1] + f.rect[3]) / 2
	const a = Math.min(8, (f.rect[2] - f.rect[0]) / 2 - 2)
	const b = Math.min(5, (f.rect[3] - f.rect[1]) / 2 - 2)
	const points = []
	for (let i = 0; i < 80; i++) {
		const t = (-i / 80) * Math.PI * 2
		points.push([cx + a * Math.cos(t), cz + b * Math.sin(t)])
	}
	return {
		id: 'arena',
		name: 'Arena',
		floor: f.id,
		y: f.y,
		width: 2,
		closed: true,
		points,
		checkpoints: [0, 20, 40, 60],
		grid: [],
	}
}

function floorRect(G, T) {
	const f = (G.scene?.floors || []).find((x) => x.id === T.floor)
	if (f && Array.isArray(f.rect)) return f.rect
	const b = T.box
	return [b.minX - T.half - 3, b.minZ - T.half - 3, b.maxX + T.half + 3, b.maxZ + T.half + 3]
}

export function setTrack(G, trackId) {
	const T = G.tracks.get(trackId) || G.tracks.values().next().value
	if (!T || T === G.T) return
	G.T = T
	if (G.trackGroup) {
		G.world.scene.remove(G.trackGroup)
		disposeGroup(G.trackGroup)
	}
	G.trackGroup = buildTrackMesh(T)
	G.world.scene.add(G.trackGroup)
	G.env = createEnv(T, floorRect(G, T), G.scene?.obstacles || [])
	G.race.setTrack(T)
	G.hud.setTrack(T)
	if (G.car) toGrid(G)
}

function mySlot(G) {
	return Number.isFinite(G.me?.slot) ? G.me.slot : 0
}

export function toGrid(G) {
	if (!G.car || !G.T) return
	placeCar(G.car, gridPose(G.T, mySlot(G)), G.T.y)
	G.race.move(G.meId, G.car.x, G.car.z, null, true)
}

export function respawn(G) {
	if (!G.car || !G.T || G.spectator) return
	if (G.phase === 'countdown') return
	const c = G.race.cars.get(G.meId)
	placeCar(G.car, respawnPose(G.T, c ? c.lap.cp : 0), G.T.y)
	G.race.move(G.meId, G.car.x, G.car.z, null, true)
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

function ensureMyCar(G) {
	if (G.spectator || G.car || !G.T) return
	G.car = createCar(gridPose(G.T, mySlot(G)), G.T.y)
	G.myModel = createCarModel({ color: safeColor(G.me?.color, COLORS[0]) })
	G.world.scene.add(G.myModel.group)
	G.race.move(G.meId, G.car.x, G.car.z, null, true)
}

function syncRemotes(G, players) {
	const ids = new Set(players.map((p) => p.id))
	for (const [id, r] of G.remotes) {
		if (!ids.has(id) || id === G.meId) {
			G.world.scene.remove(r.model.group)
			r.model.dispose()
			G.remotes.delete(id)
			G.race.remove(id)
		}
	}
	for (const p of players) {
		if (p.id === G.meId) continue
		const r = G.remotes.get(p.id)
		if (r && (r.name !== p.name || r.color !== p.color)) {
			G.world.scene.remove(r.model.group)
			r.model.dispose()
			G.remotes.delete(p.id)
		}
		if (!G.remotes.has(p.id)) {
			const model = createCarModel({
				color: safeColor(p.color),
				name: p.name,
				tag: true,
				tagScale: G.spectator ? 0.07 : 0.05,
			})
			model.group.visible = false
			G.world.scene.add(model.group)
			G.remotes.set(p.id, {
				id: p.id,
				name: p.name,
				color: p.color,
				buf: new SnapshotBuffer(),
				model,
				pose: null,
				seen: false,
			})
		}
	}
}

function applyState(G, state) {
	if (!state) return
	if (state.enabled === false) {
		gameOff(G)
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
	setTrack(G, state.trackId)
	syncRemotes(G, state.players || [])
	/* joined during a countdown / race (missed the `countdown` message): the server's state carries startAt */
	if (G.startAt == null && Number.isFinite(state.startAt) && (G.phase === 'countdown' || G.phase === 'race')) {
		G.startAt = state.startAt
		G.race.reset(state.startAt)
	}
	const meP = (state.players || []).find((p) => p.id === G.meId)
	if (meP && G.me) G.me = { ...G.me, name: meP.name, color: meP.color }
	ensureMyCar(G)
	if (G.phase === 'lobby') {
		if (prevPhase !== 'lobby') {
			G.results = null
			G.hud.results(null)
			G.startAt = null
			G.lobby?.resetReady()
			toGrid(G)
		}
		G.lobby?.showLobby(state, G.meId, G.T, { reveal: prevPhase !== 'lobby' })
	} else {
		G.lobby?.hide()
		if (G.phase === 'countdown' && prevPhase !== 'countdown') toGrid(G)
	}
	if (G.phase !== 'results' && G.results) {
		G.results = null
		G.hud.results(null)
	}
}

function onMessage(G, m) {
	switch (m.t) {
		case 'welcome':
			if (G.meId != null && G.meId !== m.id) G.race.remove(G.meId) // rejoined under a new id
			G.meId = m.id
			G.me = m.you || { id: m.id }
			if (G.myModel && G.me.color) {
				G.world.scene.remove(G.myModel.group)
				G.myModel.dispose()
				G.myModel = createCarModel({ color: safeColor(G.me.color) })
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
			toGrid(G)
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
			if (m.id === G.meId && m.ms != null)
				G.hud.toast(`Lap ${m.lap}: ${(m.ms / 1000).toFixed(2)} s${m.best === m.ms ? ' · best!' : ''}`)
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
