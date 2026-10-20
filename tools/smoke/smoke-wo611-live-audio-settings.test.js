'use strict'
/**
 * WO-611 #8 — Settings → Live audio read `liveState.channelMap`, which GET /api/audio/live-inputs never sends, so
 * every configured slot showed "not in channelMap yet". #9 — the ALSA mixer rescaled a server `percent` by min..max.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

test('live audio status builds its map from the live-inputs payload fields', async () => {
	const src = read('client/components/settings-live-audio-panel.js')
	assert.match(
		src,
		/liveState\?\.channelMap \|\| \{\s*liveAudioCount: liveState\?\.liveAudioCount,\s*liveAudioInputChannels: liveState\?\.liveAudioInputChannels,/
	)
	const { listInputChannels } = await import(pathToFileURL(path.join(root, 'client/lib/input-channels.js')).href)
	const entries = listInputChannels({ liveAudioCount: 2, liveAudioInputChannels: [5, 6] }).filter(
		(e) => e.kind === 'live_audio'
	)
	assert.deepStrictEqual(
		entries.map((e) => [e.slot, e.channel]),
		[
			[1, 5],
			[2, 6],
		]
	)
})

test('ALSA percent from the server is not rescaled', async () => {
	const { alsaControlPercent } = await import(pathToFileURL(path.join(root, 'client/lib/alsa-mixer-api.js')).href)
	assert.strictEqual(alsaControlPercent({ min: 0, max: 87, value: 43, percent: 49 }), 49)
	assert.strictEqual(alsaControlPercent({ min: 0, max: 87, value: 87, percent: 100 }), 100)
	assert.strictEqual(alsaControlPercent({ min: 0, max: 31, value: 31 }), 100)
})
