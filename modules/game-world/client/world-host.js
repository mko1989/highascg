/* global setInterval */
/**
 * WO-1101 — the world host (`/game/world/?host=1`, auth like the games' host pages: the HighAsCG session cookie or the
 * page's `?token=`): the games side by side with their state and join codes, enable / disable / start / stop per game
 * and for all, ONE prominent "Presenter safe — pause everything" switch, bots per game, the room switches (house lights
 * 0–100 %, live lights, LED wall pictures), "others can affect this game", the shared events (vegetable rain, spotlight
 * bonus) and live stats. It only calls /api/game/world/state and /host — nothing here reaches a screen.
 */
import { h, setText, getState, postHost } from './world-dom.js'
import { gamesOf, kitOf } from './world-logic.js'
import { okModelUrl } from './world-wire.js'
import { createHouseSlider } from './world-host-house.js'
import { createGameCard } from './world-host-game.js'

const POLL_MS = 2000
const SECS = [5, 10, 15, 20, 30, 45, 60]

export function startHost(root) {
	root.textContent = ''
	const stateEl = h('span.badge')
	const msg = h('div.msg', { role: 'status' })
	const safeBtn = h('button.safe', { type: 'button', 'aria-pressed': 'false' }, h('span.safe-t', { text: 'Presenter safe' }), h('span.safe-s', { text: 'pause everything' }))
	const allBtns = [
		['enable', 'Enable all', 'All games enabled.'],
		['disable', 'Disable all', 'All games disabled.'],
		['start', 'Start all', 'Started.'],
		['stop', 'Stop all', 'Stopped.'],
	].map(([action, text, ok]) => h('button.btn' + (action === 'enable' || action === 'start' ? '.go' : '.ghost'), { type: 'button', text, onclick: () => act({ action }, ok) }))
	const gamesEl = h('div.games')
	const house = createHouseSlider({ post: (b) => act(b), say: (t) => say(t) })
	const lightsBox = h('input', { type: 'checkbox' })
	const wallBox = h('input', { type: 'checkbox' })
	const secSel = (def) => h('select.secs', { 'aria-label': 'Seconds' }, ...SECS.map((s) => h('option', { value: s, text: `${s} s`, selected: s === def })))
	const rainSecs = secSel(10)
	const spotSecs = secSel(30)
	const rainBtn = h('button.btn.go', { type: 'button', text: 'Vegetable rain' })
	const spotBtn = h('button.btn.go', { type: 'button', text: 'Spotlight bonus' })
	const endBtn = h('button.btn.ghost', { type: 'button', text: 'End event' })
	const eventEl = h('span.hint')
	const statsEl = h('dl.stats')

	root.append(
		h('header.page-head', h('h1', { text: 'Game World — host' }), stateEl),
		msg,
		safeBtn,
		h('section.card', h('div.row', ...allBtns)),
		gamesEl,
		h(
			'section.card',
			h('h2', { text: 'In every game' }),
			house.el,
			h('label.row.switch', lightsBox, h('span', { text: 'Live lights in the games' })),
			h('label.row.switch', wallBox, h('span', { text: 'LED wall pictures in the games' }))
		),
		h(
			'section.card',
			h('h2', { text: 'Shared events' }),
			h('div.row', rainBtn, rainSecs),
			h('div.row', spotBtn, spotSecs),
			h('div.row', endBtn, eventEl)
		),
		h('section.card', h('h2', { text: 'Live stats' }), statsEl),
		h('p.hint', { text: 'World spectator page: /game/world/?spectate=1 — an ordinary web page. Nothing is shown on a screen by itself.' })
	)

	let state = null
	const gate = createActGate()
	const cards = new Map()
	let qrMod = null

	function say(text, bad = false) {
		setText(msg, text || '')
		msg.classList.toggle('bad', !!bad)
	}

	async function act(body, okText) {
		if (!gate.enter(body)) return
		const r = await postHost(body)
		gate.leave(body)
		if (r.status === 401 || r.status === 403) say('Not allowed: log in to the HighAsCG web UI in this browser first (or open this page with ?token=…).', true)
		else if (!r.ok) say(`Failed (${r.status || 'no connection'})${typeof r.data?.error === 'string' ? ': ' + r.data.error.slice(0, 160) : ''}`, true)
		else {
			const refused = refusals(r.data)
			if (refused) say(refused, true)
			else if (okText) say(okText)
		}
		await refresh()
	}

	safeBtn.addEventListener('click', () => {
		const on = !state?.safe
		act({ action: 'safe', on }, on ? 'Presenter safe: every game paused.' : 'Presenter safe off: the games go on.')
	})
	lightsBox.addEventListener('change', () => act({ action: 'lights', on: lightsBox.checked }, `Live lights ${lightsBox.checked ? 'on' : 'off'}.`))
	wallBox.addEventListener('change', () => act({ action: 'wall', on: wallBox.checked }, `LED wall pictures ${wallBox.checked ? 'on' : 'off'}.`))
	rainBtn.addEventListener('click', () => act({ action: 'event', kind: 'rain', secs: Number(rainSecs.value) }, 'Vegetable rain!'))
	spotBtn.addEventListener('click', () => act({ action: 'event', kind: 'spot', secs: Number(spotSecs.value) }, 'Spotlight bonus on.'))
	endBtn.addEventListener('click', () => act({ action: 'event', kind: 'none' }, 'Event ended.'))

	/** The join code through the RC kit's join-code.js (a running game's `paths.kit`); the address alone without it. */
	async function qr(url, el) {
		const kit = kitOf(gamesOf(state))
		const u = kit && kit + 'join-code.js'
		try {
			if (!qrMod && u && okModelUrl(u)) qrMod = await import(u)
			if (qrMod?.qrMatrix && qrMod.drawQr) {
				const cv = h('canvas.qr', { role: 'img', 'aria-label': `QR code for ${url}` })
				qrMod.drawQr(cv, qrMod.qrMatrix(url))
				el.append(cv)
			}
		} catch {
			/* no code: the printed address still works */
		}
		el.append(h('div.join-url', { text: url }))
	}

	function paintStats(stats) {
		statsEl.textContent = ''
		const rows = []
		const walk = (o, pre, depth) => {
			for (const [k, v] of Object.entries(o || {})) {
				if (rows.length >= 40) return
				const key = pre ? `${pre} · ${k}` : k
				if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) walk(v, key, depth + 1)
				else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') rows.push([key, String(v).slice(0, 40)])
			}
		}
		if (stats && typeof stats === 'object') walk(stats, '', 0)
		if (!rows.length) statsEl.append(h('dt', { text: 'No stats yet.' }))
		for (const [k, v] of rows) statsEl.append(h('dt', { text: k.slice(0, 48) }), h('dd', { text: v }))
	}

	async function refresh() {
		const r = await getState()
		if (r.status === 401 || r.status === 403) {
			setText(stateEl, 'Not logged in')
			say('Log in to the HighAsCG web UI in this browser first (or open this page with ?token=…).', true)
			return
		}
		if (!r.ok || !r.data) {
			setText(stateEl, r.status ? `State unavailable (${r.status})` : 'No connection to the box')
			return
		}
		state = r.data
		const games = gamesOf(state)
		const any = games.some((g) => g.enabled)
		setText(stateEl, any ? `${games.filter((g) => g.enabled).length} of ${games.length} games on` : games.length ? 'All games off' : 'No game installed')
		stateEl.classList.toggle('on', any)
		const safe = state.safe === true
		safeBtn.classList.toggle('on', safe)
		safeBtn.setAttribute('aria-pressed', String(safe))
		const keep = new Set()
		for (const g of games) {
			keep.add(g.id)
			let c = cards.get(g.id)
			if (!c) {
				c = createGameCard(g, { act, qr })
				cards.set(g.id, c)
				gamesEl.append(c.el)
			}
			c.sync(g, state)
		}
		for (const [id, c] of cards) if (!keep.has(id)) (c.el.remove(), cards.delete(id))
		house.sync(state, any)
		lightsBox.checked = any && state.lights === true
		wallBox.checked = any && state.wall === true
		lightsBox.disabled = wallBox.disabled = !any
		const ev = state.events && typeof state.events === 'object' ? state.events : {}
		const live = ['rain', 'spot'].filter((k) => ev[k])
		setText(eventEl, live.length ? `Running: ${live.map((k) => (k === 'rain' ? 'vegetable rain' : 'spotlight bonus')).join(', ')}` : 'No event running.')
		rainBtn.disabled = spotBtn.disabled = !any || safe
		endBtn.disabled = !live.length
		paintStats(state.stats)
	}

	refresh()
	setInterval(refresh, POLL_MS)
}

