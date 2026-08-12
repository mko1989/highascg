'use strict'

/**
 * WO-492 — AMCP CLEAR chatter on connect/start. Three independent findings, one file.
 *
 * A. `template-cg-orphan-sweep` ran against a dead socket (observed 11.08 15:54:13,
 *    `clear batch failed: Not connected`), and on its blind path built 90 lines per channel for a
 *    batch nothing would receive.
 * B. `multiview-apply` fired `CG n-999 CLEAR` + `MIXER n-999 CLEAR` + COMMIT on every routed
 *    PGM/PRV channel on EVERY apply, never checking whether layer 999 held anything (measured:
 *    ten triples in 50 s on an idle box).
 * C. `multiview-apply` computed a precise `layersToClear`, logged it as "surgical CLEAR", then
 *    discarded it and sent a whole-channel `CLEAR <ch>` down BOTH branches.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

// ---------------------------------------------------------------------------
// A — the orphan sweep must not run against a dead socket
// ---------------------------------------------------------------------------

const { sweepTemplateCgOrphansOnCasparConnected } = require('../../src/engine/template-cg-orphan-sweep')

function sweepAmcp({ isConnected }) {
	const sent = []
	const amcp = {
		batchSendChunked: async (lines) => {
			sent.push(...lines)
		},
	}
	if (isConnected !== undefined) Object.defineProperty(amcp, 'isConnected', { get: () => isConnected })
	return { amcp, sent }
}

test('WO-492 A: a disconnected AMCP is not swept at all', async () => {
	const { amcp, sent } = sweepAmcp({ isConnected: false })
	const res = await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channels: [1, 3],
		channelXml: {}, // no XML => this is exactly the blind path that emitted 180 lines
		log: () => {},
	})
	assert.equal(sent.length, 0, 'nothing may be queued for a socket that cannot receive it')
	assert.equal(res.clearedCount, 0)
})

test('WO-492 A: a connected AMCP still sweeps (the guard is not a kill-switch)', async () => {
	const { amcp, sent } = sweepAmcp({ isConnected: true })
	await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channels: [1],
		channelXml: {},
		log: () => {},
	})
	assert.equal(sent.length, 90, 'the deliberate WO-482 blind fallback still runs when connected')
})

test('WO-492 A: a test double without the getter is unaffected', async () => {
	const { amcp, sent } = sweepAmcp({})
	await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channels: [1],
		channelXml: {},
		log: () => {},
	})
	assert.equal(sent.length, 90, 'undefined isConnected must not be read as disconnected')
})

// ---------------------------------------------------------------------------
// B — layer 999 is probed before it is cleared
// ---------------------------------------------------------------------------

const {
	clearLedTestLayerOnChannelsIfPresent,
	markLedTestLayerPainted,
} = require('../../src/bootstrap/startup-led-test-pattern')

/** @param {Record<number, boolean>} occupied - channel -> is layer 999 loaded */
function ledAmcp(occupied) {
	const calls = { cgClear: [], mixerClear: [], info: [] }
	const amcp = {
		isConnected: true,
		cg: { cgClear: async (ch, layer) => calls.cgClear.push(`${ch}-${layer}`) },
		mixerClear: async (ch, layer) => calls.mixerClear.push(`${ch}-${layer}`),
		mixerCommit: async () => {},
		// NB: `infoResponseToXml` reads `res.data`, not `res.text` — a mock using `.text` yields an
		// empty string, which the gate correctly treats as "unknown" and clears.
		info: async (ch) => {
			calls.info.push(ch)
			const layer999 = occupied[ch]
				? '<layer_999><foreground><producer>html</producer></foreground></layer_999>'
				: ''
			return {
				data: `<?xml version="1.0"?><channel><stage><layer>${layer999}</layer></stage></channel>`,
			}
		},
	}
	return { amcp, calls }
}

test('WO-492 B: an empty layer 999 is probed once and never cleared', async () => {
	const { amcp, calls } = ledAmcp({ 1: false, 2: false, 3: false })
	const ctx = {}

	await clearLedTestLayerOnChannelsIfPresent(ctx, amcp, [1, 2, 3], () => {})
	assert.deepEqual(calls.cgClear, [], 'nothing on 999 => no CG CLEAR')
	assert.deepEqual(calls.mixerClear, [], 'nothing on 999 => no MIXER CLEAR')
	assert.deepEqual(calls.info, [1, 2, 3], 'one INFO probe per channel')

	// The steady state: every subsequent apply must be completely silent, probe included.
	await clearLedTestLayerOnChannelsIfPresent(ctx, amcp, [1, 2, 3], () => {})
	await clearLedTestLayerOnChannelsIfPresent(ctx, amcp, [1, 2, 3], () => {})
	assert.deepEqual(calls.info, [1, 2, 3], 'the "provably empty" result is cached, not re-probed')
	assert.deepEqual(calls.cgClear, [], 'still no clears')
})

test('WO-492 B: an OCCUPIED layer 999 is still cleared', async () => {
	const { amcp, calls } = ledAmcp({ 1: true, 2: false })
	await clearLedTestLayerOnChannelsIfPresent({}, amcp, [1, 2], () => {})
	assert.deepEqual(calls.cgClear, ['1-999'], 'the channel actually carrying the card is cleared')
	assert.deepEqual(calls.mixerClear, ['1-999'])
})

