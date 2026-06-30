'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const {
	listFocusableWebpageHosts,
	resolveCefCoordinates,
	buildFocusTargetFromSource,
	forwardToCefTarget,
	clearCefFocusOnly,
} = require('../../src/system/cef-interactive-forward')
const { getCefFocusTarget, clearCefFocusTarget } = require('../../src/system/cef-focus-registry')

const sampleConfig = {
	extraLiveSources: [
		{
			sourceId: 'webpage_test',
			type: 'browser',
			routeType: 'webpage_host',
			hostChannel: 20,
			hostLayer: 1,
			cefNeedle: 'interactive_click_test',
			value: 'route://20-1',
			label: 'Click test',
		},
		{
			sourceId: 'ndi_cam',
			type: 'ndi',
			routeType: 'ndi_host',
			hostChannel: 21,
			value: 'route://21-1',
		},
	],
}

describe('cef-interactive-forward', () => {
	afterEach(() => {
		clearCefFocusTarget()
	})

	it('listFocusableWebpageHosts filters interactive webpage hosts', () => {
		const list = listFocusableWebpageHosts(sampleConfig)
		assert.equal(list.length, 1)
		assert.equal(list[0].sourceId, 'webpage_test')
		assert.equal(list[0].needle, 'interactive_click_test')
	})

	it('resolveCefCoordinates maps normalized 0..1 to pixels', () => {
		const pt = resolveCefCoordinates(0.5, 0.5, 1920, 1080, true)
		assert.equal(pt.x, 960)
		assert.equal(pt.y, 540)
	})

	it('buildFocusTargetFromSource returns registry shape', () => {
		const t = buildFocusTargetFromSource(sampleConfig, 'webpage_test')
		assert.equal(t.hostChannel, 20)
		assert.equal(t.needle, 'interactive_click_test')
		assert.equal(t.zoneId, 'multiview')
	})

	it('forwardToCefTarget rejects unknown sourceId', async () => {
		const res = await forwardToCefTarget({
			config: sampleConfig,
			sourceId: 'missing',
			type: 'mousedown',
			x: 0.5,
			y: 0.5,
			coordsNormalized: true,
		})
		assert.equal(res.ok, false)
		assert.equal(res.status, 404)
	})

	it('forwardToCefTarget rejects sourceId mismatch with active focus', async () => {
		const { setCefFocusTarget } = require('../../src/system/cef-focus-registry')
		setCefFocusTarget(buildFocusTargetFromSource(sampleConfig, 'webpage_test'))
		const res = await forwardToCefTarget({
			config: sampleConfig,
			sourceId: 'other_source',
			type: 'keydown',
			keysym: 32,
		})
		assert.equal(res.ok, false)
		assert.equal(res.status, 409)
	})

	it('clearCefFocusOnly clears registry', () => {
		const { setCefFocusTarget } = require('../../src/system/cef-focus-registry')
		setCefFocusTarget(buildFocusTargetFromSource(sampleConfig, 'webpage_test'))
		assert.ok(getCefFocusTarget())
		clearCefFocusOnly()
		assert.equal(getCefFocusTarget(), null)
	})
})

describe('routes-cef-interactive handlers', () => {
	const routes = require('../../src/api/routes-cef-interactive')

	it('handleGet targets returns list or bridge-disabled', async () => {
		const res = await routes.handleGet('/api/cef-interactive/targets', {
			config: {
				operatorTools: { cefInteractiveBridge: true },
				extraLiveSources: sampleConfig.extraLiveSources,
				casparServer: { multiview_mode: '2160p5000' },
			},
		})
		assert.ok(res)
		assert.ok([200, 503].includes(res.status))
		const body = JSON.parse(res.body)
		if (res.status === 200) {
			assert.equal(body.ok, true)
			assert.ok(Array.isArray(body.targets))
			assert.equal(body.targets.length, 1)
		} else {
			assert.equal(body.ok, false)
		}
	})
})
