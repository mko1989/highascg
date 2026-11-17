/* global setInterval */
/**
 * Host panel of Stage Salad (`?host=1`, WO-1089 §2 / §8): the PROMINENT presenter-safe pause (stops every shot at
 * once), enable / disable, the join address as a QR code (the kit's join-code.js) and in large type, start / stop,
 * round length, free-for-all or teams (left / right of the room), bots and their skill, which avatar is the target
 * (auto / the stand-in / chosen tracked people), the roster with kick, and the two switches for what guests see INSIDE
 * the game world (live lights, LED wall pictures). It only calls /api/game/salad/state and /host — the game never puts
 * anything on a screen, and this panel offers no way to.
 */
import { createHouseSlider } from './kit/house-slider.js'
import { h, setText, show, apiGet, apiHost, safeColor, createBusyGate } from './dom.js'
import { qrMatrix, drawQr } from './kit/join-code.js'
import { TEAMS } from './hud-board.js'

const LEVELS = ['easy', 'normal', 'hard']
const SECS = [30, 60, 90, 120, 180, 300, 600]

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
	return { el: h('span.laps', minus, val, plus), val, minus, plus }
}

export function startHost(root) {
	root.textContent = ''
	const stateEl = h('div.host-state')
	const msg = h('div.host-msg', { role: 'status' })
	const safeBtn = h('button.salad-safe-btn', { type: 'button', text: 'Pause — presenter safe' })
	const safeNote = h('p.hint.salad-safe-note')
	const enableBtn = h('button.big', { type: 'button', text: 'Enable game' })
	const disableBtn = h('button.ghost', { type: 'button', text: 'Disable game' })
	const startBtn = h('button.big.go', { type: 'button', text: 'Start round' })
	const stopBtn = h('button.ghost', { type: 'button', text: 'Stop → lobby' })
	const ffaBtn = h('button.ghost.mode', { type: 'button', text: 'Everyone for themselves' })
	const teamsBtn = h('button.ghost.mode', { type: 'button', text: 'Teams: left vs right' })
	const levelBtns = LEVELS.map((l) => {
		const b = h('button.ghost.mode', { type: 'button', text: l[0].toUpperCase() + l.slice(1) })
		b.dataset.level = l
		return b
	})
	const autoBtn = h('button.ghost.mode', { type: 'button', text: 'Automatic' })
	const dummyBtn = h('button.ghost.mode', { type: 'button', text: 'Stand-in only' })
	const targetsEl = h('div.host-actions.salad-targets')
	const joinBox = h('div.join-box')
	const playersEl = h('ul.host-players')
	const houseSlider = createHouseSlider({ h, post: apiHost, say: (t) => say(t) }) // WO-1099 house lights level
	const lightsBox = h('input', { type: 'checkbox' })
	const wallBox = h('input', { type: 'checkbox' })
	let state = null
	const secs = stepper('round time', () => setSecs(-1), () => setSecs(1))
	const bots = stepper('bots', () => setBots(-1), () => setBots(1))

	root.append(
		h('header.host-head', h('h1', { text: 'Stage Salad — host' }), stateEl),
		msg,
		h('section.host-sec.salad-safe-sec', safeBtn, safeNote),
		h(
			'section.host-sec',
			h('h2', { text: 'Join on your phone' }),
			joinBox,
			h('p.hint', { text: 'Same Wi-Fi as this box. Scan the code with the phone’s camera, or type the address into its browser. Phones play sideways.' })
		),
		h('section.host-sec', h('div.host-actions', enableBtn, disableBtn, startBtn, stopBtn)),
		h(
			'section.host-sec',
			h('h2', { text: 'Round' }),
			h('div.host-actions', h('span.host-lbl', { text: 'Length' }), secs.el),
			h('div.host-actions', ffaBtn, teamsBtn),
			h('div.host-actions', h('span.host-lbl', { text: 'Bots' }), bots.el, h('span.host-lbl', { text: 'Skill' }), ...levelBtns),
			h('p.hint', { text: 'Before the round the lobby is practice: guests throw as much as they like, nothing is scored.' })
		),
		h(
			'section.host-sec',
			h('h2', { text: 'Target avatar' }),
			h('div.host-actions', autoBtn, dummyBtn),
			targetsEl,
			h('p.hint', { text: 'Automatic: the tracked presenter(s) on stage, or the stand-in when nobody is tracked. Only the friendly avatar is ever shown — never camera pictures.' })
		),
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
				text: 'Spectator page: /game/salad/?spectate=1 — an ordinary web page; the game never shows anything on a screen by itself',
			})
		)
	)

	const gate = createBusyGate() // WO-1106 B64: the presenter-safe tap is never dropped behind another request
	const say = (text, bad = false) => {
		setText(msg, text || '')
		msg.classList.toggle('bad', !!bad)
	}
	async function act(body, okText, urgent = false) {
		const r = await gate.run(() => apiHost(body), urgent)
		if (!r) return
		if (r.ok) say(okText || '')
		else if (r.status === 401 || r.status === 403)
			say('Not allowed: log in to the HighAsCG web UI in this browser first (or open this page with ?token=…).', true)
		else say(`Failed (${r.status || 'no connection'})${r.data?.error ? ': ' + r.data.error : ''}`, true)
		await refresh()
	}
	function setSecs(d) {
		const cur = state?.secs || 90
		let i = SECS.findIndex((s) => s >= cur)
		if (i < 0) i = SECS.length - 1
		if (SECS[i] !== cur && d < 0) i += 1 // between two steps: − goes to the lower one
		const n = SECS[Math.max(0, Math.min(SECS.length - 1, i + d))]
		act({ action: 'round', secs: n }, `Rounds of ${fmtSecs(n)}`)
	}
	function setBots(d) {
		const n = Math.max(0, Math.min(8, (state?.bots | 0) + d))
		act({ action: 'bots', n }, `${n} bots`)
	}
	safeBtn.addEventListener('click', () => {
		const on = !state?.safe
		act({ action: 'safe', on }, on ? 'Paused: no shots until you resume.' : 'Resumed: guests can throw again.', true)
	})
	enableBtn.addEventListener('click', () => act({ action: 'enable' }, 'Game enabled.'))
	disableBtn.addEventListener('click', () => act({ action: 'disable' }, 'Game disabled.'))
	startBtn.addEventListener('click', () => act({ action: 'start' }, 'Count-down started.'))
	stopBtn.addEventListener('click', () => act({ action: 'stop' }, 'Back to the lobby.'))
	ffaBtn.addEventListener('click', () => act({ action: 'teams', on: false }, 'Everyone for themselves'))
	teamsBtn.addEventListener('click', () => act({ action: 'teams', on: true }, 'Teams: left vs right side of the room'))
	for (const b of levelBtns) b.addEventListener('click', () => act({ action: 'botlevel', level: b.dataset.level }, `Bot skill: ${b.dataset.level}`))
	autoBtn.addEventListener('click', () => act({ action: 'target', mode: 'auto' }, 'Target: automatic'))
	dummyBtn.addEventListener('click', () => act({ action: 'target', mode: 'dummy' }, 'Target: the stand-in'))
	lightsBox.addEventListener('change', () => act({ action: 'lights', on: lightsBox.checked }, `Live lights in the game ${lightsBox.checked ? 'on' : 'off'}.`))
	wallBox.addEventListener('change', () => act({ action: 'wall', on: wallBox.checked }, `LED wall pictures in the game ${wallBox.checked ? 'on' : 'off'}.`))

	function paintTargets() {
		targetsEl.textContent = ''
		const list = (state?.targets || []).filter((t) => !t.dummy)
		const tg = state?.target || { mode: 'auto', ids: [] }
		const chosen = new Set(tg.mode === 'ids' ? tg.ids || [] : [])
		if (!list.length) return void targetsEl.append(h('span.hint', { text: 'No tracked people right now.' }))
		for (const t of list) {
			const b = h('button.ghost.mode', { type: 'button', text: String(t.name ?? `Person ${t.tid}`) + (t.lost ? ' (lost)' : '') })
			b.classList.toggle('on', chosen.has(t.tid))
			b.addEventListener('click', () => {
				const ids = new Set(chosen)
				if (ids.has(t.tid)) ids.delete(t.tid)
				else ids.add(t.tid)
				act(ids.size ? { action: 'target', mode: 'ids', ids: [...ids] } : { action: 'target', mode: 'auto' }, ids.size ? 'Target: the chosen people' : 'Target: automatic')
			})
			targetsEl.append(b)
		}
	}

	function paintPlayers() {
		playersEl.textContent = ''
		const ps = state?.players || []
		if (!ps.length) playersEl.append(h('li.hint', { text: 'Nobody has joined yet.' }))
		for (const p of ps) {
			const sw = h('span.swatch')
			sw.style.background = safeColor(state.teams ? TEAMS[p.team === 1 ? 1 : 0].color : p.color)
			const info = `${p.score ?? 0} pts · ${p.hits ?? 0}/${p.shots ?? 0} hits${p.bot ? ' · bot' : ''}${p.connected === false ? ' · offline' : ''}`
			const li = h('li', sw, h('span.pname', { text: String(p.name ?? '') }), h('span.pready', { text: info }))
			if (!p.bot) {
				const kick = h('button.ghost.small', { type: 'button', text: 'Kick' })
				kick.addEventListener('click', () => act({ action: 'kick', id: p.id }, `Kicked ${String(p.name ?? '')}.`))
				li.append(kick)
			}
			playersEl.append(li)
		}
	}

	let lastJoin = null
	let lastPlayers = ''
	let lastTargets = ''
	async function refresh() {
		const r = await apiGet('/state')
		if (!r.ok || !r.data) {
			setText(stateEl, r.status ? `State unavailable (${r.status})` : 'No connection to the box')
			return
		}
		state = r.data
		const on = !!state.enabled
		const n = (state.players || []).length
		setText(stateEl, on ? `Running · ${state.phase} · ${n}/${state.maxPlayers || 20} slingshots` : 'Game is OFF')
		stateEl.classList.toggle('on', on)
		const safe = on && !!state.safe
		setText(safeBtn, safe ? 'PAUSED — tap to resume' : 'Pause — presenter safe')
		safeBtn.classList.toggle('on', safe)
		safeBtn.disabled = !on
		setText(safeNote, safe ? 'No shots can leave any slingshot. Vegetables in the air stop where they are; nothing new starts.' : 'One tap stops every shot at once (the presenter needs a break, someone walks on stage…).')
		show(enableBtn, !on)
		show(disableBtn, on)
		startBtn.disabled = !on || state.phase !== 'lobby' || !n
		stopBtn.disabled = !on || state.phase === 'lobby'
		ffaBtn.classList.toggle('on', !state.teams)
		teamsBtn.classList.toggle('on', !!state.teams)
		ffaBtn.disabled = teamsBtn.disabled = !on || state.phase !== 'lobby'
		for (const b of levelBtns) {
			b.classList.toggle('on', (state.botLevel || 'normal') === b.dataset.level)
			b.disabled = !on
		}
		const mode = state.target?.mode || 'auto'
		autoBtn.classList.toggle('on', mode === 'auto')
		dummyBtn.classList.toggle('on', mode === 'dummy')
		autoBtn.disabled = dummyBtn.disabled = !on
		setText(secs.val, fmtSecs(state.secs || 90))
		secs.minus.disabled = secs.plus.disabled = !on || state.phase !== 'lobby'
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
		const tKey = JSON.stringify([state.target, (state.targets || []).map((t) => [t.tid, t.name, t.dummy, t.lost])])
		if (tKey !== lastTargets) {
			lastTargets = tKey
			paintTargets()
		}
		const pKey = JSON.stringify([state.teams, state.players || []])
		if (pKey !== lastPlayers) {
			lastPlayers = pKey
			paintPlayers()
		}
	}

	refresh()
	setInterval(refresh, 2000)
}

export function fmtSecs(s) {
	return s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : `${s / 60} min`
}
