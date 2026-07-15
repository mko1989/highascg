'use strict'

/**
 * WO-232 T232.6 smoke — Operator-facing "Arm input" toggle for interactive templates.
 * Tests:
 *   1. /api/cef/arm-input and /api/cef/release-input routes are registered in router.js
 *   2. arm-input handler sets a CefFocusTarget with the correct shape
 *   3. release-input handler clears the focus target
 *   4. Inspector component correctly identifies interactive sources (mario/cef_input_test)
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { handlePost } = require('../../src/api/routes-cef-arm-input')
const { isInteractiveSource } = require('../../client/components/inspector-interactive-input.js')
const { REPO_ROOT } = require('../../src/repo-paths')

/**
 * Create a mock context for testing routes.
 * @returns {{ ctx: object, broadcasts: Array }}
 */
function makeMockCtx() {
	const broadcasts = []
	const ctx = {
		log: (level, msg) => console.log(`[${level}]`, msg),
		_wsBroadcast: (event, payload) => {
			broadcasts.push({ event, payload })
		},
	}
	return { ctx, broadcasts }
}

describe('WO-232 T232.6 routes (arm-input / release-input)', () => {
	it('POST /api/cef/arm-input accepts valid parameters and broadcasts', async () => {
		const { ctx, broadcasts } = makeMockCtx()

		const response = await handlePost('/api/cef/arm-input', {
			channel: 1,
			layer: 5,
			needle: 'template/mario',
		}, ctx)

		assert.equal(response.status, 200)
		assert.ok(response.body.includes('ok'), 'response should indicate success')
		assert.ok(response.body.includes('cefFocusTarget'), 'response should include cefFocusTarget')
		assert.ok(response.body.includes('template/mario'), 'response should include the needle')

		// Verify broadcast was sent
		assert.ok(broadcasts.length > 0, 'should broadcast focus target change')
		const focusBroadcast = broadcasts.find(b => b.payload?.path === 'cefFocusTarget')
		assert.ok(focusBroadcast, 'should broadcast cefFocusTarget change')
		const target = focusBroadcast.payload.value
		assert.equal(target.sourceId, 'layer:1-5', 'sourceId should be layer:channel-layer format')
		assert.equal(target.hostChannel, 1, 'hostChannel should match request channel')
		assert.equal(target.hostLayer, 5, 'hostLayer should match request layer')
		assert.equal(target.needle, 'template/mario', 'needle should match request')
		assert.equal(target.zoneId, 'layer', 'zoneId should be "layer"')
	})

	it('POST /api/cef/arm-input validates channel parameter', async () => {
		const { ctx } = makeMockCtx()

		// Missing channel
		const res1 = await handlePost('/api/cef/arm-input', {
			layer: 5,
			needle: 'template/mario',
		}, ctx)
		assert.equal(res1.status, 400)
		assert.ok(res1.body.includes('channel'))

		// Invalid channel (zero)
		const res2 = await handlePost('/api/cef/arm-input', {
			channel: 0,
			layer: 5,
			needle: 'template/mario',
		}, ctx)
		assert.equal(res2.status, 400)
	})

	it('POST /api/cef/arm-input validates layer parameter', async () => {
		const { ctx } = makeMockCtx()

		// Missing layer
		const res1 = await handlePost('/api/cef/arm-input', {
			channel: 1,
			needle: 'template/mario',
		}, ctx)
		assert.equal(res1.status, 400)
		assert.ok(res1.body.includes('layer'))

		// Invalid layer (negative)
		const res2 = await handlePost('/api/cef/arm-input', {
			channel: 1,
			layer: -1,
			needle: 'template/mario',
		}, ctx)
		assert.equal(res2.status, 400)
	})

	it('POST /api/cef/arm-input validates needle parameter', async () => {
		const { ctx } = makeMockCtx()

		// Missing needle
		const res = await handlePost('/api/cef/arm-input', {
			channel: 1,
			layer: 5,
		}, ctx)
		assert.equal(res.status, 400)
		assert.ok(res.body.includes('needle'))
	})

	it('POST /api/cef/release-input broadcasts null focus target', async () => {
		const { ctx, broadcasts } = makeMockCtx()

		const response = await handlePost('/api/cef/release-input', {}, ctx)

		assert.equal(response.status, 200)
		assert.ok(response.body.includes('ok'), 'response should indicate success')

		// Verify broadcast was sent
		assert.ok(broadcasts.length > 0, 'should broadcast focus target change')
		const focusBroadcast = broadcasts.find(b => b.payload?.path === 'cefFocusTarget')
		assert.ok(focusBroadcast, 'should broadcast cefFocusTarget change')
		assert.equal(focusBroadcast.payload.value, null, 'broadcast should set target to null')
	})
})

