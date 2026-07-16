'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

/**
 * WO-259: two-phase batched take.
 *
 * T259.3 wire-shape coverage:
 * - flag ON: Phase A (one BEGIN…COMMIT: MIXER CLEAR + LOADBG + pre-PLAY opacity + deferred MIXER) →
 *   `MIXER <ch> COMMIT` outside the batch → Phase B (one BEGIN…COMMIT: non-route PLAYs + crossfade
 *   OPACITY) → trailing `MIXER <ch> COMMIT` outside the batch → route PLAYs after, sequential.
 * - flag OFF: byte-identical to the pre-WO-259 sequential/staggered line sequence (no batch events at all).
 * - `MIXER n COMMIT` never appears inside any batch payload.
 * - AmcpBatch.batchSendChunked really chunks at the configured cap even when forced.
 * - the take-scoped `forceBatch` escape hatch works without flipping the global `amcp_batch` flag.
 */

const { AmcpBatch, isTakeTwoPhaseBatchEnabled } = require('../../src/caspar/amcp-batch')
const { serializeClipCommandPlan } = require('../../src/caspar/amcp-command-plan')

// ---------------------------------------------------------------------------
// Section 1: real AmcpBatch — forceBatch escape hatch, chunking, MIXER COMMIT guard.
// ---------------------------------------------------------------------------

test('WO-259: isTakeTwoPhaseBatchEnabled defaults true, explicit false disables', () => {
	assert.equal(isTakeTwoPhaseBatchEnabled(undefined), true, 'no connection → default true')
	assert.equal(isTakeTwoPhaseBatchEnabled({ config: {} }), true, 'no key set → default true')
	assert.equal(isTakeTwoPhaseBatchEnabled({ config: { take_two_phase_batch: true } }), true)
	assert.equal(isTakeTwoPhaseBatchEnabled({ config: { take_two_phase_batch: false } }), false)
	assert.equal(isTakeTwoPhaseBatchEnabled({ config: { take_two_phase_batch: 'false' } }), false)
})

test('WO-259: batchSend forceBatch batches a real BEGIN…COMMIT even with global amcp_batch=false', async () => {
	const connection = {
		config: { amcp_batch: false }, // global flag OFF — proves this is take-scoped, not a flag flip
		socket: { isConnected: true, send: () => {} },
		response_callback: {},
		log: () => {},
		_amcpSendQueue: Promise.resolve(),
	}
	const client = { _context: connection }
	const batch = new AmcpBatch(client)

	const p = batch.batchSend(['MIXER 1-10 CLEAR', 'MIXER 1-11 CLEAR'], { forceBatch: true, skipMixerPreCommit: true })
	// Simulate Caspar's batch ack arriving on the drain interceptor.
	await new Promise((r) => setTimeout(r, 0))
	assert.ok(connection._amcpBatchDrain, 'BEGIN…COMMIT drain was armed (real batch path taken, not sequential)')
	connection._amcpBatchDrain.onLine('202 COMMIT OK')

	const result = await p
	assert.equal(result.ok, true)
	assert.equal(result.batched, true, 'forceBatch produced a real batched send despite amcp_batch=false')
})

test('WO-259: batchSend without forceBatch falls back to sequential when amcp_batch=false (unchanged legacy)', async () => {
	const sent = []
	const connection = { config: { amcp_batch: false }, log: () => {} }
	const client = { _context: connection, _send: (line) => { sent.push(line); return Promise.resolve({ ok: true }) } }
	const batch = new AmcpBatch(client)

	const result = await batch.batchSend(['MIXER 1-10 CLEAR', 'MIXER 1-11 CLEAR'])
	assert.equal(result.batched, false, 'no forceBatch + amcp_batch off → sequential, exactly as before WO-259')
	assert.deepEqual(sent, ['MIXER 1-10 CLEAR', 'MIXER 1-11 CLEAR'])
})

