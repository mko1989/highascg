'use strict'

/**
 * WO-574 — a multi-screen take (preset ▶ / global take on 2+ mains) must START all screens' PLAY +
 * crossfade together. Each screen's POST /api/scene/take preps (PRV staging, LOADBG, Phase A,
 * warm-up) at its own pace; the transitions used to begin whenever each finished (owner: "noticeable
 * time difference between the two screens"). Takes now rendezvous at a server-side barrier just
 * before Phase B.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { joinTakeGroup, withTakeGroup } = require('../../src/engine/take-sync-barrier')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const tick = (ms) => new Promise((r) => setTimeout(r, ms))

test('not part of a group → no barrier', () => {
	assert.equal(joinTakeGroup(undefined), null)
	assert.equal(joinTakeGroup({ id: 'x', size: 1 }), null)
	assert.equal(joinTakeGroup({ size: 2 }), null)
})

test('all takes are released together, only once the LAST one arrives', async () => {
	const g = { id: 'wo574-together', size: 2 }
	const a = joinTakeGroup(g)
	const b = joinTakeGroup(g)
	let aReleasedAt = 0
	let bReleasedAt = 0
	const t0 = Date.now()
	const pa = a.arrive().then(() => (aReleasedAt = Date.now() - t0))
	await tick(150) // b is still staging
	assert.equal(aReleasedAt, 0, 'a must wait for b')
	const pb = tick(0).then(() => b.arrive()).then(() => (bReleasedAt = Date.now() - t0))
	await Promise.all([pa, pb])
	assert.ok(aReleasedAt >= 150 && bReleasedAt >= 150)
	assert.ok(Math.abs(aReleasedAt - bReleasedAt) < 25, `released ${aReleasedAt} vs ${bReleasedAt}`)
})

test('a take that fails before arriving does not hold the others', async () => {
	const g = { id: 'wo574-leave', size: 2 }
	const a = joinTakeGroup(g)
	const b = joinTakeGroup(g)
	const t0 = Date.now()
	const pa = a.arrive()
	b.leave() // b bailed (400 / failure) before reaching the barrier
	await pa
	assert.ok(Date.now() - t0 < 500)
})

test('a peer that never shows up is capped by the timeout, and stragglers pass straight through', async () => {
	process.env.HIGHASCG_TAKE_SYNC_TIMEOUT_MS = '120'
	try {
		const g = { id: 'wo574-timeout', size: 3 }
		const a = joinTakeGroup(g)
		const t0 = Date.now()
		await a.arrive()
		const dt = Date.now() - t0
		assert.ok(dt >= 100 && dt < 600, `waited ${dt}ms`)
		const late = joinTakeGroup(g)
		const t1 = Date.now()
		await late.arrive()
		assert.ok(Date.now() - t1 < 50)
	} finally {
		delete process.env.HIGHASCG_TAKE_SYNC_TIMEOUT_MS
	}
})

test('withTakeGroup releases the slot even when the take throws', async () => {
	const g = { id: 'wo574-throw', size: 2 }
	const peer = joinTakeGroup(g)
	const t0 = Date.now()
	const pp = peer.arrive()
	await assert.rejects(
		withTakeGroup(g, async () => {
			throw new Error('boom')
		}),
		/boom/
	)
	await pp
	assert.ok(Date.now() - t0 < 500)
})

/** Fake AMCP client recording the exact wire order. */
function fakeAmcp(log) {
	return {
		mixerCommit: async (ch) => void log.push(`COMMIT ${ch}`),
		batchSendChunked: async (lines, opts) => void log.push({ batch: lines, opts }),
	}
}

