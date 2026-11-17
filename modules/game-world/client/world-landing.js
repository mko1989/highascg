/* global setTimeout, document */
/**
 * WO-1101 — the landing "pick your game" (`/game/world/`, the natural join address): the registered games with their
 * state, one big tap target per running game that opens its player page. Phone-first, minimal. Polls the state.
 * WO-1125: the cards are an overlay on the live world picture (world-spectate.js, full page behind them); the overlay
 * collapses to a small "Games" button. Without WebGL / a scene the picture is skipped and the cards stay on a plain background.
 */
import { h, setText, getState } from './world-dom.js'
import { gamesOf, phaseName } from './world-logic.js'

const POLL_MS = 4000
export const CLOSED = 'Closed by the host'

export function startLanding(root) {
	root.textContent = ''
	const msg = h('p.hint', { role: 'status' })
	const list = h('div.pick-list')
	const hideBtn = h('button.pick-toggle', { type: 'button', text: 'Hide', title: 'Watch the room', 'aria-expanded': 'true' })
	const gamesBtn = h('button.pick-toggle.pick-open', { type: 'button', text: 'Games', title: 'Pick a game' })
	const panel = h('div.landing-panel', h('header.page-head', h('h1', { text: 'Pick your game' }), hideBtn), msg, list)
	const collapse = (on) => {
		panel.hidden = on
		gamesBtn.hidden = !on
		hideBtn.setAttribute('aria-expanded', String(!on))
	}
	hideBtn.addEventListener('click', () => collapse(true))
	gamesBtn.addEventListener('click', () => collapse(false))
	gamesBtn.hidden = true
	const bg = h('div.world-bg')
	document.body.prepend(bg)
	root.append(panel, gamesBtn)
	startBackground(bg)
	let lastKey = null

	function paint(games) {
		const key = JSON.stringify(games.map((g) => [g.id, g.title, g.enabled, g.phase, g.players, g.paths.play]))
		if (key === lastKey) return
		lastKey = key
		list.textContent = ''
		for (const g of games) {
			const sub = g.enabled ? [phaseName(g.phase) || 'Running', `${g.players} ${g.players === 1 ? 'player' : 'players'}`].join(' · ') : CLOSED
			const inner = [h('span.pick-title', { text: g.title }), h('span.pick-sub', { text: sub })]
			if (g.enabled && g.paths.play) {
				const a = h('a.pick.on', { href: g.paths.play }, ...inner, h('span.pick-go', { text: 'Play' }))
				list.append(a)
			} else list.append(h('div.pick.off', { 'aria-disabled': 'true' }, ...inner))
		}
	}

	async function refresh() {
		const r = await getState()
		const games = r.ok && r.data ? gamesOf(r.data) : []
		if (!r.ok && r.status !== 401 && r.status !== 403) setText(msg, r.status ? `The box answered ${r.status}. Trying again…` : 'No connection to the box. Trying again…')
		else if (!games.some((g) => g.enabled)) setText(msg, 'No game is running right now. Ask the host — this page checks again every few seconds.')
		else setText(msg, 'Tap a game to join. Same Wi-Fi as the box.')
		paint(games)
		setTimeout(refresh, POLL_MS)
	}
	refresh()
}

/** The room behind the cards; any failure (no WebGL, no scene, no kit) leaves the plain background. */
async function startBackground(bg) {
	try {
		const { startSpectate } = await import('./world-spectate.js')
		await startSpectate(bg)
	} catch {
		const canvas = document.getElementById('view')
		if (canvas) canvas.hidden = true
		bg.textContent = ''
	}
}