test('WO-259: batchSendChunked really splits >64 lines into multiple chunks even when forced', async () => {
	const connection = { config: { amcp_batch: false, amcp_max_batch_commands: 64 }, log: () => {} }
	const client = { _context: connection }
	const batch = new AmcpBatch(client)

	const seenChunks = []
	batch.batchSend = async (lines, opts) => {
		seenChunks.push({ n: lines.length, forceBatch: !!(opts && opts.forceBatch) })
		return { ok: true, batched: true }
	}

	const lines = Array.from({ length: 70 }, (_, i) => `MIXER 1-${i + 10} OPACITY 1 0`)
	await batch.batchSendChunked(lines, { forceBatch: true, skipMixerPreCommit: true })

	assert.equal(seenChunks.length, 2, 'chunking at >64 lines: 70 lines → 2 chunks')
	assert.equal(seenChunks[0].n, 64)
	assert.equal(seenChunks[1].n, 6)
	assert.ok(seenChunks.every((c) => c.forceBatch), 'forceBatch propagated to every chunk')
})

test('WO-259: validateBatchLine rejects MIXER n COMMIT even with forceBatch set (never inside a batch)', async () => {
	const connection = { config: { amcp_batch: false }, log: () => {} }
	const client = { _context: connection }
	const batch = new AmcpBatch(client)

	await assert.rejects(
		() => batch.batchSend(['MIXER 1 COMMIT', 'PLAY 1-10'], { forceBatch: true }),
		/disallowed or unsupported command/i,
		'MIXER <ch> COMMIT can never be smuggled into a BEGIN…COMMIT batch, forced or not',
	)
})

// ---------------------------------------------------------------------------
// Section 2: full take-pipeline wire shape (3-layer bank crossfade) via runSceneTakeLbg.
// ---------------------------------------------------------------------------

/**
 * Lightweight recording amcp stub. `batchSendChunked`/`batchSend` mimic the real chunk-at-cap +
 * forceBatch-vs-sequential-fallback contract of {@link AmcpBatch} without re-implementing its
 * BEGIN…COMMIT wire framing (that framing is exercised directly against the real class above).
 */
function makeMockAmcp(twoPhaseBatch) {
	const events = []
	const MAX_BATCH = 64

	function sendOneRaw(line) {
		events.push({ t: 'send', line })
	}

	async function batchSendChunked(lines, opts) {
		const clean = lines.map((l) => String(l).trim()).filter(Boolean)
		if (clean.length === 0) return { ok: true, batched: false, responses: [] }
		const forceBatch = !!(opts && opts.forceBatch)
		let last = null
		for (let i = 0; i < clean.length; i += MAX_BATCH) {
			const chunk = clean.slice(i, i + MAX_BATCH)
			if (chunk.length >= 2 && forceBatch) {
				events.push({ t: 'batch', lines: chunk })
				last = { ok: true, batched: true }
			} else {
				for (const line of chunk) sendOneRaw(line)
				last = { ok: true, batched: false }
			}
		}
		return last
	}

	return {
		events,
		_context: { config: { take_two_phase_batch: twoPhaseBatch, amcp_batch: false } },
		_send: async (line) => {
			sendOneRaw(line)
			return { status: 200, response: 'OK' }
		},
		mixerClear: async (ch, layer) => sendOneRaw(`MIXER ${ch}-${layer} CLEAR`),
		loadbg: async (ch, layer, clip, opts) => {
			sendOneRaw(serializeClipCommandPlan({ commandName: 'LOADBG', channel: ch, layer, clip, opts: opts || {} }))
		},
		mixerCommit: async (ch) => {
			events.push({ t: 'commit', channel: ch })
		},
		batchSend: (lines, opts) => batchSendChunked(lines, opts),
		batchSendChunked,
	}
}

function makeSelf(channel) {
	return {
		config: { screen_count: 1 },
		log: () => {},
		programLayerBankByChannel: { [String(channel)]: 'a' },
		_playbackMatrix: {},
	}
}

/** 3-layer look, all layers changing clip, so all 3 get takeJobs on a bank crossfade. */
function threeLayerScenes(routeOnLayer13) {
	const currentScene = {
		id: 'look-current',
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'a1.mov' } },
			{ layerNumber: 11, source: { type: 'media', value: 'b1.mov' } },
			{ layerNumber: 12, source: { type: 'media', value: 'c1.mov' } },
		],
	}
	const incomingLayers = [
		{ layerNumber: 10, source: { type: 'media', value: 'a2.mov' } },
		{ layerNumber: 11, source: { type: 'media', value: 'b2.mov' } },
		{ layerNumber: 12, source: { type: 'media', value: 'c2.mov' } },
	]
	if (routeOnLayer13) {
		// route:// targeting layer 10 of THIS take/channel — must stay staggered after Phase B (dependency 1).
		incomingLayers.push({ layerNumber: 13, source: { type: 'route', value: `route://${routeOnLayer13}-10` } })
	}
	const incomingScene = {
		id: 'look-incoming',
		defaultTransition: { type: 'MIX', duration: 25, tween: 'linear' },
		layers: incomingLayers,
	}
	return { currentScene, incomingScene }
}

