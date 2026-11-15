/* global window, document, navigator */
/**
 * Controls of Stage Skirmish (WO-1081 §9), merged into one reading per frame:
 *   { mx, mz }   move wish in the plan, screen-relative (screen-up = −Z, screen-right = +X), length ≤ 1
 *   aim          { yaw } (sticks) | { ndc: [x, y] } (mouse, the game turns it into a plan point) | null
 *   fire         held (every weapon refires at its interval while held)
 *   pick         a weapon id chosen by key 1–5 (null), cycle −1 / 0 / +1 (wheel, Q, the touch button, pad shoulders)
 *   board        the scoreboard key is held (Tab)
 * Keyboard + mouse: WASD / arrows move, the mouse aims, the left button fires. Touch (landscape, Pointer Events,
 * every finger on its own): a floating left stick moves, a floating right stick aims and fires while pushed past
 * FIRE_AT, a weapon-cycle button. Gamepad (standard mapping): left stick move, right stick aim, RT fire, LB / RB cycle.
 */

const STICK_PX = 64
export const FIRE_AT = 0.35
const DEAD = 0.15
const GAME_KEYS = new Set([
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'KeyW',
	'KeyA',
	'KeyS',
	'KeyD',
	'KeyQ',
	'Tab',
	'Space',
	'Digit1',
	'Digit2',
	'Digit3',
	'Digit4',
	'Digit5',
])

/** Stick vector from a drag (px) → [x, y] with length ≤ 1. */
export function stickVec(dx, dy, range = STICK_PX) {
	let x = dx / range
	let y = dy / range
	const l = Math.hypot(x, y)
	if (l > 1) {
		x /= l
		y /= l
	}
	return [x, y]
}

/**
 * @param {{ canvas: HTMLElement, moveZone?: HTMLElement, aimZone?: HTMLElement, weaponBtn?: HTMLElement,
 *   onKey?: (code: string) => void }} o
 */
