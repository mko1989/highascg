'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

// Test server-side slot picker logic via a minimal mirror (client module is ESM).
const { LIVE_AUDIO_MAX_SLOTS } = require('../../client/lib/live-audio-inputs.js')

function pickLiveAudioSlotForDevice(ui, device) {
	const dev = String(device || '').trim()
	if (!dev) throw new Error('Select a capture device')
	for (let i = 1; i <= ui.count; i++) {
		if (!String(ui.slots[i - 1] || '').trim()) return { slot: i, count: ui.count, slots: [...ui.slots] }
	}
	if (ui.count >= LIVE_AUDIO_MAX_SLOTS) {
		throw new Error(`Maximum ${LIVE_AUDIO_MAX_SLOTS} live audio inputs`)
	}
	const count = ui.count + 1
	const slots = [...ui.slots]
	slots[count - 1] = dev
	return { slot: count, count, slots }
}

describe('live-audio-add-input', () => {
	it('reuses first empty slot within count', () => {
		const ui = { count: 2, slots: ['alsa://hw:0,0', ''] }
		const r = pickLiveAudioSlotForDevice(ui, 'alsa://hw:1,0')
		assert.equal(r.slot, 2)
		assert.equal(r.count, 2)
	})

	it('appends a new slot when all are filled', () => {
		const ui = { count: 1, slots: ['alsa://hw:0,0', '', '', '', '', '', '', ''] }
		const r = pickLiveAudioSlotForDevice(ui, 'alsa://hw:1,0')
		assert.equal(r.slot, 2)
		assert.equal(r.count, 2)
		assert.equal(r.slots[1], 'alsa://hw:1,0')
	})
})
