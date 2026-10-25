'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ConfigManager } = require('../../src/config/config-manager')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const { maxCasparChannelInXml, requiredHostLiveMaxChannel } = require('../../src/config/host-live-sources-caspar')

describe('host-live caspar config generation', () => {
	it('buildCasparGeneratorFlatConfig includes extraLiveSources for host channels', () => {
		// a fixture, not the box's own config/ (which this test used to read, and which carries whatever the box has)
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-live-config-'))
		const cm = new ConfigManager(dir, { info() {}, warn() {}, error() {} })
		cm.load()
		fs.rmSync(dir, { recursive: true, force: true })
		const cfg = {
			...cm.get(),
			extraLiveSources: [
				{ type: 'browser', routeType: 'webpage_host', sourceId: 'webpage_t', value: 'route://6-1', hostChannel: 6, hostLayer: 1,
					templateOrUrl: 'https://example.org/', cefNeedle: 'example_org', playArg: 'https://example.org/', label: 'Site', hostRole: 'webpage_host' },
			],
		}
		const flat = buildCasparGeneratorFlatConfig(cfg)
		assert.ok(Array.isArray(flat.extraLiveSources))
		assert.ok(flat.extraLiveSources.some((s) => s.routeType === 'webpage_host'))
		const xml = buildConfigXml(flat)
		const max = maxCasparChannelInXml(xml)
		const required = requiredHostLiveMaxChannel(cfg)
		assert.ok(required >= 6, `fixture should require host ch>=6, got ${required}`)
		assert.ok(max >= required, `generated max ch${max} must cover host ch${required}`)
		assert.match(xml, /Webpage host/)
	})
})
