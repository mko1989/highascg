'use strict'

/**
 * WO-278 — offline coverage for the pure parts of cable re-grab and the gesture-scoped
 * snapshot pre-warm.
 *
 * The safety property under test: a re-grab never persists an intermediate state. Every
 * outcome other than a validated new target must resolve to `restore`, and `restore` must be
 * reachable without any server call — because the original edge was never removed.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const CLIENT_LIB = path.join(__dirname, '..', '..', 'client', 'lib')
const importLib = (f) => import(pathToFileURL(path.join(CLIENT_LIB, f)).href)

// ---------------------------------------------------------------------------
// Fixture: one destination fanned to two GPU ports, plus an unrelated cable.
// ---------------------------------------------------------------------------
const EDGES = [
	{ id: 'e1', sourceId: 'dst_in_a', sinkId: 'gpu_p0' },
	{ id: 'e2', sourceId: 'dst_in_a', sinkId: 'gpu_p2' },
	{ id: 'e3', sourceId: 'dst_in_b', sinkId: 'dlsdi_3' },
]

/** Stand-in for orderEdgeForDeviceView: dst_in_* are sources, everything else is a sink. */
const orderEdge = (a, b) => {
	const isSrc = (x) => /^dst_in_/.test(x)
	if (isSrc(a) && !isSrc(b)) return { sourceId: a, sinkId: b }
	if (isSrc(b) && !isSrc(a)) return { sourceId: b, sinkId: a }
	return null // src↔src and sink↔sink are not cablable
}

const findSinkConflict = (edges) => (sinkId) => edges.find((e) => e.sinkId === sinkId) || null

// ---------------------------------------------------------------------------
// 1. Endpoint hit-testing
// ---------------------------------------------------------------------------

test('WO-278 findEdgeEndpointsAtConnector: reports the grabbed end and the end that stays anchored', async () => {
	const { findEdgeEndpointsAtConnector, EDGE_END_SINK, EDGE_END_SOURCE } = await importLib('device-view-cable-regrab.js')

	const atSink = findEdgeEndpointsAtConnector(EDGES, 'gpu_p0')
	assert.deepEqual(atSink, [{ edgeId: 'e1', end: EDGE_END_SINK, anchorId: 'dst_in_a', movingId: 'gpu_p0' }])

	// A fanned-out source reports one hit per cable; the anchor is each cable's own far end.
	const atSource = findEdgeEndpointsAtConnector(EDGES, 'dst_in_a')
	assert.equal(atSource.length, 2)
	assert.deepEqual(
		atSource.map((h) => [h.edgeId, h.end, h.anchorId]),
		[
			['e1', EDGE_END_SOURCE, 'gpu_p0'],
			['e2', EDGE_END_SOURCE, 'gpu_p2'],
		],
	)

	assert.deepEqual(findEdgeEndpointsAtConnector(EDGES, 'gpu_p9'), [])
	assert.deepEqual(findEdgeEndpointsAtConnector(EDGES, ''), [])
	assert.deepEqual(findEdgeEndpointsAtConnector(null, 'gpu_p0'), [])
})

test('WO-278 pickRegrabCandidate: only grabs the cable the operator already selected', async () => {
	const { pickRegrabCandidate } = await importLib('device-view-cable-regrab.js')

	// No selection → no grab. Clicking a cabled output must keep meaning "start another cable".
	assert.equal(pickRegrabCandidate(EDGES, 'dst_in_a', {}), null)
	assert.equal(pickRegrabCandidate(EDGES, 'gpu_p0', { selectedEdgeId: null }), null)

	// A different cable is selected → do not silently hijack this port.
	assert.equal(pickRegrabCandidate(EDGES, 'gpu_p0', { selectedEdgeId: 'e2' }), null)

	// The selected cable's own end → grab it.
	assert.deepEqual(pickRegrabCandidate(EDGES, 'gpu_p2', { selectedEdgeId: 'e2' }), {
		edgeId: 'e2',
		end: 'sink',
		anchorId: 'dst_in_a',
		movingId: 'gpu_p2',
	})
	// The same port, grabbing the source end of the selected cable instead.
	assert.deepEqual(pickRegrabCandidate(EDGES, 'dst_in_a', { selectedEdgeId: 'e2' }), {
		edgeId: 'e2',
		end: 'source',
		anchorId: 'gpu_p2',
		movingId: 'dst_in_a',
	})
})

// ---------------------------------------------------------------------------
// 2. Re-target validation — the happy paths
// ---------------------------------------------------------------------------

test('WO-278 planCableRegrab: moving the SINK end keeps the source anchored', async () => {
	const { planCableRegrab } = await importLib('device-view-cable-regrab.js')
	const grab = { edgeId: 'e1', end: 'sink', anchorId: 'dst_in_a', movingId: 'gpu_p0' }

	const plan = planCableRegrab({
		grab,
		targetId: 'gpu_p4',
		orderEdge,
		findSinkConflict: findSinkConflict(EDGES),
	})
	assert.deepEqual(plan, { action: 'retarget', removeEdgeId: 'e1', sourceId: 'dst_in_a', sinkId: 'gpu_p4' })
})

