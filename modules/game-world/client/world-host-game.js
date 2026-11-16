/**
 * WO-1101 — one game's card on the world host: its state, enable / disable, start / stop, bots − / +, "others can
 * affect this game" (on / soft / off, WO-1102), its join code (the RC kit's join-code.js, drawn on a canvas inside the
 * page — never on a screen) and a link to the game's own host page.
 */
import { h, setText } from './world-dom.js'
import { phaseName } from './world-logic.js'

const AFFECT = [
	['on', 'On'],
	['soft', 'Soft'],
	['off', 'Off'],
]
const AFFECT_TIP = 'Others can affect this game: On = hops, stuns, slick patches; Soft = only the visuals; Off = never a target.'
const MAX_BOTS = 9

/** @param {{ act: (body: object, ok: string) => any, qr: (url: string, el: HTMLElement) => void }} o */
export function createGameCard(game, { act, qr }) {
	const id = game.id
	const title = h('h2', { text: game.title })
	const stateEl = h('span.badge')
	const enableBtn = h('button.btn.go', { type: 'button', text: 'Enable' })
	const disableBtn = h('button.btn.ghost', { type: 'button', text: 'Disable' })
	const startBtn = h('button.btn.go', { type: 'button', text: 'Start' })
	const stopBtn = h('button.btn.ghost', { type: 'button', text: 'Stop' })
	const botsVal = h('span.val')
	const botsDown = h('button.btn.ghost.sq', { type: 'button', text: '−', 'aria-label': `Fewer bots in ${game.title}` })
	const botsUp = h('button.btn.ghost.sq', { type: 'button', text: '+', 'aria-label': `More bots in ${game.title}` })
	const affectBtns = AFFECT.map(([mode, label]) => {
		const b = h('button.seg', { type: 'button', text: label, 'aria-pressed': 'false' })
		b.addEventListener('click', () => act({ action: 'affect', game: id, mode }, `${game.title}: others can affect it — ${label.toLowerCase()}.`))
		return [mode, b]
	})
	const joinEl = h('div.join')
	const hostLink = h('a.small-link', { text: 'Its own host page', target: '_blank', rel: 'noopener' })
	let g = game
	let joinKey = null

	enableBtn.addEventListener('click', () => act({ action: 'enable', game: id }, `${g.title} enabled.`))
	disableBtn.addEventListener('click', () => act({ action: 'disable', game: id }, `${g.title} disabled.`))
	startBtn.addEventListener('click', () => act({ action: 'start', game: id }, `${g.title} started.`))
	stopBtn.addEventListener('click', () => act({ action: 'stop', game: id }, `${g.title} stopped.`))
	const setBots = (n) => {
		const count = Math.max(0, Math.min(MAX_BOTS, n))
		act({ action: 'bots', game: id, n: count }, `${g.title}: ${count} ${count === 1 ? 'bot' : 'bots'}.`)
	}
	botsDown.addEventListener('click', () => setBots(g.bots - 1))
	botsUp.addEventListener('click', () => setBots(g.bots + 1))

	const el = h(
		'section.card.game',
		h('div.card-head', title, stateEl),
		h('div.row', enableBtn, disableBtn, startBtn, stopBtn),
		h('div.row', h('span.lbl', { text: 'Bots' }), botsDown, botsVal, botsUp),
		h('div.row', { title: AFFECT_TIP }, h('span.lbl', { text: 'Others can affect it' }), h('span.segs', ...affectBtns.map((x) => x[1]))),
		joinEl,
		hostLink
	)

	function sync(game2, state) {
		g = game2
		setText(title, g.title)
		const on = g.enabled
		setText(stateEl, on ? [g.paused ? 'Paused' : phaseName(g.phase) || 'Running', `${g.players} ${g.players === 1 ? 'player' : 'players'}`].join(' · ') : 'Off')
		stateEl.classList.toggle('on', on)
		enableBtn.hidden = on
		disableBtn.hidden = !on
		startBtn.disabled = stopBtn.disabled = !on
		setText(botsVal, String(g.bots))
		botsDown.disabled = !on || g.bots <= 0
		botsUp.disabled = !on || g.bots >= MAX_BOTS
		const mode = state?.affect && typeof state.affect[id] === 'string' ? state.affect[id] : 'on'
		for (const [m, b] of affectBtns) {
			b.classList.toggle('on', m === mode)
			b.setAttribute('aria-pressed', String(m === mode))
		}
		if (g.paths.host) hostLink.setAttribute('href', g.paths.host)
		hostLink.hidden = !g.paths.host
		const url = on ? g.joinUrl : ''
		if (url !== joinKey) {
			joinKey = url
			joinEl.textContent = ''
			if (url) qr(url, joinEl)
			else joinEl.append(h('p.hint', { text: on ? 'No join address.' : 'Enable it to show its join code.' }))
		}
	}
	sync(game, null)
	return { el, sync }
}
