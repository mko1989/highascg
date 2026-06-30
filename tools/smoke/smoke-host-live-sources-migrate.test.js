'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	isLegacyNdiLiveSource,
	migrateExtraLiveSourcesList,
	migrateHostLiveSourcesConfig,
	collectHostLiveConfigWarnings,
} = require('../../src/config/host-live-sources-migrate')

describe('host-live-sources-migrate', () => {
	it('detects legacy direct NDI', () => {
		assert.equal(isLegacyNdiLiveSource({ type: 'ndi', value: 'ndi://Studio', useDirect: true }), true)
		assert.equal(isLegacyNdiLiveSource({ type: 'ndi', routeType: 'ndi_host', value: 'route://12-1' }), false)
	})

	it('migrates legacy NDI to ndi_host', () => {
		const list = [{ type: 'ndi', value: 'ndi://Remote PC', label: 'Remote', useDirect: true }]
		const mig = migrateExtraLiveSourcesList(list, { config: { extraLiveSources: [] } })
		assert.equal(mig.changed, true)
		assert.equal(mig.list[0].routeType, 'ndi_host')
		assert.equal(mig.list[0].useDirect, false)
		assert.ok(mig.list[0].hostChannel >= 1)
		assert.match(mig.list[0].value, /^route:\/\//)
	})

	it('warns on multiview_if_match decklink host setting', () => {
		const warnings = collectHostLiveConfigWarnings({
			decklink_input_count: 2,
			casparServer: { decklink_inputs_host: 'multiview_if_match' },
		})
		assert.ok(warnings.some((w) => /multiview_if_match/.test(w)))
	})

	it('migrateHostLiveSourcesConfig patches decklink_inputs_host to dedicated', () => {
		const config = {
			decklink_input_count: 1,
			casparServer: { decklink_input_count: 1, decklink_inputs_host: 'multiview_if_match' },
			extraLiveSources: [],
		}
		const mig = migrateHostLiveSourcesConfig(config, { config })
		assert.equal(mig.casparServerPatch.decklink_inputs_host, 'dedicated')
		assert.equal(mig.changed, true)
	})
})
