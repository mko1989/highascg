/* global setTimeout, clearTimeout */
/**
 * HUD of Stage Skirmish (WO-1081 §9): health + armour (bottom left), weapon + ammo and the 1–5 weapon strip (bottom
 * right), score (own place and the leader in `dm`, team totals in `tdm`; "Warm up" in the lobby), the match clock,
 * minimap + kill feed + connection dot + tool buttons (top right), "FRAG" / "fragged by" banners, the respawn
 * count-down, the start count-down, a red edge when hurt, toasts, the Spotlight line (`spot` mode: who holds the pool,
 * when it moves) and the scoreboard (hud-board.js). DOM only.
 */
import { h, setText, show, safeColor } from './dom.js'
import { createMinimap } from './minimap.js'
import { createBoard, createKillFeed } from './hud-board.js'
import { WEAPONS, WEAPON_ORDER, TEAM_COLORS, TEAM_NAMES, HP_MAX, AR_MAX, MODE_NAMES } from './sk-const.js'
import { ordinal } from './score.js'

export function createHud(root, { spectator = false, toolbar = [] } = {}) {
	root.textContent = ''
	root.classList.toggle('spectator', spectator)

	const scoreMain = h('div.sk-score-main')
	const scoreSub = h('div.sk-score-sub')
	const teamBar = h('div.sk-teams')
	const tl = h('div.hud-tl.sk-tl', scoreMain, scoreSub, teamBar)
	const clock = h('div.sk-clock')
	const status = h('div.hud-status')
	const spotLine = h('div.sk-spot-line')
	const tc = h('div.hud-tc', clock, spotLine, status)
	const mapCanvas = h('canvas.hud-map.sk-map', { width: spectator ? 320 : 180, height: spectator ? 240 : 135 })
	const conn = h('div.hud-conn', { title: 'Connection' })
	const tools = h('div.hud-tools', ...toolbar.map((b) => b.el))
	const feedHost = h('div.sk-feed-host')
	const tr = h('div.hud-tr', mapCanvas, h('div.hud-row', conn, tools), feedHost)

	const hpNum = h('span.sk-num')
	const hpFill = h('div.sk-fill.hp')
	const arNum = h('span.sk-num')
	const arFill = h('div.sk-fill.ar')
	const vitals = h(
		'div.sk-vitals',
		h('div.sk-vital', h('span.sk-ico.hp', { text: '+' }), hpNum, h('div.sk-bar', hpFill)),
		h('div.sk-vital', h('span.sk-ico.ar', { text: '◆' }), arNum, h('div.sk-bar', arFill))
	)
	const wName = h('div.sk-wname')
	const wAmmo = h('div.sk-ammo')
	const slots = new Map()
	const strip = h(
		'div.sk-strip',
		...WEAPON_ORDER.map((w) => {
			const n = h('span.slot-ammo')
			const el = h('div.sk-slot', h('span.slot-key', { text: String(WEAPONS[w].key) }), h('span.slot-name', { text: WEAPONS[w].name }), n)
			slots.set(w, { el, n })
			return el
		})
	)
	const weapon = h('div.sk-weapon', wName, wAmmo, strip)
	const banner = h('div.sk-banner')
	const respawn = h('div.sk-respawn')
	const big = h('div.sk-big')
	const toastEl = h('div.hud-toast')
	const hurt = h('div.sk-hurt')
	const surge = h('div.sk-surge-tag', { text: 'SURGE' })
	root.append(hurt, tl, tc, tr, vitals, weapon, banner, respawn, big, toastEl, surge)
	show(vitals, !spectator)
	show(weapon, !spectator)
	show(surge, false)

	const minimap = createMinimap(mapCanvas)
	const board = createBoard(root)
	const feed = createKillFeed(feedHost)
	let toastTimer = null
	let bannerTimer = null

	return {
		minimap,
		board,
		feed,
		/** Own vitals and weapon (strictly the server's `me`). */
		vitals(me, held) {
			const hp = Math.max(0, Math.round(me?.hp ?? 0))
			const ar = Math.max(0, Math.round(me?.ar ?? 0))
			setText(hpNum, String(hp))
			setText(arNum, String(ar))
			hpFill.style.transform = `scaleX(${Math.min(1, hp / HP_MAX).toFixed(3)})`
			arFill.style.transform = `scaleX(${Math.min(1, ar / AR_MAX).toFixed(3)})`
			hpFill.classList.toggle('low', hp <= 30)
			const ammo = me?.w || {}
			setText(wName, WEAPONS[held]?.name || '')
			const a = ammo[held]
			setText(wAmmo, a === -1 || a == null ? '∞' : String(a))
			wAmmo.classList.toggle('empty', a === 0)
			for (const [w, s] of slots) {
				const v = ammo[w]
				const have = v === -1 || v > 0
				s.el.classList.toggle('have', have)
				s.el.classList.toggle('held', w === held)
				setText(s.n, v === -1 ? '∞' : v > 0 ? String(v) : '')
			}
		},
		/** @param {{ mode: string, phase: string, players: object[], teams?: number[], meId: any, limits?: object }} s */
		score(s) {
			const tdm = s.mode === 'tdm'
			show(teamBar, tdm)
			if (s.phase === 'lobby') {
				setText(scoreMain, 'Warm up')
				setText(scoreSub, `${MODE_NAMES[s.mode] || MODE_NAMES.dm} · waiting for the host`)
			} else if (tdm) {
				const t = s.teams || [0, 0]
				const me = s.players.find((p) => p.id === s.meId)
				setText(scoreMain, me ? `${TEAM_NAMES[me.team | 0]} team` : 'Team match')
				setText(scoreSub, `first to ${s.limits?.frags ?? 40}`)
				teamBar.textContent = ''
				for (const i of [0, 1]) {
					const el = h('span.sk-team', { text: `${TEAM_NAMES[i]} ${t[i] ?? 0}` })
					el.style.background = TEAM_COLORS[i]
					teamBar.append(el)
				}
			} else {
				const me = s.players.find((p) => p.id === s.meId)
				const lead = s.leader
				if (me && s.rank) setText(scoreMain, `${ordinal(s.rank)} · ${me.score ?? 0}`)
				else setText(scoreMain, lead ? `${lead.name} leads` : '')
				const leadText = lead ? `leader ${lead.name} ${lead.score ?? 0}` : ''
				const unit = s.mode === 'spot' ? ' points' : ''
				setText(scoreSub, `${leadText}${leadText ? ' · ' : ''}to ${s.limits?.frags ?? 20}${unit}`)
			}
		},
		clock(text) {
			setText(clock, text || '')
		},
		/** The Spotlight line: { text, kind: 'mine' | 'other' | 'fight' | 'free' } or null. */
		spot(v) {
			setText(spotLine, v?.text || '')
			spotLine.className = `sk-spot-line ${v?.kind || ''}`
			show(spotLine, !!v?.text)
		},
		setStatus(text) {
			setText(status, text || '')
		},
		setConn(st, rtt) {
			conn.className = 'hud-conn ' + st
			conn.title = st + (rtt != null ? ` · ${Math.round(rtt)} ms` : '')
		},
		/** A big banner for a moment: kind 'frag' | 'dead' | 'info'. */
		banner(text, kind = 'info', ms = 1800) {
			setText(banner, text)
			banner.className = `sk-banner show ${kind}`
			clearTimeout(bannerTimer)
			bannerTimer = setTimeout(() => banner.classList.remove('show'), ms)
		},
		respawn(text) {
			setText(respawn, text || '')
			show(respawn, !!text)
		},
		/** The big centre number (count-down) or null. */
		big(text) {
			setText(big, text || '')
			show(big, !!text)
		},
		hurt() {
			hurt.classList.remove('on')
			void hurt.offsetWidth
			hurt.classList.add('on')
		},
		surge(on) {
			show(surge, !!on)
		},
		toast(text, ms = 2200) {
			setText(toastEl, text)
			toastEl.classList.add('show')
			clearTimeout(toastTimer)
			toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms)
		},
		color: (c) => safeColor(c),
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
