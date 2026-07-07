'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	normalizeNdiSourceName,
	ndiDisplayLabel,
	buildNdiHostPlayCommands,
} = require('../../src/config/ndi-playback')
const { patchNdiHostSource } = require('../../src/api/host-live-ndi')

describe('ndi-playback', () => {
	it('normalizes NDI LIST display name to ndi:// URL', () => {
		const url = normalizeNdiSourceName('MARCINS-MACBOOK-PRO-3.LOCAL (Scan Converter)')
		assert.equal(url, 'ndi://marcins-macbook-pro-3.local/"Scan Converter"')
	})

	it('builds raw ndi:// PLAY command (not PLAY NDI "ndi://…")', () => {
		const cmds = buildNdiHostPlayCommands(
			6,
			1,
			'ndi://marcins-macbook-pro-3.local/"Scan Converter"',
		)
		assert.deepEqual(cmds, [
			'PLAY 6-1 ndi://marcins-macbook-pro-3.local/"Scan Converter"',
			'MIXER 6 COMMIT',
		])
	})

	it('uses NDI keyword for plain source names', () => {
		const cmds = buildNdiHostPlayCommands(6, 1, 'Studio PC (Output)')
		assert.deepEqual(cmds, ['PLAY 6-1 NDI "Studio PC (Output)"', 'MIXER 6 COMMIT'])
	})

	it('ndiDisplayLabel reverses ndi:// URL for UI', () => {
		assert.equal(
			ndiDisplayLabel('ndi://marcins-macbook-pro-3.local/"Scan Converter"'),
			'MARCINS-MACBOOK-PRO-3.LOCAL (Scan Converter)',
		)
	})
})

describe('host-live-ndi', () => {
	it('patchNdiHostSource keeps host channel and route when NDI name changes', () => {
		const existing = {
			type: 'ndi',
			routeType: 'ndi_host',
			value: 'route://12-1',
			hostChannel: 12,
			hostLayer: 1,
			sourceId: 'ndi_studio',
			label: 'Studio PC',
			ndiName: 'ndi://box/"Old Source"',
		}
		const next = patchNdiHostSource(existing, 'MARCINS-MACBOOK-PRO-3.LOCAL (Scan Converter)', 'Renamed')
		assert.equal(next.hostChannel, 12)
		assert.equal(next.value, 'route://12-1')
		assert.equal(next.sourceId, 'ndi_studio')
		assert.equal(next.label, 'Renamed')
		assert.equal(next.ndiName, 'ndi://marcins-macbook-pro-3.local/"Scan Converter"')
	})
})
