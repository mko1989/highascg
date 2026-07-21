'use strict'

/**
 * The pointer-confine watchdog captured the monitor geometry ONCE at startup and then warped the
 * pointer back inside that rect every 50ms. When the layout moved under it, that meant dragging the
 * pointer into coordinates where no monitor existed, 20 times a second — which presents as a dead
 * mouse, not as a fence.
 *
 * Observed live on this box: barriers built for DP-5 at 1920x1080+3072+0 while xrandr reported
 * DP-5 at +0+0. Owner: "my mouse is locked to a screen that doesnt exist yet. so i cant use the
 * operator gui."
 *
 * This drives the real warp_watchdog with stubbed X and xrandr rather than matching source text.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const HARNESS = path.join(ROOT, 'tools', 'smoke', 'fixtures', 'confine-watchdog-harness.py')
const SCRIPT = path.join(ROOT, 'tools', 'runtime', 'confine-pointer-barriers.py')

/** @returns {Array<Array<any>>} */
function runWatchdog() {
	const out = execFileSync('python3', [HARNESS, SCRIPT], { encoding: 'utf8', timeout: 20000 })
	const lastLine = out.trim().split('\n').pop()
	return JSON.parse(lastLine)
}

test('the watchdog follows the monitor when the layout moves', () => {
	const events = runWatchdog()

	const rebuilt = events.find((e) => e[0] === 'create')
	assert.ok(rebuilt, 'barriers must be rebuilt when the geometry changes')
	assert.deepEqual(
		rebuilt.slice(1),
		[0, 0, 1920, 1080],
		'rebuilt barriers must use the NEW rect (+0+0), not the startup rect (+3072+0)',
	)
	assert.ok(
		events.findIndex((e) => e[0] === 'destroy') < events.findIndex((e) => e[0] === 'create'),
		'the stale barriers must be destroyed before the new ones are created',
	)
})

test('the pointer is clamped to the CURRENT rect, not the startup rect', () => {
	const warps = runWatchdog().filter((e) => e[0] === 'warp')
	assert.ok(warps.length >= 2, 'expected a warp before and after the geometry change')

	const [, firstX] = warps[0]
	const [, lastX] = warps[warps.length - 1]
	assert.equal(firstX, 4991, 'before the move, clamps to the original rect (3072+1920-1)')
	assert.equal(
		lastX,
		1919,
		'after the move it must clamp to 0..1919 — clamping to 4991 is what dragged the pointer ' +
			'off-screen and made the mouse unusable',
	)
})

test('a vanished output releases the pointer instead of clamping to a stale rect', () => {
	/* The harness feeds geometry: original → moved → gone. Reaching the end without hanging proves
	 * warp_watchdog returned; if it kept clamping it would loop forever and hit the timeout. */
	const events = runWatchdog()
	const lastWarp = events.filter((e) => e[0] === 'warp').pop()
	assert.equal(lastWarp[1], 1919, 'it must not resume clamping to the stale rect before releasing')
})
