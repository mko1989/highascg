'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildChannelMapSummary, compareChannelParity } = require('../src/replication/channel-parity')

test('compareChannelParity reports program channel mismatch', () => {
	const local = { screenCount: 2, programChannels: [1, 3], previewChannels: [2, null], multiviewCh: 4 }
	const peer = { screenCount: 2, programChannels: [1, 2], previewChannels: [2, null], multiviewCh: 4 }
	const out = compareChannelParity(local, peer)
	assert.equal(out.ok, false)
	assert.equal(out.mismatches.length, 1)
	assert.equal(out.mismatches[0].kind, 'program')
	assert.match(out.mismatches[0].label, /screen 2/)
})

test('compareChannelParity ok when maps match', () => {
	const map = { screenCount: 1, programChannels: [1], previewChannels: [2], multiviewCh: 3 }
	const out = compareChannelParity(map, { ...map, programChannels: [1], previewChannels: [2] })
	assert.equal(out.ok, true)
	assert.equal(out.mismatches.length, 0)
})

test('buildChannelMapSummary returns arrays from config', () => {
	const summary = buildChannelMapSummary({
		virtual_main_channels: [{ pgm: 5, prv: 6 }],
	})
	assert.deepEqual(summary.programChannels, [5])
	assert.deepEqual(summary.previewChannels, [6])
})
