'use strict'

/**
 * WO-303 — two owner-reported Devices-tab bugs.
 *
 * (B) "connecting a screen dest to a decklink output made the casparcg restart without clicking
 *     the apply restart button."
 *
 *     Mechanism (auto-applied config, NOT a Caspar crash): POST /api/device-view {addEdge}
 *     → handleAddEdge → applyDecklinkOutputOnDestinationEdge writes screen_N_decklink_device /
 *     screen_N_decklink_replace_screen into casparServer → scheduleDeviceViewCasparSync's 1500 ms
 *     debounce fires → syncDeviceViewToCaspar saw casparServerChanged and ran
 *     applyCasparConfigToDiskAndRestart, which bounces Caspar (AMCP RESTART + fast-kill).
 *     One cable click, live output interrupted, no button pressed.
 *
 *     Rule enforced here: a graph edit persists config and nothing else. Caspar restarts only
 *     when a caller explicitly opts in (the Apply & restart button).
 *
 * (A) "cant regrab."
 *
 *     WO-278's gesture is "select a cable, click one of its ends to lift it". A cable's visible
 *     end is the connector marker, whose click handler is onPortClick → selectKey — and selectKey
 *     cleared state.selectedEdgeId before anything could offer a re-grab. The "cable is already
 *     selected" precondition tryBeginCableRegrab requires was therefore destroyed by the very
 *     click meant to satisfy it, unless the operator hit the small child dot exactly.
 *
 *     Second, narrower fault: the hit-test compared a raw UI connector id against canonical graph
 *     ids, so a bracket-split GPU jack (gpu_p0__DP_1) never matched its own cable.
 *
 * HONESTY NOTE: the browser click path (marker vs dot, z-order, pointer-events) still cannot be
 * exercised offline — this repo has no jsdom, and importing device-view-cable.js under node keeps
 * the event loop alive. What is proven below is the decision logic and the source-level ordering
 * contract that was inverted. A click-through after a client build is still required.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const REPO = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const importClient = (rel) => import(pathToFileURL(path.join(REPO, rel)).href)

const { syncDeviceViewToCaspar, scheduleDeviceViewCasparSync } = require('../../src/api/device-view-decklink-wiring')
const CRUD = require('../../src/api/device-view-crud')

function mockConfigManager(initial) {
	let store = JSON.parse(JSON.stringify(initial))
	return { get: () => store, save: (next) => { store = next } }
}

/** The owner's exact shape: a screen destination cabled to a DeckLink SDI port. */
function screenDestToDecklinkConfig() {
	return {
		screenDestinations: {
			version: 1,
			destinations: [{ id: 'dst_1', label: 'Screen 1', mainScreenIndex: 0, mode: 'pgm_prv' }],
		},
		deviceGraph: {
			version: 1,
			devices: [
				{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' },
				{ id: 'destinations', role: 'destinations', label: 'Screen destinations' },
			],
			connectors: [
				{ id: 'dst_in_1', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_1' },
				// ioDirection unassigned — a fresh SDI port, which is what the operator cabled.
				{ id: 'dlsdi_1', deviceId: 'caspar_host', kind: 'decklink_io', label: 'DeckLink 1', externalRef: '1', caspar: {} },
			],
			edges: [],
		},
		casparServer: {},
		streamingChannel: { enabled: false, videoSource: 'program_1' },
		recordOutputs: [],
	}
}

/** Swap in a restart spy for the duration of `fn`. */
async function withRestartSpy(fn) {
	const routesCasparConfig = require('../../src/api/routes-caspar-config')
	const orig = routesCasparConfig.applyCasparConfigToDiskAndRestart
	const calls = []
	routesCasparConfig.applyCasparConfigToDiskAndRestart = async (...a) => {
		calls.push(a)
		return { status: 200, headers: {}, body: '{"ok":true}' }
	}
	try {
		return await fn(calls)
	} finally {
		routesCasparConfig.applyCasparConfigToDiskAndRestart = orig
	}
}

// ---------------------------------------------------------------------------
// (B) the restart-on-cable path
// ---------------------------------------------------------------------------

describe('WO-303 (B): cabling a screen destination to a DeckLink output must not restart Caspar', () => {
	it('handleAddEdge persists the DeckLink output wiring without any restart', async () => {
		await withRestartSpy(async (calls) => {
			const config = screenDestToDecklinkConfig()
			const ctx = { config, configManager: mockConfigManager(config), log: () => {} }
			const res = CRUD.handleAddEdge({ addEdge: { sourceId: 'dst_in_1', sinkId: 'dlsdi_1' } }, ctx, {})

			assert.equal(res.ok, true)
			// The wiring really did happen — this is not "no restart because nothing changed".
			assert.equal(ctx.config.casparServer.screen_1_decklink_device, 1)
			// ...and it is reported to the client so the Apply button can go orange.
			assert.equal(res.casparRestartNeeded, true)
			assert.equal(res.pendingApply, true)
			// Nothing bounced Caspar during the mutation itself.
			assert.equal(calls.length, 0)
		})
	})

	it('the debounced sync that handleAddEdge schedules defers the restart instead of taking it', async () => {
		await withRestartSpy(async (calls) => {
			const config = screenDestToDecklinkConfig()
			config.deviceGraph.edges.push({ id: 'e1', sourceId: 'dst_in_1', sinkId: 'dlsdi_1' })
			config.deviceGraph.connectors[1].caspar = {
				ioDirection: 'out',
				outputBinding: { type: 'screen', index: 1 },
				bus: 'pgm',
				mainIndex: 0,
			}
			const ctx = { config, configManager: mockConfigManager(config), log: () => {} }

			// The shipped path: the 1500 ms debounce timer, shortened here.
			await new Promise((resolve) => {
				scheduleDeviceViewCasparSync(ctx, 1)
				setTimeout(resolve, 40)
			})

			assert.equal(calls.length, 0, 'the debounced graph-edit sync must never restart Caspar')
			assert.equal(ctx.casparApplyPending, true, 'the operator must be told the config is stale')
		})
	})

	it('syncDeviceViewToCaspar restarts only on an explicit opt-in', async () => {
		const config = screenDestToDecklinkConfig()
		config.deviceGraph.edges.push({ id: 'e1', sourceId: 'dst_in_1', sinkId: 'dlsdi_1' })
		config.deviceGraph.connectors[1].caspar = {
			ioDirection: 'out',
			outputBinding: { type: 'screen', index: 1 },
			bus: 'pgm',
			mainIndex: 0,
		}

		await withRestartSpy(async (calls) => {
			const ctx = { config: JSON.parse(JSON.stringify(config)), configManager: mockConfigManager(config), log: () => {} }
			const deferred = await syncDeviceViewToCaspar(ctx)
			assert.equal(deferred.restarted, false)
			assert.equal(deferred.restartDeferred, true)
			assert.equal(calls.length, 0)

			const ctx2 = { config: JSON.parse(JSON.stringify(config)), configManager: mockConfigManager(config), log: () => {} }
			const explicit = await syncDeviceViewToCaspar(ctx2, { allowRestart: true })
			assert.equal(explicit.restarted, true)
			assert.equal(calls.length, 1)
		})
	})

	it('no graph-mutation handler passes allowRestart (source contract)', () => {
		const crud = read('src/api/device-view-crud.js')
		assert.equal(/allowRestart/.test(crud), false, 'device-view-crud.js must never opt a graph edit into a restart')
		const wiring = read('src/api/device-view-decklink-wiring.js')
		// The debounced scheduler is the graph-edit entry point; it must call the sync bare.
		const scheduler = wiring.slice(wiring.indexOf('function scheduleDeviceViewCasparSync'))
		const body = scheduler.slice(0, scheduler.indexOf('\n}\n'))
		assert.match(body, /syncDeviceViewToCaspar\(ctx\)/)
		assert.equal(/allowRestart/.test(body), false)
	})
})

// ---------------------------------------------------------------------------
// (A) cable re-grab
// ---------------------------------------------------------------------------

const EDGES = [
	{ id: 'e1', sourceId: 'dst_in_a', sinkId: 'gpu_p0' },
	{ id: 'e2', sourceId: 'dst_in_b', sinkId: 'dlsdi_3' },
]

describe('WO-303 (A): the re-grab precondition must survive the click that is supposed to start it', () => {
	it('selectKey offers the re-grab BEFORE it clears selectedEdgeId (source ordering contract)', () => {
		const src = read('client/components/device-view-selection.js')
		const start = src.indexOf('ctx.selectKey = ')
		assert.ok(start > 0, 'selectKey not found')
		const body = src.slice(start, src.indexOf('ctx.focusConnectorById', start))

		const regrabAt = body.indexOf('tryBeginCableRegrab')
		assert.ok(regrabAt > 0, 'selectKey must give a held cable end a chance before clearing selection')

		// The clear that used to run first. It must come after the re-grab offer, and the offer
		// must return early so the clear is skipped entirely on a re-grab.
		const clearAt = body.indexOf('state.selectedEdgeId = null', regrabAt)
		assert.ok(clearAt > regrabAt, 'selectedEdgeId is still cleared before the re-grab is offered')
		assert.match(body.slice(regrabAt, clearAt), /return/)
	})

	it('tryBeginCableRegrab canonicalises the clicked id before hit-testing (source contract)', () => {
		const src = read('client/components/device-view-cable.js')
		const start = src.indexOf('ctx.tryBeginCableRegrab = ')
		assert.ok(start > 0)
		const body = src.slice(start, src.indexOf('ctx.beginOrCompleteCable', start))
		const canonAt = body.indexOf('canonicalCableConnectorId')
		const pickAt = body.indexOf('pickRegrabCandidate')
		assert.ok(canonAt > 0 && pickAt > canonAt, 'the UI id must be canonicalised before the edge hit-test')
	})

	it('a canonicalised bracket-split GPU id hit-tests against its own cable', async () => {
		const { pickRegrabCandidate } = await importClient('client/lib/device-view-cable-regrab.js')
		const { canonicalCableConnectorId } = await importClient('client/lib/device-view-cable-resolve.js')
		const payload = { graph: { edges: EDGES, connectors: [] } }

		// Raw UI id — what the old code fed the hit-test.
		assert.equal(pickRegrabCandidate(EDGES, 'gpu_p0__DP_1', { selectedEdgeId: 'e1' }), null)

		// Canonicalised — what it is fed now.
		const canon = canonicalCableConnectorId(payload, 'gpu_p0__DP_1')
		assert.equal(canon, 'gpu_p0')
		assert.deepEqual(pickRegrabCandidate(EDGES, canon, { selectedEdgeId: 'e1' }), {
			edgeId: 'e1',
			end: 'sink',
			anchorId: 'dst_in_a',
			movingId: 'gpu_p0',
		})
	})

	it('a plain connector click is still a plain connector click (no cable selected → no re-grab)', async () => {
		const { pickRegrabCandidate } = await importClient('client/lib/device-view-cable-regrab.js')
		// No selection at all.
		assert.equal(pickRegrabCandidate(EDGES, 'gpu_p0', { selectedEdgeId: null }), null)
		// A different cable is selected — clicking gpu_p0 must not hijack e2.
		assert.equal(pickRegrabCandidate(EDGES, 'gpu_p0', { selectedEdgeId: 'e2' }), null)
		// A connector with no cable on it at all.
		assert.equal(pickRegrabCandidate(EDGES, 'gpu_p1', { selectedEdgeId: 'e1' }), null)
	})
})
