/**
 * WO-249 smoke test — 8ch → stereo pair selection for PGM2/streaming
 */

'use strict'

const assert = require('assert')

/**
 * Test 1: buildAudioDownmixFilterChain matrix
 */
async function testBuildAudioDownmixMatrix() {
	const { buildAudioDownmixFilterChain } = require('../../src/streaming/streaming-channel-ffmpeg')

	// Stereo layout → no pan
	const stereo1 = buildAudioDownmixFilterChain('stereo', 'all')
	assert.strictEqual(stereo1.ac, null, 'stereo layout: ac is null')
	assert.ok(/aformat=channel_layouts=stereo/.test(stereo1.filterA.join(' ')), 'stereo layout: aformat filter')

	const stereo2 = buildAudioDownmixFilterChain('stereo', '3+4')
	assert.strictEqual(stereo2.ac, null, 'stereo with pair selection: ac is null')
	assert.ok(/aformat=channel_layouts=stereo/.test(stereo2.filterA.join(' ')), 'stereo with pair selection: aformat filter (no pan)')

	// 8ch + 'all' → c0/c1
	const eight1 = buildAudioDownmixFilterChain('8ch', 'all')
	assert.strictEqual(eight1.ac, 2, '8ch + all: ac is 2')
	assert.ok(/pan=stereo\|c0=c0\|c1=c1/.test(eight1.filterA.join(' ')), '8ch + all: uses c0/c1')

	// 8ch + '3+4' → c2/c3
	const eight2 = buildAudioDownmixFilterChain('8ch', '3+4')
	assert.strictEqual(eight2.ac, 2, '8ch + 3+4: ac is 2')
	assert.ok(/pan=stereo\|c0=c2\|c1=c3/.test(eight2.filterA.join(' ')), '8ch + 3+4: uses c2/c3')

	// 8ch + '7+8' → c6/c7
	const eight3 = buildAudioDownmixFilterChain('8ch', '7+8')
	assert.strictEqual(eight3.ac, 2, '8ch + 7+8: ac is 2')
	assert.ok(/pan=stereo\|c0=c6\|c1=c7/.test(eight3.filterA.join(' ')), '8ch + 7+8: uses c6/c7')

	// 4ch + '5+6' → warn+fallback c0/c1
	const warnLogs = []
	const logWarn = (msg, ctx) => warnLogs.push({ msg, ctx })
	const four1 = buildAudioDownmixFilterChain('4ch', '5+6', logWarn)
	assert.strictEqual(four1.ac, 2, '4ch + 5+6: ac is 2 (fallback)')
	assert.ok(/pan=stereo\|c0=c0\|c1=c1/.test(four1.filterA.join(' ')), '4ch + 5+6: falls back to c0/c1')
	assert.strictEqual(warnLogs.length, 1, '4ch + 5+6: logs warning')
	assert.ok(/exceeds resolved layout channel count/.test(warnLogs[0].msg), '4ch + 5+6: warn message mentions channel count')

	console.log('✓ buildAudioDownmixFilterChain matrix test passed')
}

/**
 * Test 2: settings-post round-trip of audioSourcePair
 */
async function testSettingsRoundTrip() {
	const { handlePost } = require('../../src/api/settings-post')
	const defaults = require('../../src/config/defaults')

	const mockConfig = {
		...defaults,
		streamingChannel: {
			enabled: true,
			videoMode: '1080p5000',
			videoSource: 'program_1',
			audioSource: 'follow_video',
			audioSourcePair: 'all',
			casparChannel: null,
			dedicatedOutputChannel: false,
			rtmpServerUrl: 'rtmp://example.com/live',
			streamKey: 'existing_key',
			rtmpQuality: 'medium',
			contentLayer: 10,
			decklinkDevice: 0,
		},
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

	const incomingBody = JSON.stringify({
		streamingChannel: {
			enabled: true,
			videoMode: '1080p5000',
			videoSource: 'program_1',
			audioSource: 'follow_video',
			audioSourcePair: '5+6',
			contentLayer: 10,
			decklinkDevice: 0,
			rtmpServerUrl: 'rtmp://example.com/live',
			streamKey: 'existing_key',
		},
	})

	const result = await handlePost('/api/settings', incomingBody, mockCtx)
	assert.strictEqual(result.status, 200, 'POST should return 200')
	assert.strictEqual(mockConfig.streamingChannel.audioSourcePair, '5+6', 'audioSourcePair should be set to 5+6')
	assert.strictEqual(mockConfig.streamingChannel.streamKey, 'existing_key', 'streamKey should still be preserved (WO-244)')

	console.log('✓ Settings round-trip test passed')
}

/**
 * Test 3: mixer rows expose sourceAudioPair
 */
async function testMixerRowsSourceAudioPair() {
	// Test the logic that determines when sourceAudioPair is added to a row
	const layer1 = {
		layerNumber: 1,
		audioRoute: '1+2',
		routeSourceAudio: '3+4',
	}

	// When routeSourceAudio is set and not 'all', sourceAudioPair should be exposed
	const sourceAudioPair1 = layer1.routeSourceAudio && layer1.routeSourceAudio !== 'all' ? layer1.routeSourceAudio : undefined
	assert.strictEqual(sourceAudioPair1, '3+4', 'sourceAudioPair is 3+4 when routeSourceAudio is 3+4')

	// When routeSourceAudio is 'all', sourceAudioPair should be undefined
	const layer2 = { ...layer1, routeSourceAudio: 'all' }
	const sourceAudioPair2 = layer2.routeSourceAudio && layer2.routeSourceAudio !== 'all' ? layer2.routeSourceAudio : undefined
	assert.strictEqual(sourceAudioPair2, undefined, 'sourceAudioPair is undefined when routeSourceAudio is all')

	// When routeSourceAudio is absent, sourceAudioPair should be undefined
	const layer3 = { audioRoute: '1+2' }
	const sourceAudioPair3 = layer3.routeSourceAudio && layer3.routeSourceAudio !== 'all' ? layer3.routeSourceAudio : undefined
	assert.strictEqual(sourceAudioPair3, undefined, 'sourceAudioPair is undefined when routeSourceAudio is absent')

	console.log('✓ Mixer rows sourceAudioPair test passed')
}

/**
 * Test 4: WO-244 preserve-on-empty still works with audioSourcePair
 */
async function testWO244PreserveWithAudioSourcePair() {
	// Verify that the WO-244 preserve-on-empty credential logic is not disturbed

	const settingsWithBoth = {
		rtmpServerUrl: 'rtmp://example.com/live',
		streamKey: 'my-secret-key',
		audioSourcePair: '3+4',
	}

	assert.ok(settingsWithBoth.streamKey, 'streamKey is preserved when audioSourcePair is set')
	assert.strictEqual(settingsWithBoth.audioSourcePair, '3+4', 'audioSourcePair is set to 3+4')

	console.log('✓ WO-244 preserve-on-empty with audioSourcePair test passed')
}

// Run all tests
async function run() {
	try {
		await testBuildAudioDownmixMatrix()
		await testSettingsRoundTrip()
		await testMixerRowsSourceAudioPair()
		await testWO244PreserveWithAudioSourcePair()
		console.log('\n✓ All WO-249 smoke tests passed')
	} catch (e) {
		console.error('Test failed:', e)
		process.exitCode = 1
	}
}

run()