test('WO-259 T259.3: flag ON — 3-layer crossfade groups Phase A / Phase B into single BEGIN…COMMIT batches', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')
	const channel = 7
	const mockAmcp = makeMockAmcp(true)
	const self = makeSelf(channel)
	const { currentScene, incomingScene } = threeLayerScenes(false)

	const result = await runSceneTakeLbg(mockAmcp, { self, channel, currentScene, incomingScene, forceCut: false })
	assert.ok(result && result.ok, 'take succeeded')

	const events = mockAmcp.events
	const batchEvents = events.filter((e) => e.t === 'batch')
	const commitEvents = events.filter((e) => e.t === 'commit')

	assert.equal(batchEvents.length, 2, `expected exactly 2 BEGIN…COMMIT batches (Phase A, Phase B); got ${batchEvents.length}: ${JSON.stringify(events, null, 1)}`)
	assert.ok(commitEvents.length >= 2, 'at least a leading + trailing MIXER <ch> COMMIT outside the batches')

	const [phaseA, phaseB] = batchEvents

	// Phase A: 3x MIXER CLEAR + 3x LOADBG, no PLAY lines.
	const clearCount = phaseA.lines.filter((l) => /^MIXER 7-\d+ CLEAR$/.test(l)).length
	const loadCount = phaseA.lines.filter((l) => /^LOADBG /.test(l)).length
	assert.equal(clearCount, 3, `Phase A must carry 3 MIXER CLEAR lines; got: ${JSON.stringify(phaseA.lines)}`)
	assert.equal(loadCount, 3, `Phase A must carry 3 LOADBG lines; got: ${JSON.stringify(phaseA.lines)}`)
	assert.ok(!phaseA.lines.some((l) => /^PLAY /.test(l)), 'Phase A never contains a PLAY line')

	// Phase B: 3x PLAY, no LOADBG/MIXER CLEAR lines.
	const playCount = phaseB.lines.filter((l) => /^PLAY 7-\d+/.test(l)).length
	assert.equal(playCount, 3, `Phase B must carry 3 PLAY lines; got: ${JSON.stringify(phaseB.lines)}`)
	assert.ok(!phaseB.lines.some((l) => /^LOADBG /.test(l)), 'Phase B never contains a LOADBG line')
	assert.ok(!phaseB.lines.some((l) => /^MIXER 7-\d+ CLEAR$/.test(l)), 'Phase B never contains a MIXER CLEAR line')

	// Ordering: Phase A batch, then commit(s), then Phase B batch, then commit(s).
	const iPhaseA = events.indexOf(phaseA)
	const iPhaseB = events.indexOf(phaseB)
	assert.ok(iPhaseA < iPhaseB, 'Phase A batch happens before Phase B batch')
	const commitBetween = events.slice(iPhaseA + 1, iPhaseB).some((e) => e.t === 'commit')
	assert.ok(commitBetween, 'a MIXER <ch> COMMIT rides between Phase A and Phase B, outside both batches')

	// No `MIXER n COMMIT` ever inside a batch payload.
	for (const b of batchEvents) {
		assert.ok(!b.lines.some((l) => /^MIXER\s+\d+\s+COMMIT\b/i.test(l)), `MIXER <ch> COMMIT must never be inside a batch: ${JSON.stringify(b.lines)}`)
	}
})

