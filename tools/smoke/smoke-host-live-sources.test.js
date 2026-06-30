'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { getChannelMap } = require('../../src/config/routing-map')
const {
	normalizeWebpageHostSource,
	normalizeNdiHostSource,
	amcpCommandsForHostLiveSource,
	listHostLiveChannelEntries,
	isHostLiveSource,
} = require('../../src/config/host-live-sources')

describe('host-live-sources', () => {
	it('allocates webpage host channel and route value', () => {
		const ctx = { config: { extraLiveSources: [] } }
		const out = normalizeWebpageHostSource({ type: 'browser', value: 'interactive_click_test', label: 'Click test' }, ctx)
		assert.equal(out.routeType, 'webpage_host')
		assert.ok(out.hostChannel >= 1)
		assert.match(out.value, /^route:\/\//)
		assert.equal(out.cefNeedle, 'interactive_click_test')
		assert.ok(isHostLiveSource(out))
	})

	it('allocates NDI host channel from ndiName', () => {
		const ctx = { config: { extraLiveSources: [] } }
		const out = normalizeNdiHostSource({ type: 'ndi', ndiName: 'Studio PC (Output)', label: 'Studio PC' }, ctx)
		assert.equal(out.routeType, 'ndi_host')
		assert.ok(out.hostChannel >= 1)
		assert.match(out.ndiName, /ndi:\/\//)
		assert.equal(out.useDirect, false)
	})

	it('emits host channels in routing map inputChannels', () => {
		const config = {
			extraLiveSources: [
				{
					type: 'browser',
					routeType: 'webpage_host',
					value: 'route://20-1',
					hostChannel: 20,
					hostLayer: 1,
					sourceId: 'webpage_test',
					playArg: 'interactive_click_test',
					cefNeedle: 'interactive_click_test',
				},
			],
		}
		const map = getChannelMap(config)
		const host = map.inputChannels.find((e) => e.kind === 'webpage_host')
		assert.ok(host)
		assert.equal(host.channel, 20)
		assert.deepEqual(map.webpageHostChannels, [20])
	})

	it('builds LOOP PLAY commands for webpage host', () => {
		const item = {
			routeType: 'webpage_host',
			hostChannel: 12,
			hostLayer: 1,
			playArg: 'slido_join',
		}
		const cmds = amcpCommandsForHostLiveSource(item)
		assert.deepEqual(cmds, [
			'PLAY 12-1 [HTML] slido_join LOOP',
			'MIXER 12-1 FILL 0 0 1 1',
			'MIXER 12 COMMIT',
		])
	})

	it('listHostLiveChannelEntries skips non-host extras', () => {
		const config = {
			extraLiveSources: [
				{ type: 'browser', routeType: 'layer', value: 'route://1-5' },
				{
					type: 'ndi',
					routeType: 'ndi_host',
					value: 'route://21-1',
					hostChannel: 21,
					hostLayer: 1,
					sourceId: 'ndi_test',
					ndiName: 'ndi://Test',
				},
			],
		}
		const entries = listHostLiveChannelEntries(config)
		assert.equal(entries.length, 1)
		assert.equal(entries[0].kind, 'ndi_host')
	})

	it('hostChannelDestinationId matches WO-88 matrix ids', () => {
		const { hostChannelDestinationId } = require('../../src/config/host-live-sources')
		assert.equal(hostChannelDestinationId('webpage_host', 12, 'webpage_slido'), 'host_webpage_webpage_slido')
		assert.equal(hostChannelDestinationId('ndi_host', 13, 'ndi_studio'), 'host_ndi_ndi_studio')
	})
})
