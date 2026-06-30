'use strict'

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const {
	getCefFocusTarget,
	setCefFocusTarget,
	clearCefFocusTarget,
	cefFocusTargetForHostChannel,
} = require('../../src/system/cef-focus-registry')
const {
	hostFocusActive,
	notifyCefFocusChanged,
	notifyCefInteractiveAmcpLines,
} = require('../../src/system/cef-interactive-bridge')

describe('cef-focus-registry', () => {
	afterEach(() => {
		clearCefFocusTarget()
		delete process.env.HIGHASCG_CEF_FORCE_LEGACY_INFO
	})

	it('stores and clears focus target', () => {
		setCefFocusTarget({
			sourceId: 'webpage_test',
			hostChannel: 20,
			hostLayer: 1,
			needle: 'interactive_click_test',
			zoneId: 'multiview',
		})
		const t = getCefFocusTarget()
		assert.equal(t.sourceId, 'webpage_test')
		assert.equal(t.needle, 'interactive_click_test')
		clearCefFocusTarget()
		assert.equal(getCefFocusTarget(), null)
	})

	it('resolves host channel metadata from extraLiveSources', () => {
		const config = {
			extraLiveSources: [
				{
					sourceId: 'webpage_slido',
					hostChannel: 12,
					hostLayer: 1,
					cefNeedle: 'slido_join',
					routeType: 'webpage_host',
				},
			],
		}
		const meta = cefFocusTargetForHostChannel(config, 12, 1)
		assert.equal(meta.needle, 'slido_join')
		assert.equal(meta.sourceId, 'webpage_slido')
	})
})

describe('cef-interactive-bridge focus path', () => {
	beforeEach(() => {
		clearCefFocusTarget()
		delete process.env.HIGHASCG_CEF_FORCE_LEGACY_INFO
	})

	afterEach(() => {
		clearCefFocusTarget()
	})

	it('hostFocusActive when registry has needle', () => {
		assert.equal(hostFocusActive(), false)
		setCefFocusTarget({
			sourceId: 'x',
			hostChannel: 20,
			hostLayer: 1,
			needle: 'interactive_click_test',
			zoneId: 'multiview',
		})
		assert.equal(hostFocusActive(), true)
	})

	it('notifyCefFocusChanged does not throw', () => {
		setCefFocusTarget({
			sourceId: 'x',
			hostChannel: 20,
			hostLayer: 1,
			needle: 'interactive_click_test',
			zoneId: 'multiview',
		})
		assert.doesNotThrow(() => notifyCefFocusChanged())
	})

	it('notifyCefInteractiveAmcpLines warms on host channel PLAY', () => {
		const config = {
			operatorTools: { cefInteractiveBridge: true },
			extraLiveSources: [
				{
					sourceId: 'webpage_test',
					hostChannel: 20,
					hostLayer: 1,
					cefNeedle: 'interactive_click_test',
					routeType: 'webpage_host',
				},
			],
		}
		setCefFocusTarget({
			sourceId: 'webpage_test',
			hostChannel: 20,
			hostLayer: 1,
			needle: 'interactive_click_test',
			zoneId: 'multiview',
		})
		assert.doesNotThrow(() =>
			notifyCefInteractiveAmcpLines(['PLAY 20-1 [HTML] interactive_click_test LOOP'], config),
		)
	})
})