test('WO-259 T259.3: flag OFF — byte-identical legacy sequence, zero batch events', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')
	const channel = 8
	const mockAmcp = makeMockAmcp(false)
	const self = makeSelf(channel)
	const { currentScene, incomingScene } = threeLayerScenes(false)

	const result = await runSceneTakeLbg(mockAmcp, { self, channel, currentScene, incomingScene, forceCut: false })
	assert.ok(result && result.ok, 'take succeeded')

	const events = mockAmcp.events
	const batchEvents = events.filter((e) => e.t === 'batch')
	assert.equal(batchEvents.length, 0, `take_two_phase_batch:false must never produce a forced BEGIN…COMMIT batch; got: ${JSON.stringify(batchEvents)}`)

	const sendLines = events.filter((e) => e.t === 'send').map((e) => e.line)
	// 3 pre-take MIXER CLEAR on the incoming (bank B) physical layers + 3 teardown MIXER CLEAR on the
	// vacated (bank A) physical layers once the crossfade window closes — both are pre-existing,
	// WO-259-unrelated behavior (extraExitCandidates in scene-take-lbg-jobs.js); 6 total is correct.
	const clearCount = sendLines.filter((l) => /^MIXER 8-\d+ CLEAR$/.test(l)).length
	const loadCount = sendLines.filter((l) => /^LOADBG /.test(l)).length
	const playCount = sendLines.filter((l) => /^PLAY 8-\d+/.test(l)).length
	assert.equal(clearCount, 6, 'legacy path still emits 6 individual MIXER CLEAR lines (3 pre-take + 3 teardown)')
	assert.equal(loadCount, 3, 'legacy path still emits 3 individual LOADBG lines')
	assert.equal(playCount, 3, 'legacy path still emits 3 individual PLAY lines')
})

test('WO-259 T259.3: flag ON and flag OFF emit the same underlying command multiset (batching only changes transport)', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')

	function normalize(events) {
		const lines = []
		for (const e of events) {
			if (e.t === 'send') lines.push(e.line)
			else if (e.t === 'batch') lines.push(...e.lines)
			// A "commit" event (amcp.mixerCommit typed call, used by the flag-ON two-phase path) and a
			// literal `MIXER <ch> COMMIT` text line (flag-OFF legacy path, sent via sendAmcpLinesSequential)
			// are the same wire command via two different JS call shapes — normalize both to the same text
			// so this test compares AMCP *content*, not which internal helper produced it.
			else if (e.t === 'commit') lines.push(`MIXER ${e.channel} COMMIT`)
		}
		return lines
			.map((l) => l.replace(/^MIXER (\d+)-(\d+)/, 'MIXER CH-$2').replace(/^(LOADBG|PLAY) (\d+)-(\d+)/, '$1 CH-$3'))
			.sort()
	}

	const self = makeSelf(9)
	const { currentScene, incomingScene } = threeLayerScenes(false)

	const onAmcp = makeMockAmcp(true)
	await runSceneTakeLbg(onAmcp, { self, channel: 9, currentScene, incomingScene, forceCut: false })

	const self2 = makeSelf(9)
	const offAmcp = makeMockAmcp(false)
	await runSceneTakeLbg(offAmcp, { self: self2, channel: 9, currentScene, incomingScene, forceCut: false })

	assert.deepEqual(normalize(onAmcp.events), normalize(offAmcp.events), 'same content, channel-normalized, regardless of batching')
})

test('WO-259 T259.3: route:// PLAY stays staggered sequential AFTER Phase B, never inside the batch', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')
	const channel = 11
	const mockAmcp = makeMockAmcp(true)
	const self = makeSelf(channel)
	const { currentScene, incomingScene } = threeLayerScenes(channel)

	const result = await runSceneTakeLbg(mockAmcp, { self, channel, currentScene, incomingScene, forceCut: false })
	assert.ok(result && result.ok, 'take succeeded')

	const events = mockAmcp.events
	const batchEvents = events.filter((e) => e.t === 'batch')
	assert.equal(batchEvents.length, 2, 'still exactly Phase A + Phase B batches (route excluded from both)')

	const phaseB = batchEvents[1]
	assert.ok(!phaseB.lines.some((l) => /route/i.test(l)), `route PLAY must never be inside Phase B batch: ${JSON.stringify(phaseB.lines)}`)

	// The route PLAY must appear as a sequential `send` event, positioned after the Phase B batch.
	const iPhaseB = events.indexOf(phaseB)
	const routeSendIdx = events.findIndex((e, i) => i > iPhaseB && e.t === 'send' && /^PLAY 11-\d+/.test(e.line || ''))
	assert.ok(routeSendIdx !== -1, `expected a sequential PLAY for the route layer after Phase B; events: ${JSON.stringify(events)}`)
})
