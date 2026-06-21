'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const {
	parseModetestConnectors,
	parseXrandrVerboseOutputs,
	matchModetestToXrandr,
	edidMatchKey,
} = require('../../src/utils/gpu-modetest')

const FIXTURE = path.join(__dirname, 'fixtures/modetest-nvidia-sample.txt')

describe('gpu modetest parser', () => {
	it('parses connectors, modes, and EDID from modetest -c output', () => {
		const raw = fs.readFileSync(FIXTURE, 'utf8')
		const connectors = parseModetestConnectors(raw, { drmCard: 'card1' })
		assert.ok(connectors.length >= 3)
		const dp1 = connectors.find((c) => c.shortName === 'DP-1')
		assert.ok(dp1)
		assert.equal(dp1.connected, true)
		assert.equal(dp1.name, 'card1-DP-1')
		assert.ok(dp1.modes.length >= 10)
		assert.ok(dp1.modes.some((m) => m.preferred))
		assert.ok(dp1.edid.length >= 256)
	})

	it('matches modetest connectors to xrandr outputs by EDID', () => {
		const raw = fs.readFileSync(FIXTURE, 'utf8')
		const connectors = parseModetestConnectors(raw, { drmCard: 'card1' })
		const xrandrVerbose = [
			'DP-0 connected primary 1920x1080+2560+0',
			'\tConnectorNumber: 3',
			'\tEDID:',
			'\t\t00ffffffffffff0039f65ee401010101',
			'\t\t021f0104c50000781a3131a5554ea126',
			'DP-1 disconnected',
			'\tEDID:',
			'\t\t00ffffffffffff00deadbeefdeadbeef',
			'HDMI-0 connected 1920x1080+0+0',
			'\tConnectorNumber: 1',
			'\tEDID:',
			'\t\t00ffffffffffff004c2d0a0b0a0b0a0b',
		].join('\n')
		const xrandrOutputs = parseXrandrVerboseOutputs(xrandrVerbose)
		const dp1 = connectors.find((c) => c.shortName === 'DP-1')
		const dp0 = xrandrOutputs.find((x) => x.name === 'DP-0')
		dp0.edid = dp1.edid
		const matches = matchModetestToXrandr(connectors, xrandrOutputs)
		assert.equal(matches.get('DP-1'), 'DP-0')
		assert.equal(dp1.matchMethod, 'edid')
	})

	it('edidMatchKey uses stable 128-byte prefix', () => {
		const prefix = 'aa'.repeat(128)
		const a = edidMatchKey(prefix + 'bb'.repeat(50))
		const b = edidMatchKey(prefix + 'cc'.repeat(50))
		assert.equal(a.length, 256)
		assert.equal(a, b)
	})

	it('prefers live xrandr name match before heuristic reassignment', () => {
		const connectors = [
			{ shortName: 'DP-1', name: 'card0-DP-1', connected: false, edid: '' },
			{ shortName: 'DP-2', name: 'card0-DP-2', connected: false, edid: '' },
			{ shortName: 'DP-3', name: 'card0-DP-3', connected: false, edid: '' },
		]
		const xrandrOutputs = [
			{ name: 'HDMI-0', connected: true, edid: '' },
			{ name: 'DP-2', connected: true, edid: '' },
			{ name: 'DP-4', connected: true, edid: '' },
		]
		matchModetestToXrandr(connectors, xrandrOutputs)
		const dp2 = connectors.find((c) => c.shortName === 'DP-2')
		const dp1 = connectors.find((c) => c.shortName === 'DP-1')
		assert.equal(dp2.xrandrName, 'DP-2')
		assert.equal(dp2.matchMethod, 'name')
		assert.notEqual(dp1.xrandrName, 'DP-2')
	})
})
