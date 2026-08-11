'use strict'

/* WO-485. PGM1 on highascg0916 is a 6144x1536 channel driving two DeckLink cards at 2160p50 via
 * mapping-node outputs with no authored mapping rect. The tiles were sized from the OUTPUT's mode
 * (3840x2160) and packed left-to-right by that width, so the generated config asked for:
 *
 *     device 1: src-x 0     3840x2160
 *     device 2: src-x 3840  3840x2160
 *
 * on a canvas that is 6144x1536 — overrunning it by 1536px across and 624px down. Caspar then
 * fetches an out-of-bounds region per card per frame, and because the DeckLink consumer is the one
 * that carries the channel's synchronization clock (decklink_consumer.cpp:1266 returns true; the
 * screen consumer's returns false) the whole channel slows to whatever the cards can manage.
 *
 * Measured on the box: ~80% of realtime, dropping to ~50% once two DeckLink INPUTS competed for the
 * same hardware, and realtime with the DeckLink consumer removed entirely. The owner's point stands
 * — a custom-raster channel CAN feed SDI at full speed; that is what subregions are for. They just
 * have to describe a region that exists. */

const test = require('node:test')
const assert = require('node:assert/strict')

const { applyPixelMappingProgramScreens } = require('../../src/config/pixel-mapping-config')

/** The box's rig: 6144x1536 program channel, mapping node, two 2160p50 SDI cards, no rects. */
function rigConfig({ outputs, mappings = [], rasterMode = 'custom', w = 6144, h = 1536 }) {
	const nodeId = 'map1'
	return {
		screen_1_mode: rasterMode,
		screen_1_custom_width: String(w),
		screen_1_custom_height: String(h),
		screen_1_custom_fps: '50',
		deviceGraph: {
			version: 1,
			devices: [
				{ id: 'caspar_host', role: 'caspar_host' },
				{ id: nodeId, role: 'pixel_mapping', settings: { outputs, mappings } },
			],
			connectors: [
				{ id: 'map1_in', deviceId: nodeId, kind: 'pixel_map_in' },
				...outputs.map((o, i) => ({ id: `${nodeId}_${o.id}`, deviceId: nodeId, kind: 'pixel_map_out', index: i })),
				{ id: 'sdi1', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '1' },
				{ id: 'sdi2', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '2' },
			],
			edges: [
				{ id: 'e0', sourceId: 'caspar_pgm_1', sinkId: 'map1_in' },
				...outputs.map((o, i) => ({ id: `e${i + 1}`, sourceId: `${nodeId}_${o.id}`, sinkId: `sdi${i + 1}` })),
			],
		},
	}
}

const TWO_UHD_OUTPUTS = [
	{ id: 'o1', mode: '2160p5000', fps: 50 },
	{ id: 'o2', mode: '2160p5000', fps: 50 },
]

test('WO-485: rect-less tiles split the CHANNEL raster, not the SDI mode size', () => {
	const app = rigConfig({ outputs: TWO_UHD_OUTPUTS })
	const merged = { ...app }
	applyPixelMappingProgramScreens(merged, app)
	const tiles = merged.screen_1_decklink_tiles
	assert.ok(Array.isArray(tiles) && tiles.length === 2, 'both cabled cards get a tile')
	assert.deepEqual(
		tiles.map((t) => [t.device, t.srcX, t.srcY, t.width, t.height]),
		[
			[1, 0, 0, 3072, 1536],
			[2, 3072, 0, 3072, 1536],
		],
		'6144x1536 split in two — not 3840x2160 packed from the output mode',
	)
})

test('WO-485: no tile may leave the raster', () => {
	const app = rigConfig({ outputs: TWO_UHD_OUTPUTS })
	const merged = { ...app }
	applyPixelMappingProgramScreens(merged, app)
	for (const t of merged.screen_1_decklink_tiles) {
		assert.ok(t.srcX + t.width <= 6144, `tile on device ${t.device} overruns the raster width`)
		assert.ok(t.srcY + t.height <= 1536, `tile on device ${t.device} overruns the raster height`)
	}
})

test('WO-485: an authored rect is honoured, but still clamped to the raster', () => {
	const app = rigConfig({
		outputs: TWO_UHD_OUTPUTS,
		/* A rect authored before the destination shrank: it now hangs off the right edge. */
		mappings: [
			{ outputId: 'o1', rect: { x: 0, y: 0, w: 2048, h: 1536 } },
			{ outputId: 'o2', rect: { x: 5000, y: 0, w: 2048, h: 1536 } },
		],
	})
	const merged = { ...app }
	applyPixelMappingProgramScreens(merged, app)
	const [a, b] = merged.screen_1_decklink_tiles
	assert.deepEqual([a.srcX, a.width], [0, 2048], 'an in-bounds authored rect is untouched')
	assert.deepEqual([b.srcX, b.width], [5000, 1144], 'a stale rect is clamped to the raster edge')
})

test('WO-485: a single card takes the whole raster', () => {
	const app = rigConfig({ outputs: [{ id: 'o1', mode: '2160p5000', fps: 50 }] })
	const merged = { ...app }
	applyPixelMappingProgramScreens(merged, app)
	assert.deepEqual(
		merged.screen_1_decklink_tiles.map((t) => [t.srcX, t.width, t.height]),
		[[0, 6144, 1536]],
	)
})

test('WO-485: a standard-raster channel is unaffected', () => {
	const app = rigConfig({ outputs: TWO_UHD_OUTPUTS, rasterMode: '1080p5000' })
	const merged = { ...app }
	applyPixelMappingProgramScreens(merged, app)
	assert.deepEqual(
		merged.screen_1_decklink_tiles.map((t) => [t.srcX, t.width, t.height]),
		[
			[0, 960, 1080],
			[960, 960, 1080],
		],
		'1920x1080 split in two',
	)
})
