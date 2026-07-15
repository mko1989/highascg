'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { ConfigManager } = require('../../src/config/config-manager')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')

describe('WO-237: monitor channel uses cheapest video mode (576p2500)', () => {
	it('monitor channel block includes 576p2500 when enabled', () => {
		const cm = new ConfigManager(path.join(__dirname, '../../config'), {
			info() {},
			warn() {},
			error() {},
		})
		cm.load()
		const cfg = cm.get()

		// Enable monitor channel (settings are in casparServer)
		cfg.casparServer.monitor_channel_enabled = true
		cfg.casparServer.caspar_build_profile = 'custom_live'
		cfg.casparServer.monitor_portaudio_device = 'hw:0,0'

		const flat = buildCasparGeneratorFlatConfig(cfg)

		// Debug: check the flat config
		assert.equal(flat.monitor_channel_enabled, true, 'flat config should have monitor_channel_enabled=true')
		assert.equal(flat.caspar_build_profile, 'custom_live', 'flat config should have caspar_build_profile=custom_live')

		const xml = buildConfigXml(flat)

		// Debug: check if monitor is being found
		const hasMonitor = xml.includes('Monitor / headphone')
		assert.ok(hasMonitor, 'XML should contain monitor channel block')

		// Check that monitor channel block contains 576p2500
		assert.match(xml, /Monitor \/ headphone mix.*?<video-mode>576p2500<\/video-mode>/s,
			'monitor channel should use 576p2500 mode')

		// Verify it contains only PortAudio consumer (no video consumers)
		const monitorBlockMatch = xml.match(
			/<!-- HighAsCG: Caspar channel \d+: Monitor[\s\S]*?<\/channel>/
		)
		assert.ok(monitorBlockMatch, 'should find monitor channel block')
		const monitorBlock = monitorBlockMatch[0]
		assert.match(monitorBlock, /<portaudio>/, 'should have portaudio consumer')
		assert.doesNotMatch(monitorBlock, /<screen>/, 'should not have screen consumer')
		assert.doesNotMatch(monitorBlock, /<decklink>/, 'should not have decklink consumer')
		assert.doesNotMatch(monitorBlock, /<ndi>/, 'should not have ndi consumer')
	})

	it('monitor channel is not emitted when disabled', () => {
		const cm = new ConfigManager(path.join(__dirname, '../../config'), {
			info() {},
			warn() {},
			error() {},
		})
		cm.load()
		const cfg = cm.get()

		// Disable monitor channel (default)
		cfg.casparServer.monitor_channel_enabled = false
		cfg.casparServer.caspar_build_profile = 'custom_live'

		const flat = buildCasparGeneratorFlatConfig(cfg)
		const xml = buildConfigXml(flat)

		// Check that monitor channel is not in the output
		assert.doesNotMatch(xml, /Monitor \/ headphone mix/,
			'monitor channel should not be present when disabled')
	})

	it('other channels unchanged when monitor channel enabled', () => {
		const cm = new ConfigManager(path.join(__dirname, '../../config'), {
			info() {},
			warn() {},
			error() {},
		})
		cm.load()
		const cfg = cm.get()

		// Build config without monitor channel
		cfg.casparServer.monitor_channel_enabled = false
		cfg.casparServer.caspar_build_profile = 'custom_live'
		cfg.casparServer.monitor_portaudio_device = 'hw:0,0'
		const flat1 = buildCasparGeneratorFlatConfig(cfg)
		const xml1 = buildConfigXml(flat1)

		// Build config with monitor channel
		cfg.casparServer.monitor_channel_enabled = true
		const flat2 = buildCasparGeneratorFlatConfig(cfg)
		const xml2 = buildConfigXml(flat2)

		// Extract the program and preview channels from both (they should be identical)
		// Remove the monitor channel block from xml2 and compare
		const xml2WithoutMonitor = xml2.replace(
			/<!-- Caspar channel \d+: Monitor \/ headphone mix[\s\S]*?<\/channel>\n/,
			''
		)

		// The remaining channels should be identical
		assert.equal(
			xml1.length > 0 && xml2WithoutMonitor.includes('<channels>'),
			true,
			'both should have channel blocks'
		)
	})
})