test('Phase B of every screen goes out as ONE merged batch, the last batch sent, with commits around it', async () => {
	const g = { id: 'wo574-merge', size: 2 }
	const log = []
	const amcp = fakeAmcp(log)
	const a = joinTakeGroup(g)
	const b = joinTakeGroup(g)
	const pa = a.arrive({ amcp, channel: 1, leadingCommit: true, block: ['PLAY 1-10', 'MIXER 1-110 OPACITY 1 25'], trailingCommit: true })
	await tick(40)
	assert.deepEqual(log, [], 'nothing is sent until the last screen is ready')
	const pb = b.arrive({ amcp, channel: 2, leadingCommit: true, block: ['PLAY 2-10'], trailingCommit: false })
	await Promise.all([pa, pb])
	const batches = log.filter((x) => typeof x === 'object')
	assert.equal(batches.length, 1, 'one BEGIN…COMMIT for both screens')
	assert.deepEqual(batches[0].batch, ['PLAY 1-10', 'MIXER 1-110 OPACITY 1 25', 'PLAY 2-10'])
	assert.deepEqual(batches[0].opts, { skipMixerPreCommit: true, forceBatch: true })
	const at = log.indexOf(batches[0])
	assert.deepEqual(log.slice(0, at).sort(), ['COMMIT 1', 'COMMIT 2'], 'leading commits of both screens first')
	assert.deepEqual(log.slice(at + 1), ['COMMIT 1'], 'trailing commit only where requested, after the batch')
})

test('a send failure rejects every screen of the merged send (each take logs its own Phase B failure)', async () => {
	const g = { id: 'wo574-fail', size: 2 }
	const amcp = { mixerCommit: async () => {}, batchSendChunked: async () => Promise.reject(new Error('amcp down')) }
	const plan = (channel) => ({ amcp, channel, leadingCommit: false, block: [`PLAY ${channel}-10`], trailingCommit: false })
	const a = joinTakeGroup(g)
	const b = joinTakeGroup(g)
	const res = await Promise.allSettled([a.arrive(plan(1)), b.arrive(plan(2))])
	assert.deepEqual(res.map((r) => r.status), ['rejected', 'rejected'])
})

test('a straggler after a timeout release sends its own plan immediately', async () => {
	process.env.HIGHASCG_TAKE_SYNC_TIMEOUT_MS = '60'
	try {
		const g = { id: 'wo574-straggler', size: 2 }
		const log = []
		const amcp = fakeAmcp(log)
		const a = joinTakeGroup(g)
		await a.arrive({ amcp, channel: 1, leadingCommit: false, block: ['PLAY 1-10'], trailingCommit: false })
		const late = joinTakeGroup(g)
		await late.arrive({ amcp, channel: 2, leadingCommit: false, block: ['PLAY 2-10'], trailingCommit: false })
		assert.deepEqual(log.filter((x) => typeof x === 'object').map((x) => x.batch), [['PLAY 1-10'], ['PLAY 2-10']])
	} finally {
		delete process.env.HIGHASCG_TAKE_SYNC_TIMEOUT_MS
	}
})

test('wiring: client tags batched POSTs, server hands the group to the PGM take, Phase B submits its plan to it', () => {
	const client = read('client/components/scenes-editor-support.js')
	assert.match(client, /jobs\.length > 1/)
	assert.match(client, /size: jobs\.length/)
	assert.match(client, /takeGroup \? \{ \.\.\.j\.body, takeGroup \} : j\.body/)

	const route = read('src/api/routes-scene-take.js')
	assert.match(route, /withTakeGroup\(parseBody\(body\)\?\.takeGroup/)
	assert.equal((route.match(/playSync: sync/g) || []).length, 2, 'PGM take + direct-program take only (never PRV staging)')

	assert.match(read('src/engine/scene-take-lbg.js'), /playSync: opts\.playSync \|\| null/)

	const pipe = read('src/engine/scene-take-lbg-amcp-pipeline.js')
	assert.equal((pipe.match(/\bplaySync,\n/g) || []).length >= 3, true, 'crossfade / merge / phased branches pass playSync on')
	assert.ok(pipe.indexOf('setTimeout(r, prebufferMs)') < pipe.indexOf('Timeline-only / exit-only crossfade'))

	const deps = read('src/engine/scene-route-deps.js')
	assert.match(deps, /opts\.playSync\.arrive\(\{ amcp, channel: ch, leadingCommit, block, trailingCommit \}\)/)
})
