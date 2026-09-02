'use strict'

/**
 * WO-540 §6 option B — the take teardown must verify a fade actually finished (by querying the
 * outgoing layer's real MIXER OPACITY) instead of blindly trusting a duration computed from the
 * channel's DECLARED framerate, which was measured wrong on channel 1 (24.9fps while declaring
 * 50 — `work/work-orders/540_...md`).
 *
 * Covers the isolated poll helper (fast-settle, slow-settle-within-bound, never-settles-bounded,
 * query-error-fails-open) and its wiring into `runSceneTakeLbgTeardown` (queries the right
 * reference layer for a plain exit / a live-timeline exit, skips the verification on a merge
 * transition, and never blocks longer than the documented bound).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	waitForOpacitySettled,
	parseOpacityResponse,
} = require('../../src/engine/scene-take-teardown-opacity-wait.js')
const { runSceneTakeLbgTeardown } = require('../../src/engine/scene-take-lbg-teardown.js')

describe('WO-540 §6: parseOpacityResponse', () => {
	// `amcp-protocol.js`'s SINGLE_LINE state (RETCODE.OKDATA, what a bare `MIXER ch-layer OPACITY`
	// query returns) hands the callback ONLY the data line — the "201 MIXER OK" status line is
	// consumed by the protocol parser and never reaches here. `data` is a plain value string.
	it('parses a plain numeric response', () => {
		assert.equal(parseOpacityResponse('0'), 0)
		assert.equal(parseOpacityResponse('0.72'), 0.72)
	})
	it('parses an array response defensively (multi-line state, not expected for this query)', () => {
		assert.equal(parseOpacityResponse(['0.5']), 0.5)
	})
	it('returns null for an empty/unparseable response', () => {
		assert.equal(parseOpacityResponse(''), null)
		assert.equal(parseOpacityResponse(undefined), null)
	})
})

function fakeAmcp(responses) {
	// responses: array of values to return in sequence (or a function(query#) => value)
	let n = 0
	const queries = []
	return {
		queries,
		_send: async (cmd) => {
			queries.push(cmd)
			const r = typeof responses === 'function' ? responses(n) : responses[Math.min(n, responses.length - 1)]
			n++
			if (r instanceof Error) throw r
			return { ok: true, data: String(r) }
		},
	}
}

describe('WO-540 §6: waitForOpacitySettled', () => {
	it('already at target: resolves on the first query, no extra polling delay', async () => {
		const amcp = fakeAmcp(['0'])
		const t0 = Date.now()
		await waitForOpacitySettled(amcp, 1, 210, 0, 500)
		assert.ok(Date.now() - t0 < 100, 'no artificial delay when already settled')
		assert.equal(amcp.queries.length, 1)
	})

	it('settles partway through the bound: stops polling as soon as the value reaches target', async () => {
		// Simulate a slow channel: opacity is still 0.7 for a couple of polls, then reaches 0.
		const amcp = fakeAmcp((n) => (n < 3 ? '0.7' : '0'))
		await waitForOpacitySettled(amcp, 1, 210, 0, 1000)
		assert.ok(amcp.queries.length >= 4, `polled until settled: ${amcp.queries.length} queries`)
	})

	it('never settles: gives up at the bound, does not hang', async () => {
		const amcp = fakeAmcp(['0.7'])
		const t0 = Date.now()
		await waitForOpacitySettled(amcp, 1, 210, 0, 150)
		const elapsed = Date.now() - t0
		assert.ok(elapsed >= 140 && elapsed < 400, `bounded near the 150ms cap, got ${elapsed}ms`)
	})

	it('query error: fails open immediately, does not throw, does not hang', async () => {
		const amcp = fakeAmcp(() => new Error('AMCP response timeout'))
		const t0 = Date.now()
		await waitForOpacitySettled(amcp, 1, 210, 0, 5000)
		assert.ok(Date.now() - t0 < 200, 'gave up immediately on query failure, not after the 5s bound')
	})

	it('maxWaitMs <= 0: no query sent at all', async () => {
		const amcp = fakeAmcp(['0.9'])
		await waitForOpacitySettled(amcp, 1, 210, 0, 0)
		assert.equal(amcp.queries.length, 0)
	})
})

function teardownAmcp(opacityByLayer) {
	const sent = []
	const queries = []
	return {
		sent,
		queries,
		batchSendChunked: async () => {},
		mixerCommit: async () => {},
		_send: async (cmd) => {
			queries.push(cmd)
			const m = cmd.match(/MIXER (\d+)-(\d+) OPACITY$/)
			if (m) {
				const key = `${m[1]}-${m[2]}`
				return { ok: true, data: String(opacityByLayer[key] ?? 0) }
			}
			return { ok: true, data: '' }
		},
	}
}

function baseTeardownCtx(overrides) {
	return Object.assign(
		{
			self: { log: () => {} },
			channel: 1,
			exitMedia: [],
			needsBorderOnlyTeardown: false,
			fadeClockStart: Date.now() - 600, // fade window (fadeMs below) already elapsed — isolates the new poll step
			fadeDur: 25,
			fadeMs: 500,
			takeJobs: [],
			isMergeTransition: false,
			currentSceneLayers: [],
			currentGbEnabled: false,
			incomingGbEnabled: false,
			activeBank: 'a',
			inactiveBank: 'b',
			phys: (n, bank) => (bank === 'b' ? Number(n) + 100 : Number(n)),
			activeTimelineIdToFadeOut: null,
		},
		overrides,
	)
}

describe('WO-540 §6: runSceneTakeLbgTeardown queries the real opacity before tearing down', () => {
	it('a plain exiting media layer already at 0: queries it, no extra delay', async () => {
		const amcp = teardownAmcp({ '1-5': 0 })
		const ctx = baseTeardownCtx({
			exitMedia: [{ layerNumber: 5, source: { type: 'media', value: 'x' } }],
			amcp,
		})
		const t0 = Date.now()
		await runSceneTakeLbgTeardown(ctx)
		assert.ok(amcp.queries.some((q) => q === 'MIXER 1-5 OPACITY'), `queried the exiting layer: ${JSON.stringify(amcp.queries)}`)
		assert.ok(Date.now() - t0 < 300, 'settled fast, no full extra fadeMs wasted')
	})

	it('a live timeline fading out: queries the timeline band base layer, not an exitMedia layer', async () => {
		const amcp = teardownAmcp({ '1-210': 0 })
		const ctx = baseTeardownCtx({
			activeTimelineIdToFadeOut: 'tl-1',
			amcp,
		})
		await runSceneTakeLbgTeardown(ctx)
		assert.ok(amcp.queries.includes('MIXER 1-210 OPACITY'), `queried timeline layer base: ${JSON.stringify(amcp.queries)}`)
	})

	it('a merge transition: does NOT query opacity — its teardown timing model is untouched', async () => {
		const amcp = teardownAmcp({ '1-5': 0.7 })
		const ctx = baseTeardownCtx({
			exitMedia: [{ layerNumber: 5, source: { type: 'media', value: 'x' } }],
			isMergeTransition: true,
			amcp,
		})
		await runSceneTakeLbgTeardown(ctx)
		assert.equal(amcp.queries.length, 0, `no opacity query on a merge take: ${JSON.stringify(amcp.queries)}`)
	})

	it('a channel running slow (opacity not yet settled): waits the extra bound, then still tears down', async () => {
		const amcp = teardownAmcp({ '1-5': 0.6 }) // never reaches 0 — simulates the WO-540 drift
		const ctx = baseTeardownCtx({
			exitMedia: [{ layerNumber: 5, source: { type: 'media', value: 'x' } }],
			fadeClockStart: Date.now() - 50, // small original wait left (50ms), plenty of 2x budget remains
			fadeMs: 100, // small bound so the test stays fast
			amcp,
		})
		const t0 = Date.now()
		await runSceneTakeLbgTeardown(ctx)
		const elapsed = Date.now() - t0
		assert.ok(elapsed >= 90, `extra verification wait applied on top of the original wait: ${elapsed}ms`)
		assert.ok(elapsed < 1000, `still bounded (2x fadeMs total), take proceeds instead of hanging: ${elapsed}ms`)
	})
})
