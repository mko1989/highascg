'use strict'

/**
 * WO-803 — GET /api/screens/pgm-layer: each program screen's main layer for the Companion PGM readback button.
 * The pick (WO-734 main video: topmost non-looped clip in the live bank), the empty/cleared state, clamping, and the
 * route reached through the real router (the registry matches in order; an earlier wildcard must not swallow it).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { pgmLayers } = require('../../src/api/routes-pgm-layer')
const { routeRequest } = require('../../src/api/router')
const { buildChannelMap } = require('../../src/config/channel-map-from-ctx')

const now = 5_000_000
const clip = (o = {}, ly = {}) => ({
	type: 'ffmpeg',
	paused: false,
	_lastOscAt: now - 100,
	file: { name: 'PROJECTS/X/OPENER', elapsed: 15, remaining: 45, duration: 60, ...o },
	...ly,
})
const cm = { programChannels: [1, 3], screenLabels: ['Dioda', ''] }

describe('WO-803 pgm layer readback', () => {
	it('one entry per program screen; the main clip with remaining, duration, progress', () => {
		const s = pgmLayers({ channels: { 1: { layers: { 10: clip({ loop: true }), 12: clip() } } } }, cm, {}, now)
		assert.equal(s.length, 2)
		assert.deepEqual(s[0], {
			screen: 0,
			label: 'Dioda',
			channel: 1,
			active: true,
			layer: 12,
			clip: 'OPENER',
			remainingSec: 45,
			durationSec: 60,
			elapsedSec: 15,
			progress: 0.25,
			paused: false,
		})
		assert.deepEqual(s[1], {
			screen: 1,
			label: 'Screen 2',
			channel: 3,
			active: false,
			layer: null,
			clip: '',
			remainingSec: null,
			durationSec: null,
			elapsedSec: null,
			progress: 0,
			paused: false,
		})
	})

	it('cleared / taken out / only looped backgrounds / stale → inactive (button clears)', () => {
		const empty = pgmLayers({ channels: {} }, cm, {}, now)
		assert.deepEqual(empty.map((x) => x.active), [false, false])
		const loops = pgmLayers({ channels: { 1: { layers: { 10: clip({ loop: true }) } } } }, cm, {}, now)
		assert.equal(loops[0].active, false)
		const stale = pgmLayers({ channels: { 1: { layers: { 10: clip({}, { _lastOscAt: now - 60_000 }) } } } }, cm, {}, now)
		assert.equal(stale[0].active, false)
		const cleared = pgmLayers({ channels: { 1: { layers: { 10: { type: 'empty', file: {} } } } } }, cm, {}, now)
		assert.equal(cleared[0].active, false)
	})

	it('paused carried; live bank B read; remaining clamped to 0..duration', () => {
		const p = pgmLayers({ channels: { 1: { layers: { 10: clip({}, { paused: true }) } } } }, cm, {}, now)
		assert.equal(p[0].paused, true)
		const bankB = pgmLayers({ channels: { 1: { layers: { 10: clip({ name: 'A' }), 110: clip({ name: 'B' }) } } } }, cm, { 1: 'b' }, now)
		assert.equal(bankB[0].layer, 110)
		assert.equal(bankB[0].clip, 'B')
		const over = pgmLayers({ channels: { 1: { layers: { 10: clip({ remaining: -3, elapsed: 63 }) } } } }, cm, {}, now)
		assert.equal(over[0].remainingSec, 0)
		assert.equal(over[0].progress, 1)
	})

	it('GET /api/screens/pgm-layer is reached through the real router (no Caspar needed)', async () => {
		const ctx = {
			config: {},
			log: () => {},
			oscState: { getSnapshot: () => ({ channels: {} }) },
		}
		const res = await routeRequest('GET', '/api/screens/pgm-layer', '', ctx, null)
		assert.equal(res.status, 200)
		const body = JSON.parse(res.body)
		assert.equal(body.ok, true)
		assert.ok(Number.isFinite(body.serverNowMs))
		assert.equal(body.screens.length, buildChannelMap(ctx).programChannels.length)
		assert.ok(body.screens.every((x) => x.active === false))
	})
})
