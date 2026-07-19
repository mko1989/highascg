'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	handlePreviewMixerNudge,
	buildNudgeLinesForLayer,
	resolveNudgePreviewChannel,
	NUDGE_MAX_LAYERS,
} = require('../../src/api/routes-preview-nudge')
const liveSceneState = require('../../src/state/live-scene-state')
const persistence = require('../../src/utils/persistence')

// ---------------------------------------------------------------------------
// Test 1: buildNudgeLinesForLayer with rotation=0, opacity, no effects
// ---------------------------------------------------------------------------

test('buildNudgeLinesForLayer: rotation=0 produces FILL, ANCHOR, ROTATION, and OPACITY with DEFER', () => {
	const previewCh = 2
	const layer = {
		layerNumber: 21,
		rotation: 0,
		opacity: 0.5,
	}
	const f = { x: 0.1, y: 0.2, scaleX: 0.5, scaleY: 0.5 }

	const lines = buildNudgeLinesForLayer(previewCh, layer, f)

	// Verify that rotation=0 does NOT shift the FILL center (fillForSceneLayerRotationAnchor returns as-is)
	assert.ok(
		lines.some((l) => l === 'MIXER 2-21 FILL 0.1 0.2 0.5 0.5 0 DEFER'),
		`Expected FILL line with exact numbers, got: ${JSON.stringify(lines)}`,
	)

	// ANCHOR 0 0 0 (when rotation=0, no DEFER on anchor)
	assert.ok(
		lines.some((l) => l === 'MIXER 2-21 ANCHOR 0 0 0'),
		`Expected ANCHOR 0 0 0, got: ${JSON.stringify(lines)}`,
	)

	// ROTATION 0 0 DEFER (when rotation=0)
	assert.ok(
		lines.some((l) => l === 'MIXER 2-21 ROTATION 0 0 DEFER'),
		`Expected ROTATION 0 0 DEFER, got: ${JSON.stringify(lines)}`,
	)

	// OPACITY
	assert.ok(
		lines.some((l) => l === 'MIXER 2-21 OPACITY 0.5 0 DEFER'),
		`Expected OPACITY 0.5 0 DEFER, got: ${JSON.stringify(lines)}`,
	)

	// Most lines end with DEFER; ANCHOR does not when rotation=0
	const nonDeferLines = lines.filter((l) => !l.includes('DEFER'))
	assert.ok(nonDeferLines.every((l) => l.includes('ANCHOR')), `Only ANCHOR should lack DEFER: ${JSON.stringify(nonDeferLines)}`)
})

// ---------------------------------------------------------------------------
// Test 2: buildNudgeLinesForLayer with crop effect
// ---------------------------------------------------------------------------

test('buildNudgeLinesForLayer: crop effect produces crop MIXER line', () => {
	const previewCh = 3
	const layer = {
		layerNumber: 15,
		rotation: 0,
		effects: [
			{
				type: 'crop',
				params: { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 },
			},
		],
	}
	const f = { x: 0, y: 0, scaleX: 1, scaleY: 1 }

	const lines = buildNudgeLinesForLayer(previewCh, layer, f)

	// Crop line should be in the output
	const cropLine = lines.find((l) => l.startsWith('MIXER 3-15 CROP'))
	assert.ok(cropLine, `Expected a CROP line starting with 'MIXER 3-15 CROP', got: ${JSON.stringify(lines)}`)

	// Verify the crop line is constructed correctly
	assert.ok(
		cropLine.includes('0.1') && cropLine.includes('0.2') && cropLine.includes('0.9') && cropLine.includes('0.8'),
		`Crop line should contain the param values: ${cropLine}`,
	)
})

// ---------------------------------------------------------------------------
// Test 3: handlePreviewMixerNudge staleness guard
// ---------------------------------------------------------------------------