/**
 * WO-1106 A34 — the host's in-flight gate. One action at a time (a double click does not post twice), but the house
 * slider's posts (throttled by the slider itself) have their own lane: they are never refused and never take or free
 * the flag, so a Presenter-safe click while a house post is in flight goes through.
 */
export function createActGate() {
	let busy = false
	const house = (body) => body?.action === 'house'
	return {
		enter(body) {
			if (house(body)) return true
			if (busy) return false
			return (busy = true)
		},
		leave(body) {
			if (!house(body)) busy = false
		},
	}
}

/** A host answer's per-game refusals (a game with no players, already running …) → one line, or ''. */
export function refusals(data) {
	const res = data && typeof data === 'object' ? data.results || data.games : null
	if (!res || typeof res !== 'object') return ''
	const out = []
	for (const [k, v] of Object.entries(res)) {
		const id = typeof v?.id === 'string' ? v.id : k
		if (v && typeof v === 'object' && (v.ok === false || (typeof v.status === 'number' && v.status >= 400)))
			out.push(`${String(id).slice(0, 12)}: ${typeof v.error === 'string' ? v.error.slice(0, 80) : typeof v.body?.error === 'string' ? v.body.error.slice(0, 80) : 'refused'}`)
	}
	return out.length ? `Not everywhere — ${out.join(' · ')}` : ''
}
