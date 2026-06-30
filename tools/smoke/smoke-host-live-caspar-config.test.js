'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { ConfigManager } = require('../../src/config/config-manager')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const { maxCasparChannelInXml, requiredHostLiveMaxChannel } = require('../../src/config/host-live-sources-caspar')

describe('host-live caspar config generation', () => {
	it('buildCasparGeneratorFlatConfig includes extraLiveSources for host channels', () => {
		const cm = new ConfigManager(path.join(__dirname, '../../config'), {
			info() {},
			warn() {},
			error() {},
		})
		cm.load()
		const cfg = cm.get()
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
