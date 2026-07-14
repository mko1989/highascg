'use strict'

/**
 * WO-198 — `POST /api/amcp/batch` (the scenes-editor look-stack PRV push transport)
 * does NOT trigger compose-preview settle anymore (WO-155 T155.4b coupling REVERTED).
 * Root cause: the settle deferral caused continuous 150 ms broadcast restarts per drag tick.
 * The FILE consumer + 40 ms mtime poll already deliver editor freshness without the nudge.
 * Offline router + simulated AMCP — no live Caspar required.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { defaultLogger } = require('../../src/utils/logger')
const { StateManager } = require('../../src/state/state-manager')
const { AmcpClient } = require('../../src/caspar/amcp-client')
const { routeRequest } = require('../../src/api/router')
const activity = require('../../src/preview/compose-preview-activity')

function makeOfflineAmcp(overrides = {}) {
	/** @type {import('../../src/caspar/amcp-protocol').AmcpConnectionContext} */
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
		_casparStatus: { connected: true, host: cfg.caspar?.host || '127.0.0.1', port: cfg.caspar?.port ?? 5250 },
		log: () => {},
		timelineEngine: null,
		getState: null,
	}
}

test('POST /api/amcp/batch does NOT schedule a compose-preview settle (coupling reverted in WO-198)', async () => {
	activity.reset()
	const amcp = makeOfflineAmcp()
	const ctx = makeAppCtx(amcp)
	assert.equal(activity.isComposePreviewSettled(31), true, 'channel starts settled')
	// Real callers (`postAmcpPreviewPipeline`) send MIXER-only batches for fill/rotation/opacity edits.
	const lines = ['MIXER 31-10 FILL 0 0 1 1 DEFER', 'MIXER 31-10 OPACITY 800 DEFER']
	const res = await routeRequest('POST', '/api/amcp/batch', JSON.stringify({ commands: lines }), ctx, null)
	assert.equal(res.status, 200)
	assert.equal(
		activity.isComposePreviewSettled(31),
		true,
		'touched channel must stay settled — /api/amcp/batch no longer calls onAmcpBatchMutation (WO-198 reverts T155.4b)',
	)
})

test('POST /api/amcp/batch with PLAY/STOP/CLEAR does not affect settle either', async () => {
	activity.reset()
	const amcp = makeOfflineAmcp()
	const ctx = makeAppCtx(amcp)
	const lines = ['PLAY 33-10 AMB', 'STOP 34-20', 'CLEAR 35']
	const res = await routeRequest('POST', '/api/amcp/batch', JSON.stringify({ commands: lines }), ctx, null)
	assert.equal(res.status, 200)
	// None of these should have been settled by the batch handler.
	for (const ch of [33, 34, 35]) {
		assert.equal(
			activity.isComposePreviewSettled(ch),
			true,
			`channel ${ch} must stay settled — batch handler does not trigger settle (WO-198)`,
		)
	}
})

test('Other paths still settle channels correctly (e.g., /api/play)', async () => {
	activity.reset()
	const amcp = makeOfflineAmcp()
	const ctx = makeAppCtx(amcp)
	const res = await routeRequest(
		'POST',
		'/api/play',
		JSON.stringify({ channel: 40, layer: 10, clip: 'test.mov' }),
		ctx,
		null,
	)
	assert.equal(res.status, 200)
	assert.equal(
		activity.isComposePreviewSettled(40),
		false,
		'/api/play still settles via onProgramMutation (unchanged)',
	)
})
