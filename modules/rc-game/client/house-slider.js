/* global setTimeout, clearTimeout, performance */
/**
 * WO-1099 — the host page's "House lights" slider (one builder for all three games' host.js; Skirmish and Salad reach it
 * through their `kit/` alias). A label (click = dark ↔ the last non-zero level, house.js houseToggle) + range 0..100 + a "%"
 * readout, placed where the old checkbox was. While dragging it posts `{action:'house', level}` at most every ~100 ms plus
 * once on `change`; `sync(state, on)` follows the server without fighting a drag in progress.
 */
import { houseToggle, normHouse } from './house.js'

export const HOUSE_TIP = "The general light on the room (0–100 %). 0 = a dark room lit only by the rig, the LED walls and the game's own lights."
const THROTTLE_MS = 100
const ECHO_MS = 400

/** @param {{ h: Function, post: (body: object) => any, say?: (t: string) => void }} o  post = the games' apiHost */
export function createHouseSlider({ h, post, say }) {
	const range = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 100, 'aria-label': 'House lights level' })
	const pct = h('span.house-pct', { text: '100%' })
	const lbl = h('span.house-lbl', { text: 'House lights', role: 'button', tabindex: 0 })
	const el = h('div.host-switch.house-switch', { title: HOUSE_TIP }, lbl, range, pct)
	let last = 1 // the last non-zero level (the label's way back to light)
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
		const wait = Math.max(0, THROTTLE_MS - (performance.now() - lastSent))
		timer = setTimeout(() => {
			timer = null
			if (pending != null) send(pending)
		}, wait)
	}
	range.addEventListener('pointerdown', () => (dragging = true))
	const up = () => (dragging = false)
	range.addEventListener('pointerup', up)
	range.addEventListener('pointercancel', up)
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
		range,
		/** Follow the server (a number 0..1; a boolean of an older server; nothing = lit); not while the user is on it. */
		sync(state, on) {
			range.disabled = !on
			if (dragging || timer || performance.now() - touched < ECHO_MS) return
			show(on ? normHouse(state?.house) : 1)
		},
	}
}
