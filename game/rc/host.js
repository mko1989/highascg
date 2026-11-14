/* global setInterval */
/**
 * Host panel (`?host=1`, WO-1074): enable / disable the game, pick the track (top-down previews), laps, start / stop,
 * kick, the join address shown very large, and the two §2.6 switches for what the guests see INSIDE the game world
 * (the live lights, the LED wall pictures). It only calls /api/game/rc/state, /scene and /host — the game never
 * puts anything on a screen; showing the spectator page somewhere is the operator's own, separate decision.
 */
import { h, setText, show, apiGet, apiHost, safeColor } from './dom.js'
import { previewTrack } from './trackdraw.js'
import { sceneScale } from './scale.js'

/**
 * HOOK: draw a join code for `url` into `el`. No QR library is installed (and the venue may be offline), so this just
 * prints the URL. Replace the body with a QR renderer later; keep the signature.
 */
export function renderJoinCode(url, el) {
	el.textContent = ''
	el.append(h('div.join-url', { text: url }))
}

export function startHost(root) {
	root.textContent = ''
	const stateEl = h('div.host-state')
	const msg = h('div.host-msg', { role: 'status' })
	const enableBtn = h('button.big', { type: 'button', text: 'Enable game' })
	const disableBtn = h('button.ghost', { type: 'button', text: 'Disable game' })
	const startBtn = h('button.big.go', { type: 'button', text: 'Start race' })
	const stopBtn = h('button.ghost', { type: 'button', text: 'Stop → lobby' })
	const lapsVal = h('span.laps-val')
	const lapsDown = h('button.ghost.sq', { type: 'button', text: '−', 'aria-label': 'Fewer laps' })
	const lapsUp = h('button.ghost.sq', { type: 'button', text: '+', 'aria-label': 'More laps' })
	const joinBox = h('div.join-box')
	const tracksEl = h('div.host-tracks')
	const playersEl = h('ul.host-players')
	/* §2.6: what the guests' game world shows — nothing here reaches a real output */
	const lightsBox = h('input', { type: 'checkbox' })
	const wallBox = h('input', { type: 'checkbox' })

	root.append(
		h('header.host-head', h('h1', { text: 'Stage Sprint RC — host' }), stateEl),
		msg,
		h(
			'section.host-sec',
			h('h2', { text: 'Join on your phone' }),
			joinBox,
			h('p.hint', { text: 'Same Wi-Fi as this box. Type the address into the phone’s browser.' })
		),
		h(
			'section.host-sec',
			h('div.host-actions', enableBtn, disableBtn, startBtn, stopBtn, h('span.laps', lapsDown, lapsVal, lapsUp))
		),
		h('section.host-sec', h('h2', { text: 'Track' }), tracksEl),
		h('section.host-sec', h('h2', { text: 'Players' }), playersEl),
		h(
			'section.host-sec',
			h('h2', { text: 'In the game world' }),
			h('label.host-switch', lightsBox, ' Live lights in the game'),
			h('label.host-switch', wallBox, ' LED wall pictures in the game'),
			h('p.hint', { text: 'What every guest sees inside their own game. Off = dark rig / blank walls in the game.' })
		),
		h(
			'section.host-sec',
			h('p.hint', {
				text:
					'Spectator page (leaderboard + race camera): /game/rc/?spectate=1 — an ordinary web page. The game never shows anything on a screen by itself.',
			})
		)
	)

	let state = null
	let sceneRev = null
	let scale = 1 // §3 the scene's toy scale (previews)
	let tracks = []
	let busy = false

	const say = (text, bad = false) => {
		setText(msg, text || '')
		msg.classList.toggle('bad', !!bad)
	}

	async function act(body, okText) {
		if (busy) return
		busy = true
		const r = await apiHost(body)
		busy = false
		if (r.ok) say(okText || '')
		else if (r.status === 401 || r.status === 403)
			say('Not allowed: log in to the HighAsCG web UI in this browser first (or open this page with ?token=…).', true)
		else say(`Failed (${r.status || 'no connection'})${r.data?.error ? ': ' + r.data.error : ''}`, true)
		await refresh()
	}

	enableBtn.addEventListener('click', () => act({ action: 'enable' }, 'Game enabled.'))
	disableBtn.addEventListener('click', () => act({ action: 'disable' }, 'Game disabled.'))
	startBtn.addEventListener('click', () => act({ action: 'start' }, 'Countdown started.'))
	stopBtn.addEventListener('click', () => act({ action: 'stop' }, 'Back to the lobby.'))
	const setLaps = (d) => {
		const laps = Math.max(1, Math.min(20, (state?.laps || 3) + d))
		act({ action: 'laps', laps })
	}
	lightsBox.addEventListener('change', () =>
		act({ action: 'lights', on: lightsBox.checked }, `Live lights in the game ${lightsBox.checked ? 'on' : 'off'}.`)
	)
	wallBox.addEventListener('change', () =>
		act({ action: 'wall', on: wallBox.checked }, `LED wall pictures in the game ${wallBox.checked ? 'on' : 'off'}.`)
	)
	lapsDown.addEventListener('click', () => setLaps(-1))
	lapsUp.addEventListener('click', () => setLaps(1))

	function paintTracks() {
		tracksEl.textContent = ''
		if (!state?.enabled) {
			tracksEl.append(h('p.hint', { text: 'Enable the game to see the tracks of the current scene.' }))
			return
		}
		if (!tracks.length) {
			tracksEl.append(h('p.hint', { text: 'Loading tracks…' }))
			return
		}
		for (const t of tracks) {
			const cv = h('canvas', { width: 200, height: 130 })
			const b = h(
				'button.track-card',
				{ type: 'button' },
				cv,
				h('span', { text: t.name || t.id }),
				h('small', { text: trackInfo(t) })
			)
			b.classList.toggle('on', t.id === state.trackId)
			b.addEventListener('click', () => pickTrack(t))
			tracksEl.append(b)
			previewTrack(cv, t, scale)
		}
	}

	/** §3: a track's `laps` hint (long tours: 1) becomes the lap count when it is picked; + / − still change it. */
	async function pickTrack(t) {
		await act({ action: 'track', trackId: t.id }, `Track: ${t.name || t.id}`)
		const want = lapsHint(t)
		if (want && state?.trackId === t.id && state.laps !== want)
			await act({ action: 'laps', laps: want }, `Track: ${t.name || t.id} · ${want} ${want === 1 ? 'lap' : 'laps'}`)
	}

	function paintPlayers() {
		playersEl.textContent = ''
		const ps = state?.players || []
		if (!ps.length) playersEl.append(h('li.hint', { text: 'Nobody has joined yet.' }))
		for (const p of ps) {
			const sw = h('span.swatch')
			sw.style.background = safeColor(p.color)
			const kick = h('button.ghost.small', { type: 'button', text: 'Kick' })
			kick.addEventListener('click', () => act({ action: 'kick', id: p.id }, `Kicked ${p.name}.`))
			const li = h(
				'li',
				sw,
				h('span.pname', { text: p.name }),
				h('span.pready', { text: p.connected === false ? 'offline' : p.ready ? 'ready' : 'not ready' }),
				kick
			)
			playersEl.append(li)
		}
	}

	let lastJoinKey = null
	let lastTracksKey = ''
	let lastPlayersKey = ''
	async function refresh() {
		const r = await apiGet('/state')
		if (!r.ok || !r.data) {
			setText(stateEl, r.status ? `State unavailable (${r.status})` : 'No connection to the box')
			return
		}
		state = r.data
		const on = !!state.enabled
		setText(
			stateEl,
			on ? `Running · ${state.phase} · ${(state.players || []).length}/${state.maxPlayers || 10} players` : 'Game is OFF'
		)
		stateEl.classList.toggle('on', on)
		show(enableBtn, !on)
		show(disableBtn, on)
		startBtn.disabled = !on || state.phase !== 'lobby' || !(state.players || []).length
		stopBtn.disabled = !on || state.phase === 'lobby'
		setText(lapsVal, `${state.laps || 3} laps`)
		lightsBox.checked = on && state.lights === true
		wallBox.checked = on && state.wall === true
		lightsBox.disabled = wallBox.disabled = !on
		const urls = on ? state.joinUrls || [] : []
		const joinKey = urls.join('|')
		if (joinKey !== lastJoinKey) {
			lastJoinKey = joinKey
			joinBox.textContent = ''
			if (!urls.length) joinBox.append(h('p.hint', { text: on ? 'No network address found.' : 'Enable the game first.' }))
			for (const u of urls) {
				const slot = h('div.join-slot')
				renderJoinCode(u, slot)
				joinBox.append(slot)
			}
		}
		if (on && (state.sceneRev !== sceneRev || !tracks.length)) {
			const s = await apiGet('/scene')
			if (s.ok && s.data) {
				sceneRev = s.data.rev ?? state.sceneRev
				scale = sceneScale(s.data)
				tracks = Array.isArray(s.data.tracks) ? s.data.tracks : []
			}
		}
		if (!on) {
			tracks = []
			sceneRev = null
		}
		const tKey = JSON.stringify([on, state.trackId, tracks.map((t) => t.id)])
		if (tKey !== lastTracksKey) {
			lastTracksKey = tKey
			paintTracks()
		}
		const pKey = JSON.stringify(state.players || [])
		if (pKey !== lastPlayersKey) {
			lastPlayersKey = pKey
			paintPlayers()
		}
	}

	refresh()
	setInterval(refresh, 2000)
}

/** The track's suggested lap count (1…20) or null. */
function lapsHint(t) {
	const n = Number(t?.laps)
	return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null
}

/** "86 m · 2 ramps · 1 drop" (v2), "24 m · stage" (v1); §3 toy tracks: "8.6 m · …", "+ 1 lap" for a laps hint. */
function trackInfo(t) {
	const len = Number(t.length) || 0
	const parts = [`${len > 0 && len < 10 ? len.toFixed(1) : Math.round(len)} m`]
	const n = (a) => (Array.isArray(a) ? a.length : 0)
	const plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`
	if (n(t.ramps)) parts.push(plural(n(t.ramps), 'ramp'))
	if (n(t.drops)) parts.push(plural(n(t.drops), 'drop'))
	if (n(t.pads)) parts.push(plural(n(t.pads), 'pad'))
	if (parts.length === 1 && t.floor) parts.push(String(t.floor))
	const laps = lapsHint(t)
	if (laps) parts.push(`${laps} ${laps === 1 ? 'lap' : 'laps'}`)
	return parts.join(' · ')
}
