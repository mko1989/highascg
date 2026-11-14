/* global window, document, navigator, DeviceOrientationEvent */
/**
 * Controls (WO-1074 v2): keyboard, touch (Pointer Events, multi-touch), Gamepad API and optional tilt — merged into
 * one input per frame: { throttle 0…1, brake 0…1, steer −1…1 (+ = LEFT), drift, use (true once per press) }.
 *  - keyboard: arrows / WASD, Shift or Space = drift, S / Down = brake / reverse, E or Ctrl = item, R respawn,
 *    C camera, M sound;
 *  - touch: left thumb steers (slider anywhere in the left zone); right thumb plays a 2 × 2 cluster — big GO bottom
 *    right, BRAKE left of it, DRIFT above GO, ITEM above BRAKE. A finger may slide between the zones; DRIFT and ITEM
 *    also hold the gas (one thumb drives, drifts and fires); ITEM fires when the finger enters it;
 *  - gamepad: left stick / d-pad steer, RT gas, LT brake, LB / RB drift, A / B / X item, Y respawn, Back camera.
 */

const STICK_RANGE_PX = 70
const DEADZONE = 0.12
const ZONE_SLOP_PX = 10

export function createInput({ stickEl, knobEl, zones = {}, onRespawn, onCamera, onMute }) {
	const keys = new Set()
	const touch = { steer: 0, gas: false, brake: false, drift: false }
	const tilt = { on: false, steer: 0, zero: null }
	let usePresses = 0
	const listeners = []
	const on = (target, ev, fn, opts) => {
		target.addEventListener(ev, fn, opts)
		listeners.push(() => target.removeEventListener(ev, fn, opts))
	}

	/* ---------- keyboard ---------- */
	const GAME_KEYS = new Set([
		'ArrowUp',
		'ArrowDown',
		'ArrowLeft',
		'ArrowRight',
		'Space',
		'KeyW',
		'KeyA',
		'KeyS',
		'KeyD',
		'KeyE',
		'ShiftLeft',
		'ShiftRight',
		'ControlLeft',
		'ControlRight',
	])
	on(window, 'keydown', (e) => {
		if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
		if (GAME_KEYS.has(e.code)) e.preventDefault()
		if (e.repeat) return
		keys.add(e.code)
		if (e.code === 'KeyR') onRespawn?.()
		else if (e.code === 'KeyC') onCamera?.()
		else if (e.code === 'KeyM') onMute?.()
		else if (e.code === 'KeyE' || e.code === 'ControlLeft' || e.code === 'ControlRight') usePresses++
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
			/* drag right = steer right = negative */
			touch.steer = -Math.max(-1, Math.min(1, (e.clientX - stickX0) / STICK_RANGE_PX))
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

	/* ---------- right-thumb cluster (each pointer may slide between the zones) ---------- */
	const ZONES = ['gas', 'brake', 'drift', 'item'].filter((z) => zones[z])
	const zonePointers = new Map() // pointerId → zone name | null
	const zoneAt = (x, y) => {
		for (const name of ZONES) {
			const r = zones[name].getBoundingClientRect()
			if (
				x >= r.left - ZONE_SLOP_PX &&
				x <= r.right + ZONE_SLOP_PX &&
				y >= r.top - ZONE_SLOP_PX &&
				y <= r.bottom + ZONE_SLOP_PX
			)
				return name
		}
		return null
	}
	const syncZones = () => {
		const vals = [...zonePointers.values()]
		touch.brake = vals.includes('brake')
		touch.drift = vals.includes('drift')
		/* drift and item keep the gas down: one thumb rolls from GO onto them without lifting */
		touch.gas = vals.includes('gas') || touch.drift || vals.includes('item')
		for (const name of ZONES) zones[name].classList.toggle('active', vals.includes(name))
		zones.gas?.classList.toggle('held', touch.gas)
	}
	const setZone = (id, z) => {
		const was = zonePointers.get(id)
		zonePointers.set(id, z)
		if (z === 'item' && was !== 'item') usePresses++
		syncZones()
	}
	for (const name of ZONES) {
		const el = zones[name]
		on(el, 'pointerdown', (e) => {
			e.preventDefault()
			el.setPointerCapture?.(e.pointerId)
			setZone(e.pointerId, zoneAt(e.clientX, e.clientY) || name)
		})
		on(el, 'pointermove', (e) => {
			if (!zonePointers.has(e.pointerId)) return
			const z = zoneAt(e.clientX, e.clientY)
			if (z !== zonePointers.get(e.pointerId)) setZone(e.pointerId, z)
		})
		const end = (e) => {
			if (!zonePointers.delete(e.pointerId)) return
			syncZones()
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
		/* landscape: beta is the steering-wheel axis; raising the left end at 90° = a right turn = negative steer */
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

	/* ---------- gamepad (standard mapping) ---------- */
	const held = { resp: false, cam: false, use: false }
	const edge = (name, now) => {
		const fire = now && !held[name]
		held[name] = now
		return fire
	}
	function readPad() {
		const pads = navigator.getGamepads ? navigator.getGamepads() : []
		for (const gp of pads || []) {
			if (!gp || !gp.connected) continue
			const ax = gp.axes[0] || 0
			const b = (i) => gp.buttons[i] || { value: 0, pressed: false }
			const steer = Math.abs(ax) > DEADZONE ? -ax : b(14).pressed ? 1 : b(15).pressed ? -1 : 0
			if (edge('resp', b(3).pressed)) onRespawn?.()
			if (edge('cam', b(8).pressed)) onCamera?.()
			if (edge('use', b(0).pressed || b(1).pressed || b(2).pressed)) usePresses++
			return {
				steer,
				gas: Math.max(b(7).value, b(12).pressed ? 1 : 0),
				brk: Math.max(b(6).value, b(13).pressed ? 1 : 0),
				drift: b(4).pressed || b(5).pressed,
			}
		}
		return null
	}

	/** Merged controls for this frame (`use` is true once per press). */
	function read() {
		const k = (a, b) => keys.has(a) || keys.has(b)
		let steer = (k('ArrowLeft', 'KeyA') ? 1 : 0) - (k('ArrowRight', 'KeyD') ? 1 : 0)
		let throttle = k('ArrowUp', 'KeyW') ? 1 : 0
		let brake = k('ArrowDown', 'KeyS') ? 1 : 0
		let drift = keys.has('Space') || k('ShiftLeft', 'ShiftRight')
		if (touch.steer) steer = touch.steer
		if (tilt.on && !touch.steer) steer = tilt.steer
		if (touch.gas) throttle = 1
		if (touch.brake) brake = 1
		drift = drift || touch.drift
		const pad = readPad()
		if (pad) {
			if (pad.steer) steer = pad.steer
			throttle = Math.max(throttle, pad.gas)
			brake = Math.max(brake, pad.brk)
			drift = drift || pad.drift
		}
		const use = usePresses > 0
		usePresses = 0
		return { throttle, brake, steer, drift, use }
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
