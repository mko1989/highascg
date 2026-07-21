'use strict'

/**
 * WO-313: `window.onresize = () => renderCableOverlay(...)` in device-view-events.js was
 * unthrottled. The Verlet rope cache (device-view-cables-physics.js) is keyed on exact pixel
 * coordinates, so a resize drag invalidates every cable and re-runs the full simulation on
 * every resize event — dozens per second — while the pointermove handler ~70 lines below was
 * already rAF-gated.
 *
 * These tests import the REAL client/lib/raf-throttle.js (dynamic import: client/ is ESM, this
 * runner is CJS) rather than re-declaring the throttle locally — a local copy would pass even
 * with the production fix fully reverted.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const repoFile = (rel) => path.join(__dirname, '../..', rel)
const importClient = (rel) => import('file://' + repoFile(rel))

test('rafThrottle: a burst within one frame schedules exactly one frame and fires once', async () => {
	const { rafThrottle } = await importClient('client/lib/raf-throttle.js')
	/** @type {Array<() => void>} */
	const frames = []
	let ran = 0
	const trigger = rafThrottle(
		() => ran++,
		(cb) => frames.push(cb),
	)

	trigger()
	trigger()
	trigger()
	assert.equal(frames.length, 1, 'three calls in one frame must schedule one frame callback')
	assert.equal(ran, 0, 'work must not run on the leading edge')

	frames[0]()
	assert.equal(ran, 1, 'the frame callback runs the work exactly once')
})

test('rafThrottle: re-arms after the frame fires, so a later burst still renders', async () => {
	const { rafThrottle } = await importClient('client/lib/raf-throttle.js')
	const frames = []
	let ran = 0
	const trigger = rafThrottle(
		() => ran++,
		(cb) => frames.push(cb),
	)

	trigger()
	frames[0]()
	assert.equal(ran, 1)

	trigger()
	assert.equal(frames.length, 2, 'a call after the frame fired must schedule a new frame')
	frames[1]()
	assert.equal(ran, 2)
})

test('rafThrottle: the trailing call sees the LAST state of the burst, not the first', async () => {
	const { rafThrottle } = await importClient('client/lib/raf-throttle.js')
	const frames = []
	let width = 0
	let rendered = null
	const trigger = rafThrottle(
		() => (rendered = width),
		(cb) => frames.push(cb),
	)

	// Simulates a resize drag: geometry keeps changing inside a single frame.
	width = 1000
	trigger()
	width = 1400
	trigger()
	width = 1920
	trigger()
	frames[0]()

	assert.equal(rendered, 1920, 'render must use the final geometry of the burst')
})

test('rafThrottle: defaults to the real requestAnimationFrame when none is injected', async () => {
	const { rafThrottle } = await importClient('client/lib/raf-throttle.js')
	const original = globalThis.requestAnimationFrame
	let sawDefault = false
	globalThis.requestAnimationFrame = (cb) => {
		sawDefault = true
		cb()
	}
	try {
		let ran = 0
		rafThrottle(() => ran++)()
		assert.ok(sawDefault, 'no injected scheduler => global requestAnimationFrame is used')
		assert.equal(ran, 1)
	} finally {
		globalThis.requestAnimationFrame = original
	}
})

test('wiring: device-view-events.js routes the resize handler through rafThrottle', () => {
	const src = fs.readFileSync(repoFile('client/components/device-view-events.js'), 'utf8')
	assert.match(src, /import \{ rafThrottle \} from '\.\.\/lib\/raf-throttle\.js'/)
	assert.match(
		src,
		/window\.onresize\s*=\s*rafThrottle\(/,
		'the resize handler must be throttled, not call renderCableOverlay directly',
	)
	assert.doesNotMatch(
		src,
		/window\.onresize\s*=\s*\(\)\s*=>\s*renderCableOverlay/,
		'the unthrottled WO-313 form must not come back',
	)
})
