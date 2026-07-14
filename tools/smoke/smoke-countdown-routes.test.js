'use strict'

/**
 * WO-169 smoke — Countdown routes multi-instance safety:
 * 1. POST start/pause/reset produce a CG UPDATE line addressed to the resolved host layer
 * 2. Two countdown layers (10, 11) on the same channel resolve to DIFFERENT host layers
 * 3. Routes are STATELESS (no per-channel singleton) — addressing is per-request
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { resolveTemplateCgHostLayer } = require('../../src/engine/cg-routing')
const { handleGet, handlePost } = require('../../src/api/routes-countdown')

/**
 * @param {{ failAmcp?: boolean }} [opts]
 */
function makeMockCtx(opts = {}) {
	/** @type {string[]} */
	const cgUpdateCalls = []
	const ctx = {
		amcp: {
			cg: {
				cgUpdate: async (channel, hostLayer, templateHostLayer, jsonPayload) => {
					cgUpdateCalls.push({
						channel,
						hostLayer,
						templateHostLayer,
						jsonPayload: JSON.parse(jsonPayload),
					})
					if (opts.failAmcp) throw new Error('AMCP connection failed')
					return { ok: true }
				},
			},
		},
	}
	return { ctx, cgUpdateCalls }
}

describe('countdown routes (WO-169)', () => {
	it('POST start/pause/reset produce a CG UPDATE line to the resolved host layer', async () => {
		const { ctx, cgUpdateCalls } = makeMockCtx()

		// Start: should emit CG UPDATE with cmd: 'start'
		const startRes = await handlePost('/api/countdown/start', { channel: 1, layer: 10 }, ctx)
		assert.equal(startRes.status, 200)
		assert.equal(cgUpdateCalls.length, 1)
		assert.equal(cgUpdateCalls[0].channel, 1)
		assert.equal(cgUpdateCalls[0].hostLayer, 700)
		assert.equal(cgUpdateCalls[0].templateHostLayer, 0)
		assert.deepEqual(cgUpdateCalls[0].jsonPayload, { cmd: 'start' })

		cgUpdateCalls.length = 0

		// Pause: should emit CG UPDATE with cmd: 'pause'
		const pauseRes = await handlePost('/api/countdown/pause', { channel: 1, layer: 10 }, ctx)
		assert.equal(pauseRes.status, 200)
		assert.equal(cgUpdateCalls.length, 1)
		assert.equal(cgUpdateCalls[0].jsonPayload.cmd, 'pause')

		cgUpdateCalls.length = 0

		// Reset: should emit CG UPDATE with cmd: 'reset'
		const resetRes = await handlePost('/api/countdown/reset', { channel: 1, layer: 10 }, ctx)
		assert.equal(resetRes.status, 200)
		assert.equal(cgUpdateCalls.length, 1)
		assert.equal(cgUpdateCalls[0].jsonPayload.cmd, 'reset')
	})

	it('set/update endpoints with config keys produce a CG UPDATE (no cmd)', async () => {
		const { ctx, cgUpdateCalls } = makeMockCtx()

		const body = {
			channel: 1,
			layer: 10,
			mode: 'duration',
			durationSec: 120,
			format: 'ms',
		}

		const setRes = await handlePost('/api/countdown/set', body, ctx)
		assert.equal(setRes.status, 200)
		assert.equal(cgUpdateCalls.length, 1)
		const payload = cgUpdateCalls[0].jsonPayload
		// cmd should NOT be present; only config keys
		assert.equal(payload.cmd, undefined)
		assert.equal(payload.mode, 'duration')
		assert.equal(payload.durationSec, 120)
		assert.equal(payload.format, 'ms')
		// Routing keys should be stripped
		assert.equal(payload.channel, undefined)
		assert.equal(payload.layer, undefined)
	})

	it('two countdown layers (10, 11) on the same channel resolve to DIFFERENT host layers', async () => {
		const { ctx, cgUpdateCalls } = makeMockCtx()

		// Layer 10
		const res10 = await handlePost('/api/countdown/start', { channel: 1, layer: 10 }, ctx)
		assert.equal(res10.status, 200)
		const hostLayer10 = cgUpdateCalls[0].hostLayer

		cgUpdateCalls.length = 0

		// Layer 11
		const res11 = await handlePost('/api/countdown/start', { channel: 1, layer: 11 }, ctx)
		assert.equal(res11.status, 200)
		const hostLayer11 = cgUpdateCalls[0].hostLayer

		// They must resolve to different host layers
		assert.notEqual(hostLayer10, hostLayer11, `layer 10 and 11 must map to different host layers, got ${hostLayer10} and ${hostLayer11}`)

		// Verify that resolveTemplateCgHostLayer computes the same values
		const expectedHostLayer10 = resolveTemplateCgHostLayer(10, 'countdown/countdown')
		const expectedHostLayer11 = resolveTemplateCgHostLayer(11, 'countdown/countdown')
		assert.equal(hostLayer10, expectedHostLayer10)
		assert.equal(hostLayer11, expectedHostLayer11)
		assert.notEqual(expectedHostLayer10, expectedHostLayer11)
	})

	it('missing layer parameter returns 400 error', async () => {
		const { ctx, cgUpdateCalls } = makeMockCtx()

		const res = await handlePost('/api/countdown/start', { channel: 1 }, ctx)
		assert.equal(res.status, 400)
		assert.equal(cgUpdateCalls.length, 0)
	})

	it('AMCP failure returns 502 error', async () => {
		const { ctx, cgUpdateCalls } = makeMockCtx({ failAmcp: true })

		const res = await handlePost('/api/countdown/start', { channel: 1, layer: 10 }, ctx)
		assert.equal(res.status, 502)
		assert.match(res.body, /AMCP connection failed/)
	})

	it('routes are STATELESS — no request-to-request state coupling', async () => {
		const { ctx, cgUpdateCalls } = makeMockCtx()

		// Two independent requests for the same layer should produce independent updates
		await handlePost('/api/countdown/start', { channel: 1, layer: 10 }, ctx)
		const call1 = cgUpdateCalls[0]

		cgUpdateCalls.length = 0

		await handlePost('/api/countdown/pause', { channel: 1, layer: 10 }, ctx)
		const call2 = cgUpdateCalls[0]

		// Both should target the same resolved host layer (same channel + layer = same resolution)
		assert.equal(call1.channel, call2.channel)
		assert.equal(call1.hostLayer, call2.hostLayer)
		// But payloads differ (cmd field)
		assert.equal(call1.jsonPayload.cmd, 'start')
		assert.equal(call2.jsonPayload.cmd, 'pause')
		// No request has caused the other to change state
	})
})

