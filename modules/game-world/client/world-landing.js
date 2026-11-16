/* global setTimeout */
/**
 * WO-1101 — the landing "pick your game" (`/game/world/`, the natural join address): the registered games with their
 * state, one big tap target per running game that opens its player page. Phone-first, minimal. Polls the state.
 */
import { h, setText, getState } from './world-dom.js'
import { gamesOf, phaseName } from './world-logic.js'

const POLL_MS = 4000

export function startLanding(root) {
	root.textContent = ''
	const msg = h('p.hint', { role: 'status' })
	const list = h('div.pick-list')
	root.append(h('header.page-head', h('h1', { text: 'Pick your game' })), msg, list)
	let lastKey = null

	function paint(games) {
		const key = JSON.stringify(games.map((g) => [g.id, g.title, g.enabled, g.phase, g.players, g.paths.play]))
		if (key === lastKey) return
		lastKey = key
		list.textContent = ''
		for (const g of games) {
			const sub = g.enabled ? [phaseName(g.phase) || 'Running', `${g.players} ${g.players === 1 ? 'player' : 'players'}`].join(' · ') : 'Not running'
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
