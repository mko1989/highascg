'use strict'

/**
 * WO-172 T172.1/T172.2/T172.3/T172.8 — device-view→Caspar stream/record source sync.
 *
 * Root cause fixed by this WO: `syncDeviceViewToCaspar` (src/api/device-view-decklink-wiring.js)
 * destructured `applyDestinationOutputEdgesToCasparConfig` from `./device-view-apply`, but that
 * module only exported `{ buildApplyDryRunPlan, executeApplyPlan }` — the call was `undefined()`,
 * a TypeError swallowed to a warn. Net effect: cabling a destination to stream_out/record_out never
 * updated `streamingChannel.videoSource` / `recordOutputs[].source`, so Start kept streaming/recording
 * whatever stale source was last saved (production evidence: log/highascg-node.log:6977,:7122).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { applyDestinationOutputEdgesToCasparConfig } = require('../../src/api/device-view-apply')
const { syncDeviceViewToCaspar } = require('../../src/api/device-view-decklink-wiring')
const { getChannelMap } = require('../../src/config/routing')
const { handlePostRtmp } = require('../../src/api/routes-streaming-channel-rtmp')

function mockConfigManager(initial) {
	let store = JSON.parse(JSON.stringify(initial))
	return {
		get: () => store,
		save: (next) => {
			store = next
		},
	}
}

/** Destination `dst_2` at mainScreenIndex 1 (Screen 2 / "PGM2"), cabled stream_out → `str_1`. */
function streamOnlyConfig() {
	return {
		screenDestinations: {
			version: 1,
			destinations: [{ id: 'dst_2', label: 'Screen 2', mainScreenIndex: 1, mode: 'pgm_prv' }],
		},
		deviceGraph: {
			version: 1,
			devices: [],
			connectors: [
				{ id: 'dst_in_2', kind: 'destination_in', externalRef: 'dst_2' },
				{ id: 'str_1', kind: 'stream_out', label: 'Str1', caspar: {} },
			],
			edges: [{ id: 'e1', sourceId: 'dst_in_2', sinkId: 'str_1' }],
		},
		streamingChannel: { enabled: true, videoSource: 'program_1' },
		recordOutputs: [],
		casparServer: {},
	}
}

/** Destination `dst_1` at mainScreenIndex 0, cabled record_out → `rec_1`. */
function recordOnlyConfig() {
	return {
		screenDestinations: {
			version: 1,
			destinations: [{ id: 'dst_1', label: 'Screen 1', mainScreenIndex: 0, mode: 'pgm_only' }],
		},
		deviceGraph: {
			version: 1,
			devices: [],
			connectors: [
				{ id: 'dst_in_1', kind: 'destination_in', externalRef: 'dst_1' },
				{ id: 'rec_1', kind: 'record_out', label: 'Rec1', caspar: {} },
			],
			edges: [{ id: 'e2', sourceId: 'dst_in_1', sinkId: 'rec_1' }],
		},
		streamingChannel: { enabled: false, videoSource: 'program_1' },
		recordOutputs: [{ id: 'rec_1', label: 'Rec1', enabled: true, source: 'program_5' }],
		casparServer: {},
	}
}

/** Same as streamOnlyConfig, plus a decklink_out cable on screen 1 (casparServer-affecting). */
function streamPlusDecklinkConfig() {
	const cfg = streamOnlyConfig()
	cfg.screenDestinations.destinations.push({ id: 'dst_1', label: 'Screen 1', mainScreenIndex: 0, mode: 'pgm_prv' })
	cfg.deviceGraph.connectors.push(
		{ id: 'dst_in_1', kind: 'destination_in', externalRef: 'dst_1' },
		{ id: 'dl_1', kind: 'decklink_out', label: 'DL1', externalRef: '2', caspar: {} },
	)
	cfg.deviceGraph.edges.push({ id: 'e3', sourceId: 'dst_in_1', sinkId: 'dl_1' })
	return cfg
}

describe('WO-172 T172.1: applyDestinationOutputEdgesToCasparConfig export', () => {
	it('is exported (was previously undefined — the production TypeError)', () => {
		assert.equal(typeof applyDestinationOutputEdgesToCasparConfig, 'function')
	})

	it('writes streamingChannel.videoSource from a stream_out cable edge, no casparServer touch', () => {
		const config = streamOnlyConfig()
		const ctx = { config, configManager: mockConfigManager(config) }
		const res = applyDestinationOutputEdgesToCasparConfig(ctx, { actions: [], warnings: [] })
		assert.equal(ctx.config.streamingChannel.videoSource, 'program_2')
		assert.equal(res.streamChanged, true)
		// NB: recordChanged is not asserted here — applyStreamRecordMappingsFromGraph
		// (src/config/device-graph-output-mapping.js, out of WO-172's touch scope) reports one shared
		// `changed` boolean for stream+record together, so a stream-only edit can also flip
		// `res.recordChanged` true (redundant recordOutputs write, not a data-correctness bug).
		// `casparServerChanged` is what gates the restart decision (T172.3) and is independently
		// computed from the actual casparServer diff — asserted below.
		assert.equal(res.casparServerChanged, false)
	})

	it('writes recordOutputs[].source from a record_out cable edge, no casparServer touch', () => {
		const config = recordOnlyConfig()
		const ctx = { config, configManager: mockConfigManager(config) }
		const res = applyDestinationOutputEdgesToCasparConfig(ctx, { actions: [], warnings: [] })
		const rec = ctx.config.recordOutputs.find((r) => r.id === 'rec_1')
		assert.equal(rec.source, 'program_1')
		assert.equal(res.recordChanged, true)
		assert.equal(res.casparServerChanged, false)
	})

	it('flags casparServerChanged when a decklink_out edge is also present', () => {
		const config = streamPlusDecklinkConfig()
		const ctx = { config, configManager: mockConfigManager(config) }
		const res = applyDestinationOutputEdgesToCasparConfig(ctx, { actions: [], warnings: [] })
		assert.equal(res.casparServerChanged, true)
		assert.equal(ctx.config.casparServer.screen_1_decklink_device, 2)
	})
})

