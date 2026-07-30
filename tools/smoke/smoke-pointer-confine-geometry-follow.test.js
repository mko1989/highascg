'use strict'

/**
 * Pointer confine: the fence must FOLLOW the monitor, and must never poll the cursor.
 *
 * History this guards, in order:
 *
 * 1. The watchdog captured the monitor geometry ONCE at startup and then warped the pointer back
 *    inside that rect every 50ms. When the layout moved under it, that meant dragging the pointer
 *    into coordinates where no monitor existed, 20 times a second — which presents as a dead mouse,
 *    not as a fence. Observed live on this box: barriers built for DP-5 at 1920x1080+3072+0 while
 *    xrandr reported DP-5 at +0+0. Owner: "my mouse is locked to a screen that doesnt exist yet. so
 *    i cant use the operator gui."
 *
 * 2. WO-391 — the warp poll is GONE. Instrumenting it showed the only escape it ever caught was
 *    (1919,0): one pixel out at exactly y=0, i.e. the barrier segments merely TOUCHING at their
 *    corner endpoints — not the "NVIDIA slips past barriers" quirk it was written for. The corners
 *    are now overlapped in create_edge_barriers and the X server enforces the fence by itself.
 *    Owner: "i dont like that mouse cursor poll loop at all … i dont see the need for that at all."
 *
 * The geometry-follow assertions are therefore unchanged, and the old pointer-clamping assertions
 * are replaced by their inverse: touching the cursor at all is now the regression.
 *
 * Drives the real barrier_maintenance_loop with stubbed X and xrandr, not source-text matching —
 * except the two guards that deliberately DO read the source, because "this code no longer exists"
 * is exactly the property being pinned.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
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

test('the fence follows the monitor when the layout moves', () => {
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

test('WO-391: the loop NEVER reads or moves the cursor', () => {
	const events = runWatchdog()

	assert.deepEqual(
		events.filter((e) => e[0] === 'warp'),
		[],
		'XWarpPointer must never be called — XFixes barriers are enforced by the X server, and the ' +
			'one "escape" that justified warping was the corner-endpoint gap, fixed in create_edge_barriers',
	)
	assert.deepEqual(
		events.filter((e) => e[0] === 'query_pointer'),
		[],
		'the cursor position must never be polled — reintroducing a poll loop is the regression this guards',
	)
})

test('WO-391: no pointer-poking code survives in the script', () => {
	const src = fs.readFileSync(SCRIPT, 'utf8')
	/* Strip docstrings and comments so the historical explanation in the prose does not trip this. */
	const code = src
		.replace(/"""[\s\S]*?"""/g, '')
		.split('\n')
		.filter((l) => !l.trim().startsWith('#'))
		.join('\n')
	for (const banned of ['XWarpPointer', 'XQueryPointer', 'def query_pointer']) {
		assert.ok(
			!code.includes(banned),
			`${banned} must not reappear in executable code — see WO-391 (if the fence ever leaks, ` +
				'the answer is XFixesSelectBarrierInput barrier events, not a poll loop)',
		)
	}
})

test('a vanished output releases instead of holding a stale fence', () => {
	/* The harness feeds geometry: original → moved → gone. Reaching the end without hanging proves
	 * barrier_maintenance_loop returned; if it kept looping it would hit the execFileSync timeout. */
	const events = runWatchdog()
	assert.ok(
		events.some((e) => e[0] === 'create'),
		'sanity: the loop ran far enough to rebuild once before the output vanished',
	)
	assert.equal(
		events.filter((e) => e[0] === 'warp').length,
		0,
		'releasing must not involve moving the pointer anywhere',
	)
})

test('WO-391: barrier corners are sealed by overlapping the segments', () => {
	const src = fs.readFileSync(SCRIPT, 'utf8')
	const m = src.match(/CORNER_OVERLAP_PX\s*=\s*(\d+)/)
	assert.ok(m, 'the corner overlap must be a named constant so it is reviewable')
	assert.ok(parseInt(m[1], 10) >= 1, 'overlap must be at least 1px or the corner endpoints still touch')

	/* Each edge must extend past BOTH perpendicular edges — the vertical pair by ±m in y, the
	 * horizontal pair by ±m in x. Anything less and a diagonal move slips through the shared corner,
	 * which is exactly the (1919,0) escape that was measured live. */
	assert.match(src, /\("left",\s*x,\s*y\s*-\s*m,\s*x,\s*y\s*\+\s*h\s*\+\s*m/, 'left barrier overlaps in y')
	assert.match(src, /\("right",\s*x\s*\+\s*w,\s*y\s*-\s*m,\s*x\s*\+\s*w,\s*y\s*\+\s*h\s*\+\s*m/, 'right barrier overlaps in y')
	assert.match(src, /\("top",\s*x\s*-\s*m,\s*y,\s*x\s*\+\s*w\s*\+\s*m,\s*y/, 'top barrier overlaps in x')
	assert.match(src, /\("bottom",\s*x\s*-\s*m,\s*y\s*\+\s*h,\s*x\s*\+\s*w\s*\+\s*m,\s*y\s*\+\s*h/, 'bottom barrier overlaps in x')
})
