'use strict'

/**
 * WO-782 — owner: "recall of the looks preset is very sequential. the final play amcp needs to be in the same batch
 * for all screens included". The server-side recall (Godot) now makes its items one WO-574 take group: real recall →
 * real take-look → the barrier, with a fake take engine that hands each screen's Phase B over as a plan. An empty
 * PGM destination's fade to black rides the same batch.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { handleLookPresetRecall, clearDestination } = require('../../src/api/routes-scene-look-preset')
const { handleTakeLook } = require('../../src/api/routes-scene-take-look')
const { withTakeGroup } = require('../../src/engine/take-sync-barrier')

const tick = (ms) => new Promise((r) => setTimeout(r, ms))

function fakeAmcp() {
	const log = []
	return {
		log,
		batchSendChunked: async (lines) => void log.push(['batch', [...lines]]),
		mixerCommit: async (ch) => void log.push(['commit', ch]),
		clear: async (ch) => void log.push(['clear', ch]),
		raw: async () => {},
	}
}

const looks = { a: { id: 'a', layers: [] }, b: { id: 'b', layers: [] } }

/** Real take-look; the take engine preps for `prepMs[channel]`, then hands its PLAY line to the group. */
function rig(items, prepMs) {
	const amcp = fakeAmcp()
	const ctx = { amcp, config: { screen_count: 2 }, _playbackMatrix: { '3-10': {}, '3-11': {} } }
	const takeDeps = {
		resolveSceneById: (id) => looks[id] || null,
		getChannelMap: () => ({ programChannels: [1, 3], previewChannels: [2, 4] }),
		withBorder: (s) => s,
		take: (body) =>
			withTakeGroup(body.takeGroup, async (sync) => {
				const ch = body.target === 'preview' ? body.channel + 1 : body.channel
				await tick(prepMs[body.channel] || 0)
				const plan = { amcp, channel: ch, leadingCommit: true, block: [`PLAY ${ch}-10`], trailingCommit: true }
				if (sync) await sync.arrive(plan)
				else await amcp.batchSendChunked(plan.block)
				return { status: 200, body: '{}' }
			}),
	}
	const deps = {
		project: () => ({ scenes: { lookPresets: [{ id: 'p', name: 'P', items }] } }),
		resolveSceneById: (id) => looks[id] || null,
		fps: 50,
		takeLook: (tb) => handleTakeLook(tb, ctx, takeDeps),
	}
	return { amcp, ctx, deps }
}

const batches = (amcp) => amcp.log.filter((e) => e[0] === 'batch').map((e) => e[1])

describe('WO-782 preset recall: one PLAY batch for every screen', () => {
	it('PGM: a fast and a slow screen still send their PLAYs in ONE batch', async () => {
		const r = rig(
			[
				{ mainIdx: 0, sceneId: 'a' },
				{ mainIdx: 1, sceneId: 'b' },
			],
			{ 1: 10, 3: 120 }
		)
		const res = await handleLookPresetRecall({ id: 'p', target: 'program' }, r.ctx, r.deps)
		assert.equal(res.status, 200)
		assert.deepEqual(batches(r.amcp), [['PLAY 1-10', 'PLAY 3-10']])
	})

	it('PRV recall joins the group too', async () => {
		const r = rig(
			[
				{ mainIdx: 0, sceneId: 'a' },
				{ mainIdx: 1, sceneId: 'b' },
			],
			{ 1: 90, 3: 5 }
		)
		await handleLookPresetRecall({ id: 'p' }, r.ctx, r.deps)
		assert.deepEqual(batches(r.amcp), [['PLAY 4-10', 'PLAY 2-10']])
	})

	it('an empty PGM destination fades in the same batch, then its channel is cleared; Cut = 0 frames', async () => {
		const r = rig(
			[
				{ mainIdx: 0, sceneId: 'a' },
				{ mainIdx: 1, sceneId: '', empty: true },
			],
			{ 1: 30 }
		)
		r.deps.clearDestination = (m, t, cut, group) => clearDestination(r.ctx, m, t, cut, group)
		const res = await handleLookPresetRecall({ id: 'p', target: 'program', forceCut: true }, r.ctx, r.deps)
		assert.equal(JSON.parse(res.body).ok, true)
		const sent = batches(r.amcp)
		assert.equal(sent.length, 1, 'one batch (lines in arrival order)')
		assert.deepEqual(sent[0].sort(), [
			'MIXER 3-10 OPACITY 0 0 linear DEFER',
			'MIXER 3-11 OPACITY 0 0 linear DEFER',
			'PLAY 1-10',
		])
		assert.ok(
			r.amcp.log.some((e) => e[0] === 'commit' && e[1] === 3),
			"a trailing COMMIT fires the fade's DEFER"
		)
		const clearAt = r.amcp.log.findIndex((e) => e[0] === 'clear' && e[1] === 3)
		assert.ok(clearAt > r.amcp.log.findIndex((e) => e[0] === 'batch'), 'cleared after the batch')
		assert.ok(!r.amcp.log.some((e) => e[0] === 'clear' && e[1] === 4), "the screen's PRV is left alone")
	})

	it('a screen take-look rejects (no program channel) does not hold the others at the barrier', async () => {
		process.env.HIGHASCG_TAKE_SYNC_TIMEOUT_MS = '3000'
		try {
			const r = rig(
				[
					{ mainIdx: 0, sceneId: 'a' },
					{ mainIdx: 3, sceneId: 'b' },
				],
				{}
			)
			const t0 = Date.now()
			const res = await handleLookPresetRecall({ id: 'p', target: 'program' }, r.ctx, r.deps)
			assert.ok(Date.now() - t0 < 1000, `waited ${Date.now() - t0} ms`)
			assert.deepEqual(
				JSON.parse(res.body).items.map((i) => i.status),
				[200, 400]
			)
		} finally {
			delete process.env.HIGHASCG_TAKE_SYNC_TIMEOUT_MS
		}
	})
})