test('WO-278 planCableRegrab: moving the SOURCE end keeps the sink anchored', async () => {
	const { planCableRegrab } = await importLib('device-view-cable-regrab.js')
	const grab = { edgeId: 'e1', end: 'source', anchorId: 'gpu_p0', movingId: 'dst_in_a' }

	const plan = planCableRegrab({
		grab,
		targetId: 'dst_in_c',
		orderEdge,
		// The anchored sink is still occupied by the very cable being moved — that must not
		// count as a conflict, or re-patching a source would be impossible.
		findSinkConflict: findSinkConflict(EDGES),
	})
	assert.deepEqual(plan, { action: 'retarget', removeEdgeId: 'e1', sourceId: 'dst_in_c', sinkId: 'gpu_p0' })
})

test('WO-278 planCableRegrab: canonicalises UI ids to persisted graph ids before committing', async () => {
	const { planCableRegrab } = await importLib('device-view-cable-regrab.js')
	// DP-1/DP-2 on one physical socket share a single gpu_pN cable slot.
	const canonicalize = (id) => (id === 'gpu_p4__DP-2' ? 'gpu_p4' : id)
	const plan = planCableRegrab({
		grab: { edgeId: 'e1', end: 'sink', anchorId: 'dst_in_a', movingId: 'gpu_p0' },
		targetId: 'gpu_p4__DP-2',
		orderEdge,
		findSinkConflict: findSinkConflict(EDGES),
		canonicalize,
	})
	assert.equal(plan.action, 'retarget')
	assert.equal(plan.sinkId, 'gpu_p4', 'must persist the physical socket id, not the DP alias')
})

// ---------------------------------------------------------------------------
// 3. Restore-on-invalid — the safety cases. None of these may produce a mutation.
// ---------------------------------------------------------------------------

test('WO-278 planCableRegrab: every invalid drop restores instead of disconnecting', async () => {
	const { planCableRegrab, describeRegrabRestore } = await importLib('device-view-cable-regrab.js')
	const grab = { edgeId: 'e1', end: 'sink', anchorId: 'dst_in_a', movingId: 'gpu_p0' }
	const base = { grab, orderEdge, findSinkConflict: findSinkConflict(EDGES) }

	const cases = [
		// Empty space is this app's CANCEL gesture, not its delete affordance (delete is
		// select + Delete key / the edge inspector button). It must never disconnect.
		[null, 'cancelled'],
		['', 'cancelled'],
		// Dropped back where it came from: a no-op, not a disconnect.
		['gpu_p0', 'unchanged'],
		// Dropped on its own far end: a port cannot patch to itself.
		['dst_in_a', 'self'],
		// Role/direction rejected by the app's existing validation: the anchor is a source, so
		// dropping the far end on another source is not cablable.
		['dst_in_b', 'invalid-target'],
		// The target input already carries someone else's cable.
		['gpu_p2', 'sink-occupied'],
	]

	for (const [targetId, reason] of cases) {
		const plan = planCableRegrab({ ...base, targetId })
		assert.equal(plan.action, 'restore', `target ${JSON.stringify(targetId)} must restore, got ${plan.action}`)
		assert.equal(plan.reason, reason)
		assert.equal(plan.removeEdgeId, undefined, 'a restore must never carry a removal')
		assert.equal(plan.sinkId, undefined, 'a restore must never carry an edge to persist')
		assert.ok(describeRegrabRestore(plan).length > 0, 'restore reasons are operator-facing')
	}

	// The occupied-sink case names the cable that is in the way.
	assert.equal(planCableRegrab({ ...base, targetId: 'gpu_p2' }).conflictEdgeId, 'e2')
})

test('WO-278 planCableRegrab: rejects a target that would reverse the cable', async () => {
	const { planCableRegrab } = await importLib('device-view-cable-regrab.js')
	// Grab the SINK end of e1, then drop it on a connector that only validates as a SOURCE.
	// orderEdge would happily return {source: dst_in_c, sink: dst_in_a}, flipping the anchor
	// from source to sink. That is a different cable, not a re-target of this one.
	const plan = planCableRegrab({
		grab: { edgeId: 'e1', end: 'sink', anchorId: 'dst_in_a', movingId: 'gpu_p0' },
		targetId: 'gpu_p7',
		orderEdge: () => ({ sourceId: 'gpu_p7', sinkId: 'dst_in_a' }),
		findSinkConflict: () => null,
	})
	assert.deepEqual(plan, { action: 'restore', reason: 'direction' })
})

