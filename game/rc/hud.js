/* global setTimeout, clearTimeout */
/**
 * HUD of the RC game (WO-1074): lap, lap times, speed bar, minimap, countdown lights, connection dot, results table
 * and (spectator) a big leaderboard; v2 arcade pieces (big ordinal position, lap banner, item slot, start hint, speed
 * lines, pop words, confetti) live in hud-extra.js and are reachable as `hud.x`. DOM only; text via textContent.
 */
import { h, setText, show, safeColor } from './dom.js'
import { fmtTime } from './lap-logic.js'
import { Minimap } from './trackdraw.js'
import { PHYS } from './physics.js'
import { createHudExtra } from './hud-extra.js'

export function createHud(root, { spectator = false, toolbar = [], itemButton = null } = {}) {
	root.textContent = ''
	root.classList.toggle('spectator', spectator)

	const lapEl = h('div.hud-lap')
	const curEl = h('div.hud-time')
	const bestEl = h('div.hud-best')
	const statusEl = h('div.hud-status')
	const tl = h('div.hud-tl', lapEl)
	const tc = h('div.hud-tc', curEl, bestEl, statusEl)
	const mapCanvas = h('canvas.hud-map', { width: spectator ? 360 : 180, height: spectator ? 260 : 130 })
	const conn = h('div.hud-conn', { title: 'Connection' })
	const tools = h('div.hud-tools', ...toolbar.map((b) => b.el))
	const tr = h('div.hud-tr', mapCanvas, h('div.hud-row', conn, tools))
	const speedFill = h('div.speed-fill')
	const speedNum = h('div.speed-num')
	const speed = h('div.hud-speed', h('div.speed-bar', speedFill), speedNum)
	const lights = h('div.lights', ...[0, 1, 2, 3, 4].map(() => h('span.light')))
	const cdText = h('div.cd-text')
	const countdown = h('div.hud-countdown', lights, cdText)
	const toastEl = h('div.hud-toast')
	const board = h('ol.hud-board')
	const resultsBody = h('tbody')
	const resultsTitle = h('h2', { text: 'Results' })
	const resultsNote = h('p.results-note')
	const results = h(
		'div.hud-results',
		h(
			'div.results-card',
			resultsTitle,
			h(
				'table',
				h('thead', h('tr', ...['#', 'Driver', 'Laps', 'Total', 'Best'].map((t) => h('th', { text: t })))),
				resultsBody
			),
			resultsNote
		)
	)
	root.append(tl, tc, tr, speed, countdown, toastEl, board, results)
	show(countdown, false)
	show(results, false)
	show(board, spectator)
	show(speed, !spectator)

	const minimap = new Minimap(mapCanvas)
	const x = createHudExtra(root, { spectator, itemButton })
	let toastTimer = null

	return {
		x,
		setTrack(T) {
			minimap.setTrack(T)
		},
		/** @param {object} s */
		update(s) {
			x.position(s.racing ? s.pos : 0, s.total)
			setText(lapEl, s.racing ? `Lap ${Math.min(s.lap + 1, s.laps)}/${s.laps}` : s.phaseLabel || '')
			setText(curEl, s.racing && s.curMs != null ? fmtTime(s.curMs) : '')
			setText(bestEl, s.bestMs != null ? `Best ${fmtTime(s.bestMs)}` : '')
			const pct = Math.min(1, Math.abs(s.speed || 0) / PHYS.TOP_BOOST)
			speedFill.style.transform = `scaleX(${pct.toFixed(3)})`
			speedFill.classList.toggle('off', !s.onTrack)
			setText(speedNum, `${(Math.abs(s.speed || 0) * 3.6).toFixed(0)} km/h`)
			if (s.dots) minimap.draw(s.dots)
		},
		setStatus(text) {
			setText(statusEl, text || '')
		},
		setConn(status, rtt) {
			conn.className = 'hud-conn ' + status
			conn.title = status + (rtt != null ? ` · ${Math.round(rtt)} ms` : '')
		},
		/** @param {number|null} remainMs ms until GO (null hides); negative = just started */
		countdown(remainMs) {
			if (remainMs == null || remainMs < -1000) {
				show(countdown, false)
				return
			}
			show(countdown, true)
			const lit = remainMs > 0 ? Math.min(5, 5 - Math.floor(remainMs / 1000)) : 0
			lights.querySelectorAll('.light').forEach((el, i) => {
				el.classList.toggle('on', remainMs > 0 && i < lit)
				el.classList.toggle('go', remainMs <= 0)
			})
			setText(cdText, remainMs > 0 ? String(Math.ceil(remainMs / 1000)) : 'GO!')
		},
		toast(text, ms = 2200) {
			setText(toastEl, text)
			toastEl.classList.add('show')
			clearTimeout(toastTimer)
			toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms)
		},
		/** Spectator leaderboard. @param {{ name: string, color: string, lap: number, laps: number, best: number|null }[]} rows */
		leaderboard(rows) {
			const key = JSON.stringify(rows)
			if (board.dataset.key === key) return
			board.dataset.key = key
			board.textContent = ''
			rows.forEach((r, i) => {
				const sw = h('span.swatch')
				sw.style.background = safeColor(r.color)
				board.append(
					h(
						'li',
						h('span.bpos', { text: String(i + 1) }),
						sw,
						h('span.bname', { text: r.name }),
						h('span.blap', { text: r.info || '' })
					)
				)
			})
		},
		/** @param {{ name: string, color?: string, laps: number, totalMs: number|null, bestMs: number|null, me?: boolean }[]|null} rows */
		results(rows, note = '') {
			if (!rows) {
				show(results, false)
				x.confetti(false)
				return
			}
			const wasShown = !results.hidden
			resultsBody.textContent = ''
			rows.forEach((r, i) => {
				const sw = h('span.swatch')
				sw.style.background = safeColor(r.color)
				const tr = h(
					'tr',
					h('td', { text: String(i + 1) }),
					h('td', sw, h('span', { text: r.name })),
					h('td', { text: String(r.laps ?? '') }),
					h('td', { text: r.totalMs != null ? fmtTime(r.totalMs) : 'DNF' }),
					h('td', { text: fmtTime(r.bestMs) })
				)
				if (r.me) tr.classList.add('me')
				resultsBody.append(tr)
			})
			setText(resultsNote, note)
			show(results, true)
			if (!wasShown) x.confetti(true)
		},
	}
}

/** A HUD toolbar button. */
export function toolButton(label, title, onClick) {
	const el = h('button.tool', { type: 'button', title, 'aria-label': title, text: label })
	el.addEventListener('click', (e) => {
		e.preventDefault()
		onClick(el)
		el.blur()
	})
	return { el }
}
