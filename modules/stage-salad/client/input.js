/* global window, document, navigator */
/**
 * Controls of Stage Salad (WO-1089 §11) — DOM, keyboard and gamepad into the pure aim-input.js AimState.
 *   touch / mouse: press anywhere on the view, drag down to pull (stretch = power), sideways to aim (pull left aims
 *     right), release fires; a tiny drag cancels; the wheel tilts the pitch.
 *   keyboard: ← → aim, ↑ ↓ / W S pitch, hold Space to pull and release to fire, 1–6 pick a vegetable, Q / E cycle,
 *     Esc drops a pull, Tab shows the scores, M sound.
 *   gamepad (standard mapping): left stick aim / pitch, hold RT to pull and release to fire, LB / RB cycle.
 * Each frame tick(dt) → { release: { fire, pull } | null, pick: index | null, cycle: −1 | 0 | 1, board }.
 */
import { AimState } from './aim-input.js'

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyQ', 'KeyE', 'Space', 'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'])
const DEAD = 0.18

/**
 * @param {{ canvas: HTMLElement, canPull: () => boolean, onKey?: (code: string) => void }} o
 */
export function createInput({ canvas, canPull, onKey }) {
	const aim = new AimState()
	const keys = new Set()
	const off = []
	let pick = null
	let cycle = 0
	let release = null
	let pointer = null
	const on = (t, ev, fn, opt) => {
		t.addEventListener(ev, fn, opt)
		off.push(() => t.removeEventListener(ev, fn, opt))
	}
	const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')
	const view = () => ({ w: window.innerWidth, h: window.innerHeight })

	on(window, 'keydown', (e) => {
		if (typing(e)) return
		if (GAME_KEYS.has(e.code)) e.preventDefault()
		if (e.repeat) return
		keys.add(e.code)
		const d = /^Digit([1-6])$/.exec(e.code)
		if (d) pick = Number(d[1]) - 1
		else if (e.code === 'KeyQ') cycle = -1
		else if (e.code === 'KeyE') cycle = 1
		else if (e.code === 'Escape' && aim.source) aim.release(false)
		onKey?.(e.code)
	})
	on(window, 'keyup', (e) => keys.delete(e.code))
	on(window, 'blur', () => {
		keys.clear()
		if (aim.source) aim.release(false)
		pointer = null
	})

	/* ---------- pointer: drag anywhere on the view ---------- */
	on(canvas, 'pointerdown', (e) => {
		if (pointer != null || (e.pointerType === 'mouse' && e.button !== 0)) return
		if (!canPull()) return
		e.preventDefault()
		if (!aim.press(e.clientX, e.clientY)) return
		pointer = e.pointerId
		canvas.setPointerCapture?.(e.pointerId)
		canvas.focus?.()
	})
	on(canvas, 'pointermove', (e) => {
		if (e.pointerId !== pointer) return
		aim.move(e.clientX, e.clientY, view())
	})
	const end = (fire) => (e) => {
		if (e.pointerId !== pointer) return
		pointer = null
		if (aim.source === 'drag') release = aim.release(fire)
	}
	on(canvas, 'pointerup', end(true))
	on(canvas, 'pointercancel', end(false))
	on(canvas, 'lostpointercapture', (e) => {
		if (e.pointerId === pointer) end(true)(e)
	})
	on(
		canvas,
		'wheel',
		(e) => {
			e.preventDefault()
			aim.pitchStep(e.deltaY > 0 ? -1 : 1)
		},
		{ passive: false }
	)
	on(canvas, 'contextmenu', (e) => e.preventDefault())
	on(document, 'gesturestart', (e) => e.preventDefault())
	on(document, 'dblclick', (e) => e.preventDefault())

	/* ---------- gamepad ---------- */
	const held = { lb: false, rb: false }
	const edge = (k, now) => {
		const f = now && !held[k]
		held[k] = now
		return f
	}
	function readPad() {
		const pads = navigator.getGamepads ? navigator.getGamepads() : []
		for (const gp of pads || []) {
			if (!gp || !gp.connected) continue
			const ax = (i) => gp.axes[i] || 0
			const b = (i) => gp.buttons[i] || { value: 0, pressed: false }
			if (edge('lb', b(4).pressed)) cycle = -1
			if (edge('rb', b(5).pressed)) cycle = 1
			const x = Math.abs(ax(0)) > DEAD ? ax(0) : 0
			const y = Math.abs(ax(1)) > DEAD ? ax(1) : 0
			return { x, y, pull: b(7).value > 0.4 || b(7).pressed }
		}
		return null
	}

	/** This frame's controls (keyboard / pad nudges applied to the aim). */
	function tick(dt) {
		const k = (a, b) => keys.has(a) || keys.has(b)
		const turn = (k('ArrowLeft', 'KeyA') ? 1 : 0) - (k('ArrowRight', 'KeyD') ? 1 : 0)
		const tilt = (k('ArrowUp', 'KeyW') ? 1 : 0) - (k('ArrowDown', 'KeyS') ? 1 : 0)
		aim.nudge(turn, tilt, dt)
		const ok = canPull()
		const r1 = aim.hold('key', keys.has('Space') && (ok || aim.source === 'key'), dt)
		const pad = readPad()
		let r2 = null
		if (pad) {
			aim.nudge(-pad.x, -pad.y, dt)
			r2 = aim.hold('pad', pad.pull && (ok || aim.source === 'pad'), dt)
		}
		if (!ok && aim.source === 'drag' && pointer == null) aim.release(false)
		const out = { release: release || r1 || r2, pick, cycle, board: keys.has('Tab') }
		release = null
		pick = null
		cycle = 0
		return out
	}

	return {
		aim,
		tick,
		/** Drop a pull in progress (phase change, pause). */
		cancel() {
			if (aim.source) aim.release(false)
			pointer = null
		},
		get pulling() {
			return !!aim.source
		},
		destroy() {
			for (const f of off) f()
		},
	}
}
