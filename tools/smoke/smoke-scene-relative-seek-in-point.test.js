'use strict'

/**
 * "Relative to the clip playing on this layer" between two looks sharing a looping bg clip.
 * This Caspar build defaults IN to SEEK (`ffmpeg_producer.cpp:302`), so the take's bare
 * `LOADBG … LOOP SEEK n` also moved the loop point to n — every same-clip look switch cut
 * more of the clip out of the loop. The take must send an explicit IN (trim-in or 0).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')
const { serializeClipCommandPlan, buildClipCommandPlan } = require('../../src/caspar/amcp-command-plan')

async function take(layerPatch) {
	const incoming = {
		id: 'main-lista',
		layers: [{ layerNumber: 10, source: { type: 'media', value: 'bg.mp4' }, loop: true, ...layerPatch }],
	}
	const { takeJobs } = await buildTakeJobs({
		incomingSorted: incoming.layers,
		currentMap: new Map(),
		channel: 1,
		incoming,
		self: { config: { screen_count: 1 }, log: () => {} },
		amcp: {},
		phys: (n, bank) => n + (bank === 'b' ? 100 : 0),
		inactiveBank: 'b',
		activeBank: 'a',
		shouldRunBankCrossfade: true,
		forceCut: false,
		globalT: { type: 'MIX', duration: 25 },
		framerate: 50,
	})
	return takeJobs[0]
}

test('serializer emits IN before SEEK and drops both on a bare PLAY swap', () => {
	assert.equal(
		serializeClipCommandPlan(buildClipCommandPlan('LOADBG', 1, 110, 'bg', { loop: true, in: 0, seek: 264 })),
		'LOADBG 1-110 bg LOOP IN 0 SEEK 264'
	)
	assert.equal(serializeClipCommandPlan(buildClipCommandPlan('PLAY', 1, 110, '', { in: 0, seek: 264 })), 'PLAY 1-110')
})

test('relative take continues mid-clip but keeps the loop point at frame 0', async () => {
	const job = await take({ startBehaviour: 'relativeToPrevious', playSeekFrames: 264 })
	assert.equal(serializeClipCommandPlan(job.loadPlan), 'LOADBG 1-110 BG LOOP IN 0 SEEK 264')
})

test('relative take keeps a trim-in as the loop point; LENGTH is measured from IN', async () => {
	const job = await take({ startBehaviour: 'relativeToPrevious', playSeekFrames: 264, trimInMs: 1000, trimOutMs: 10000 })
	assert.equal(job.loadOpts.in, 50)
	assert.equal(job.loadOpts.seek, 264)
	assert.equal(job.loadOpts.length, 450, 'out 500 = in 50 + LENGTH 450, independent of the seek frame')
})

test('trim-out before a relative start point sends no LENGTH', async () => {
	const job = await take({ startBehaviour: 'relativeToPrevious', playSeekFrames: 264, trimOutMs: 4000 })
	assert.equal(job.loadOpts.length, undefined)
})

/* ── WO-582 part 2: one-way failure + visible lag ─────────────────────────────────────────── */

const { resolvePlaySeekFramesForSceneLayer } = require('../../src/engine/scene-play-seek')
const {
	projectRelativeSeekFrames,
	settleRelativeSeekLead,
	relativeSeekPlayWaitMs,
	TARGET_LEAD_MS,
	PLAY_SEND_OVERHEAD_MS,
	CASPAR_PLAY_PIPE_MS,
} = require('../../src/engine/scene-relative-seek-lead')

function oscCtx(physLayer, file, ageMs = 0, now = Date.now()) {
	return {
		oscState: {
			getSnapshot: () => ({
				channels: { 1: { layers: { [physLayer]: { type: 'ffmpeg', file, _lastOscAt: now - ageMs } } } },
			}),
		},
	}
}
const opts = {
	channel: 1,
	layerNumber: 10,
	fps: 50,
	forceCut: false,
	phys: (n, b) => n + (b === 'b' ? 100 : 0),
	incoming: {},
}