describe('WO-172 T172.2: attach-mode resolution from a graph edge', () => {
	it('graph edge stream_out→PGM2 resolves to Caspar channel 3 (ADD 3 STREAM)', async () => {
		const config = streamOnlyConfig()
		const ctx = { config, configManager: mockConfigManager(config) }
		applyDestinationOutputEdgesToCasparConfig(ctx, { actions: [], warnings: [] })

		const map = getChannelMap(ctx.config)
		// Screen 1 pgm=1/prv=2, Screen 2 (PGM2) pgm=3/prv=4 — matches A172.1's "ch3/PGM2" phrasing.
		assert.equal(map.streamingCh, 3)

		const calls = []
		ctx.amcp = { raw: (cmd) => { calls.push(cmd); return Promise.resolve({ ok: true, data: '' }) } }
		const res = await handlePostRtmp(
			JSON.stringify({ action: 'start', rtmpServerUrl: 'rtmp://example.test/live', streamKey: 'k1' }),
			ctx,
		)
		assert.equal(res.status, 200)
		assert.ok(calls.length >= 1)
		assert.match(calls[0], /^ADD 3(-\d+)? STREAM /)
	})
})

describe('WO-172 T172.1/T172.3: syncDeviceViewToCaspar restart gating', () => {
	it('does not attempt the heavy write+restart for a stream-only sync (A172.1: no restart needed)', async () => {
		const config = streamOnlyConfig()
		const routesCasparConfig = require('../../src/api/routes-caspar-config')
		let restartCalls = 0
		const orig = routesCasparConfig.applyCasparConfigToDiskAndRestart
		routesCasparConfig.applyCasparConfigToDiskAndRestart = async () => {
			restartCalls++
			return { status: 200, headers: {}, body: '{"ok":true}' }
		}
		try {
			const ctx = { config, configManager: mockConfigManager(config), log: () => {} }
			await syncDeviceViewToCaspar(ctx)
			assert.equal(restartCalls, 0)
			assert.equal(ctx.config.streamingChannel.videoSource, 'program_2')
		} finally {
			routesCasparConfig.applyCasparConfigToDiskAndRestart = orig
		}
	})

	it('does attempt the write+restart when a decklink/screen output edge is present', async () => {
		const config = streamPlusDecklinkConfig()
		const routesCasparConfig = require('../../src/api/routes-caspar-config')
		let restartCalls = 0
		const orig = routesCasparConfig.applyCasparConfigToDiskAndRestart
		routesCasparConfig.applyCasparConfigToDiskAndRestart = async () => {
			restartCalls++
			return { status: 200, headers: {}, body: '{"ok":true}' }
		}
		try {
			const ctx = { config, configManager: mockConfigManager(config), log: () => {} }
			await syncDeviceViewToCaspar(ctx)
			assert.equal(restartCalls, 1)
		} finally {
			routesCasparConfig.applyCasparConfigToDiskAndRestart = orig
		}
	})

	it('logs error-level (not warn) with the edge involved when the mapping step throws', async () => {
		const config = streamOnlyConfig()
		const logs = []
		const ctx = {
			config,
			configManager: {
				get: () => config,
				save: () => {
					throw new Error('disk full')
				},
			},
			log: (level, msg) => logs.push({ level, msg }),
		}
		await assert.rejects(() => syncDeviceViewToCaspar(ctx))
		// syncDeviceViewToCaspar itself doesn't log (it rethrows) — the debounced scheduler wrapper
		// does the error-level logging; exercise that directly here as it's the shipped call path.
		const { scheduleDeviceViewCasparSync } = require('../../src/api/device-view-decklink-wiring')
		await new Promise((resolve) => {
			scheduleDeviceViewCasparSync(ctx, 1)
			setTimeout(resolve, 30)
		})
		const errorLogs = logs.filter((l) => l.level === 'error')
		assert.ok(errorLogs.length >= 1, 'expected at least one error-level log')
		assert.match(errorLogs[0].msg, /stream_out:str_1/)
	})
})