test('WO-278 planCableRegrab: no grab in flight is a no-op, not a restore or a write', async () => {
	const { planCableRegrab } = await importLib('device-view-cable-regrab.js')
	assert.deepEqual(planCableRegrab({ grab: null, targetId: 'gpu_p4', orderEdge }), { action: 'none' })
	assert.deepEqual(planCableRegrab({ grab: { end: 'sink' }, targetId: 'gpu_p4', orderEdge }), { action: 'none' })
})

// ---------------------------------------------------------------------------
// 4. Rollback — remove-then-add must be able to put the original cable back
// ---------------------------------------------------------------------------

test('WO-278 planRegrabRollback: reconstructs the original edge for either grabbed end', async () => {
	const { planRegrabRollback } = await importLib('device-view-cable-regrab.js')

	assert.deepEqual(
		planRegrabRollback({ edgeId: 'e1', end: 'sink', anchorId: 'dst_in_a', movingId: 'gpu_p0' }),
		{ sourceId: 'dst_in_a', sinkId: 'gpu_p0' },
	)
	assert.deepEqual(
		planRegrabRollback({ edgeId: 'e1', end: 'source', anchorId: 'gpu_p0', movingId: 'dst_in_a' }),
		{ sourceId: 'dst_in_a', sinkId: 'gpu_p0' },
	)
	assert.equal(planRegrabRollback(null), null)
	assert.equal(planRegrabRollback({ edgeId: 'e1', end: 'sink' }), null)
})

// ---------------------------------------------------------------------------
// 5. Snapshot pre-warm — must cost nothing while nothing is being dragged
// ---------------------------------------------------------------------------

test('WO-278 shouldPrewarm: re-warms under the server 3 s xrandr TTL, never above it', async () => {
	const { shouldPrewarm, PREWARM_INTERVAL_MS } = await importLib('device-view-snapshot-prewarm.js')

	assert.ok(PREWARM_INTERVAL_MS < 3000, 'must re-warm before the server cache lapses')
	assert.equal(shouldPrewarm(0, 1_000_000), true, 'never warmed → warm now')
	assert.equal(shouldPrewarm(NaN, 1_000_000), true)
	assert.equal(shouldPrewarm(1_000_000, 1_000_000 + PREWARM_INTERVAL_MS - 1), false)
	assert.equal(shouldPrewarm(1_000_000, 1_000_000 + PREWARM_INTERVAL_MS), true)
})

test('WO-278 createSnapshotPrewarmer: no timer and no requests unless a gesture is active', async () => {
	const { createSnapshotPrewarmer } = await importLib('device-view-snapshot-prewarm.js')

	let now = 1_000_000
	let warms = 0
	const timers = new Map()
	let nextHandle = 1
	const p = createSnapshotPrewarmer({
		warm: () => { warms++; return Promise.resolve() },
		intervalMs: 2500,
		now: () => now,
		setInterval: (fn, ms) => { const h = nextHandle++; timers.set(h, { fn, ms }); return h },
		clearInterval: (h) => { timers.delete(h) },
	})

	// Idle: nothing scheduled, nothing fetched.
	assert.equal(p.isRunning(), false)
	assert.equal(timers.size, 0)
	assert.equal(warms, 0)

	// Arming warms immediately and schedules exactly one timer.
	p.start()
	assert.equal(p.isRunning(), true)
	assert.equal(warms, 1, 'arming must warm the snapshot straight away')
	assert.equal(timers.size, 1)

	// start() is idempotent — re-arming must not stack timers.
	p.start()
	assert.equal(timers.size, 1)
	assert.equal(warms, 1)

	// A tick before the interval elapses is suppressed.
	const tick = () => timers.get(1).fn()
	now += 100
	tick()
	assert.equal(warms, 1)

	now += 2500
	tick()
	assert.equal(warms, 2)

	// Committing/cancelling tears the timer down; later ticks would never fire.
	p.stop()
	assert.equal(p.isRunning(), false)
	assert.equal(timers.size, 0)
	p.stop() // idempotent
	assert.equal(timers.size, 0)
	assert.deepEqual(p.stats(), { warmCount: 2, lastWarmAt: now })
})

test('WO-278 createSnapshotPrewarmer: a failing warm never surfaces to the operator', async () => {
	const { createSnapshotPrewarmer } = await importLib('device-view-snapshot-prewarm.js')

	const throwing = createSnapshotPrewarmer({
		warm: () => { throw new Error('offline') },
		setInterval: () => 1,
		clearInterval: () => {},
	})
	assert.doesNotThrow(() => throwing.start())
	throwing.stop()

	const rejecting = createSnapshotPrewarmer({
		warm: () => Promise.reject(new Error('502')),
		setInterval: () => 1,
		clearInterval: () => {},
	})
	assert.doesNotThrow(() => rejecting.start())
	rejecting.stop()
	// An unhandled rejection here would fail the process; reaching this point proves it is caught.
	await new Promise((r) => setImmediate(r))
})
