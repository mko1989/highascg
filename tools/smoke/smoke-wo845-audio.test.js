'use strict'

/**
 * WO-845 smoke — audio defects from the 29.10 sweep (REPORT §5 "Audio"):
 *  - setDefaultAlsaDevice overwrote the whole ~/.asoundrc (destroying the box's hand-authored pcm.sc60mon)
 *  - an ALSA volume control without an [on|off] switch parsed as a boolean that is OFF
 *  - a removed live-audio slot kept its persisted PGM route selection
 * Temp HOME only; the real ~/.asoundrc is never touched. No AMCP.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { setDefaultAlsaDevice, mergeAsoundrcBlock } = require('../../src/audio/audio-devices')
const { parseAmixerScontents } = require('../../src/audio/alsa-mixer-controls')

const HAND_AUTHORED = `# HighAsCG WO-406: 48 kHz plug view of the Sennheiser SC60 USB headset.
pcm.sc60mon {
    type plug
    slave {
        pcm "hw:2,0"
        rate 48000
    }
}
`

test('WO-845: setDefaultAlsaDevice edits only its own marked block of ~/.asoundrc', () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wo845-home-'))
	try {
		const rc = path.join(home, '.asoundrc')
		fs.writeFileSync(rc, HAND_AUTHORED)
		const r1 = setDefaultAlsaDevice(1, 3, { scope: 'user', home })
		assert.equal(r1.ok, true)
		let txt = fs.readFileSync(rc, 'utf8')
		assert.ok(txt.startsWith(HAND_AUTHORED), 'hand-authored content kept verbatim')
		assert.match(txt, /defaults\.pcm\.card 1\ndefaults\.pcm\.device 3\ndefaults\.ctl\.card 1\n/)
		assert.equal(fs.readFileSync(`${rc}.highascg.bak`, 'utf8'), HAND_AUTHORED, 'one-time backup of the original')

		const r2 = setDefaultAlsaDevice(2, 0, { scope: 'user', home })
		assert.equal(r2.ok, true)
		txt = fs.readFileSync(rc, 'utf8')
		assert.ok(txt.startsWith(HAND_AUTHORED))
		assert.equal((txt.match(/HighAsCG default device \(managed block/g) || []).length, 1, 'block replaced, not duplicated')
		assert.match(txt, /defaults\.pcm\.card 2\ndefaults\.pcm\.device 0/)
		assert.doesNotMatch(txt, /defaults\.pcm\.card 1/)
		assert.equal(fs.existsSync(`${rc}.highascg.tmp`), false)

		// a fresh home gets just the block
		const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wo845-home-'))
		assert.equal(setDefaultAlsaDevice(0, 0, { scope: 'user', home: home2 }).ok, true)
		assert.match(fs.readFileSync(path.join(home2, '.asoundrc'), 'utf8'), /^# >>> HighAsCG default device/)
		fs.rmSync(home2, { recursive: true, force: true })

		// garbage numbers never reach the file
		for (const [c, d] of [[NaN, 0], [0, NaN], [-1, 0], [1.5, 0]]) {
			assert.equal(setDefaultAlsaDevice(c, d, { scope: 'user', home }).ok, false)
		}
		assert.equal(fs.readFileSync(rc, 'utf8'), txt, 'rejected calls left the file untouched')
	} finally {
		fs.rmSync(home, { recursive: true, force: true })
	}
	assert.equal(mergeAsoundrcBlock('a\n', 'x 1\n').startsWith('a\n\n# >>>'), true)
})

const PCM_NO_SWITCH = `Simple mixer control 'PCM',0
  Capabilities: pvolume
  Playback channels: Front Left - Front Right
  Limits: Playback 0 - 255
  Mono:
  Front Left: Playback 255 [100%] [0.00dB]
  Front Right: Playback 255 [100%] [0.00dB]
Simple mixer control 'Headphone',0
  Capabilities: pvolume pswitch
  Playback channels: Front Left - Front Right
  Limits: Playback 0 - 87
  Mono:
  Front Left: Playback 87 [100%] [0.00dB] [off]
  Front Right: Playback 87 [100%] [0.00dB] [on]
Simple mixer control 'Master',0
  Capabilities: pvolume pvolume-joined
  Playback channels: Mono
  Limits: Playback 0 - 87
  Mono: Playback 43 [49%] [-20.00dB]
Simple mixer control 'Digital',0
  Capabilities: cvolume
  Capture channels: Front Left - Front Right
  Limits: Capture 0 - 120
  Front Left: Capture 60 [50%] [0.00dB]
  Front Right: Capture 60 [50%] [0.00dB]
`

test('WO-845: ALSA volume controls without a switch are volumes (ON), not an OFF boolean', () => {
	const by = Object.fromEntries(parseAmixerScontents(PCM_NO_SWITCH).map((c) => [c.name, c]))
	assert.equal(by.PCM.type, 'volume')
	assert.equal(by.PCM.value, 255)
	assert.equal(by.PCM.percent, 100)
	assert.equal(by.PCM.muted, false)
	assert.equal(by.Master.type, 'volume', 'mono without a switch')
	assert.equal(by.Master.percent, 49)
	assert.equal(by.Master.muted, false)
	assert.equal(by.Digital.type, 'volume', 'capture volume without a switch')
	assert.equal(by.Digital.muted, false)
	// a real [off] still mutes
	assert.equal(by.Headphone.type, 'volume')
	assert.equal(by.Headphone.muted, true)
})

test('WO-845: a removed live-audio slot loses its persisted PGM route selection (server side)', async () => {
	const { clearRemovedSlotPgmRoutes } = require('../../src/audio/live-audio-slot-prune')
	const cs = {
		live_audio_input_count: 2,
		live_audio_input_1_device: '',
		live_audio_input_1_pgm_channels: '1,2',
		live_audio_input_2_device: 'alsa://hw:2,0',
		live_audio_input_2_pgm_channels: '1',
		live_audio_input_3_device: 'alsa://hw:3,0', // beyond the count
		live_audio_input_3_pgm_channels: '2',
		live_audio_input_4_pgm_channels: '', // already none
	}
	assert.deepEqual(clearRemovedSlotPgmRoutes(cs), [1, 3])
	assert.equal(cs.live_audio_input_1_pgm_channels, '', 'removed slot: route to nothing')
	assert.equal(cs.live_audio_input_2_pgm_channels, '1', 'live slot untouched')
	assert.equal(cs.live_audio_input_3_pgm_channels, '')
	assert.equal('live_audio_input_5_pgm_channels' in cs, false, 'never-touched slots get no key (legacy routing intact)')

	// end to end through the route: the client re-sends the stale selection of the slot it just removed
	const { handlePost } = require('../../src/api/routes-audio')
	const ctx = {
		log() {},
		config: { casparServer: { live_audio_input_count: 2, live_audio_input_1_device: 'alsa://hw:1,0', live_audio_input_1_pgm_channels: '1,2' } },
	}
	const res = await handlePost('/api/audio/live-inputs/config', JSON.stringify({
		live_audio_input_count: 2,
		live_audio_input_1_device: '',
		live_audio_input_1_pgm_channels: [1, 2],
	}), ctx)
	assert.equal(res.status, 200)
	assert.equal(ctx.config.casparServer.live_audio_input_1_pgm_channels, '')
	// adding a device back into that slot starts with no PGM routes
	const { listConfiguredLiveAudioSlots } = require('../../src/config/live-audio-input')
	ctx.config.casparServer.live_audio_input_1_device = 'alsa://hw:1,0'
	assert.deepEqual(listConfiguredLiveAudioSlots(ctx.config).slots[0].pgmChannels, [])
})