describe('countdown list (WO-192)', () => {
	it('GET /api/countdown/list includes countdownConfig for each timer entry', () => {
		const mockSceneState = require('../../src/state/live-scene-state')
		const projectScenesLoad = require('../../src/engine/project-scenes-load')
		// Stub getAll to return a scene with a countdown timer layer
		const originalGetAll = mockSceneState.getAll
		const originalLoadFullProject = projectScenesLoad.loadFullProject
		mockSceneState.getAll = () => ({
			'1': {
				sceneId: 'scene-1',
				scene: {
					layers: [
						{
							layerNumber: 10,
							source: {
								value: 'countdown/countdown',
								label: 'My Timer',
								countdownConfig: {
									mode: 'duration',
									durationSec: 300,
									endEpochMs: Date.now() + 300000,
								},
							},
						},
					],
				},
			},
		})
		projectScenesLoad.loadFullProject = () => ({ scenes: { scenes: [] } })

		const result = handleGet('/api/countdown/list', {})
		mockSceneState.getAll = originalGetAll
		projectScenesLoad.loadFullProject = originalLoadFullProject

		assert.equal(result.status, 200)
		const body = JSON.parse(result.body)
		assert.ok(Array.isArray(body.items), 'response has items array')
		assert.ok(body.items.length >= 1, 'should have at least one timer')
		// Find the specific timer we created
		const item = body.items.find(i => i.label === 'My Timer')
		assert.ok(item, 'My Timer should be in the list')
		assert.equal(item.channel, 1, 'channel should be 1')
		assert.equal(item.layerNumber, 10, 'layerNumber should be 10')
		assert.equal(item.label, 'My Timer', 'label should be included')
		assert.ok(item.config, 'config should be included')
		assert.equal(item.config.mode, 'duration', 'config.mode should be duration')
		assert.equal(item.config.durationSec, 300, 'config.durationSec should be 300')
	})

	it('GET /api/countdown/list returns null config when countdownConfig is missing', () => {
		const mockSceneState = require('../../src/state/live-scene-state')
		const projectScenesLoad = require('../../src/engine/project-scenes-load')
		const originalGetAll = mockSceneState.getAll
		const originalLoadFullProject = projectScenesLoad.loadFullProject
		mockSceneState.getAll = () => ({
			'1': {
				sceneId: 'scene-1',
				scene: {
					layers: [
						{
							layerNumber: 10,
							source: {
								value: 'countdown/countdown',
								label: 'No Config Timer',
								// countdownConfig intentionally missing
							},
						},
					],
				},
			},
		})
		projectScenesLoad.loadFullProject = () => ({ scenes: { scenes: [] } })

		const result = handleGet('/api/countdown/list', {})
		mockSceneState.getAll = originalGetAll
		projectScenesLoad.loadFullProject = originalLoadFullProject

		assert.equal(result.status, 200)
		const body = JSON.parse(result.body)
		assert.ok(body.items.length >= 1, 'should have at least one timer')
		const item = body.items.find(i => i.label === 'No Config Timer')
		assert.ok(item, 'No Config Timer should be in the list')
		assert.equal(item.config, null, 'config should be null when missing')
	})

	it('WO-196 T196.3: GET /api/countdown/list includes onAir flag for live timers', () => {
		const mockSceneState = require('../../src/state/live-scene-state')
		const projectScenesLoad = require('../../src/engine/project-scenes-load')
		const originalGetAll = mockSceneState.getAll
		const originalLoadFullProject = projectScenesLoad.loadFullProject
		mockSceneState.getAll = () => ({
			'1': {
				sceneId: 'scene-1',
				scene: {
					layers: [
						{
							layerNumber: 10,
							source: {
								value: 'countdown/countdown',
								label: 'Live Timer',
								countdownConfig: {
									mode: 'duration',
									durationSec: 300,
								},
							},
						},
					],
				},
			},
		})
		projectScenesLoad.loadFullProject = () => ({ scenes: { scenes: [] } })

		const result = handleGet('/api/countdown/list', {})
		mockSceneState.getAll = originalGetAll
		projectScenesLoad.loadFullProject = originalLoadFullProject

		assert.equal(result.status, 200)
		const body = JSON.parse(result.body)
		assert.ok(body.items.length >= 1, 'should have at least one timer')

		// Find the live timer in the list (there may be other items from project state)
		const liveTimer = body.items.find(item => item.label === 'Live Timer')
		assert.ok(liveTimer, 'live timer should be in the list')
		assert.ok('onAir' in liveTimer, 'onAir flag should be present')
		assert.equal(liveTimer.onAir, true, 'on-air timer should have onAir=true')
	})
})