test('handlePreviewMixerNudge: sceneId mismatch returns ok:false staged:false, zero AMCP calls', async () => {
	const KEY = liveSceneState.KEY
	const prev = persistence.get(KEY)
	persistence.set(KEY, {
		'2': {
			sceneId: 'old-scene-id',
			scene: { id: 'old-scene-id', layers: [] },
			updatedAt: Date.now(),
		},
	})

	const amcpEvents = []
	const ctx = {
		config: {
			screen_count: 1,
			casparServer: { screen_count: 1, channel_layout: 'mono' },
			screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
		},
		switcherOutputBusByChannel: {},
		amcp: {
			batchSendChunked: async (lines, opts) => {
				amcpEvents.push({ t: 'batchSendChunked', lines: lines.length, opts })
				return { ok: true }
			},
			raw: async (line) => {
				amcpEvents.push({ t: 'raw', line })
				return { ok: true }
			},
		},
		log: () => {},
	}

	const body = JSON.stringify({
		mainIndex: 0,
		sceneId: 'request-scene-id', // Different from staged 'old-scene-id'
		layers: [
			{
				layerNumber: 10,
				opacity: 1,
			},
		],
	})

	const result = await handlePreviewMixerNudge(body, ctx)
	const responseBody = JSON.parse(result.body)

	assert.equal(responseBody.ok, false, 'ok should be false when sceneId mismatch')
	assert.equal(responseBody.staged, false, 'staged should be false when sceneId mismatch')
	assert.equal(amcpEvents.length, 0, `AMCP stub should receive zero calls, got: ${JSON.stringify(amcpEvents)}`)

	persistence.set(KEY, prev)
})

// ---------------------------------------------------------------------------
// Test 4: handlePreviewMixerNudge happy path
// ---------------------------------------------------------------------------

test('handlePreviewMixerNudge: matching sceneId triggers batchSendChunked + COMMIT', async () => {
	const KEY = liveSceneState.KEY
	const prev = persistence.get(KEY)
	const stagedSceneId = 'correct-scene-id'
	persistence.set(KEY, {
		'2': {
			sceneId: stagedSceneId,
			scene: { id: stagedSceneId, layers: [] },
			updatedAt: Date.now(),
		},
	})

	const amcpEvents = []
	const ctx = {
		config: {
			screen_count: 1,
			casparServer: { screen_count: 1, channel_layout: 'mono' },
			screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
		},
		switcherOutputBusByChannel: {},
		amcp: {
			batchSendChunked: async (lines, opts) => {
				amcpEvents.push({ t: 'batchSendChunked', lineCount: lines.length, opts })
				return { ok: true }
			},
			raw: async (line) => {
				amcpEvents.push({ t: 'raw', line })
				return { ok: true }
			},
		},
		log: () => {},
	}

	const body = JSON.stringify({
		mainIndex: 0,
		sceneId: stagedSceneId,
		layers: [
			{
				layerNumber: 10,
				opacity: 1,
			},
		],
	})

	// Mock getResolvedFillForSceneLayer
	const sceneFill = require('../../src/engine/scene-native-fill')
	const originalGetResolvedFill = sceneFill.getResolvedFillForSceneLayer
	sceneFill.getResolvedFillForSceneLayer = async () => ({
		x: 0,
		y: 0,
		scaleX: 1,
		scaleY: 1,
	})

	try {
		const result = await handlePreviewMixerNudge(body, ctx)
		const responseBody = JSON.parse(result.body)

		assert.equal(responseBody.ok, true, 'ok should be true when sceneId matches')
		assert.equal(amcpEvents.length, 2, `Should have 2 AMCP events (batchSendChunked + raw COMMIT), got ${amcpEvents.length}: ${JSON.stringify(amcpEvents)}`)

		const batchEvent = amcpEvents[0]
		assert.equal(batchEvent.t, 'batchSendChunked', 'First event should be batchSendChunked')
		assert.equal(batchEvent.opts.skipMixerPreCommit, true, 'batchSendChunked should have skipMixerPreCommit:true')

		const commitEvent = amcpEvents[1]
		assert.equal(commitEvent.t, 'raw', 'Second event should be raw')
		assert.equal(commitEvent.line, 'MIXER 2 COMMIT', 'Should send MIXER 2 COMMIT')
	} finally {
		sceneFill.getResolvedFillForSceneLayer = originalGetResolvedFill
		persistence.set(KEY, prev)
	}
})

// ---------------------------------------------------------------------------
// Test 5: Layer band guard
// ---------------------------------------------------------------------------

