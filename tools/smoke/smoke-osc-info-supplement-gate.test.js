'use strict'

/* WO-477. The OSC INFO supplement (WO-252) polled `INFO <program channel>` on a fixed 2s heartbeat
 * for as long as an OSC listener existed — `isOscPlaybackActive()` only checks that `ctx.oscState`
 * is present, not that anything is playing. On .28 that meant `INFO 1` + `INFO 3` every two
 * seconds forever, idle or not, against the standing rule to keep AMCP traffic minimal.
 *
 * The duration this supplement exists to fetch is a property of the CLIP, so it is asked once per
 * clip: the gate opens on a clip-signature change, allows one retry (Caspar may not have parsed the
 * file on the first INFO), then stays shut until the content changes again. */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	MAX_TRIES_PER_CLIP,
	oscClipSignatureForChannel,
	shouldSendOscInfoSupplement,
	resetOscInfoSupplementGate,
} = require('../../src/utils/periodic-sync-osc-info-gate')

/** @param {Record<string, object>} layersByChannel */
function ctxWithOsc(layersByChannel) {
	const channels = {}
	for (const [ch, layers] of Object.entries(layersByChannel)) channels[ch] = { layers }
	return { oscState: { getSnapshot: () => ({ channels }) } }
}

const CLIP_A = { 10: { file: { name: 'BRIDGE/TALK2' } } }
const CLIP_B = { 10: { file: { name: 'BRIDGE/LEADER2050_INTRO' } } }

test('WO-477: an idle channel never spends an INFO', () => {
	resetOscInfoSupplementGate()
	const idle = ctxWithOsc({ 1: {} })
	for (let tick = 0; tick < 10; tick++) {
		assert.equal(shouldSendOscInfoSupplement(idle, 1), false, `tick ${tick} must stay silent`)
	}
})

test('WO-477: one clip costs at most MAX_TRIES_PER_CLIP INFOs, however long it plays', () => {
	resetOscInfoSupplementGate()
	const ctx = ctxWithOsc({ 1: CLIP_A })
	let sent = 0
	for (let tick = 0; tick < 60; tick++) {
		if (shouldSendOscInfoSupplement(ctx, 1)) sent++
	}
	assert.equal(sent, MAX_TRIES_PER_CLIP, 'steady playback must not re-ask forever')
	assert.equal(MAX_TRIES_PER_CLIP, 2, 'one INFO on the change, one retry')
})

test('WO-477: a new clip reopens the gate', () => {
	resetOscInfoSupplementGate()
	const a = ctxWithOsc({ 1: CLIP_A })
	while (shouldSendOscInfoSupplement(a, 1)) {
		/* drain the allowance for clip A */
	}
	const b = ctxWithOsc({ 1: CLIP_B })
	assert.equal(shouldSendOscInfoSupplement(b, 1), true, 'the next clip is asked about once')
})

test('WO-477: channels are gated independently', () => {
	resetOscInfoSupplementGate()
	const ctx = ctxWithOsc({ 1: CLIP_A, 3: CLIP_B })
	assert.equal(shouldSendOscInfoSupplement(ctx, 1), true)
	assert.equal(shouldSendOscInfoSupplement(ctx, 3), true, 'channel 3 has its own signature')
})

test('WO-477: going empty shuts the gate and re-arms it for the next clip', () => {
	resetOscInfoSupplementGate()
	const playing = ctxWithOsc({ 1: CLIP_A })
	assert.equal(shouldSendOscInfoSupplement(playing, 1), true)
	const cleared = ctxWithOsc({ 1: {} })
	assert.equal(shouldSendOscInfoSupplement(cleared, 1), false, 'an empty stage needs no INFO')
	assert.equal(shouldSendOscInfoSupplement(playing, 1), true, 'the same clip re-loaded is asked again')
})

test('WO-477: the signature tracks clip identity, not tick-to-tick timing noise', () => {
	const a = ctxWithOsc({ 1: { 10: { file: { name: 'CLIP', time: 1.0, frame: 25 } } } })
	const b = ctxWithOsc({ 1: { 10: { file: { name: 'CLIP', time: 9.5, frame: 475 } } } })
	assert.equal(oscClipSignatureForChannel(a, 1), oscClipSignatureForChannel(b, 1))
	assert.notEqual(oscClipSignatureForChannel(a, 1), '')
})

test('WO-477: the supplement filters its channel list through the gate', () => {
	const src = require('node:fs').readFileSync(
		require('node:path').join(__dirname, '../../src/utils/periodic-sync.js'),
		'utf8',
	)
	assert.match(src, /shouldSendOscInfoSupplement\(self, ch\)/, 'gate is applied to the tick channel list')
	assert.match(src, /resetOscInfoSupplementGate\(\)/, 'gate state is dropped on teardown/reconnect')
})
