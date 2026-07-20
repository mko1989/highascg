'use strict'

/**
 * WO-272 — operator-GUI PGM-edit + capture buttons (offline smoke).
 *
 * Server side of the feature:
 *  - /api/preview/mixer-nudge `target: 'pgm'`: same nudge machinery pointed at the PGM channel,
 *    bank-aware (bank B = logical + 100, re-read inside the take chain) and staleness-guarded
 *    against what is LIVE on the PGM channel (src/api/routes-preview-nudge.js).
 *  - /api/pgm/capture: Caspar PRINT of the resolved PGM channel (src/api/routes-pgm-capture.js).
 *
 * Conventions copied from smoke-preview-mixer-nudge.test.js: pure helpers + stubbed ctx,
 * persistence KEY save/restore, default routing (screen 1 pgm_prv → PGM ch 1, PRV ch 2).
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	handlePreviewMixerNudge,
	buildNudgeLinesForLayer,
	resolveNudgePgmChannel,
	isPgmNudgeTarget,
} = require('../../src/api/routes-preview-nudge')
const { handlePgmCapture, resolvePgmCaptureChannel } = require('../../src/api/routes-pgm-capture')
const liveSceneState = require('../../src/state/live-scene-state')
const persistence = require('../../src/utils/persistence')

/** Default single-screen pgm_prv routing: PGM ch 1, PRV ch 2. */
function baseCtx(extra = {}) {
	return {
		config: {
			screen_count: 1,
			casparServer: { screen_count: 1, channel_layout: 'mono' },
			screenDestinations: [{ id: 'm1', mainScreenIndex: 0, mode: 'pgm_prv' }],
		},
		switcherOutputBusByChannel: {},
		log: () => {},
		...extra,
	}
}

function amcpRecorder(events) {
	return {
		batchSendChunked: async (lines, opts) => {
			events.push({ t: 'batchSendChunked', lines: [...lines], opts })
			return { ok: true }
		},
		raw: async (line) => {
			events.push({ t: 'raw', line })
			return { ok: true }
		},
	}
}

// ---------------------------------------------------------------------------
// buildNudgeLinesForLayer: physical-layer override (bank B mapping)
// ---------------------------------------------------------------------------

test('buildNudgeLinesForLayer: physicalLayer override targets the bank-B layer, not the logical one', () => {
	const layer = { layerNumber: 12, rotation: 0, opacity: 0.8 }
	const f = { x: 0.1, y: 0.2, scaleX: 0.5, scaleY: 0.5 }

	const lines = buildNudgeLinesForLayer(1, layer, f, 112)

	assert.ok(
		lines.some((l) => l === 'MIXER 1-112 FILL 0.1 0.2 0.5 0.5 0 DEFER'),
		`Expected bank-B FILL on 1-112, got: ${JSON.stringify(lines)}`,
	)
	assert.ok(
		lines.some((l) => l === 'MIXER 1-112 OPACITY 0.8 0 DEFER'),
		`Expected bank-B OPACITY on 1-112, got: ${JSON.stringify(lines)}`,
	)
	assert.ok(
		lines.every((l) => !l.startsWith('MIXER 1-12 ')),
		`No line may target the logical layer 12 directly: ${JSON.stringify(lines)}`,
	)
})

test('buildNudgeLinesForLayer: without physicalLayer the logical layer IS the physical layer (bank-less PRV)', () => {
	const lines = buildNudgeLinesForLayer(2, { layerNumber: 12, rotation: 0 }, { x: 0, y: 0, scaleX: 1, scaleY: 1 })
	assert.ok(
		lines.some((l) => l.startsWith('MIXER 2-12 FILL ')),
		`Expected FILL on 2-12, got: ${JSON.stringify(lines)}`,
	)
})

// ---------------------------------------------------------------------------
// resolveNudgePgmChannel / isPgmNudgeTarget
// ---------------------------------------------------------------------------

test('resolveNudgePgmChannel: resolves mainIndex 0 to PGM channel 1 (default routing)', () => {
	assert.equal(resolveNudgePgmChannel(baseCtx(), { mainIndex: 0 }), 1)
})

test('resolveNudgePgmChannel: accepts an explicit channel only when it is a program channel', () => {
	assert.equal(resolveNudgePgmChannel(baseCtx(), { channel: 1 }), 1)
	assert.equal(resolveNudgePgmChannel(baseCtx(), { channel: 2 }), null, 'PRV channel must not resolve as PGM')
	assert.equal(resolveNudgePgmChannel(baseCtx(), { channel: 999 }), null)
})

test('isPgmNudgeTarget: only target "pgm" (case-insensitive) selects the PGM path', () => {
	assert.equal(isPgmNudgeTarget({ target: 'pgm' }), true)
	assert.equal(isPgmNudgeTarget({ target: 'PGM' }), true)
	assert.equal(isPgmNudgeTarget({ target: 'preview' }), false)
	assert.equal(isPgmNudgeTarget({}), false)
})

// ---------------------------------------------------------------------------
// handlePreviewMixerNudge target:'pgm' — bank mapping + staleness guard
// ---------------------------------------------------------------------------

