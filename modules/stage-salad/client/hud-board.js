/**
 * Scores of Stage Salad (WO-1089 §7 / §8 / §11): the full board (Tab / the board button, by itself in `results`, always
 * for spectators): title, winner line, team totals in team mode, rows with hits / shots / best streak / score; and the
 * small live leaderboard of the HUD. Order: score, then more hits, then fewer shots (the contract's tie rule). DOM
 * only; names via textContent.
 */
import { h, setText, show, safeColor } from './dom.js'

export const TEAMS = Object.freeze([
	{ name: 'Left side', color: '#36c2bd' },
	{ name: 'Right side', color: '#ff9f43' },
])

/** Rows in board order (pure). */
export function orderPlayers(players) {
	return (players || [])
		.filter((p) => p && typeof p === 'object')
		.slice()
		.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.hits ?? 0) - (a.hits ?? 0) || (a.shots ?? 0) - (b.shots ?? 0))
}

export function createBoard(root) {
	const title = h('h2.board-title')
	const sub = h('p.board-sub')
	const teams = h('div.board-teams')
	const body = h('tbody')
	const note = h('p.board-note')
	const card = h(
		'div.board-card',
		title,
		sub,
		teams,
		h('table.board-table', h('thead', h('tr', ...['#', 'Player', 'Hits', 'Shots', 'Best', 'Score'].map((t) => h('th', { text: t })))), body),
		note
	)
	const el = h('div.salad-board', card)
	root.append(el)
	show(el, false)
	let key = ''

	/** @param {{ title, sub?, note?, players, teams?: number[]|null, teamMode?: boolean, meId?, final? }|null} d */
	function render(d) {
		if (!d) {
			show(el, false)
			key = ''
			return
		}
		show(el, true)
		el.classList.toggle('final', !!d.final)
		const k = JSON.stringify(d)
		if (k === key) return
		key = k
		setText(title, d.title)
		setText(sub, d.sub || '')
		setText(note, d.note || '')
		teams.textContent = ''
		if (d.teamMode) {
			const t = d.teams || [0, 0]
			for (const i of [0, 1]) {
				const b = h('div.team-total', h('span.team-name', { text: TEAMS[i].name }), h('span.team-score', { text: String(t[i] ?? 0) }))
				b.style.borderColor = TEAMS[i].color
				teams.append(b)
			}
		}
		body.textContent = ''
		let place = 0
		let last = null
		orderPlayers(d.players).forEach((p, i) => {
			if (p.score !== last) place = i + 1
			last = p.score
			const sw = h('span.swatch')
			sw.style.background = safeColor(d.teamMode ? TEAMS[p.team === 1 ? 1 : 0].color : p.color)
			const tr = h(
				'tr',
				h('td', { text: String(place) }),
				h('td', sw, h('span', { text: String(p.name ?? '') + (p.bot ? ' (bot)' : '') })),
				h('td', { text: String(p.hits ?? 0) }),
				h('td', { text: String(p.shots ?? 0) }),
				h('td', { text: String(p.best ?? 0) }),
				h('td.score', { text: String(p.score ?? 0) })
			)
			if (p.id === d.meId) tr.classList.add('me')
			if (p.connected === false) tr.classList.add('offline')
			body.append(tr)
		})
	}

	return {
		render,
		get visible() {
			return !el.hidden
		},
	}
}

/** The HUD's small live leaderboard (top `n`, the own row added when outside). */
export function createLeaders(root, n = 5) {
	const ol = h('ol.salad-leaders')
	root.append(ol)
	let key = ''
	return {
		render(players, meId, teamMode) {
			const rows = orderPlayers(players)
			let list = rows.slice(0, n)
			const mine = rows.findIndex((p) => p.id === meId)
			if (mine >= n) list = [...list.slice(0, n - 1), rows[mine]]
			const k = JSON.stringify([list.map((p) => [p.id, p.name, p.score, p.color, p.team]), meId, teamMode])
			if (k === key) return
			key = k
			ol.textContent = ''
			for (const p of list) {
				const sw = h('span.swatch')
				sw.style.background = safeColor(teamMode ? TEAMS[p.team === 1 ? 1 : 0].color : p.color)
				const li = h('li', h('span.lb-pos', { text: String(rows.indexOf(p) + 1) }), sw, h('span.lb-name', { text: String(p.name ?? '') }), h('span.lb-score', { text: String(p.score ?? 0) }))
				if (p.id === meId) li.classList.add('me')
				ol.append(li)
			}
			show(ol, list.length > 0)
		},
	}
}
