'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	normalizeDecklinkPlayAmcpLine,
	resolveDecklinkInputFromChannelLayer,
} = require('../../src/config/decklink-amcp')
const {
	enrichExtraLiveSource,
	parseRouteChannelLayer,
	resolutionPixelsFromNormalizedFill,
	resolveLiveSourcePrintTarget,
} = require('../../src/config/extra-live-source-enrich')

describe('decklink-amcp', () => {
	it('maps PLAY … DECKLINK 0 to resolved 1-based device index', () => {
		const config = {
			decklink_input_count: 1,
			casparServer: { decklink_input_count: 1, decklink_input_1_device: 0 },
		}
		const map = require('../../src/config/routing-map').getChannelMap(config)
		const entry = map.inputChannels.find((e) => e.kind === 'decklink')
		assert.ok(entry)
		const line = `PLAY ${entry.channel}-${entry.layer} DECKLINK 0`
		const out = normalizeDecklinkPlayAmcpLine(line, config)
		assert.match(out, /DECKLINK 1$/)
	})

	it('resolveDecklinkInputFromChannelLayer returns slot device', () => {
		const config = { decklink_input_count: 2, casparServer: { decklink_input_count: 2 } }
		const map = require('../../src/config/routing-map').getChannelMap(config)
		const entry = map.inputChannels[0]
		const resolved = resolveDecklinkInputFromChannelLayer(config, entry.channel, entry.layer)
		assert.equal(resolved?.slot, 1)
		assert.equal(resolved?.device, 1)
	})
})

describe('extra-live-source-enrich', () => {
	it('parseRouteChannelLayer splits channel and layer', () => {
		assert.deepEqual(parseRouteChannelLayer('route://1-10'), { channel: 1, layer: 10 })
		assert.deepEqual(parseRouteChannelLayer('route://5'), { channel: 5, layer: null })
	})

	it('resolutionPixelsFromNormalizedFill uses layer fill not full channel', () => {
		const dims = resolutionPixelsFromNormalizedFill(5120, 1024, { scaleX: 0.375, scaleY: 1 })
		assert.equal(dims.w, 1920)
		assert.equal(dims.h, 1024)
	})

	it('enrichExtraLiveSource sets layer resolution and thumbnail layer', () => {
		const ctx = {
			config: {
				screen_count: 1,
				casparServer: { screen_count: 1 },
			},
			gatheredInfo: {
				infoConfig:
					'<configuration><channels><channel><video-mode>5120x1024</video-mode></channel></channels></configuration>',
			},
		}
		const out = enrichExtraLiveSource(
			{
				type: 'route',
				routeType: 'layer',
				value: 'route://1-10',
				fill: { x: 0, y: 0, scaleX: 0.375, scaleY: 1 },
			},
			ctx,
		)
		assert.equal(out.resolution, '1920×1024')
		assert.equal(out.thumbnailChannel, 1)
		assert.equal(out.thumbnailLayer, 10)
	})

	it('resolveLiveSourcePrintTarget prefers thumbnailChannel/Layer', () => {
		const target = resolveLiveSourcePrintTarget({
			value: 'route://1-10',
			routeType: 'layer',
			thumbnailChannel: 1,
			thumbnailLayer: 10,
		})
		assert.deepEqual(target, { channel: 1, layer: 10 })
	})
})