export function createInput({ canvas, moveZone, aimZone, weaponBtn, onKey }) {
	const keys = new Set()
	const mouse = { ndc: null, down: false }
	const touch = { move: null, aim: null }
	let pickKey = null
	let cycle = 0
	let override = null // the dev hook (?dev=1 on 127.0.0.1 only)
	const off = []
	const on = (t, ev, fn, opt) => {
		t.addEventListener(ev, fn, opt)
		off.push(() => t.removeEventListener(ev, fn, opt))
	}
	const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')

	on(window, 'keydown', (e) => {
		if (typing(e)) return
		if (GAME_KEYS.has(e.code)) e.preventDefault()
		if (e.repeat) return
		keys.add(e.code)
		const d = /^Digit([1-5])$/.exec(e.code)
		if (d) pickKey = Number(d[1])
		else if (e.code === 'KeyQ') cycle = 1
		onKey?.(e.code)
	})
	on(window, 'keyup', (e) => keys.delete(e.code))
	on(window, 'blur', () => {
		keys.clear()
		mouse.down = false
	})

	/* ---------- mouse ---------- */
	if (canvas) {
		const toNdc = (e) => {
			const r = canvas.getBoundingClientRect()
			mouse.ndc = [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)]
		}
		on(canvas, 'pointermove', (e) => e.pointerType === 'mouse' && toNdc(e))
		on(canvas, 'pointerdown', (e) => {
			if (e.pointerType !== 'mouse') return
			toNdc(e)
			if (e.button === 0) mouse.down = true
			canvas.focus?.()
		})
		on(window, 'pointerup', (e) => e.pointerType === 'mouse' && e.button === 0 && (mouse.down = false))
		on(canvas, 'wheel', (e) => {
			e.preventDefault()
			cycle = e.deltaY > 0 ? 1 : -1
		}, { passive: false })
		on(canvas, 'contextmenu', (e) => e.preventDefault())
	}

	/* ---------- touch twin sticks (floating: the stick starts where the thumb lands) ---------- */
	function stickZone(zone, slot) {
		if (!zone) return
		const base = zone.querySelector('.stick-base')
		const knob = zone.querySelector('.stick-knob')
		const paint = (st) => {
			zone.classList.toggle('active', !!st)
			if (!st || !base) return
			base.style.transform = `translate(${st.x0.toFixed(0)}px, ${st.y0.toFixed(0)}px)`
			if (knob) knob.style.transform = `translate(${(st.v[0] * STICK_PX).toFixed(1)}px, ${(st.v[1] * STICK_PX).toFixed(1)}px)`
		}
		on(zone, 'pointerdown', (e) => {
			if (touch[slot]) return
			e.preventDefault()
			const r = zone.getBoundingClientRect()
			touch[slot] = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x0: e.clientX - r.left, y0: e.clientY - r.top, v: [0, 0] }
			zone.setPointerCapture?.(e.pointerId)
			paint(touch[slot])
		})
		on(zone, 'pointermove', (e) => {
			const st = touch[slot]
			if (!st || st.id !== e.pointerId) return
			st.v = stickVec(e.clientX - st.cx, e.clientY - st.cy)
			paint(st)
		})
		const end = (e) => {
			const st = touch[slot]
			if (!st || st.id !== e.pointerId) return
			touch[slot] = null
			paint(null)
		}
		on(zone, 'pointerup', end)
		on(zone, 'pointercancel', end)
		on(zone, 'lostpointercapture', end)
		on(zone, 'contextmenu', (e) => e.preventDefault())
	}
	stickZone(moveZone, 'move')
	stickZone(aimZone, 'aim')
	if (weaponBtn) {
		on(weaponBtn, 'pointerdown', (e) => {
			e.preventDefault()
			e.stopPropagation()
			cycle = 1
			weaponBtn.classList.add('active')
		})
		const up = () => weaponBtn.classList.remove('active')
		on(weaponBtn, 'pointerup', up)
		on(weaponBtn, 'pointercancel', up)
	}
	on(document, 'gesturestart', (e) => e.preventDefault())
	on(document, 'dblclick', (e) => e.preventDefault())

	/* ---------- gamepad ---------- */
	const held = { lb: false, rb: false, y: false }
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
			if (edge('rb', b(5).pressed) || edge('y', b(3).pressed)) cycle = 1
			const mv = Math.hypot(ax(0), ax(1)) > DEAD ? [ax(0), ax(1)] : [0, 0]
			const am = Math.hypot(ax(2), ax(3)) > DEAD * 2 ? [ax(2), ax(3)] : null
			return { mv, am, fire: b(7).value > 0.4 || b(0).pressed }
		}
		return null
	}

	/** The merged controls of this frame. */
	function read() {
		const k = (a, b) => keys.has(a) || keys.has(b)
		let mx = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0)
		let mz = (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0)
		let aim = mouse.ndc ? { ndc: mouse.ndc } : null
		let fire = mouse.down || keys.has('Space')
		if (touch.move) [mx, mz] = touch.move.v
		if (touch.aim) {
			const v = touch.aim.v
			const l = Math.hypot(v[0], v[1])
			if (l > 0.12) aim = { yaw: Math.atan2(-v[0], -v[1]) }
			fire = fire || l > FIRE_AT
		}
		const pad = readPad()
		if (pad) {
			if (pad.mv[0] || pad.mv[1]) [mx, mz] = pad.mv
			if (pad.am) aim = { yaw: Math.atan2(-pad.am[0], -pad.am[1]) }
			fire = fire || pad.fire
		}
		if (override) {
			if (override.mx != null) mx = override.mx
			if (override.mz != null) mz = override.mz
			if (override.yaw != null) aim = { yaw: override.yaw }
			if (override.fire != null) fire = !!override.fire
		}
		const l = Math.hypot(mx, mz)
		if (l > 1) {
			mx /= l
			mz /= l
		}
		const out = { mx, mz, aim, fire, pick: pickKey, cycle, board: keys.has('Tab') }
		pickKey = null
		cycle = 0
		return out
	}

	return {
		read,
		/** Dev hook only: { mx, mz, yaw, fire } overrides (null clears). */
		setOverride(o) {
			override = o || null
		},
		get touching() {
			return !!(touch.move || touch.aim)
		},
		destroy() {
			for (const f of off) f()
		},
	}
}
