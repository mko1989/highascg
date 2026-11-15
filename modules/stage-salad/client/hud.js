/* global setTimeout, clearTimeout */
/**
 * HUD of Stage Salad (WO-1089 §11): score + streak (top left; team totals in team mode; "Practice" in the lobby), the
 * round clock and the "Paused — presenter safe" pill (top centre), the small live leaderboard + connection dot + tool
 * buttons (top right), the vegetable tray with the slingshot's reload ring (bottom), the power meter and the pitch arc
 * slider (right), banners ("SPLAT! +150", "Dodged!", "Umbrella!"), the count-down, toasts, a how-to hint until the first
 * shot, and the board (hud-board.js). DOM only; user text via textContent.
 */
import { h, setText, show, isTouchDevice } from './dom.js'
import { createBoard, createLeaders, TEAMS } from './hud-board.js'
import { VEGGIES, VEG_IDS } from './veggies.js'
import { PITCH_OFF, DEG } from './aim-input.js'

export function createHud(root, { spectator = false, toolbar = [], onPick, onPitch } = {}) {
	root.textContent = ''
	root.classList.toggle('spectator', spectator)

	const scoreMain = h('div.salad-score')
	const scoreSub = h('div.salad-sub')
	const teamBar = h('div.salad-teams')
	const tl = h('div.hud-tl.salad-tl', scoreMain, scoreSub, teamBar)
	const clock = h('div.salad-clock')
	const safe = h('div.salad-safe', { text: 'Paused — presenter safe' })
	const status = h('div.hud-status')
	const tc = h('div.hud-tc', clock, safe, status)
	const conn = h('div.hud-conn', { title: 'Connection' })
	const tools = h('div.hud-tools', ...toolbar.map((b) => b.el))
	const lbHost = h('div.salad-lb')
	const tr = h('div.hud-tr', h('div.hud-row', conn, tools), lbHost)

	const slots = VEG_IDS.map((id, i) => {
		const v = VEGGIES[id]
		const ico = h(`span.veg-ico.v-${id}`)
		ico.style.setProperty('--veg', v.color)
		const b = h('button.veg-btn', { type: 'button', title: `${v.name} (${i + 1})`, 'aria-label': v.name }, h('span.veg-key', { text: String(i + 1) }), ico, h('span.veg-name', { text: v.name }))
		b.addEventListener('pointerdown', (e) => e.stopPropagation())
		b.addEventListener('click', (e) => {
			e.preventDefault()
			b.blur()
			onPick?.(i)
		})
		return { id, b, ico }
	})
	const tray = h('div.salad-tray', ...slots.map((s) => s.b))

	const powFill = h('div.pow-fill')
	const powNum = h('div.pow-num')
	const power = h('div.salad-power', h('div.pow-bar', powFill), powNum)
	const knob = h('div.pitch-knob')
	const pTrack = h('div.pitch-track', knob)
	const pNum = h('div.pitch-num')
	const pitch = h('div.salad-pitch', { title: 'Throw higher / flatter (wheel, W / S)' }, h('span.pitch-lbl', { text: 'arc' }), pTrack, pNum)
	const side = h('div.salad-side', power, pitch)

	const hint = h('div.salad-hint', {
		text: isTouchDevice() ? 'Press anywhere, drag DOWN to pull and sideways to aim — let go to throw' : 'Drag down with the mouse (or hold Space) to pull, sideways / ← → to aim, let go to throw · 1–6 vegetables',
	})
	const banner = h('div.salad-banner')
	const big = h('div.salad-big')
	const toastEl = h('div.hud-toast')
	root.append(tl, tc, tr, tray, side, hint, banner, big, toastEl)
	show(tray, !spectator)
	show(side, !spectator)
	show(hint, !spectator)
	show(safe, false)

	/* the arc slider: drag along the track */
	let pDrag = null
	const setFromY = (y) => {
		const r = pTrack.getBoundingClientRect()
		const k = 1 - Math.max(0, Math.min(1, (y - r.top) / Math.max(1, r.height)))
		onPitch?.(PITCH_OFF[0] + k * (PITCH_OFF[1] - PITCH_OFF[0]))
	}
	pTrack.addEventListener('pointerdown', (e) => {
		e.preventDefault()
		e.stopPropagation()
		pDrag = e.pointerId
		pTrack.setPointerCapture?.(e.pointerId)
		setFromY(e.clientY)
	})
	pTrack.addEventListener('pointermove', (e) => e.pointerId === pDrag && setFromY(e.clientY))
	const pEnd = (e) => e.pointerId === pDrag && (pDrag = null)
	pTrack.addEventListener('pointerup', pEnd)
	pTrack.addEventListener('pointercancel', pEnd)

	const board = createBoard(root)
	const leaders = createLeaders(lbHost)
	let toastTimer = null
	let bannerTimer = null
	let trayKey = ''

	return {
		board,
		leaders,
		/** The tray: selected index, reload share left (0 = ready), may the player fire at all. */
		tray(sel, reload, canFire) {
			const k = `${sel}|${reload.toFixed(2)}|${canFire}`
			if (k === trayKey) return
			trayKey = k
			slots.forEach((s, i) => {
				s.b.classList.toggle('sel', i === sel)
				s.ico.style.setProperty('--reload', String(Math.max(0, Math.min(1, reload))))
			})
			tray.classList.toggle('blocked', !canFire)
			tray.classList.toggle('loading', reload > 0.001)
		},
		/** Pull 0…1 and the power it means. */
		power(pull, pw) {
			powFill.style.transform = `scaleY(${Math.max(0, Math.min(1, pull)).toFixed(3)})`
			setText(powNum, pull > 0.005 ? `${Math.round(pw * 100)} %` : '')
			power.classList.toggle('on', pull > 0.005)
		},
		/** The pitch offset (rad) and the launch pitch (rad). */
		pitch(off, abs) {
			const k = (off - PITCH_OFF[0]) / (PITCH_OFF[1] - PITCH_OFF[0])
			knob.style.top = `${((1 - k) * 100).toFixed(1)}%`
			setText(pNum, `${Math.round(abs / DEG)}°`)
		},
		/** { main, sub, teams: [l, r] | null, myTeam } */
		score(s) {
			setText(scoreMain, s.main || '')
			setText(scoreSub, s.sub || '')
			show(teamBar, !!s.teams)
			if (s.teams) {
				teamBar.textContent = ''
				for (const i of [0, 1]) {
					const el = h('span.salad-team', { text: `${TEAMS[i].name} ${s.teams[i] ?? 0}` })
					el.style.background = TEAMS[i].color
					el.classList.toggle('mine', s.myTeam === i)
					teamBar.append(el)
				}
			}
		},
		clock(text) {
			setText(clock, text || '')
		},
		safe(on) {
			show(safe, !!on)
			root.classList.toggle('paused', !!on)
		},
		setStatus(text) {
			setText(status, text || '')
		},
		setConn(st, rtt) {
			conn.className = 'hud-conn ' + st
			conn.title = st + (rtt != null ? ` · ${Math.round(rtt)} ms` : '')
		},
		hint(on) {
			show(hint, !spectator && !!on)
		},
		/** A big banner for a moment: kind 'splat' | 'miss' | 'info'. */
		banner(text, kind = 'info', ms = 1600) {
			setText(banner, text)
			banner.className = `salad-banner show ${kind}`
			clearTimeout(bannerTimer)
			bannerTimer = setTimeout(() => banner.classList.remove('show'), ms)
		},
		big(text) {
			setText(big, text || '')
			show(big, !!text)
		},
		toast(text, ms = 2200) {
			setText(toastEl, text)
			toastEl.classList.add('show')
			clearTimeout(toastTimer)
			toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms)
		},
	}
}

/** A HUD toolbar button. */
export function toolButton(label, title, onClick) {
	const el = h('button.tool', { type: 'button', title, 'aria-label': title, text: label })
	el.addEventListener('pointerdown', (e) => e.stopPropagation())
	el.addEventListener('click', (e) => {
		e.preventDefault()
		onClick(el)
		el.blur()
	})
	return { el }
}