describe('WO-232 T232.6 router registration', () => {
	it('arm-input and release-input routes are registered in router.js', () => {
		const routerPath = path.join(REPO_ROOT, 'src/api/router.js')
		const routerContent = fs.readFileSync(routerPath, 'utf8')

		// Check that routes-cef-arm-input is imported
		assert.ok(
			routerContent.includes("require('./routes-cef-arm-input')"),
			'router should import routes-cef-arm-input',
		)

		// Check that arm-input route is registered
		assert.ok(
			routerContent.includes("'/api/cef/arm-input'"),
			'router should register /api/cef/arm-input route',
		)

		// Check that release-input route is registered
		assert.ok(
			routerContent.includes("'/api/cef/release-input'"),
			'router should register /api/cef/release-input route',
		)

		// Check that both routes use the handlePost function
		assert.ok(
			routerContent.includes('routesCefArmInput.handlePost'),
			'both routes should dispatch to handlePost',
		)
	})
})

describe('WO-232 T232.6 inspector component', () => {
	it('isInteractiveSource correctly identifies mario sources', () => {
		assert.ok(isInteractiveSource({ value: 'template/mario' }), 'mario should be interactive')
		assert.ok(isInteractiveSource({ value: 'template/mario/index.html' }), 'mario index should be interactive')
		assert.ok(isInteractiveSource({ value: '/mnt/template/mario' }), 'path to mario should be interactive')
		assert.ok(isInteractiveSource({ value: 'TEMPLATE\\MARIO' }), 'case-insensitive mario should be interactive')
	})

	it('isInteractiveSource correctly identifies cef_input_test sources', () => {
		assert.ok(isInteractiveSource({ value: 'cef_input_test' }), 'cef_input_test should be interactive')
		assert.ok(isInteractiveSource({ value: 'template/cef_input_test.html' }), 'cef_input_test.html should be interactive')
		assert.ok(isInteractiveSource({ value: 'CEF_INPUT_TEST' }), 'case-insensitive cef_input_test should be interactive')
	})

	it('isInteractiveSource rejects non-interactive sources', () => {
		assert.ok(!isInteractiveSource({ value: 'template/countdown' }), 'countdown should not be interactive')
		assert.ok(!isInteractiveSource({ value: 'template/lower_third' }), 'lower_third should not be interactive')
		assert.ok(!isInteractiveSource({ value: '' }), 'empty source should not be interactive')
		assert.ok(!isInteractiveSource(null), 'null source should not be interactive')
	})

	it('inspector component exists at expected path', () => {
		const componentPath = path.join(REPO_ROOT, 'client/components/inspector-interactive-input.js')
		assert.ok(fs.existsSync(componentPath), 'inspector-interactive-input.js should exist')

		const content = fs.readFileSync(componentPath, 'utf8')
		assert.ok(content.includes('appendInteractiveInputGroup'), 'should export appendInteractiveInputGroup')
		assert.ok(content.includes('isInteractiveSource'), 'should export isInteractiveSource')
		assert.ok(content.includes('/api/cef/arm-input'), 'should reference arm-input endpoint')
		assert.ok(content.includes('/api/cef/release-input'), 'should reference release-input endpoint')
	})

	it('inspector component is integrated into layer inspector', () => {
		const layerInspectorPath = path.join(REPO_ROOT, 'client/components/inspector-scene-layer.js')
		const content = fs.readFileSync(layerInspectorPath, 'utf8')

		assert.ok(
			content.includes("import { appendInteractiveInputGroup }"),
			'inspector-scene-layer should import appendInteractiveInputGroup',
		)
		assert.ok(
			content.includes('appendInteractiveInputGroup(root'),
			'inspector-scene-layer should call appendInteractiveInputGroup',
		)
	})
})
