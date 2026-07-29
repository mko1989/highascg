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
		routerContent.includes("const routesScreens = require(" + "'./routes-screens')"),
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
	// WO-385: the handler takes the RAW request body (a string) exactly as router-dispatch.js
	// hands it over, and answers with the { status, headers, body } shape the route registry
	// sends. This test used to pass a parsed object and read a bare `.ok`, which is why it stayed
	// green while every real HTTP save silently did nothing.
	const routesScreens = require('../../src/api/routes-screens')
	const post = (payload, ctx) => {
		const res = routesScreens.handlePost('/api/screens/label', JSON.stringify(payload), ctx)
		assert(res && typeof res.status === 'number', 'handler must return a { status, headers, body } response')
		return { status: res.status, json: JSON.parse(res.body) }
	}

	// 1. No destination owns the index → the legacy screenLabels array is the fallback store.
	const bareConfig = { screenLabels: [] }
	const bareCtx = {
		config: bareConfig,
		configManager: { get: () => bareConfig, save: (n) => Object.assign(bareConfig, n) },
	}
	const r1 = post({ screenIdx: 0, label: 'Main' }, bareCtx)
	assert.strictEqual(r1.status, 200, 'POST should succeed')
	assert.strictEqual(r1.json.ok, true)
	assert.strictEqual(bareConfig.screenLabels[0], 'Main', 'config should persist label')

	const r2 = post({ screenIdx: 2, label: 'Aux' }, bareCtx)
	assert.strictEqual(r2.status, 200)
	assert.strictEqual(bareConfig.screenLabels[2], 'Aux', 'config should persist second label')
	assert.strictEqual(bareConfig.screenLabels.length, 3, 'screenLabels array should expand to fit index 2')
	assert.strictEqual(bareConfig.screenLabels[1], '', 'missing indices should be empty strings')

	// 2. A destination owns the index → THAT is renamed, because the screen and its destination
	//    are one thing now (owner: "name and label should be one thing").
	const destConfig = {
		screenLabels: [],
		screenDestinations: {
			version: 1,
			destinations: [{ id: 'dst_a', label: 'PGM/PRV 1', mode: 'pgm_prv', mainScreenIndex: 0 }],
		},
	}
	const destCtx = {
		config: destConfig,
		configManager: { get: () => destConfig, save: (n) => Object.assign(destConfig, n) },
	}
	const r3 = post({ screenIdx: 0, label: 'ekran' }, destCtx)
	assert.strictEqual(r3.status, 200)
	assert.strictEqual(r3.json.renamedDestination, 'dst_a', 'the owning destination is what gets named')
	assert.strictEqual(destConfig.screenDestinations.destinations[0].label, 'ekran')
	assert.deepStrictEqual(r3.json.screenLabels, ['ekran'], 'the channel map reports the new name')
	assert.deepStrictEqual(destConfig.screenLabels, [], 'the legacy array is left alone when a destination owns it')

	// 3. Malformed input is refused, not silently dropped.
	assert.strictEqual(post({ label: 'no index' }, bareCtx).status, 400)
	const badJson = routesScreens.handlePost('/api/screens/label', '{not json', bareCtx)
	assert.strictEqual(badJson.status, 400, 'a broken body must be a 400, not a success-looking empty 200')
	assert.strictEqual(routesScreens.handlePost('/api/other', '{}', bareCtx), null, 'other paths are not ours')

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
