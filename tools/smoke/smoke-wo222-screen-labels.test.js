/**
 * WO-222 smoke test — screen label helper, router registration, server roundtrip
 */

'use strict'

const assert = require('assert')
const path = require('path')

/**
 * Test 1: screenLabel helper with fallback logic
 */
async function testScreenLabelHelper() {
	const { screenLabel } = await import('../../client/lib/screen-label.js')

	// Test with screenLabels provided
	const cmWithLabels = {
		screenLabels: ['Main', 'Side', 'Aux'],
	}
	assert.strictEqual(screenLabel(cmWithLabels, 0), 'Main', 'screenLabel(cm, 0) should return custom label')
	assert.strictEqual(screenLabel(cmWithLabels, 1), 'Side', 'screenLabel(cm, 1) should return custom label')
	assert.strictEqual(screenLabel(cmWithLabels, 2), 'Aux', 'screenLabel(cm, 2) should return custom label')

	// Test fallback when label is empty string
	const cmWithMissing = {
		screenLabels: ['Main', '', 'Aux'],
	}
	assert.strictEqual(screenLabel(cmWithMissing, 1), 'S2', 'screenLabel should fallback to S2 for empty label')

	// Test fallback when out of bounds
	assert.strictEqual(screenLabel(cmWithLabels, 5), 'S6', 'screenLabel should fallback to S6 when out of bounds')

	// Test fallback when no screenLabels
	assert.strictEqual(screenLabel({}, 0), 'S1', 'screenLabel should fallback to S1 when no screenLabels')

	console.log('✓ screenLabel helper test passed')
}

/**
 * Test 2: Router registration verification
 */
async function testRouterRegistration() {
	const routerContent = require('fs').readFileSync(
		path.join(__dirname, '../../src/api/router.js'),
		'utf8'
	)

	assert(
		routerContent.includes("const routesScreens = require('./routes-screens')"),
		'router.js should import routesScreens'
	)
	assert(
		routerContent.includes("routes.post('/api/screens/label'"),
		'router.js should register POST /api/screens/label'
	)
	assert(
		routerContent.includes('routesScreens.handlePost'),
		'router.js should dispatch to routesScreens.handlePost'
	)

	console.log('✓ Router registration test passed')
}

/**
 * Test 3: Server store roundtrip with stubbed persistence
 */
async function testServerStoreRoundtrip() {
	// Simulate the routes-screens handler logic
	const mockConfig = {
		screenLabels: [],
	}

	const mockConfigManager = {
		get: () => mockConfig,
		save: (newCfg) => {
			Object.assign(mockConfig, newCfg)
		},
	}

	const mockCtx = {
		config: mockConfig,
		configManager: mockConfigManager,
	}

	// Test setting a label
	const routesScreens = require('../../src/api/routes-screens')
	const result1 = routesScreens.handlePost('/api/screens/label', { screenIdx: 0, label: 'Main' }, mockCtx)
	assert(result1.ok === true, 'POST should return ok: true')
	assert.deepStrictEqual(result1.screenLabels, ['Main'], 'screenLabels should be updated')
	assert.strictEqual(mockConfig.screenLabels[0], 'Main', 'config should persist label')

	// Test setting another label
	const result2 = routesScreens.handlePost('/api/screens/label', { screenIdx: 2, label: 'Aux' }, mockCtx)
	assert(result2.ok === true, 'Second POST should return ok: true')
	assert.strictEqual(mockConfig.screenLabels[2], 'Aux', 'config should persist second label')

	// Verify array has correct length (sparse array filled with empty strings)
	assert.strictEqual(mockConfig.screenLabels.length, 3, 'screenLabels array should expand to fit index 2')
	assert.strictEqual(mockConfig.screenLabels[1], '', 'missing indices should be empty strings')

	console.log('✓ Server store roundtrip test passed')
}

/**
 * Test 4: Defaults include screenLabels
 */
async function testDefaultsIncludeScreenLabels() {
	const defaults = require('../../src/config/defaults')
	assert(
		Array.isArray(defaults.screenLabels),
		'defaults should include screenLabels as an array'
	)
	assert.strictEqual(defaults.screenLabels.length, 0, 'default screenLabels should be empty array')
	console.log('✓ Defaults test passed')
}

/**
 * Test 5: Channel map exposes screenLabels
 */
async function testChannelMapExposesLabels() {
	const { getChannelMap } = require('../../src/config/routing-map')
	const cfg = {
		caspar: { host: '127.0.0.1', port: 5250 },
		screenLabels: ['Main', 'Side'],
		casparServer: { screen_count: 2 },
	}
	const map = getChannelMap(cfg)
	assert.deepStrictEqual(
		map.screenLabels,
		['Main', 'Side'],
		'getChannelMap should expose screenLabels from config'
	)
	console.log('✓ Channel map exposure test passed')
}

/**
 * Run all tests
 */
async function runTests() {
	try {
		await testScreenLabelHelper()
		await testRouterRegistration()
		await testServerStoreRoundtrip()
		await testDefaultsIncludeScreenLabels()
		await testChannelMapExposesLabels()
		console.log('\n✓ All WO-222 smoke tests passed')
		process.exit(0)
	} catch (e) {
		console.error('\n✗ Smoke test failed:', e.message)
		console.error(e.stack)
		process.exit(1)
	}
}

runTests()
