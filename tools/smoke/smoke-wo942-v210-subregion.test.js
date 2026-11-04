'use strict'

/**
 * WO-942 — a YUV (v210) DeckLink port must not carry <width>, <height> or a non-zero <dest-x>.
 *
 * The deployed Caspar (2.5.1 line) only converts a v210 frame when region_w == 0 && region_h == 0 && dest_x == 0;
 * otherwise the card gets a zero buffer = solid green on SDI (box, 04.11: a mapping node feeding DeckLink 3 + 4 at
 * 2160p50 yuv showed green with 3072×1024 AND 3840×2160 regions, picture once width/height were omitted).
 * The fixture is that exact rig; the expected XML is the config proven on the switcher.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildDecklinkTiledConsumersXml } = require('../../src/config/config-generator-consumer-attach-screen')
const { decklinkSubregionFields, v210HonoursRegion } = require('../../src/config/decklink-v210-subregion')

/** Box rig 04.11: PGM 6144×1024 → mapping node → DeckLink 3 (0..3072) + DeckLink 4 (3072..6144), both 2160p5000. */
const tiles = [
	{ device: 3, srcX: 0, srcY: 0, destX: 0, destY: 0, width: 3072, height: 1024, videoMode: '2160p5000' },
	{ device: 4, srcX: 3072, srcY: 0, destX: 0, destY: 0, width: 3072, height: 1024, videoMode: '2160p5000' },
]
const blocks = (xml) =>
	[...String(xml).matchAll(/<subregion>([\s\S]*?)<\/subregion>/g)].map((m) => m[1].replace(/\s+/g, ''))

test('WO-942: yuv ports — src-x/src-y/dest-y only, no width/height (the config proven on the box)', () => {
	const xml = buildDecklinkTiledConsumersXml(tiles, { videoMode: '2160p5000', consumerSettings: { pixelFormat: 'yuv' } })
	assert.match(xml, /<pixel-format>yuv<\/pixel-format>/)
	assert.deepEqual(blocks(xml), [
		'<src-x>0</src-x><src-y>0</src-y><dest-x>0</dest-x><dest-y>0</dest-y>',
		'<src-x>3072</src-x><src-y>0</src-y><dest-x>0</dest-x><dest-y>0</dest-y>',
	])
})

test('WO-942: yuv cannot place horizontally — dest-x is forced to 0, dest-y survives', () => {
	const f = decklinkSubregionFields({ srcX: 100, srcY: 10, destX: 480, destY: 270, width: 960, height: 540 }, 'yuv')
	assert.deepEqual(f, { srcX: 100, srcY: 10, destX: 0, destY: 270, width: null, height: null })
})

test('WO-942: rgba and auto (8-bit → BGRA path) keep the full subregion — WO-869 placement unchanged', () => {
	for (const pixelFormat of ['rgba', '', undefined]) {
		const xml = buildDecklinkTiledConsumersXml(tiles, { videoMode: '2160p5000', consumerSettings: { pixelFormat } })
		assert.deepEqual(blocks(xml), [
			'<src-x>0</src-x><src-y>0</src-y><dest-x>0</dest-x><dest-y>0</dest-y><width>3072</width><height>1024</height>',
			'<src-x>3072</src-x><src-y>0</src-y><dest-x>0</dest-x><dest-y>0</dest-y><width>3072</width><height>1024</height>',
		])
	}
	const f = decklinkSubregionFields({ srcX: 100, srcY: 0, destX: 480, destY: 270, width: 960, height: 540 }, 'rgba')
	assert.deepEqual([f.destX, f.width, f.height], [480, 960, 540])
})

test('WO-942: the gate stays closed until the fork carries upstream #1700 (flip it then, and this test with it)', () => {
	assert.equal(v210HonoursRegion(), false)
})
