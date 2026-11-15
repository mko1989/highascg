'use strict'

/**
 * WO-1089 Stage Salad — browser client controls (modules/stage-salad/client/aim-input.js pure + input.js on fake DOM
 * targets; contract work/notes/stage-salad-contract.md §9 / §11):
 *  - drag → aim: down = pull (stretch = power 0.15…1), sideways = yaw (pull LEFT aims RIGHT: yaw − ), sizes scale with
 *    the view and are clamped; the yaw offset never leaves ±54° (the server refuses beyond ±55°), the launch pitch never
 *    leaves −10°…70° (the server's range), the pitch offset stays in its own band;
 *  - a tiny drag (< CANCEL_PX down) cancels — no shot; Esc / blur drop a pull; `fire false` always cancels;
 *  - keyboard: ← → turn (+ = left), ↑ ↓ pitch, hold Space pulls at PULL_RATE and its release fires; 1–6 pick, Q / E
 *    cycle, Tab = board; a pull only starts while canPull() (safe pause / countdown / no slot → nothing);
 *  - gamepad (standard mapping): RT pulls, release fires, LB / RB cycle (edge-triggered), stick dead zone.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const DIR = path.join(__dirname, '..', '..', 'modules', 'stage-salad', 'client')
const load = (f) => import(pathToFileURL(path.join(DIR, f)).href)

let A, V
const DEG = Math.PI / 180
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

before(async () => {
	A = await load('aim-input.js')
	V = await load('veggies.js')
})

describe('WO-1089 Salad client: aim maths (pure)', () => {
	it('drag sizes scale with the view and are clamped', () => {
		assert.equal(A.pullPx(500), 210)
		assert.equal(A.pullPx(100), 110)
		assert.equal(A.pullPx(4000), 320)
		assert.equal(A.yawPx(1000), 600)
		assert.equal(A.yawPx(100), 240)
		assert.equal(A.yawPx(9999), 900)
	})

	it('drag down = pull, sideways = yaw (pull left aims right), clamped; tiny drags cancel', () => {
		const view = { w: 1000, h: 500 } // pull 210 px, yaw 600 px
		let r = A.dragAim(0, 105, 0, view)
		assert.ok(near(r.pull, 0.5))
		assert.equal(r.cancel, false)
		assert.equal(r.yawOff, 0)
		r = A.dragAim(-300, 400, 0, view)
		assert.equal(r.pull, 1, 'pull clamped')
		assert.ok(near(r.yawOff, -A.YAW_LIMIT / 2), 'left drag → negative yaw (turns right)')
		r = A.dragAim(5000, 50, 0, view)
		assert.ok(near(r.yawOff, A.YAW_LIMIT), 'yaw clamped')
		r = A.dragAim(0, -80, 0, view)
		assert.equal(r.pull, 0)
		assert.equal(r.cancel, true, 'drag up = no shot')
		assert.equal(A.dragAim(0, A.CANCEL_PX - 1, 0, view).cancel, true)
		assert.equal(A.dragAim(0, A.CANCEL_PX, 0, view).cancel, false)
		assert.ok(A.YAW_LIMIT < 55 * DEG, 'inside the server limit')
	})

	it('pull → power 0.15…1; clampYaw / pitchOf keep the server ranges', () => {
		assert.equal(A.powerOf(0), V.POWER_MIN)
		assert.equal(A.powerOf(1), 1)
		assert.ok(near(A.powerOf(0.5), V.POWER_MIN + 0.5 * (1 - V.POWER_MIN)))
		assert.equal(A.powerOf(7), 1)
		assert.equal(A.powerOf(-1), V.POWER_MIN)
		assert.ok(near(A.clampYaw(3, 1), 1 + A.YAW_LIMIT))
		assert.ok(near(A.clampYaw(-0.5, 1), 1 - A.YAW_LIMIT))
		assert.ok(near(A.clampYaw(1.3, 1), 1.3), 'inside the limit: unchanged')
		assert.ok(near(A.clampYaw(Math.PI - 0.1, -Math.PI + 0.1), -Math.PI + 0.1 - 0.2), 'wraps across ±π')
		for (const id of V.VEG_IDS)
			for (const off of [-1, A.PITCH_OFF[0], 0, A.PITCH_OFF[1], 1]) {
				const p = A.pitchOf(V.VEGGIES[id], off)
				assert.ok(p >= -10 * DEG - 1e-12 && p <= 70 * DEG + 1e-12, `${id} ${off}`)
			}
		assert.ok(near(A.pitchOf(V.VEGGIES.tomato, 0), 22 * DEG))
		assert.equal(A.clampPitchOff(1), A.PITCH_OFF[1])
		assert.equal(A.clampPitchOff('x'), 0)
	})

	it('AimState: press / move / release; cancel; keys only nudge when not dragging', () => {
		const s = new A.AimState()
		const view = { w: 1000, h: 500 }
		assert.equal(s.press(100, 100), true)
		assert.equal(s.press(0, 0), false, 'one pull at a time')
		s.move(40, 110, view)
		assert.equal(s.cancel, true)
		assert.equal(s.release(true).fire, false, 'tiny drag cancels')
		s.press(100, 100)
		s.move(-200, 205, view)
		s.nudge(1, 1, 1)
		assert.ok(near(s.yawOff, ((-60 - 300) / 600) * A.YAW_LIMIT), 'the yaw adds up from the last aim; keys do not touch it while dragging')
		const out = s.release(true)
		assert.equal(out.fire, true)
		assert.ok(near(out.pull, 0.5))
		assert.equal(s.pull, 0)
		assert.equal(s.source, null)
		s.press(0, 0)
		s.move(0, 300, view)
		assert.equal(s.release(false).fire, false, 'fire false always cancels')
		s.nudge(1, 0, 10)
		assert.ok(near(s.yawOff, A.YAW_LIMIT))
		s.nudge(0, -1, 100)
		assert.equal(s.pitchOff, A.PITCH_OFF[0])
		s.pitchStep(1)
		assert.ok(near(s.pitchOff, A.PITCH_OFF[0] + A.WHEEL_STEP))
		const a = s.aim(0.5, V.VEGGIES.carrot)
		assert.ok(near(a.yaw, 0.5 + A.YAW_LIMIT))
		assert.equal(a.power, V.POWER_MIN)
	})

	it('hold to pull grows at PULL_RATE, release fires, a too-short hold cancels', () => {
		const s = new A.AimState()
		assert.equal(s.hold('key', true, 0.02), null)
		assert.equal(s.source, 'key')
		assert.equal(s.hold('key', false, 0.016).fire, false, 'a tap is no shot')
		s.hold('key', true, 0.5)
		assert.equal(s.hold('pad', true, 0.5), null, 'the pad cannot steal a key pull')
		assert.ok(near(s.pull, 0.5 * A.PULL_RATE))
		s.hold('key', true, 5)
		assert.equal(s.pull, 1)
		const r = s.hold('key', false, 0.016)
		assert.equal(r.fire, true)
		assert.equal(r.pull, 1)
	})
})

/* ---------- input.js on fake DOM targets ---------- */
function target() {
	const ls = new Map()
	return {
		addEventListener: (t, f) => (ls.get(t) || ls.set(t, []).get(t)).push(f),
		removeEventListener: (t, f) => ls.set(t, (ls.get(t) || []).filter((x) => x !== f)),
		emit(t, e = {}) {
			const ev = { preventDefault() {}, stopPropagation() {}, ...e }
			for (const f of ls.get(t) || []) f(ev)
			return ev
		},
		count: () => [...ls.values()].reduce((n, a) => n + a.length, 0),
	}
}