test('handlePreviewMixerNudge: layers outside LOOK_LAYER_MIN..LOOK_LAYER_MAX are skipped', async () => {
	const KEY = liveSceneState.KEY
	const prev = persistence.get(KEY)
	const stagedSceneId = 'band-guard-test'
	persistence.set(KEY, {
		'2': {
			sceneId: stagedSceneId,
			scene: { id: stagedSceneId, layers: [] },
			updatedAt: Date.now(),
		},
	})

	const amcpEvents = []
	const ctx = {
		config: {
			screen_count: 1,
			casparServer: { screen_count: 1, channel_layout: 'mono' },
			screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
		},
		switcherOutputBusByChannel: {},
		amcp: {
			batchSendChunked: async (lines, opts) => {
				amcpEvents.push({ t: 'batchSendChunked', lineCount: lines.length, opts })
				return { ok: true }
			},
			raw: async (line) => {
				amcpEvents.push({ t: 'raw', line })
				return { ok: true }
			},
		},
		log: () => {},
	}

	const body = JSON.stringify({
		mainIndex: 0,
		sceneId: stagedSceneId,
		layers: [
			{ layerNumber: 5, opacity: 1 }, // Below LOOK_LAYER_MIN
			{ layerNumber: 10, opacity: 1 }, // LOOK_LAYER_MIN - should be included
			{ layerNumber: 99, opacity: 1 }, // LOOK_LAYER_MAX - should be included
			{ layerNumber: 100, opacity: 1 }, // Above LOOK_LAYER_MAX
		],
	})

	// Mock getResolvedFillForSceneLayer
	const sceneFill = require('../../src/engine/scene-native-fill')
	const originalGetResolvedFill = sceneFill.getResolvedFillForSceneLayer
	sceneFill.getResolvedFillForSceneLayer = async () => ({
		x: 0,
		y: 0,
		scaleX: 1,
		scaleY: 1,
	})

	try {
		const result = await handlePreviewMixerNudge(body, ctx)
		const responseBody = JSON.parse(result.body)

		assert.equal(responseBody.ok, true, 'ok should be true')

		// Verify that only layers 10 and 99 produced lines
		const batchEvent = amcpEvents[0]
		assert.ok(batchEvent, 'Should have batchSendChunked event')

		// Each valid layer should produce: FILL + ANCHOR + ROTATION + OPACITY = 4 lines
		// 2 valid layers (10, 99) × 4 lines = 8 lines
		assert.equal(
			batchEvent.lineCount,
			8,
			`Should have 8 lines (2 valid layers × 4 lines each), got ${batchEvent.lineCount} from ${JSON.stringify(amcpEvents)}`,
		)

		const commitEvent = amcpEvents[1]
		assert.equal(commitEvent.t, 'raw', 'Second event should be raw COMMIT')
	} finally {
		sceneFill.getResolvedFillForSceneLayer = originalGetResolvedFill
		persistence.set(KEY, prev)
	}
})

// ---------------------------------------------------------------------------
// Test 6: resolveNudgePreviewChannel
// ---------------------------------------------------------------------------

test('resolveNudgePreviewChannel: resolves via mainIndex', () => {
	const ctx = {
		config: {
			screen_count: 1,
			casparServer: { screen_count: 1, channel_layout: 'mono' },
			screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
		},
		switcherOutputBusByChannel: {},
	}

	const b = { mainIndex: 0 }
	const ch = resolveNudgePreviewChannel(ctx, b)
	assert.equal(ch, 2, 'Should resolve mainIndex 0 to preview channel 2 (default routing)')
})

test('resolveNudgePreviewChannel: falls back to explicit channel', () => {
	const ctx = {
		config: {
			screen_count: 1,
			casparServer: { screen_count: 1, channel_layout: 'mono' },
			screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
		},
		switcherOutputBusByChannel: {},
	}

	const b = { channel: 2 }
	const ch = resolveNudgePreviewChannel(ctx, b)
	assert.equal(ch, 2, 'Should resolve explicit channel 2')
})

test('resolveNudgePreviewChannel: returns null when channel not found', () => {
	const ctx = {
		config: {
			screen_count: 1,
			casparServer: { screen_count: 1, channel_layout: 'mono' },
			screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
		},
		switcherOutputBusByChannel: {},
	}

	const b = { channel: 999 } // Non-existent channel
	const ch = resolveNudgePreviewChannel(ctx, b)
	assert.equal(ch, null, 'Should return null for non-existent channel')
})

// ---------------------------------------------------------------------------
// Test 7: NUDGE_MAX_LAYERS constant
// ---------------------------------------------------------------------------

test('NUDGE_MAX_LAYERS is exported', () => {
	assert.equal(typeof NUDGE_MAX_LAYERS, 'number')
	assert.ok(NUDGE_MAX_LAYERS > 0, 'NUDGE_MAX_LAYERS should be a positive number')
})
