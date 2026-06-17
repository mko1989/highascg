'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveSysIdToXrandrOutput, looksLikeDrmConnectorName, looksLikeXrandrOutputName } = require('../../src/utils/xrandr-output-resolve')
const { compareXrandrLayout, plannedHeadsFromLayout } = require('../../src/utils/xrandr-layout-verify')

test('resolveSysIdToXrandrOutput maps DRM inventory to xrandr names', () => {
	const inventory = [
		{ name: 'card1-DP-3', shortName: 'DP-3', drmCard: 'card1', xrandrName: 'DP-4', connected: true },
		{ name: 'card1-DP-1', shortName: 'DP-1', drmCard: 'card1', xrandrName: 'DP-0', connected: true },
		{ name: 'card1-HDMI-A-1', shortName: 'HDMI-A-1', drmCard: 'card1', xrandrName: 'HDMI-0', connected: true },
	]
	assert.equal(resolveSysIdToXrandrOutput('card1-DP-3', { inventory }), 'DP-4')
	assert.equal(resolveSysIdToXrandrOutput('DP-0', { inventory }), 'DP-0')
	assert.equal(resolveSysIdToXrandrOutput('HDMI-A-1', { inventory }), 'HDMI-0')
	assert.equal(resolveSysIdToXrandrOutput('card1-HDMI-A-1', { inventory }), 'HDMI-0')
	assert.equal(looksLikeDrmConnectorName('card1-DP-3'), true)
	assert.equal(looksLikeXrandrOutputName('HDMI-A-1'), false)
	assert.equal(looksLikeXrandrOutputName('HDMI-0'), true)
})

test('resolveSysIdToXrandrOutput uses device graph alias', () => {
	const config = {
		deviceGraph: {
			connectors: [{ kind: 'gpu_out', externalRef: 'card1-HDMI-A-1', alias: 'HDMI-0' }],
		},
	}
	assert.equal(resolveSysIdToXrandrOutput('card1-HDMI-A-1', { config, inventory: [] }), 'HDMI-0')
	assert.equal(resolveSysIdToXrandrOutput('HDMI-A-1', { config, inventory: [] }), 'HDMI-0')
})

test('resolveSysIdToXrandrOutput heuristic when inventory lacks xrandrName', () => {
	const inventory = [{ name: 'card1-HDMI-A-1', shortName: 'HDMI-A-1', connected: true, xrandrName: null }]
	const displays = [{ name: 'HDMI-0', connected: true, x: 0, y: 0, resolution: '1920x1080', refreshHz: 50 }]
	assert.equal(resolveSysIdToXrandrOutput('card1-HDMI-A-1', { inventory, displays }), 'HDMI-0')
})

test('compareXrandrLayout detects overlap at same origin', () => {
	const planned = [
		{ sysId: 'DP-4', x: 0, y: 0, width: 2560, height: 1280, mode: '2560x1280' },
		{ sysId: 'DP-0', x: 2560, y: 0, width: 1920, height: 1080, mode: '1920x1080' },
		{ sysId: 'HDMI-0', x: 4480, y: 0, width: 1920, height: 1080, mode: '1920x1080' },
	]
	const badActual = [
		{ name: 'HDMI-0', x: 0, y: 0, resolution: '1920x1080', refreshHz: 50 },
		{ name: 'DP-4', x: 0, y: 0, resolution: '2560x1280', refreshHz: 50 },
		{ name: 'DP-0', x: 2560, y: 0, resolution: '1920x1080', refreshHz: 50 },
	]
	const check = compareXrandrLayout(planned, badActual)
	assert.equal(check.ok, false)
	assert.ok(check.mismatches.some((m) => m.field === 'overlap'))
	assert.ok(check.mismatches.some((m) => m.sysId === 'HDMI-0' && m.field === 'x'))
})

test('plannedHeadsFromLayout resolves DRM sysIds', () => {
	const inventory = [{ name: 'card1-DP-3', xrandrName: 'DP-4', connected: true }]
	const heads = plannedHeadsFromLayout(
		{
			screens: {
				1: { sysId: 'card1-DP-3', x: 0, y: 0, width: 2560, height: 1280, mode: '2560x1280' },
			},
			multiview: {},
			mappingGpuOutputs: [],
		},
		{ inventory }
	)
	assert.equal(heads.length, 1)
	assert.equal(heads[0].sysId, 'DP-4')
})
