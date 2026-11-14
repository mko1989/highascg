/* global window, document, navigator, DeviceOrientationEvent */
/**
 * Controls (WO-1074): keyboard (arrows / WASD, space = handbrake, R = respawn, C = camera), touch (left thumb steering
 * slider with a knob, right thumb gas + brake/reverse pedals, multi-touch via Pointer Events), Gamepad API, and an
 * optional tilt-to-steer (DeviceOrientation, with the iOS permission prompt). All merge into one input object:
 * { throttle 0…1, brake 0…1, steer −1…1 (+ = LEFT), hand }.
 */

const STICK_RANGE_PX = 70
const DEADZONE = 0.12

export function createInput({ stickEl, knobEl, gasEl, brakeEl, onRespawn, onCamera, onMute }) {
	const keys = new Set()
	const touch = { steer: 0, gas: false, brake: false }
	const tilt = { on: false, steer: 0, zero: null }
	const listeners = []
	const on = (target, ev, fn, opts) => {
		target.addEventListener(ev, fn, opts)
		listeners.push(() => target.removeEventListener(ev, fn, opts))
	}

	/* ---------- keyboard ---------- */
	const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'])
	on(window, 'keydown', (e) => {
		if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
		if (GAME_KEYS.has(e.code)) e.preventDefault()
		if (e.repeat) return
		keys.add(e.code)
		if (e.code === 'KeyR') onRespawn?.()
		else if (e.code === 'KeyC') onCamera?.()
		else if (e.code === 'KeyM') onMute?.()
	})
	on(window, 'keyup', (e) => keys.delete(e.code))
	on(window, 'blur', () => keys.clear())

	/* ---------- touch steering slider ---------- */
	let stickPointer = null
	let stickX0 = 0
	const setKnob = (v) => {
		if (knobEl) knobEl.style.transform = `translateX(${(-v * STICK_RANGE_PX).toFixed(1)}px)`
	}
	if (stickEl) {
		on(stickEl, 'pointerdown', (e) => {
			if (stickPointer != null) return
			e.preventDefault()
			stickPointer = e.pointerId
			stickX0 = e.clientX
			stickEl.setPointerCapture?.(e.pointerId)
			stickEl.classList.add('active')
		})
		on(stickEl, 'pointermove', (e) => {
			if (e.pointerId !== stickPointer) return
			const dx = (e.clientX - stickX0) / STICK_RANGE_PX
			/* drag right = steer right = negative */
			touch.steer = -Math.max(-1, Math.min(1, dx))
			setKnob(touch.steer)
		})
		const end = (e) => {
			if (e.pointerId !== stickPointer) return
			stickPointer = null
			touch.steer = 0
			setKnob(0)
			stickEl.classList.remove('active')
		}
		on(stickEl, 'pointerup', end)
		on(stickEl, 'pointercancel', end)
		on(stickEl, 'lostpointercapture', end)
	}

	/* ---------- pedals (each pointer may slide between gas and brake) ---------- */
	const pedalPointers = new Map() // pointerId → 'gas' | 'brake' | null
	const pedalAt = (x, y) => {
		for (const [name, el] of [
			['gas', gasEl],
			['brake', brakeEl],
		]) {
			const r = el?.getBoundingClientRect()
			if (r && x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 12 && y <= r.bottom + 12) return name
		}
		return null
	}
	const syncPedals = () => {
		const vals = [...pedalPointers.values()]
		touch.gas = vals.includes('gas')
		touch.brake = vals.includes('brake')
		gasEl?.classList.toggle('active', touch.gas)
		brakeEl?.classList.toggle('active', touch.brake)
	}
	for (const el of [gasEl, brakeEl]) {
		if (!el) continue
		on(el, 'pointerdown', (e) => {
			e.preventDefault()
			el.setPointerCapture?.(e.pointerId)
			pedalPointers.set(e.pointerId, pedalAt(e.clientX, e.clientY) || (el === gasEl ? 'gas' : 'brake'))
			syncPedals()
		})
		on(el, 'pointermove', (e) => {
			if (!pedalPointers.has(e.pointerId)) return
			pedalPointers.set(e.pointerId, pedalAt(e.clientX, e.clientY))
			syncPedals()
		})
		const end = (e) => {
			if (!pedalPointers.delete(e.pointerId)) return
			syncPedals()
		}
		on(el, 'pointerup', end)
		on(el, 'pointercancel', end)
		on(el, 'lostpointercapture', end)
		on(el, 'contextmenu', (e) => e.preventDefault())
	}

	/* iOS: no pinch / double-tap zoom on the game surface */
	on(document, 'gesturestart', (e) => e.preventDefault())
	on(document, 'dblclick', (e) => e.preventDefault())

	/* ---------- tilt ---------- */
	const onOrient = (e) => {
		if (e.beta == null) return
		const angle = window.screen?.orientation?.angle ?? window.orientation ?? 90
		if (tilt.zero == null) tilt.zero = e.beta
		/* landscape: the device's beta axis is the steering-wheel axis; raising the left end (top on the left at 90°)
		 * gives positive beta = a right turn = negative steer */
		const sign = angle === 90 ? -1 : 1
		tilt.steer = Math.max(-1, Math.min(1, (sign * (e.beta - tilt.zero)) / 22))
	}
	async function setTilt(want) {
		if (!want) {
			tilt.on = false
			tilt.steer = 0
			window.removeEventListener('deviceorientation', onOrient)
			return false
		}
		if (typeof DeviceOrientationEvent === 'undefined') return false
		try {
			if (typeof DeviceOrientationEvent.requestPermission === 'function') {
				const res = await DeviceOrientationEvent.requestPermission()
				if (res !== 'granted') return false
			}
		} catch {
			return false
		}
		tilt.zero = null
		tilt.on = true
		window.addEventListener('deviceorientation', onOrient)
		return true
	}

	/* ---------- gamepad ---------- */
	let padRespawnHeld = false
	let padCamHeld = false
	function readPad() {
		const pads = navigator.getGamepads ? navigator.getGamepads() : []
		for (const gp of pads || []) {
			if (!gp || !gp.connected) continue
			const ax = gp.axes[0] || 0
			const b = (i) => gp.buttons[i] || { value: 0, pressed: false }
			const steer = Math.abs(ax) > DEADZONE ? -ax : b(14).pressed ? 1 : b(15).pressed ? -1 : 0
			const gas = Math.max(b(7).value, b(0).pressed ? 1 : 0, b(12).pressed ? 1 : 0)
			const brk = Math.max(b(6).value, b(2).pressed ? 1 : 0, b(13).pressed ? 1 : 0)
			const resp = b(3).pressed
			if (resp && !padRespawnHeld) onRespawn?.()
			padRespawnHeld = resp
			const cam = b(5).pressed
			if (cam && !padCamHeld) onCamera?.()
			padCamHeld = cam
			return { steer, gas, brk, hand: b(1).pressed }
		}
		return null
	}

	/** Merged controls for this frame. */
	function read() {
		const k = (a, b) => keys.has(a) || keys.has(b)
		let steer = (k('ArrowLeft', 'KeyA') ? 1 : 0) - (k('ArrowRight', 'KeyD') ? 1 : 0)
		let throttle = k('ArrowUp', 'KeyW') ? 1 : 0
		let brake = k('ArrowDown', 'KeyS') ? 1 : 0
		let hand = keys.has('Space')
		if (touch.steer) steer = touch.steer
		if (tilt.on && !touch.steer) steer = tilt.steer
		if (touch.gas) throttle = 1
		if (touch.brake) brake = 1
		const pad = readPad()
		if (pad) {
			if (pad.steer) steer = pad.steer
			throttle = Math.max(throttle, pad.gas)
			brake = Math.max(brake, pad.brk)
			hand = hand || pad.hand
		}
		return { throttle, brake, steer, hand }
	}

	function destroy() {
		for (const off of listeners) off()
		setTilt(false)
	}
	return {
		read,
		setTilt,
		destroy,
		get tiltOn() {
			return tilt.on
		},
	}
}
