/**
 * Scoreboard, results and kill feed of Stage Skirmish (WO-1081 §9). The full board shows on Tab / the board button and
 * by itself in `results` (title, winner line, rows ordered by score.js; `tdm` adds the team totals and groups the
 * rows). The kill feed keeps the last few frags for a few seconds. DOM only; names via textContent.
 */
import { h, setText, show, safeColor } from './dom.js'
import { orderPlayers } from './score.js'
import { TEAM_COLORS, TEAM_NAMES, WEAPONS } from './sk-const.js'

const FEED_MAX = 5
const FEED_MS = 6000

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
		h('table.board-table', h('thead', h('tr', ...['#', 'Player', 'Frags', 'Deaths', 'Score'].map((t) => h('th', { text: t })))), body),
		note
	)
	const el = h('div.sk-board', card)
	root.append(el)
	show(el, false)
	let key = ''

	/**
	 * @param {{ title: string, sub?: string, note?: string, mode: string, players: object[], teams?: number[]|null,
	 *   meId?: any, final?: boolean }|null} d
	 */
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
		if (d.mode === 'tdm') {
			const t = d.teams || [0, 0]
			for (const i of [0, 1]) {
				const b = h('div.team-total', h('span.team-name', { text: TEAM_NAMES[i] }), h('span.team-score', { text: String(t[i] ?? 0) }))
				b.style.borderColor = TEAM_COLORS[i]
				teams.append(b)
			}
		}
		body.textContent = ''
		const rows = orderPlayers(d.players, d.mode, d.teams)
		let place = 0
		let lastScore = null
		rows.forEach((p, i) => {
			if (p.score !== lastScore) place = i + 1
			lastScore = p.score
			const sw = h('span.swatch')
			sw.style.background = safeColor(d.mode === 'tdm' ? TEAM_COLORS[p.team | 0] : p.color)
			const tr = h(
				'tr',
				h('td', { text: String(place) }),
				h('td', sw, h('span', { text: String(p.name ?? '') + (p.bot ? ' (bot)' : '') })),
				h('td', { text: String(p.kills ?? 0) }),
				h('td', { text: String(p.deaths ?? 0) }),
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

export function createKillFeed(root) {
	const el = h('ol.sk-feed')
	root.append(el)
	const items = []
	function paint() {
		el.textContent = ''
		for (const it of items) el.append(it.li)
	}
	return {
		/** @param {{ killer: object|null, victim: object, w: string, suicide: boolean, mine: boolean }} k */
		add(k) {
			const name = (p) => {
				const s = h('span.feed-name', { text: String(p?.name ?? '?') })
				s.style.color = safeColor(p?.color, '#ffffff')
				return s
			}
			const li = k.suicide
				? h('li', name(k.victim), h('span.feed-w', { text: ' blew up' }))
				: h('li', name(k.killer), h('span.feed-w', { text: ` ${WEAPONS[k.w]?.name || '›'} ` }), name(k.victim))
			if (k.mine) li.classList.add('mine')
			items.push({ li, at: Date.now() })
			while (items.length > FEED_MAX) items.shift()
			paint()
		},
		tick() {
			const now = Date.now()
			let changed = false
			while (items.length && now - items[0].at > FEED_MS) {
				items.shift()
				changed = true
			}
			if (changed) paint()
		},
		clear() {
			items.length = 0
			paint()
		},
	}
}