test('WO-492 B: repainting the card invalidates the cache', async () => {
	const { amcp, calls } = ledAmcp({ 1: false })
	const ctx = {}
	await clearLedTestLayerOnChannelsIfPresent(ctx, amcp, [1], () => {})
	assert.equal(calls.info.length, 1)

	markLedTestLayerPainted(ctx)
	await clearLedTestLayerOnChannelsIfPresent(ctx, amcp, [1], () => {})
	assert.equal(calls.info.length, 2, 'after a repaint the channel must be probed again')
})

test('WO-492 B: an unreadable INFO falls back to clearing (uncertainty fails toward clearing)', async () => {
	const calls = { cgClear: [] }
	const amcp = {
		isConnected: true,
		cg: { cgClear: async (ch, layer) => calls.cgClear.push(`${ch}-${layer}`) },
		mixerClear: async () => {},
		mixerCommit: async () => {},
		info: async () => {
			throw new Error('INFO failed')
		},
	}
	await clearLedTestLayerOnChannelsIfPresent({}, amcp, [1], () => {})
	assert.deepEqual(calls.cgClear, ['1-999'], 'if we cannot see 999, clear it — same rule as WO-482')
})

// ---------------------------------------------------------------------------
// C — the surgical branch really is surgical
// ---------------------------------------------------------------------------

/** Drive applyMultiviewLayout with a channel map we control, recording every AMCP call. */
async function runApply({ infoXml }) {
	const Module = require('module')
	const originalRequire = Module.prototype.require
	const mockGetChannelMap = () => ({
		inputsCh: 1,
		previewChannels: [2],
		programChannels: [3, 4],
		screenCount: 2,
		programCh: (n) => 2 + n,
		multiviewChannels: [99],
	})
	Module.prototype.require = function (id) {
		const result = originalRequire.apply(this, arguments)
		if (id === '../config/routing') return { ...result, getChannelMap: mockGetChannelMap }
		return result
	}
	try {
		delete require.cache[require.resolve('../../src/engine/multiview-apply.js')]
		const { applyMultiviewLayout } = require('../../src/engine/multiview-apply')

		const rec = { batched: [], raw: [], wholeChannelClear: 0 }
		const amcp = {
			isConnected: true,
			play: async () => {},
			mixerFill: async () => {},
			mixerCommit: async () => {},
			cgAdd: async () => {
				throw new Error('CG not available')
			},
			cgUpdate: async () => {},
			cgPlay: async () => {},
			cg: { cgClear: async () => {} },
			mixerClear: async () => {},
			batchSend: async (lines) => rec.batched.push(...lines),
			batchSendChunked: async (lines) => rec.batched.push(...lines),
			clear: async () => {
				rec.wholeChannelClear++
			},
			raw: async (cmd) => {
				rec.raw.push(cmd)
				if (/^CLEAR \d+$/.test(String(cmd))) rec.wholeChannelClear++
			},
			info: async () => ({ text: '<?xml version="1.0"?><channel></channel>' }),
		}
		const ctx = { amcp, config: { caspar: {} }, switcherOutputBusByChannel: {}, log: () => {} }
		await applyMultiviewLayout(
			{ n: 1, layout: [{ id: 'cell1', x: 0, y: 0, w: 0.5, h: 0.5 }], showOverlay: false },
			ctx,
			{ infoXml },
		)
		return rec
	} finally {
		Module.prototype.require = originalRequire
	}
}

/** INFO for ch 99 showing layers 30 and 31 occupied — neither is a layer this apply needs. */
const OCCUPIED_30_31 =
	'<?xml version="1.0"?><channel><stage><layer>' +
	'<layer_30><foreground><producer>route</producer></foreground></layer_30>' +
	'<layer_31><foreground><producer>route</producer></foreground></layer_31>' +
	'</layer></stage></channel>'

test('WO-492 C: with INFO, only the occupied stale layers are cleared — no whole-channel CLEAR', async () => {
	const rec = await runApply({ infoXml: OCCUPIED_30_31 })

	assert.equal(rec.wholeChannelClear, 0, 'the whole-channel hammer must not fire when INFO told us the layers')
	for (const L of [30, 31]) {
		assert.ok(rec.batched.includes(`CG 99-${L} CLEAR`), `expected CG 99-${L} CLEAR, got ${JSON.stringify(rec.batched)}`)
		assert.ok(rec.batched.includes(`STOP 99-${L}`), `expected STOP 99-${L}`)
		assert.ok(rec.batched.includes(`MIXER 99-${L} CLEAR`), `expected MIXER 99-${L} CLEAR`)
	}
	// Layer 11 is a cell this apply is about to fill — clearing it would be the old blanket behaviour.
	assert.ok(!rec.batched.includes('CG 99-11 CLEAR'), 'a layer this apply needs must not be cleared')
})

test('WO-492 C: without INFO the whole-channel CLEAR is still the fallback', async () => {
	const rec = await runApply({ infoXml: null })
	assert.ok(rec.wholeChannelClear > 0, 'no INFO => we cannot see the channel => clear it wholesale')
})