test('mixer-nudge target pgm: bank B maps logical 10 to physical 110 and commits the PGM channel', async () => {
	const KEY = liveSceneState.KEY
	const prev = persistence.get(KEY)
	const sceneId = 'wo272-live-look'
	persistence.set(KEY, {
		1: { sceneId, scene: { id: sceneId, layers: [] }, updatedAt: Date.now() },
	})

	const events = []
	const ctx = baseCtx({
		amcp: amcpRecorder(events),
		programLayerBankByChannel: { 1: 'b' },
	})

	try {
		const result = await handlePreviewMixerNudge(
			JSON.stringify({ mainIndex: 0, sceneId, target: 'pgm', layers: [{ layerNumber: 10, opacity: 1 }] }),
			ctx,
		)
		const body = JSON.parse(result.body)
		assert.equal(body.ok, true, `nudge should emit: ${result.body}`)
		assert.equal(body.target, 'pgm')
		assert.equal(body.previewChannel, 1, 'PGM target resolves to program channel 1')

		assert.equal(events.length, 2, `expected batch + COMMIT, got: ${JSON.stringify(events)}`)
		const batch = events[0]
		assert.equal(batch.t, 'batchSendChunked')
		assert.ok(
			batch.lines.every((l) => l.startsWith('MIXER 1-110 ')),
			`bank B: every line must target physical layer 110, got: ${JSON.stringify(batch.lines)}`,
		)
		assert.equal(events[1].line, 'MIXER 1 COMMIT')
	} finally {
		persistence.set(KEY, prev)
	}
})

test('mixer-nudge target pgm: bank A (default) keeps logical layer numbers', async () => {
	const KEY = liveSceneState.KEY
	const prev = persistence.get(KEY)
	const sceneId = 'wo272-bank-a'
	persistence.set(KEY, {
		1: { sceneId, scene: { id: sceneId, layers: [] }, updatedAt: Date.now() },
	})

	const events = []
	const ctx = baseCtx({ amcp: amcpRecorder(events) })

	try {
		const result = await handlePreviewMixerNudge(
			JSON.stringify({ mainIndex: 0, sceneId, target: 'pgm', layers: [{ layerNumber: 10, opacity: 1 }] }),
			ctx,
		)
		assert.equal(JSON.parse(result.body).ok, true)
		const batch = events[0]
		assert.ok(
			batch.lines.every((l) => l.startsWith('MIXER 1-10 ')),
			`bank A: lines must target logical layer 10, got: ${JSON.stringify(batch.lines)}`,
		)
	} finally {
		persistence.set(KEY, prev)
	}
})

test('mixer-nudge target pgm: staleness guard — look not live on PGM emits nothing', async () => {
	const KEY = liveSceneState.KEY
	const prev = persistence.get(KEY)
	persistence.set(KEY, {
		1: { sceneId: 'something-else', scene: { id: 'something-else', layers: [] }, updatedAt: Date.now() },
	})

	const events = []
	const ctx = baseCtx({ amcp: amcpRecorder(events) })

	try {
		const result = await handlePreviewMixerNudge(
			JSON.stringify({ mainIndex: 0, sceneId: 'wo272-edited', target: 'pgm', layers: [{ layerNumber: 10 }] }),
			ctx,
		)
		const body = JSON.parse(result.body)
		assert.equal(body.ok, false)
		assert.equal(body.staged, false)
		assert.equal(events.length, 0, `zero AMCP calls expected, got: ${JSON.stringify(events)}`)
	} finally {
		persistence.set(KEY, prev)
	}
})

// ---------------------------------------------------------------------------
// /api/pgm/capture — PRINT of the resolved PGM channel
// ---------------------------------------------------------------------------

test('resolvePgmCaptureChannel: mainIndex resolves to the program channel; PRV channel rejected', () => {
	assert.equal(resolvePgmCaptureChannel(baseCtx(), { mainIndex: 0 }), 1)
	assert.equal(resolvePgmCaptureChannel(baseCtx(), { channel: 1 }), 1)
	assert.equal(resolvePgmCaptureChannel(baseCtx(), { channel: 2 }), null)
	assert.equal(resolvePgmCaptureChannel(baseCtx(), {}), null)
})

test('handlePgmCapture: sends PRINT for the resolved PGM channel and returns the parsed file name', async () => {
	const printCalls = []
	const ctx = baseCtx({
		amcp: {
			basic: {
				print: async (ch) => {
					printCalls.push(ch)
					return { ok: true, data: ['20260719T101010.png'] }
				},
			},
		},
	})

	const result = await handlePgmCapture(JSON.stringify({ mainIndex: 0 }), ctx)
	assert.equal(result.status, 200)
	const body = JSON.parse(result.body)
	assert.equal(body.ok, true)
	assert.equal(body.channel, 1)
	assert.equal(body.file, '20260719T101010.png')
	assert.deepEqual(printCalls, [1], 'PRINT must hit exactly the resolved PGM channel')
})

test('handlePgmCapture: 503 without Caspar, 400 for unresolvable channel, 502 on PRINT failure', async () => {
	const noCaspar = await handlePgmCapture(JSON.stringify({ mainIndex: 0 }), baseCtx())
	assert.equal(noCaspar.status, 503)

	const okAmcp = { basic: { print: async () => ({ ok: true, data: [] }) } }
	const badChannel = await handlePgmCapture(JSON.stringify({ channel: 2 }), baseCtx({ amcp: okAmcp }))
	assert.equal(badChannel.status, 400)

	const failAmcp = { basic: { print: async () => ({ ok: false }) } }
	const printFail = await handlePgmCapture(JSON.stringify({ mainIndex: 0 }), baseCtx({ amcp: failAmcp }))
	assert.equal(printFail.status, 502)
})
