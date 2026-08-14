'use strict'

/**
 * WO-522 — timeline clip geometry drags must not flood the server.
 *
 * Owner 13.08: *"changing clips position/size (on the screen) in timelines takes a while to show up
 * on the preview screen, looks like amcp gets overrun."* The owner was right.
 *
 * `applyFillPx` fires on every drag-input change and called
 * `refreshTimelineClipGeometryOnServer()`, which is TWO round-trips: a PUT of the whole timeline
 * (`syncTimelineToServer`) plus a `/seek` that makes the engine re-apply every layer at that
 * position. Fired-and-forgotten, so a drag put two full requests per pointer move on the wire with
 * no coalescing and no ordering guarantee.
 *
 * The fix must keep one property above all: **the value the operator settles on always reaches the
 * server.** Dropping intermediate frames is the point; dropping the last one leaves a layer
 * visibly wrong.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** Load the ESM helper without a bundler. */
function loadThrottle() {
	const src = read('client/lib/trailing-throttle.js').replace(/export function/g, 'function')
	return new Function(`${src}; return createTrailingThrottle`)()
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('WO-522: a burst of calls collapses to far fewer runs', async () => {
	const createTrailingThrottle = loadThrottle()
	let runs = 0
	const schedule = createTrailingThrottle(() => {
		runs++
	}, 50)
	for (let i = 0; i < 50; i++) schedule() // one drag, 50 pointer moves
	await sleep(200)
	assert.ok(runs < 10, `50 drag frames must not become 50 requests, got ${runs}`)
	assert.ok(runs >= 1, 'but something must actually run')
})

test('WO-522: the LAST value always reaches the server', async () => {
	const createTrailingThrottle = loadThrottle()
	let seen = null
	let value = 0
	const schedule = createTrailingThrottle(() => {
		seen = value
	}, 40)
	for (let i = 1; i <= 20; i++) {
		value = i
		schedule()
	}
	await sleep(250)
	assert.equal(seen, 20, 'a dropped FINAL frame leaves the layer visibly wrong')
})

test('WO-522: work never runs concurrently, so responses cannot land out of order', async () => {
	const createTrailingThrottle = loadThrottle()
	let active = 0
	let maxActive = 0
	const schedule = createTrailingThrottle(async () => {
		active++
		maxActive = Math.max(maxActive, active)
		await sleep(30)
		active--
	}, 5)
	for (let i = 0; i < 20; i++) {
		schedule()
		await sleep(3)
	}
	await sleep(200)
	assert.equal(maxActive, 1, 'the previous request must land before the next starts')
})

test('WO-522: a slow request still gets a trailing run for changes made during it', async () => {
	const createTrailingThrottle = loadThrottle()
	const seen = []
	let value = 0
	const schedule = createTrailingThrottle(async () => {
		seen.push(value)
		await sleep(60)
	}, 10)
	value = 1
	schedule()
	await sleep(20) // first call now in flight
	value = 2
	schedule() // must be remembered, not dropped
	await sleep(250)
	assert.ok(seen.includes(2), `the change made mid-flight must still be sent, saw ${JSON.stringify(seen)}`)
})

test('WO-522: a throwing call does not wedge the throttle', async () => {
	const createTrailingThrottle = loadThrottle()
	let runs = 0
	const schedule = createTrailingThrottle(() => {
		runs++
		throw new Error('network down')
	}, 10)
	schedule()
	await sleep(60)
	schedule()
	await sleep(60)
	assert.ok(runs >= 2, 'a failed request must not stop the next gesture from syncing')
})

test('WO-522: every drag handler in the clip inspector uses the throttle', () => {
	const src = read('client/components/inspector-panel-timeline-clip.js')
	assert.match(src, /createTrailingThrottle/, 'the throttle must be wired')
	assert.doesNotMatch(
		src,
		/void refreshTimelineClipGeometryOnServer\(\)/,
		'a fire-and-forget geometry refresh in a drag handler is the bug',
	)
	// Discrete one-shot actions may still await the un-throttled function directly.
	assert.match(src, /await refreshTimelineClipGeometryOnServer\(\)/, 'one-shot actions stay immediate')
})

test('WO-522: the helper mirrors the compose editor pattern it was extracted from', () => {
	// scenes-preview-runtime-mixer-nudge.js already solved this for compose: one pending timer, an
	// in-flight guard, and a queued flag. A second, subtly different implementation would drift.
	const nudge = read('client/components/scenes-preview-runtime-mixer-nudge.js')
	assert.match(nudge, /nudgeInFlight/, 'the precedent still exists')
	assert.match(nudge, /nudgeQueued/)
	const helper = read('client/lib/trailing-throttle.js')
	assert.match(helper, /inFlight/)
	assert.match(helper, /queued/)
})

test('WO-522: flush() sends immediately and resolves only when the server has it', async () => {
	const createTrailingThrottle = loadThrottle()
	const seen = []
	let value = 0
	const schedule = createTrailingThrottle(async () => {
		await sleep(20)
		seen.push(value)
	}, 5000) // a long window: only flush can beat it
	value = 7
	schedule()
	await schedule.flush()
	assert.deepEqual(seen, [7], 'flush must not wait out the throttle window')
	assert.equal(schedule.pending(), false, 'and must leave nothing outstanding')
})

test('WO-522: flush() waits for an in-flight call rather than racing it', async () => {
	const createTrailingThrottle = loadThrottle()
	let active = 0
	let maxActive = 0
	const schedule = createTrailingThrottle(async () => {
		active++
		maxActive = Math.max(maxActive, active)
		await sleep(40)
		active--
	}, 10)
	schedule()
	await sleep(20) // in flight
	await schedule.flush()
	assert.equal(maxActive, 1, 'flush must never start a concurrent request')
})
