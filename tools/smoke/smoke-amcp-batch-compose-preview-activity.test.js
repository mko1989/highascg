'use strict'

/**
 * WO-155 T155.4b — `POST /api/amcp/batch` is the transport the scenes-editor look-stack PRV push
 * uses (MIXER…DEFER + COMMIT for fill/rotation/opacity edits, or PLAY for content changes), but —
 * unlike /api/play, /api/stop, /api/clear — it never nudged compose-preview activity for the
 * touched channel (B155.3 finding c). Offline router + simulated AMCP — no live Caspar required.
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

test('POST /api/amcp/batch schedules a compose-preview settle for a MIXER-only touched channel', async () => {
	activity.reset()
	const amcp = makeOfflineAmcp()
	const ctx = makeAppCtx(amcp)
	assert.equal(activity.isComposePreviewSettled(31), true)
	// Real callers (`postAmcpPreviewPipeline`) never put channel-level `MIXER <ch> COMMIT` in the
	// batch itself — that goes via /api/raw separately — so this mirrors an actual MIXER-only push.
	const lines = ['MIXER 31-10 FILL 0 0 1 1 DEFER', 'MIXER 31-10 OPACITY 800 DEFER']
	const res = await routeRequest('POST', '/api/amcp/batch', JSON.stringify({ commands: lines }), ctx, null)
	assert.equal(res.status, 200)
	assert.equal(
		activity.isComposePreviewSettled(31),
		false,
		'touched channel should be settling immediately after a MIXER-only batch',
	)
})

test('POST /api/amcp/batch does not mark an unrelated channel', async () => {
	activity.reset()
	const amcp = makeOfflineAmcp()
	const ctx = makeAppCtx(amcp)
	const lines = ['MIXER 32-10 OPACITY 800 DEFER']
	const res = await routeRequest('POST', '/api/amcp/batch', JSON.stringify({ commands: lines }), ctx, null)
	assert.equal(res.status, 200)
	assert.equal(activity.isComposePreviewSettled(32), false)
	assert.equal(activity.isComposePreviewSettled(99), true, 'untouched channel must stay settled')
})

test('POST /api/amcp/batch extracts channels from PLAY/STOP/CLEAR lines too', async () => {
	activity.reset()
	const amcp = makeOfflineAmcp()
	const ctx = makeAppCtx(amcp)
	const lines = ['PLAY 33-10 AMB', 'STOP 34-20', 'CLEAR 35']
	const res = await routeRequest('POST', '/api/amcp/batch', JSON.stringify({ commands: lines }), ctx, null)
	assert.equal(res.status, 200)
	for (const ch of [33, 34, 35]) {
		assert.equal(activity.isComposePreviewSettled(ch), false, `channel ${ch} should be settling`)
	}
})
