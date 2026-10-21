/**
 * WO-600 M — POST /api/multiview/audio-focus composes the focus MIXER lines on the server against
 * the APPLIED layout (so the Godot editor and the web editor send no raw AMCP). VOLUME is linear
 * gain on this build: the web editor used to send dB with the layer in the volume slot.
 */

'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { handlePost, buildAudioFocusLines } = require('../../src/api/routes-multiview')

const config = { screenDestinations: { destinations: [{ id: 'pgm1', mode: 'pgm_prv', mainScreenIndex: 0 }, { id: 'mv1', mode: 'multiview' }] } }
const layout = [{ id: 'pgm' }, { id: 'prv' }, { id: 'decklink_0' }]

function ctxWith(applied) {
	const sent = []
	return {
		sent,
		config,
		_multiviewLayouts: applied ? { 1: { n: 1, layout: applied } } : {},
		persistence: { get: () => null },
		amcp: { batchSendChunked: async (lines) => { sent.push(...lines); return {} } },
		log: () => {},
	}
}

test('lines: layers 1–10 and other cells silenced, focused cell at unity (linear, ch-layer form)', () => {
	const lines = buildAudioFocusLines(3, 3, 1)
	assert.equal(lines.length, 13)
	assert.equal(lines[0], 'MIXER 3-1 VOLUME 0')
	assert.equal(lines[9], 'MIXER 3-10 VOLUME 0')
	assert.deepEqual(lines.slice(10), ['MIXER 3-11 VOLUME 0', 'MIXER 3-12 VOLUME 1', 'MIXER 3-13 VOLUME 0'])
	assert.ok(lines.every((l) => /^MIXER \d+-\d+ VOLUME [01]$/.test(l)), 'never a dB figure')
})

test('focus resolves the cell in the applied layout of the multiviewer channel', async () => {
	const ctx = ctxWith(layout)
	const res = await handlePost('/api/multiview/audio-focus', JSON.stringify({ n: 1, cellId: 'decklink_0' }), ctx)
	assert.equal(res.status, 200)
	assert.deepEqual(JSON.parse(res.body), { ok: true, channel: 3, layer: 13 })
	assert.ok(ctx.sent.includes('MIXER 3-13 VOLUME 1'))
	assert.ok(ctx.sent.includes('MIXER 3-11 VOLUME 0'))
})

test('refusals: unknown cell 404, nothing applied 409, multiviewer absent 400 — no AMCP sent', async () => {
	const a = ctxWith(layout)
	assert.equal((await handlePost('/api/multiview/audio-focus', { n: 1, cellId: 'nope' }, a)).status, 404)
	const b = ctxWith(null)
	assert.equal((await handlePost('/api/multiview/audio-focus', { n: 1, cellId: 'pgm' }, b)).status, 409)
	const c = ctxWith(layout)
	assert.equal((await handlePost('/api/multiview/audio-focus', { n: 2, cellId: 'pgm' }, c)).status, 400)
	assert.equal(a.sent.length + b.sent.length + c.sent.length, 0)
})

test('apply path still dispatches; unknown subpaths fall through', async () => {
	const ctx = ctxWith(layout)
	assert.equal((await handlePost('/api/multiview/apply', { n: 1 }, ctx)).status, 400, 'layout array required')
	assert.equal(await handlePost('/api/multiview/nope', {}, ctx), null)
})
