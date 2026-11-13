'use strict'

/**
 * WO-1071 — a live audio input follows its USB sound card when the kernel renumbers it, and the watchdog restarts a
 * capture that died while the meter null consumer kept the channel's meters fresh.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const follow = require('../../src/audio/live-audio-card-follow')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
const CARDS = (scarlett, radial) =>
	[
		' 0 [PCH            ]: HDA-Intel - HDA Intel PCH',
		'                      HDA Intel PCH at 0x485e220000 irq 244',
		...(scarlett == null ? [] : [` ${scarlett} [USB            ]: USB-Audio - Scarlett Solo USB`, '                      Focusrite at usb-0000:00:14.0-13, high speed']),
		` ${radial} [Pro            ]: USB-Audio - Radial USB Pro`,
	].join('\n')

function ctxOf(cs, cards, capture = () => true) {
	const saved = []
	const logs = []
	return {
		config: { casparServer: cs },
		asoundCards: () => cards.text,
		asoundHasCapture: capture,
		configManager: { get: () => ({}), save: (c) => saved.push(JSON.parse(JSON.stringify(c))) },
		log: (level, msg) => logs.push(`${level} ${msg}`),
		saved,
		logs,
	}
}

describe('WO-1071 live audio input follows its sound card', () => {
	it('parses /proc/asound/cards', () => {
		assert.deepEqual(follow.parseCards(CARDS(4, 3)), [
			{ index: 0, id: 'PCH', name: 'HDA Intel PCH' },
			{ index: 4, id: 'USB', name: 'Scarlett Solo USB' },
			{ index: 3, id: 'Pro', name: 'Radial USB Pro' },
		])
	})
	it('a picked device remembers the id of its card; a named PCM remembers nothing', () => {
		const cs = { live_audio_input_1_device: 'alsa://hw:4,0', live_audio_input_2_device: 'alsa://sc60mon', live_audio_input_2_card: 'old' }
		follow.rememberCards(cs, { live_audio_input_1_device: 'hw:4,0', live_audio_input_2_device: 'sc60mon' }, follow.parseCards(CARDS(4, 3)))
		assert.equal(cs.live_audio_input_1_card, 'USB')
		assert.equal('live_audio_input_2_card' in cs, false)
		const keep = { live_audio_input_1_device: 'alsa://hw:4,0', live_audio_input_1_card: 'USB' }
		follow.rememberCards(keep, { live_audio_input_1_pgm_channels: '1' }, follow.parseCards(CARDS(3, 4)))
		assert.equal(keep.live_audio_input_1_card, 'USB', 'a save that did not carry the device does not re-read the card')
	})
	it('the card came back at another index: the device is rewritten and saved', () => {
		const cards = { text: CARDS(3, 4) }
		const ctx = ctxOf({ live_audio_input_1_device: 'alsa://hw:4,0', live_audio_input_1_card: 'USB' }, cards)
		assert.deepEqual(follow.followCards(ctx).moved, [{ slot: 1, from: 4, to: 3, card: 'USB' }])
		assert.equal(ctx.config.casparServer.live_audio_input_1_device, 'alsa://hw:3,0')
		assert.equal(ctx.saved[0].casparServer.live_audio_input_1_device, 'alsa://hw:3,0')
		assert.match(ctx.logs[0], /card "USB" is hw:3 now \(was hw:4\)/)
		assert.deepEqual(follow.followCards(ctx).moved, [], 'in place: nothing to do')
	})
	it('unplugged: the index is kept and the slot is absent, not a stranger at that index', () => {
		const ctx = ctxOf({ live_audio_input_1_device: 'alsa://hw:4,0', live_audio_input_1_card: 'USB' }, { text: CARDS(null, 4) })
		assert.deepEqual(follow.followCards(ctx).moved, [])
		assert.equal(ctx.config.casparServer.live_audio_input_1_device, 'alsa://hw:4,0')
		assert.deepEqual(follow.capturePresent(ctx, 1), { present: false, why: 'sound card "USB" is not connected' })
	})
	it('no remembered card on a playback-only card (the box, 13.11): absent, with what to do', () => {
		const ctx = ctxOf({ live_audio_input_1_device: 'alsa://hw:4,0' }, { text: CARDS(3, 4) }, (i) => i === 3)
		assert.match(follow.capturePresent(ctx, 1).why, /hw:4,0 \(Radial USB Pro\) has no capture/)
		ctx.config.casparServer.live_audio_input_1_device = 'alsa://hw:3,0'
		assert.deepEqual(follow.capturePresent(ctx, 1), { present: true })
		assert.equal(follow.rememberRunningCard(ctx, 1), true)
		assert.equal(ctx.config.casparServer.live_audio_input_1_card, 'USB')
	})
	it('the watchdog restarts a dead capture and waits for an absent device', () => {
		const h = read('src/audio/live-audio-health.js')
		assert.match(h, /const bridgeDead = bridgeOn && !isLiveAudioBridgeAlive\(slot\.slot\)/)
		assert.match(h, /if \(!opts\.force && !oscStale && !bridgeDead && !back && !moved\.has\(slot\.slot\)\) continue/)
		assert.match(h, /reason: 'device_absent'/)
		assert.match(read('src/api/routes-audio.js'), /live-audio-card-follow'\)\.rememberPicked\(cs, b, ctx\)/)
	})
})
