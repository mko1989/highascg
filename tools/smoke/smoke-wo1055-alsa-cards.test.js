'use strict'
/**
 * WO-1055 — LTC device dropdowns: GET /api/audio/alsa-cards?dir=capture|playback lists the sound cards by their stable
 * ALSA id (`plughw:CARD=USB,DEV=0` — survives a USB replug renumbering the card).
 */
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { parseAlsaCardList, listAlsaCards } = require('../../src/audio/audio-devices')

const APLAY = `**** List of PLAYBACK Hardware Devices ****
card 0: PCH [HDA Intel PCH], device 0: ALC1220 Analog [ALC1220 Analog]
  Subdevices: 1/1
card 4: USB [Scarlett Solo USB], device 0: USB Audio [USB Audio]
  Subdevice #0: subdevice #0
`

test('card lines → stable plughw:CARD= values with readable labels', () => {
	assert.deepStrictEqual(parseAlsaCardList(APLAY), [
		{ value: 'plughw:CARD=PCH,DEV=0', label: 'HDA Intel PCH — ALC1220 Analog', card: 0, device: 0 },
		{ value: 'plughw:CARD=USB,DEV=0', label: 'Scarlett Solo USB — USB Audio', card: 4, device: 0 },
	])
	assert.deepStrictEqual(parseAlsaCardList('garbage\n'), [])
})

test('direction picks aplay or arecord; a missing tool is an empty list, not a throw', () => {
	const seen = []
	const run = (bin) => (seen.push(bin), APLAY)
	assert.strictEqual(listAlsaCards('capture', run).cards.length, 2)
	assert.strictEqual(listAlsaCards('playback', run).dir, 'playback')
	assert.deepStrictEqual(seen, ['arecord', 'aplay'])
	assert.deepStrictEqual(listAlsaCards('capture', () => null), { dir: 'capture', cards: [], ok: false })
})

test('the route is registered and handled', () => {
	const root = path.join(__dirname, '..', '..')
	const router = fs.readFileSync(path.join(root, 'src/api/router.js'), 'utf8')
	assert.match(router, /routes\.get\('\/api\/audio\/alsa-cards'/)
	const r = require('../../src/api/routes-alsa-cards').handleAlsaCards({ dir: 'capture' })
	assert.strictEqual(r.status, 200)
	assert.strictEqual(JSON.parse(r.body).dir, 'capture')
})