describe('WO-1089 Salad client: input.js (fake DOM)', () => {
	let I
	const pads = []
	const win = Object.assign(target(), { innerWidth: 1000, innerHeight: 500 })
	const doc = target()
	before(async () => {
		globalThis.window = win
		globalThis.document = doc
		Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true, writable: true })
		I = await load('input.js')
	})

	it('pointer drag → release fires with the pull; a tiny drag does not; no pull while canPull() is false', () => {
		let ok = true
		const canvas = Object.assign(target(), { setPointerCapture() {}, focus() {} })
		const inp = I.createInput({ canvas, canPull: () => ok })
		canvas.emit('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 500, clientY: 200 })
		assert.equal(inp.pulling, true)
		canvas.emit('pointermove', { pointerId: 2, clientX: 0, clientY: 499 })
		assert.equal(inp.aim.pull, 0, 'another finger is ignored')
		canvas.emit('pointermove', { pointerId: 1, clientX: 380, clientY: 305 })
		assert.ok(near(inp.aim.pull, 0.5))
		assert.ok(inp.aim.yawOff < 0, 'pulled left → aims right')
		canvas.emit('pointerup', { pointerId: 1 })
		const t = inp.tick(0.016)
		assert.equal(t.release.fire, true)
		assert.ok(near(t.release.pull, 0.5))
		assert.equal(inp.tick(0.016).release, null, 'reported once')
		canvas.emit('pointerdown', { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 })
		canvas.emit('pointermove', { pointerId: 3, clientX: 10, clientY: 20 })
		canvas.emit('pointerup', { pointerId: 3 })
		assert.equal(inp.tick(0.016).release.fire, false, 'tiny drag = cancel')
		canvas.emit('pointerdown', { pointerId: 4, pointerType: 'mouse', button: 2, clientX: 10, clientY: 10 })
		assert.equal(inp.pulling, false, 'right button ignored')
		ok = false
		canvas.emit('pointerdown', { pointerId: 5, pointerType: 'touch', clientX: 10, clientY: 10 })
		assert.equal(inp.pulling, false, 'paused: no pull')
		inp.destroy()
		assert.equal(canvas.count(), 0, 'listeners removed')
	})

	it('a pull dropped by a pause never fires; Esc and blur drop a pull', () => {
		let ok = true
		const canvas = Object.assign(target(), { setPointerCapture() {}, focus() {} })
		const inp = I.createInput({ canvas, canPull: () => ok })
		canvas.emit('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 })
		canvas.emit('pointermove', { pointerId: 1, clientX: 0, clientY: 300 })
		inp.cancel()
		canvas.emit('pointerup', { pointerId: 1 })
		assert.equal(inp.tick(0.016).release, null)
		win.emit('keydown', { code: 'Space' })
		inp.tick(0.5)
		assert.equal(inp.pulling, true)
		win.emit('keydown', { code: 'Escape' })
		win.emit('keyup', { code: 'Space' })
		assert.equal(inp.tick(0.016).release, null, 'Esc dropped it')
		win.emit('keydown', { code: 'Space' })
		inp.tick(0.3)
		win.emit('blur')
		assert.equal(inp.pulling, false)
		ok = false
		win.emit('keydown', { code: 'Space' })
		inp.tick(0.5)
		assert.equal(inp.pulling, false, 'no key pull while paused')
		win.emit('keyup', { code: 'Space' })
		inp.destroy()
	})

	it('keyboard: Space pull + release fires, arrows aim, digits pick, Q / E cycle, Tab board; typing ignored', () => {
		const canvas = Object.assign(target(), { setPointerCapture() {}, focus() {} })
		const keys = []
		const inp = I.createInput({ canvas, canPull: () => true, onKey: (c) => keys.push(c) })
		win.emit('keydown', { code: 'ArrowLeft' })
		inp.tick(0.5)
		win.emit('keyup', { code: 'ArrowLeft' })
		assert.ok(near(inp.aim.yawOff, 0.5 * A.KEY_YAW_RATE), '← turns left (+)')
		win.emit('keydown', { code: 'KeyW' })
		inp.tick(0.5)
		win.emit('keyup', { code: 'KeyW' })
		assert.ok(near(inp.aim.pitchOff, 0.5 * A.KEY_PITCH_RATE))
		win.emit('keydown', { code: 'Space' })
		inp.tick(0.6)
		const held = win.emit('keydown', { code: 'Space', repeat: true })
		assert.ok(held)
		win.emit('keyup', { code: 'Space' })
		const t = inp.tick(0.016)
		assert.equal(t.release.fire, true)
		assert.ok(near(t.release.pull, 0.6 * A.PULL_RATE, 1e-6))
		win.emit('keydown', { code: 'Digit4' })
		assert.equal(inp.tick(0.016).pick, 3)
		win.emit('keydown', { code: 'KeyE' })
		assert.equal(inp.tick(0.016).cycle, 1)
		win.emit('keydown', { code: 'KeyQ' })
		assert.equal(inp.tick(0.016).cycle, -1)
		win.emit('keydown', { code: 'Tab' })
		assert.equal(inp.tick(0.016).board, true)
		win.emit('keyup', { code: 'Tab' })
		win.emit('keydown', { code: 'Digit2', target: { tagName: 'INPUT' } })
		assert.equal(inp.tick(0.016).pick, null, 'typing a name is not a pick')
		win.emit('keydown', { code: 'KeyM' })
		assert.ok(keys.includes('KeyM'))
		inp.destroy()
	})

	it('gamepad: RT pull + release fires, LB / RB cycle on the press edge, stick dead zone', () => {
		const canvas = Object.assign(target(), { setPointerCapture() {}, focus() {} })
		const inp = I.createInput({ canvas, canPull: () => true })
		const btn = (pressed, value = pressed ? 1 : 0) => ({ pressed, value })
		const pad = { connected: true, axes: [0.1, 0], buttons: Array.from({ length: 16 }, () => btn(false)) }
		pads.push(pad)
		inp.tick(1)
		assert.equal(inp.aim.yawOff, 0, 'dead zone')
		pad.buttons[7] = btn(true)
		inp.tick(0.5)
		assert.equal(inp.pulling, true)
		pad.buttons[7] = btn(false)
		assert.equal(inp.tick(0.016).release.fire, true)
		pad.buttons[5] = btn(true)
		assert.equal(inp.tick(0.016).cycle, 1)
		assert.equal(inp.tick(0.016).cycle, 0, 'held RB = one step')
		pad.buttons[5] = btn(false)
		pad.buttons[4] = btn(true)
		assert.equal(inp.tick(0.016).cycle, -1)
		pad.axes[0] = -1
		inp.tick(0.5)
		assert.ok(near(inp.aim.yawOff, 0.5 * A.KEY_YAW_RATE), 'stick left turns left')
		pads.length = 0
		inp.destroy()
	})
})
