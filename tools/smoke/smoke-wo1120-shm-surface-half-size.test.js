'use strict'

/** WO-1120 — a channel far above UHD is published as a half-size ring (`ADD … SHM NAME <role> SCALE 2`); others as before. */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createVideoSurfaceManager, scaleFor } = require('../../src/system/video-surfaces')

const MAP = {
	programChannels: [2, 4],
	previewChannels: [3, null],
	channelResolutionsByChannel: { 1: { w: 1920, h: 1080 }, 2: { w: 11520, h: 1536 }, 3: { w: 11520, h: 1536 }, 4: { w: 1920, h: 1080 }, 5: { w: 3840, h: 2160 } },
}

test('scaleFor: 2 only far above UHD', () => {
	assert.equal(scaleFor(2, MAP), 2, '11520×1536 = 17.7 MP')
	assert.equal(scaleFor(5, MAP), 1, 'UHD stays whole')
	assert.equal(scaleFor(4, MAP), 1)
	assert.equal(scaleFor(9, MAP), 1, 'unknown channel')
	assert.equal(scaleFor(2, {}), 1, 'no resolution map')
})

test('the ADD carries SCALE 2 for the big canvas only, and the descriptor says so', async () => {
	const lines = []
	const m = createVideoSurfaceManager({
		getAmcp: () => ({ basic: { add: async (ch, c, params, idx) => lines.push(`ADD ${ch}-${idx} ${c} ${params}`), remove: async () => ({ ok: false }) } }),
		getChannelMap: () => MAP,
		settleMs: 0,
	})
	const list = await m.lease('godot-a', ['pgm1', 'pgm2'])
	assert.deepEqual(lines, ['ADD 2-741 SHM NAME pgm1 SCALE 2', 'ADD 4-743 SHM NAME pgm2'])
	assert.equal(list.find((s) => s.role === 'pgm1').scale, 2)
	assert.equal(list.find((s) => s.role === 'pgm2').scale, 1)
})
