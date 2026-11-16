/* global setTimeout, clearTimeout, performance */
/**
 * WO-1101 — the world host's "House lights" slider: the behaviour of the RC kit's house-slider.js (WO-1099), posting the
 * world action `{ action: 'house', level 0..1 }` (passed on to every enabled game). A label (click = dark ↔ the last
 * non-zero level) + range 0..100 + a "%" readout; while dragging it posts at most every ~100 ms plus once on `change`;
 * sync(state, on) follows the server without fighting a drag in progress.
 */
import { h } from './world-dom.js'

const THROTTLE_MS = 100
const ECHO_MS = 400

/** A level 0..1 from the server (a boolean of an older game = 1 / 0; nothing = lit). */
export function normHouse(v) {
	if (typeof v === 'boolean') return v ? 1 : 0
	if (typeof v === 'number' && !Number.isNaN(v)) return Math.min(1, Math.max(0, v))
	return 1
}

/** The label's toggle: lit → dark (remembering the level), dark → the last level. */
export function houseToggle(level, last = 1) {
	const cur = normHouse(level)
	if (cur > 0) return { level: 0, last: cur }
	return { level: last > 0 ? normHouse(last) : 1, last: last > 0 ? last : 1 }
}

export function createHouseSlider({ post, say }) {
	const range = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 100, 'aria-label': 'House lights level' })
	const pct = h('span.house-pct', { text: '100%' })
	const lbl = h('span.house-lbl', { text: 'House lights', role: 'button', tabindex: 0 })
	const el = h('div.row.house', { title: 'The general light on the room in every game (0–100 %).' }, lbl, range, pct)
	let last = 1
	let dragging = false
	let timer = null
	let lastSent = 0
	let touched = 0
	let pending = null

	const level = () => normHouse(Number(range.value) / 100)
	const show = (lv) => {
		range.value = String(Math.round(lv * 100))
		pct.textContent = `${Math.round(lv * 100)}%`
		if (lv > 0) last = lv
	}
	const send = (lv) => {
		pending = null
		lastSent = performance.now()
		post({ action: 'house', level: lv })
	}
	const queue = () => {
		touched = performance.now()
		const lv = level()
		pct.textContent = `${Math.round(lv * 100)}%`
		if (lv > 0) last = lv
		pending = lv
		if (timer) return
		timer = setTimeout(() => {
			timer = null
			if (pending != null) send(pending)
		}, Math.max(0, THROTTLE_MS - (performance.now() - lastSent)))
	}
	range.addEventListener('pointerdown', () => (dragging = true))
	range.addEventListener('pointerup', () => (dragging = false))
	range.addEventListener('pointercancel', () => (dragging = false))
	range.addEventListener('input', queue)
	range.addEventListener('change', () => {
		dragging = false
		touched = performance.now()
		if (timer) (clearTimeout(timer), (timer = null))
		const lv = level()
		send(lv)
		say?.(`House lights ${Math.round(lv * 100)} %.`)
	})
	const toggle = () => {
		const t = houseToggle(level(), last)
		last = t.last
		show(t.level)
		touched = performance.now()
		if (timer) (clearTimeout(timer), (timer = null))
		send(t.level)
		say?.(`House lights ${t.level > 0 ? Math.round(t.level * 100) + ' %' : 'off'}.`)
	}
	lbl.addEventListener('click', toggle)
	lbl.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), toggle())
	})
	return {
		el,
		sync(state, on) {
			range.disabled = !on
			if (dragging || timer || performance.now() - touched < ECHO_MS) return
			show(on ? normHouse(state?.house) : 1)
		},
	}
}