test('leaving a bank-B look: the server reads the on-air bank-B layer and ignores the client 0', () => {
	const ctx = oscCtx(110, { elapsed: 4, duration: 60, loop: true })
	const f = resolvePlaySeekFramesForSceneLayer(
		{ layerNumber: 10, startBehaviour: 'relativeToPrevious', playSeekFrames: 0 },
		ctx,
		{
			...opts,
			activeBank: 'b',
		}
	)
	assert.equal(
		f,
		200 + Math.round(((TARGET_LEAD_MS + CASPAR_PLAY_PIPE_MS) * 50) / 1000),
		'on-air frame 200 projected by the fixed lead'
	)
})

test('projection adds OSC sample age + lead, and wraps a looping clip', () => {
	const now = Date.now()
	const ctx = oscCtx(10, { elapsed: 3.6, duration: 60, loop: true }, 20, now)
	assert.equal(
		projectRelativeSeekFrames(ctx, 1, 10, 50, now),
		Math.round(180 + ((20 + TARGET_LEAD_MS + CASPAR_PLAY_PIPE_MS) * 50) / 1000)
	)
	const nearEnd = oscCtx(10, { elapsed: 59.9, duration: 60, loop: true })
	assert.equal(
		projectRelativeSeekFrames(nearEnd, 1, 10, 50, now),
		Math.round(2995 + ((TARGET_LEAD_MS + CASPAR_PLAY_PIPE_MS) * 50) / 1000) - 3000
	)
	const oneShot = oscCtx(10, { elapsed: 59.9, duration: 60, loop: false })
	assert.equal(projectRelativeSeekFrames(oneShot, 1, 10, 50, now), 2999, 'a non-looping clip clamps to its last frame')
})

test('a relative seek fixes the PLAY moment: the pipeline waits until resolve + lead, never under its prebuffer', () => {
	const ctx = oscCtx(10, { elapsed: 1, duration: 60, loop: true })
	assert.equal(relativeSeekPlayWaitMs(ctx, 1, 180, 1000), 180, 'no relative seek pending → plain prebuffer')
	projectRelativeSeekFrames(ctx, 1, 10, 50, 1000)
	const deadline = 1000 + TARGET_LEAD_MS - PLAY_SEND_OVERHEAD_MS
	assert.equal(
		relativeSeekPlayWaitMs(ctx, 1, 80, 1100),
		deadline - 1100,
		'bank-A take (80 ms prebuffer) waits to the deadline'
	)
	assert.equal(
		relativeSeekPlayWaitMs(ctx, 1, 180, 1100),
		deadline - 1100,
		'bank-B take (180 ms) lands on the same deadline'
	)
	assert.equal(
		relativeSeekPlayWaitMs(ctx, 1, 180, deadline),
		180,
		'prep overran the deadline → prebuffer still honoured'
	)
	assert.equal(relativeSeekPlayWaitMs(ctx, 2, 80, 1100), 80, 'another channel is unaffected')
	assert.equal(settleRelativeSeekLead(ctx, 1, 1400), 400)
	assert.equal(relativeSeekPlayWaitMs(ctx, 1, 80, 1500), 80, 'settled → stamp cleared')
	projectRelativeSeekFrames(ctx, 1, 10, 50, 10000)
	assert.equal(relativeSeekPlayWaitMs(ctx, 1, 80, 19000), 80, 'a 9 s old stamp (never-settled pgm-only take) is ignored')
})

test('forceCut (PRV staging) never reads program OSC — falls back to the client value', () => {
	const ctx = oscCtx(10, { elapsed: 4, duration: 60, loop: true })
	const f = resolvePlaySeekFramesForSceneLayer(
		{ layerNumber: 10, startBehaviour: 'relativeToPrevious', playSeekFrames: 77 },
		ctx,
		{
			...opts,
			forceCut: true,
			activeBank: 'a',
		}
	)
	assert.equal(f, 77)
	assert.equal(ctx._relativeSeekResolvedAt, undefined, 'no lead stamp from a PRV staging take')
})
