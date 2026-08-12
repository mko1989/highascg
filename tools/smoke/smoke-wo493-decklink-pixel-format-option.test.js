'use strict'

/**
 * WO-493 — the DeckLink `<pixel-format>` operator override must actually reach the config.
 *
 * WO-487 stopped forcing `yuv` on UHD SDI (it costs a per-frame RGBA→YUV convert on 8-bit channels)
 * and said the element would still be "emitted only on an explicit operator override". That override
 * was UNREACHABLE: both call sites invoked `decklinkPixelFormatXml(videoMode)` with no second
 * argument, so `consumerSettings` was always `undefined` and the element could never be produced by
 * any input at all. On this box a 2160p SDI output with no `<pixel-format>` shows nothing AND wedges
 * its channel, so every consumer on that channel goes dark — with no way back.
 *
 * These tests pin the override end-to-end on BOTH shapes: the plain key/fill consumer and the tiled
 * (LED-wall / pixel-mapped) consumer, which is the shape a 2160p wall actually uses.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	buildDecklinkKeyFillConsumersXml,
	normalizeDecklinkPixelFormat,
	readDecklinkConsumerSettings,
	applyDecklinkConsumerSettingsFromConnector,
	DEFAULT_DECKLINK_CONSUMER_SETTINGS,
} = require('../../src/config/decklink-key-fill')
const { buildDecklinkTiledConsumersXml } = require('../../src/config/config-generator-consumer-attach-screen')

const pixelFormats = (xml) => [...String(xml).matchAll(/<pixel-format>([^<]*)<\/pixel-format>/g)].map((m) => m[1])

test('WO-493: default is auto — no <pixel-format> element (WO-487 behaviour preserved)', () => {
	assert.equal(DEFAULT_DECKLINK_CONSUMER_SETTINGS.pixelFormat, '')
	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		videoMode: '1080p5000',
		consumerSettings: { ...DEFAULT_DECKLINK_CONSUMER_SETTINGS },
	})
	assert.deepEqual(pixelFormats(xml), [], '1080p rigs must keep paying nothing for this')
})

test('WO-493: yuv override reaches the key/fill consumer XML', () => {
	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		videoMode: '2160p5000',
		consumerSettings: { pixelFormat: 'yuv' },
	})
	assert.deepEqual(pixelFormats(xml), ['yuv'], 'this is the element whose absence blanks a 2160p SDI')
})

test('WO-493: yuv reaches BOTH consumers of a fill+key pair', () => {
	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		keyDevice: 2,
		videoMode: '2160p5000',
		consumerSettings: { pixelFormat: 'yuv' },
	})
	assert.deepEqual(pixelFormats(xml), ['yuv', 'yuv'], 'the key-only consumer needs it too')
})

test('WO-493: yuv override reaches the TILED (pixel-mapped wall) consumer XML', () => {
	const tiles = [
		{ device: 1, srcX: 0, srcY: 0, destX: 0, destY: 0, width: 3840, height: 2160, videoMode: '2160p5000' },
		{ device: 2, srcX: 3840, srcY: 0, destX: 0, destY: 0, width: 3840, height: 2160, videoMode: '2160p5000' },
	]
	const withOverride = buildDecklinkTiledConsumersXml(tiles, {
		videoMode: '2160p5000',
		consumerSettings: { pixelFormat: 'yuv' },
	})
	assert.deepEqual(pixelFormats(withOverride), ['yuv'], 'a 2160p LED wall is exactly the case that needs it')

	const withoutOverride = buildDecklinkTiledConsumersXml(tiles, { videoMode: '2160p5000' })
	assert.deepEqual(pixelFormats(withoutOverride), [], 'and auto still omits it')
})

test('WO-493: rgba can be forced too, and junk falls back to auto', () => {
	assert.equal(normalizeDecklinkPixelFormat('RGBA'), 'rgba')
	assert.equal(normalizeDecklinkPixelFormat('  YUV '), 'yuv')
	for (const junk of ['', null, undefined, 'nonsense', 'v210', 0]) {
		assert.equal(normalizeDecklinkPixelFormat(junk), '', `${JSON.stringify(junk)} must mean auto`)
	}
	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		videoMode: '1080p5000',
		consumerSettings: { pixelFormat: 'rgba' },
	})
	assert.deepEqual(pixelFormats(xml), ['rgba'])
})

test('WO-493: the choice round-trips connector -> flat casparServer key -> generator', () => {
	// What the inspector saves on the connector.
	const connector = { caspar: { decklinkPixelFormat: 'yuv' } }
	const merged = {}
	applyDecklinkConsumerSettingsFromConnector(merged, 'screen_1_', connector)
	assert.equal(merged.screen_1_decklink_pixel_format, 'yuv', 'must be persisted as a flat key')

	// What the generator reads back out of that flat config.
	const settings = readDecklinkConsumerSettings(merged, 'screen_1_')
	assert.equal(settings.pixelFormat, 'yuv')

	const xml = buildDecklinkKeyFillConsumersXml({
		fillDevice: 1,
		videoMode: '2160p5000',
		consumerSettings: settings,
	})
	assert.deepEqual(pixelFormats(xml), ['yuv'], 'end to end: inspector choice -> emitted element')
})

test('WO-493: an untouched output round-trips as auto, not as a forced format', () => {
	const merged = {}
	applyDecklinkConsumerSettingsFromConnector(merged, 'screen_2_', { caspar: {} })
	assert.equal(merged.screen_2_decklink_pixel_format, '')
	assert.equal(readDecklinkConsumerSettings(merged, 'screen_2_').pixelFormat, '')
})

test('WO-493: the inspector offers the option and saves it (source contract)', () => {
	const fs = require('fs')
	const path = require('path')
	const REPO = path.resolve(__dirname, '../..')
	const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

	const shared = read('client/components/device-view-inspector-decklink-shared.js')
	assert.match(shared, /DECKLINK_PIXEL_FORMAT_OPTIONS/)
	assert.match(shared, /pixelFormat: String\(c\.decklinkPixelFormat/, 'the control must read back what was saved')

	const out = read('client/components/device-view-inspector-decklink-output.js')
	assert.match(out, /DECKLINK_PIXEL_FORMAT_OPTIONS/, 'the select must be rendered')
	assert.match(out, /decklinkPixelFormat: String\(pixSel\.value/, 'and its value must be in the save patch')
	assert.match(out, /decklinkModeNeedsYuv/, '2160p must warn when left on Auto')

	// The regression that made WO-487's escape hatch unreachable: a bare one-arg call.
	for (const rel of [
		'src/config/decklink-key-fill.js',
		'src/config/config-generator-consumer-attach-screen.js',
	]) {
		// Line-based on purpose: the argument can contain nested parens
		// (`String(opts.videoMode || tiles[0]?.videoMode || '')`), which a naive `[^)]*` truncates.
		const callLines = read(rel)
			.split('\n')
			.filter((l) => l.includes('decklinkPixelFormatXml(') && !l.includes('function decklinkPixelFormatXml'))
		assert.ok(callLines.length > 0, `${rel}: expected at least one call site`)
		for (const line of callLines) {
			assert.ok(
				line.includes('consumerSettings'),
				`${rel}: decklinkPixelFormatXml must be passed consumerSettings — this one-arg form is what made the override unreachable: ${line.trim()}`,
			)
		}
	}
})
