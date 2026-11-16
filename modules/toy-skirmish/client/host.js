/* global setInterval */
/**
 * Host panel of Stage Skirmish (`?host=1`, WO-1081 §2/§9): enable / disable, the join address as a QR code (the kit's
 * join-code.js + its vendored generator) and in large type, the arena (top-down previews of the solid grid), mode
 * (free for all / teams / spotlight), frag (points) and time limits, bots and their skill (WO-1083), start / stop, the
 * two switches for what the guests see INSIDE the game world (live lights, LED wall pictures), and the roster with
 * kick and team moves. It only calls /api/game/sk/state, /scene and /host — the game never puts anything on a screen,
 * and this panel offers no way to.
 */
import { createHouseSlider } from './kit/house-slider.js'
import { h, setText, show, apiGet, apiHost, safeColor } from './dom.js'
import { qrMatrix, drawQr } from './kit/join-code.js'
import { prepareOcc } from './kit/occ.js'
import { sceneScale } from './kit/scale.js'
import { buildArenaGrid } from './grid.js'
import { createMinimap } from './minimap.js'
import { TEAM_COLORS, TEAM_NAMES, BOT_LEVELS } from './sk-const.js'

export function renderJoinCode(url, el) {
	el.textContent = ''
	try {
		const cv = h('canvas.join-qr', { role: 'img', 'aria-label': `QR code for ${url}` })
		drawQr(cv, qrMatrix(url))
		el.append(cv)
	} catch {
		/* an address too long for a QR code: the printed address still works */
	}
	el.append(h('div.join-url', { text: url }))
}

const stepper = (label, onMinus, onPlus) => {
	const val = h('span.laps-val')
	const minus = h('button.ghost.sq', { type: 'button', text: '−', 'aria-label': `Less ${label}` })
	const plus = h('button.ghost.sq', { type: 'button', text: '+', 'aria-label': `More ${label}` })
	minus.addEventListener('click', onMinus)
	plus.addEventListener('click', onPlus)
	return { el: h('span.laps', minus, val, plus), val }
}

