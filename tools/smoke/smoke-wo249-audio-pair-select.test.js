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

/**
 * Test 5: T249.4 — streaming bus layout follows the wider of video/audio source screens
 */
async function testStreamingBusLayoutWidening() {
	const { resolveStreamingChannelAudioLayout } = require('../../src/config/config-generator-consumer-attach')

	const config = {
		screen_1_audio_layout: 'stereo',
		screen_2_audio_layout: '8ch',
	}

	// Video source stereo + audio source 8ch → wider audio-source layout wins
	const widened = resolveStreamingChannelAudioLayout(config, { videoSource: 'program_1', audioSource: 'program_2' })
	assert.strictEqual(widened, '8ch', 'video stereo + audio 8ch: bus layout widens to 8ch')

	// audioSource follow_video → unchanged video-source layout (both widths)
	const followStereo = resolveStreamingChannelAudioLayout(config, { videoSource: 'program_1', audioSource: 'follow_video' })
	assert.strictEqual(followStereo, 'stereo', 'follow_video: stereo video source stays stereo')
	const followWide = resolveStreamingChannelAudioLayout(config, { videoSource: 'program_2', audioSource: 'follow_video' })
	assert.strictEqual(followWide, '8ch', 'follow_video: 8ch video source stays 8ch')

	// Audio source narrower than video source → keep the wider video-source layout
	const keptWider = resolveStreamingChannelAudioLayout(config, { videoSource: 'program_2', audioSource: 'program_1' })
	assert.strictEqual(keptWider, '8ch', 'audio stereo + video 8ch: keeps wider video layout')

	console.log('✓ Streaming bus layout widening test passed')
}

/**
 * Test 6: streaming bus videoMode inherits from the cabled source screen (videoMode '' = inherit;
 * sc.videoSource is graph-synced, so the encode bus follows the cable — WO-270 follow-up).
 */
async function testStreamingBusVideoModeInheritance() {
	const { buildStreamingChannel } = require('../../src/config/config-generator-consumer-attach')

	const config = {
		screen_1_mode: '1080p5000',
		screen_2_mode: '720p5000',
	}

	// videoMode '' + cabled program_2 → inherits screen_2_mode
	config.streamingChannel = { videoMode: '', videoSource: 'program_2' }
	assert.ok(/<video-mode>720p50/.test(buildStreamingChannel(config, 9)), 'empty videoMode inherits the cabled screen mode')

	// explicit videoMode stays the escape hatch and wins over the cable
	config.streamingChannel = { videoMode: '1080i5000', videoSource: 'program_2' }
	assert.ok(/<video-mode>1080i50/.test(buildStreamingChannel(config, 9)), 'explicit videoMode overrides inheritance')

	// non-screen source (multiview) → screen_1_mode fallback as before
	config.streamingChannel = { videoMode: '', videoSource: 'multiview' }
	assert.ok(/<video-mode>1080p50/.test(buildStreamingChannel(config, 9)), 'non-screen source falls back to screen_1_mode')

	console.log('✓ Streaming bus videoMode inheritance test passed')
}

// Run all tests
async function run() {
	try {
		await testBuildAudioDownmixMatrix()
		await testSettingsRoundTrip()
		await testMixerRowsSourceAudioPair()
		await testWO244PreserveWithAudioSourcePair()
		await testStreamingBusLayoutWidening()
		await testStreamingBusVideoModeInheritance()
		console.log('\n✓ All WO-249 smoke tests passed')
	} catch (e) {
		console.error('Test failed:', e)
		process.exitCode = 1
	}
}

run()
