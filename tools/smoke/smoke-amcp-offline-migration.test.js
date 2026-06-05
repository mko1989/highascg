'use strict'

/**
 * T7.2 — Offline AMCP / REST parity after casparcg-connection migration.
 * No TCP to Caspar; uses AmcpSimulated via offline_mode context.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const defaults = require('../../src/config/defaults')
const { defaultLogger } = require('../../src/utils/logger')
const { StateManager } = require('../../src/state/state-manager')
const { AmcpClient } = require('../../src/caspar/amcp-client')
const { routeRequest } = require('../../src/api/router')

/** @param {AmcpClient} amcp @param {string[]} bucket */
function captureAmcp(amcp, bucket) {
	const sim = amcp._simulated
	const orig = sim.send.bind(sim)
	sim.send = function wrappedSend(cmd) {
		bucket.push(String(cmd).trim())
		return orig(cmd)
	}
}

function makeOfflineAmcp(overrides = {}) {
	const ctx = {
		socket: { isConnected: false },
		config: {
			offline_mode: true,
			amcp_batch: false,
			amcp_max_batch_commands: 64,
			amcp_mixer_commit_before_amcp_batch: true,
			...overrides,
		},
		response_callback: {},
		_amcpSendQueue: Promise.resolve(),
		log: () => {},
	}
	return new AmcpClient(ctx)
}

function makeAppCtx(amcp) {
	const state = new StateManager({ logger: defaultLogger })
	const cfg = JSON.parse(JSON.stringify(defaults))
	return {
		state,
		variables: state.variables,
		config: cfg,
		gatheredInfo: {
			channelIds: [],
			channelStatusLines: {},
			channelXml: {},
			infoConfig: '',
			infoPaths: '',
			infoSystem: '',
		},
		CHOICES_MEDIAFILES: [],
		CHOICES_TEMPLATES: [],
		mediaDetails: {},
		programLayerBankByChannel: {},
		sceneDeck: { looks: [], previewSceneId: null, layerPresets: [], lookPresets: [] },
		persistence: { get: () => null, set: () => {}, remove: () => {} },
		amcp,
		_casparStatus: { connected: true, host: '127.0.0.1', port: 5250 },
		log: () => {},
		timelineEngine: null,
		getState: null,
	}
}

/** @param {unknown} r */
function assertAmcpOkShape(r) {
	assert.equal(typeof r, 'object')
	assert.equal(r.ok, true)
	assert.ok('data' in r)
}

describe('AMCP migration offline parity (T7.2)', () => {
	it('direct amcp: pause/stop/clear return { ok, data }', async () => {
		const amcp = makeOfflineAmcp()
		const captured = []
		captureAmcp(amcp, captured)
		for (const fn of [
			() => amcp.pause(1, 10),
			() => amcp.stop(1, 10),
			() => amcp.clear(1, 10),
		]) {
			assertAmcpOkShape(await fn())
		}
		assert.ok(captured.some((c) => /^PAUSE\s+1-10/.test(c)))
		assert.ok(captured.some((c) => /^STOP\s+1-10/.test(c)))
		assert.ok(captured.some((c) => /^CLEAR\s+1-10/.test(c)))
	})

	it('direct amcp: version returns string data (simulated)', async () => {
		const amcp = makeOfflineAmcp()
		const r = await amcp.version()
		assertAmcpOkShape(r)
		assert.equal(typeof r.data, 'string')
		assert.match(r.data, /simulated/i)
	})

	it('direct amcp: mixerCommit and cgClear issue expected commands', async () => {
		const amcp = makeOfflineAmcp()
		const captured = []
		captureAmcp(amcp, captured)
		assertAmcpOkShape(await amcp.mixer.mixerCommit(1))
		assertAmcpOkShape(await amcp.cg.cgClear(1, 10))
		assert.ok(captured.some((c) => /^MIXER\s+1\s+COMMIT/.test(c)))
		assert.ok(captured.some((c) => /^CG\s+1-10\s+CLEAR/.test(c)))
	})

	it('REST POST /api/mixer/commit and /api/cg/clear return 200 + ok', async () => {
		const amcp = makeOfflineAmcp()
		const captured = []
		captureAmcp(amcp, captured)
		const ctx = makeAppCtx(amcp)
		const commit = await routeRequest('POST', '/api/mixer/commit', JSON.stringify({ channel: 1 }), ctx, null)
		assert.equal(commit.status, 200)
		assert.equal(JSON.parse(commit.body).ok, true)
		const clear = await routeRequest(
			'POST',
			'/api/cg/clear',
			JSON.stringify({ channel: 1, layer: 10 }),
			ctx,
			null,
		)
		assert.equal(clear.status, 200)
		assert.equal(JSON.parse(clear.body).ok, true)
		assert.ok(captured.some((c) => /COMMIT/.test(c)))
		assert.ok(captured.some((c) => /^CG\s+1-10\s+CLEAR/.test(c)))
	})

	it('offline batchSend (sequential) returns ok + responses array', async () => {
		const amcp = makeOfflineAmcp({ amcp_batch: false })
		const r = await amcp.batchSend(['CLEAR 1-10', 'CLEAR 1-11'], { skipMixerPreCommit: true })
		assert.equal(r.ok, true)
		assert.equal(r.batched, false)
		assert.ok(Array.isArray(r.responses))
		assert.equal(r.responses.length, 2)
	})
})