export function startHost(root) {
	root.textContent = ''
	const stateEl = h('div.host-state')
	const msg = h('div.host-msg', { role: 'status' })
	const enableBtn = h('button.big', { type: 'button', text: 'Enable game' })
	const disableBtn = h('button.ghost', { type: 'button', text: 'Disable game' })
	const startBtn = h('button.big.go', { type: 'button', text: 'Start match' })
	const stopBtn = h('button.ghost', { type: 'button', text: 'Stop → lobby' })
	const dmBtn = h('button.ghost.mode', { type: 'button', text: 'Free for all' })
	const tdmBtn = h('button.ghost.mode', { type: 'button', text: 'Teams' })
	const spotBtn = h('button.ghost.mode', { type: 'button', text: 'Spotlight' })
	const levelBtns = BOT_LEVELS.map((l) => {
		const b = h('button.ghost.mode', { type: 'button', text: l[0].toUpperCase() + l.slice(1) })
		b.dataset.level = l
		return b
	})
	const fragsLbl = h('span.host-lbl', { text: 'Frag limit' })
	const joinBox = h('div.join-box')
	const arenasEl = h('div.host-tracks')
	const playersEl = h('ul.host-players')
	const houseSlider = createHouseSlider({ h, post: apiHost, say: (t) => say(t) }) // WO-1099 house lights level
	const lightsBox = h('input', { type: 'checkbox' })
	const wallBox = h('input', { type: 'checkbox' })
	let state = null
	const lim = () => state?.limits || { frags: 20, minutes: 5 }
	const frags = stepper('frags', () => setLimits(-5, 0), () => setLimits(5, 0))
	const minutes = stepper('minutes', () => setLimits(0, -1), () => setLimits(0, 1))
	const bots = stepper('bots', () => setBots(-1), () => setBots(1))

	root.append(
		h('header.host-head', h('h1', { text: 'Stage Skirmish — host' }), stateEl),
		msg,
		h(
			'section.host-sec',
			h('h2', { text: 'Join on your phone' }),
			joinBox,
			h('p.hint', { text: 'Same Wi-Fi as this box. Scan the code with the phone’s camera, or type the address into its browser.' })
		),
		h('section.host-sec', h('div.host-actions', enableBtn, disableBtn, startBtn, stopBtn)),
		h(
			'section.host-sec',
			h('h2', { text: 'Match' }),
			h('div.host-actions', dmBtn, tdmBtn, spotBtn),
			h('p.hint', { text: 'Spotlight: a pool of light moves around the arena; standing in it alone scores a point a second.' }),
			h('div.host-actions', fragsLbl, frags.el, h('span.host-lbl', { text: 'Time' }), minutes.el),
			h('div.host-actions', h('span.host-lbl', { text: 'Bots' }), bots.el, h('span.host-lbl', { text: 'Skill' }), ...levelBtns)
		),
		h('section.host-sec', h('h2', { text: 'Arena' }), arenasEl),
		h('section.host-sec', h('h2', { text: 'Players' }), playersEl),
		h(
			'section.host-sec',
			h('h2', { text: 'In the game world' }),
			houseSlider.el,
			h('label.host-switch', lightsBox, ' Live lights in the game'),
			h('label.host-switch', wallBox, ' LED wall pictures in the game'),
			h('p.hint', { text: 'What every guest sees inside their own game. Off = dark rig / blank walls in the game.' })
		),
		h(
			'section.host-sec',
			h('p.hint', {
				text: 'Spectator page (arena camera + scores): /game/sk/?spectate=1 — an ordinary web page. The game never shows anything on a screen by itself.',
			})
		)
	)

	let sceneRev = null
	let arenas = []
	let scene = null
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
	function setLimits(df, dm) {
		const l = lim()
		const f = Math.max(5, Math.min(100, (l.frags || 20) + df))
		const m = Math.max(1, Math.min(30, (l.minutes || 5) + dm))
		act({ action: 'limits', frags: f, minutes: m }, `Limits: ${f} ${state?.mode === 'spot' ? 'points' : 'frags'} · ${m} min`)
	}
	function setBots(d) {
		const n = Math.max(0, Math.min(6, (state?.bots | 0) + d))
		act({ action: 'bots', n }, `${n} bots`)
	}
	enableBtn.addEventListener('click', () => act({ action: 'enable' }, 'Game enabled.'))
	disableBtn.addEventListener('click', () => act({ action: 'disable' }, 'Game disabled.'))
	startBtn.addEventListener('click', () => act({ action: 'start' }, 'Count-down started.'))
	stopBtn.addEventListener('click', () => act({ action: 'stop' }, 'Back to the lobby.'))
	dmBtn.addEventListener('click', () => act({ action: 'mode', mode: 'dm' }, 'Mode: free for all'))
	tdmBtn.addEventListener('click', () => act({ action: 'mode', mode: 'tdm' }, 'Mode: teams'))
	spotBtn.addEventListener('click', () => act({ action: 'mode', mode: 'spot' }, 'Mode: spotlight'))
	for (const b of levelBtns) b.addEventListener('click', () => act({ action: 'botlevel', level: b.dataset.level }, `Bot skill: ${b.dataset.level}`))
	lightsBox.addEventListener('change', () =>
		act({ action: 'lights', on: lightsBox.checked }, `Live lights in the game ${lightsBox.checked ? 'on' : 'off'}.`)
	)
	wallBox.addEventListener('change', () =>
		act({ action: 'wall', on: wallBox.checked }, `LED wall pictures in the game ${wallBox.checked ? 'on' : 'off'}.`)
	)

	function paintArenas() {
		arenasEl.textContent = ''
		if (!state?.enabled) return void arenasEl.append(h('p.hint', { text: 'Enable the game to see the arenas of the current scene.' }))
		if (!arenas.length) return void arenasEl.append(h('p.hint', { text: 'Loading arenas…' }))
		const s = sceneScale(scene)
		const occ = prepareOcc(scene?.occ || [])
		for (const a of arenas) {
			const cv = h('canvas', { width: 200, height: 130 })
			const [x0, z0, x1, z1] = a.rect || [0, 0, 0, 0]
			const size = `${Math.round((x1 - x0) / s)} × ${Math.round((z1 - z0) / s)} u`
			const b = h('button.track-card', { type: 'button' }, cv, h('span', { text: a.name || a.id }), h('small', { text: size }))
			b.classList.toggle('on', a.id === state.arenaId)
			b.addEventListener('click', () => act({ action: 'arena', id: a.id }, `Arena: ${a.name || a.id}`))
			arenasEl.append(b)
			try {
				const mm = createMinimap(cv)
				mm.setArena(buildArenaGrid(a, occ, s))
				mm.draw({ pickups: (a.pickups || []).map((p) => ({ ...p, here: true })), dots: [] })
			} catch {
				/* a preview is optional */
			}
		}
	}

	function paintPlayers() {
		playersEl.textContent = ''
		const ps = state?.players || []
		if (!ps.length) playersEl.append(h('li.hint', { text: 'Nobody has joined yet.' }))
		const tdm = state?.mode === 'tdm'
		for (const p of ps) {
			const sw = h('span.swatch')
			sw.style.background = safeColor(tdm ? TEAM_COLORS[p.team | 0] : p.color)
			const info = `${p.kills ?? 0} / ${p.deaths ?? 0}${p.bot ? ' · bot' : ''}${p.connected === false ? ' · offline' : ''}`
			const li = h('li', sw, h('span.pname', { text: String(p.name ?? '') }), h('span.pready', { text: info }))
			if (tdm) {
				const other = (p.team | 0) === 0 ? 1 : 0
				const mv = h('button.ghost.small', { type: 'button', text: `→ ${TEAM_NAMES[other]}` })
				mv.addEventListener('click', () => act({ action: 'team', id: p.id, team: other }, `${p.name} → ${TEAM_NAMES[other]}`))
				li.append(mv)
			}
			if (!p.bot) {
				const kick = h('button.ghost.small', { type: 'button', text: 'Kick' })
				kick.addEventListener('click', () => act({ action: 'kick', id: p.id }, `Kicked ${p.name}.`))
				li.append(kick)
			}
			playersEl.append(li)
		}
	}

	let lastJoin = null
	let lastArenas = ''
	let lastPlayers = ''
	async function refresh() {
		const r = await apiGet('/state')
		if (!r.ok || !r.data) {
			setText(stateEl, r.status ? `State unavailable (${r.status})` : 'No connection to the box')
			return
		}
		state = r.data
		const on = !!state.enabled
		const n = (state.players || []).length
		setText(stateEl, on ? `Running · ${state.phase} · ${n}/${state.maxPlayers || 10} soldiers` : 'Game is OFF')
		stateEl.classList.toggle('on', on)
		show(enableBtn, !on)
		show(disableBtn, on)
		startBtn.disabled = !on || state.phase !== 'lobby' || !n
		stopBtn.disabled = !on || state.phase === 'lobby'
		dmBtn.classList.toggle('on', state.mode !== 'tdm' && state.mode !== 'spot')
		tdmBtn.classList.toggle('on', state.mode === 'tdm')
		spotBtn.classList.toggle('on', state.mode === 'spot')
		dmBtn.disabled = tdmBtn.disabled = spotBtn.disabled = !on || state.phase !== 'lobby'
		for (const b of levelBtns) {
			b.classList.toggle('on', (state.botLevel || 'normal') === b.dataset.level)
			b.disabled = !on
		}
		const pts = state.mode === 'spot'
		setText(fragsLbl, pts ? 'Points' : 'Frag limit')
		setText(frags.val, `${lim().frags ?? 20} ${pts ? 'points' : 'frags'}`)
		setText(minutes.val, `${lim().minutes ?? 5} min`)
		setText(bots.val, `${state.bots | 0}`)
		houseSlider.sync(state, on)
		lightsBox.checked = on && state.lights === true
		wallBox.checked = on && state.wall === true
		lightsBox.disabled = wallBox.disabled = !on
		const urls = on ? state.joinUrls || [] : []
		if (urls.join('|') !== lastJoin) {
			lastJoin = urls.join('|')
			joinBox.textContent = ''
			if (!urls.length) joinBox.append(h('p.hint', { text: on ? 'No network address found.' : 'Enable the game first.' }))
			for (const u of urls) {
				const slot = h('div.join-slot')
				renderJoinCode(u, slot)
				joinBox.append(slot)
			}
		}
		if (on && (state.sceneRev !== sceneRev || !arenas.length)) {
			const sc = await apiGet('/scene')
			if (sc.ok && sc.data) {
				scene = sc.data
				sceneRev = sc.data.rev ?? state.sceneRev
				arenas = Array.isArray(sc.data.arenas) ? sc.data.arenas : []
			}
		}
		if (!on) {
			arenas = []
			sceneRev = null
		}
		const aKey = JSON.stringify([on, state.arenaId, arenas.map((a) => a.id)])
		if (aKey !== lastArenas) {
			lastArenas = aKey
			paintArenas()
		}
		const pKey = JSON.stringify([state.mode, state.players || []])
		if (pKey !== lastPlayers) {
			lastPlayers = pKey
			paintPlayers()
		}
	}

	refresh()
	setInterval(refresh, 2000)
}
