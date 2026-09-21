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

test('wiring: client tags batched POSTs, server passes the barrier into the PGM take, pipeline awaits it before Phase B', () => {
	const client = read('client/components/scenes-editor-support.js')
	assert.match(client, /jobs\.length > 1/)
	assert.match(client, /size: jobs\.length/)
	assert.match(client, /takeGroup \? \{ \.\.\.j\.body, takeGroup \} : j\.body/)

	const route = read('src/api/routes-scene-take.js')
	assert.match(route, /withTakeGroup\(parseBody\(body\)\?\.takeGroup/)
	assert.equal((route.match(/awaitPlayBarrier: sync\?\.arrive/g) || []).length, 2, 'PGM take + direct-program take')

	const lbg = read('src/engine/scene-take-lbg.js')
	assert.match(lbg, /awaitPlayBarrier: typeof opts\.awaitPlayBarrier === 'function'/)

	const pipe = read('src/engine/scene-take-lbg-amcp-pipeline.js')
	const barrierAt = pipe.indexOf('await awaitPlayBarrier()')
	const sleepAt = pipe.indexOf('await new Promise((r) => setTimeout(r, prebufferMs))')
	const phaseBAt = pipe.indexOf('Timeline-only / exit-only crossfade')
	assert.ok(sleepAt > 0 && barrierAt > sleepAt && phaseBAt > barrierAt, 'barrier sits between warm-up and Phase B')
})
