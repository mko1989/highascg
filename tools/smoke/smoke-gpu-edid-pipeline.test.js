'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
	probeGpuEdidCatalog,
	edidForXrandrOutput,
	attachEdidToConnector,
	invalidateGpuEdidCache,
} = require('../../src/utils/gpu-edid-probe')
const { parseXrandrVerboseOutputs } = require('../../src/utils/gpu-modetest')

const EDID_HEX = fs.readFileSync(path.join(__dirname, 'fixtures/edid-acer-k222hql.hex'), 'utf8').trim()

describe('gpu edid pipeline', () => {
	it('enriches connectors from xrandr verbose EDID hex', () => {
		invalidateGpuEdidCache()
		const xrandrVerbose = [
			'DP-2 connected 1920x1080+0+0',
			'\tConnectorNumber: 2',
			'\tEDID:',
			...chunkEdidLines(EDID_HEX),
		].join('\n')
		const catalog = probeGpuEdidCatalog({ xrandrVerboseRaw: xrandrVerbose, budgetMs: 250 })
		const hit = edidForXrandrOutput('DP-2', { connected: true, catalog })
		assert.ok(hit.raw.length >= 256)
		assert.equal(hit.parsed?.monitorName, 'k222HQL')
		const conn = attachEdidToConnector(
			{ name: 'DP-2', shortName: 'DP-2', connected: true, xrandrName: 'DP-2' },
			catalog,
		)
		assert.equal(conn.edid.parsed.monitorName, 'k222HQL')
		assert.equal(conn.monitor.monitorName, 'k222HQL')
	})

	it('returns empty EDID for disconnected outputs without probing', () => {
		invalidateGpuEdidCache()
		const hit = edidForXrandrOutput('DP-9', { connected: false })
		assert.equal(hit.raw, '')
		assert.equal(hit.parsed, null)
	})

	it('parseXrandrVerboseOutputs extracts EDID hex lines', () => {
		const raw = ['HDMI-0 connected', '\tEDID:', '\t\t00ffffffffffff00'].join('\n')
		const outs = parseXrandrVerboseOutputs(raw)
		assert.equal(outs.length, 1)
		assert.ok(outs[0].edid.startsWith('00ffffffffffff00'))
	})
})

function chunkEdidLines(hex) {
	const clean = String(hex).replace(/[^0-9a-fA-F]/g, '')
	const lines = []
	for (let i = 0; i < clean.length; i += 32) {
		lines.push(`\t\t${clean.slice(i, i + 32)}`)
	}
	return lines
}
