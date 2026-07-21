'use strict'

/**
 * WO-316 — the DeckLink input retry loop could never succeed.
 *
 * Diagnosed live on the box 2026-07-21. The Caspar log showed `PLAY 5-4 DECKLINK 4` failing
 * with "Could not enable video input" every 20s (DECKLINK_INPUT_RETRY_MS), dumping a full
 * exception stack each time. INFO showed why: channel 5 layer 4 was ALREADY running
 * `producer=decklink, file.path=4` — the retry was fighting its own producer. A card input can
 * only be enabled once, and Caspar constructs the new producer before releasing the old one, so
 * re-PLAYing a device the target layer already holds fails deterministically, forever.
 *
 * Ruled out at the time: no decklink consumer existed in the running Caspar config, and channel
 * 3's output consumer is index 3, not 4. Nothing but 5-4 held device 4.
 *
 * The layer also reported has_signal=false — the card was open and the SOURCE was missing, which
 * is what put it in the retry set to begin with.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	foregroundProducerOnLayer,
	isDecklinkProducerForDevice,
	infoResponseToXml,
} = require('../../src/caspar/channel-info-xml')

/** The real INFO shape from the live box (trimmed to what the parser reads). */
const liveInfoXml = (layer, { producer = 'decklink', path = '4', hasSignal = 'false' } = {}) => `
<channel>
  <stage><layer>
    <layer_${layer}>
      <background><producer>empty</producer></background>
      <foreground>
        <buffer>3</buffer>
        <file>
          <audio><channels>16</channels><sample-rate>48000</sample-rate></audio>
          <format>1080p5000</format><fps>50</fps>
          <name>DeckLink 8K Pro</name>
          <path>${path}</path>
          <video><height>1080</height><width>1920</width></video>
        </file>
        <has_signal>${hasSignal}</has_signal>
        <paused>false</paused>
        <producer>${producer}</producer>
      </foreground>
    </layer_${layer}>
  </layer></stage>
</channel>`

test('the live 5-4 case: layer already holds device 4, so a re-PLAY must be skipped', async () => {
	const fg = await foregroundProducerOnLayer(liveInfoXml(4), 4)
	assert.equal(fg.producer, 'decklink')
	assert.equal(fg.device, 4, 'file.path carries the DEVICE INDEX for a decklink producer')
	assert.equal(fg.hasSignal, false, 'open but nothing cabled — the state that caused the retry')
	assert.equal(isDecklinkProducerForDevice(fg, 4), true, 'this must suppress the PLAY')
})

test('a DIFFERENT device on the layer must NOT be treated as satisfied', async () => {
	const fg = await foregroundProducerOnLayer(liveInfoXml(4, { path: '2' }), 4)
	assert.equal(fg.device, 2)
	assert.equal(isDecklinkProducerForDevice(fg, 4), false, 'device 2 does not satisfy a request for 4')
})

test('an empty layer, a non-decklink producer, and a missing layer all fall through to PLAY', async () => {
	const empty = `<channel><stage><layer><layer_4><foreground>
		<producer>empty</producer></foreground></layer_4></layer></stage></channel>`
	assert.equal(await foregroundProducerOnLayer(empty, 4), null, 'empty layer => nothing running')

	const ffmpeg = await foregroundProducerOnLayer(liveInfoXml(4, { producer: 'ffmpeg', path: 'clip.mp4' }), 4)
	assert.equal(ffmpeg.producer, 'ffmpeg')
	assert.equal(ffmpeg.device, null, 'a non-numeric path is not a device index')
	assert.equal(isDecklinkProducerForDevice(ffmpeg, 4), false)

	assert.equal(await foregroundProducerOnLayer(liveInfoXml(4), 9), null, 'layer 9 is not present')
})

test('unreadable INFO returns null (UNKNOWN) so the caller still attempts the PLAY', async () => {
	for (const bad of ['', 'not xml at all', '<channel><broken', null, undefined]) {
		assert.equal(await foregroundProducerOnLayer(bad, 4), null)
	}
	// The critical direction: null must NEVER be read as "yes, it is already open".
	assert.equal(isDecklinkProducerForDevice(null, 4), false)
})

test('isDecklinkProducerForDevice rejects a bad device argument instead of matching loosely', async () => {
	const fg = await foregroundProducerOnLayer(liveInfoXml(4), 4)
	assert.equal(isDecklinkProducerForDevice(fg, NaN), false)
	assert.equal(isDecklinkProducerForDevice(fg, undefined), false)
	assert.equal(isDecklinkProducerForDevice(fg, '4'), true, 'a numeric string is still device 4')
})

test('infoResponseToXml handles both the array and string forms of an AMCP response', () => {
	assert.match(infoResponseToXml({ data: ['<channel>', '</channel>'] }), /<channel>/)
	assert.match(infoResponseToXml({ data: '<channel/>' }), /<channel/)
	assert.equal(infoResponseToXml({}), '')
	assert.equal(infoResponseToXml(null), '')
})

test('wiring: the retry path checks before playing and re-checks after a failure', () => {
	const fs = require('fs')
	const path = require('path')
	const src = fs.readFileSync(path.join(__dirname, '../../src/config/routing-setup.js'), 'utf8')

	assert.match(src, /isDecklinkProducerForDevice\(before, device\)/, 'must check BEFORE playing')
	assert.match(src, /isDecklinkProducerForDevice\(after, device\)/, 'must re-check after a failed PLAY')
	assert.match(src, /assumeReleased/, 'the deliberate re-acquire path must be able to opt out')
	assert.match(src, /alreadyOpen/, 'status must distinguish already-open from a fresh PLAY')
	// The transient classification must survive — a genuinely dead input still has to retry.
	assert.match(src, /source powered off \/ not cabled/, 'transient failure message kept')
	assert.match(src, /scheduleDecklinkInputRetries/, 'the retry loop itself is still wired')
})

test('the deliberate re-acquire path opts out, so its STOP/CLEAR/PLAY sequence stays clean', () => {
	const fs = require('fs')
	const path = require('path')
	const src = fs.readFileSync(path.join(__dirname, '../../src/audio/live-input-start.js'), 'utf8')

	// live-input-start STOPs and CLEARs the layer itself before re-PLAYing, so the card is
	// provably free. Probing there costs a round-trip and inserts an INFO into a sequence that
	// smoke-live-input-stop-start.test.js asserts exactly — it must stay opted out.
	assert.match(src, /assumeReleased:\s*true/, 'the re-acquire path must skip the already-open probe')
	assert.match(src, /STOP \$\{cl\}/, 'it still releases the card first')
})
