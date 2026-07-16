/**
 * WO-244 smoke test — preserve streamKey/rtmpServerUrl on empty-overwrite, mask on GET
 */

'use strict'

const assert = require('assert')

/**
 * Test 1: settings-post preserves empty streamKey when current value exists
 */
async function testPreserveOnEmpty() {
	const { handlePost } = require('../../src/api/settings-post')
	const defaults = require('../../src/config/defaults')

	const mockConfig = {
		...defaults,
		streamingChannel: {
			enabled: true,
			rtmpServerUrl: 'rtmp://live.example.com/app',
			streamKey: 'existing_secret_key_12345',
			videoMode: '1080p5000',
			videoSource: 'program_1',
			audioSource: 'follow_video',
			casparChannel: null,
			dedicatedOutputChannel: false,
			contentLayer: 10,
			decklinkDevice: 0,
			rtmpQuality: 'medium',
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
			contentLayer: 10,
			decklinkDevice: 0,
			rtmpServerUrl: '',
			streamKey: '',
		},
	})

	const result = await handlePost('/api/settings', incomingBody, mockCtx)
	assert.strictEqual(result.status, 200, 'POST should return 200')
	assert.strictEqual(
		mockConfig.streamingChannel.streamKey,
		'existing_secret_key_12345',
		'streamKey should be preserved when empty in payload'
	)
	assert.strictEqual(
		mockConfig.streamingChannel.rtmpServerUrl,
		'rtmp://live.example.com/app',
		'rtmpServerUrl should be preserved when empty in payload'
	)

	console.log('✓ Preserve on empty test passed')
}

/**
 * Test 2: WO-261 supersedes WO-244 — settings-post NO LONGER accepts credential writes into config.
 * Incoming url/key are ignored; existing config values are preserved untouched (migration fallback).
 */
async function testReplaceWithNewValue() {
	const { handlePost } = require('../../src/api/settings-post')
	const defaults = require('../../src/config/defaults')

	const mockConfig = {
		...defaults,
		streamingChannel: {
			enabled: true,
			rtmpServerUrl: 'rtmp://old.example.com/app',
			streamKey: 'old_key',
			videoMode: '1080p5000',
			videoSource: 'program_1',
			audioSource: 'follow_video',
			casparChannel: null,
			dedicatedOutputChannel: false,
			contentLayer: 10,
			decklinkDevice: 0,
			rtmpQuality: 'medium',
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
			contentLayer: 10,
			decklinkDevice: 0,
			rtmpServerUrl: 'rtmp://new.example.com/app',
			streamKey: 'new_secret_key',
		},
	})

	const result = await handlePost('/api/settings', incomingBody, mockCtx)
	assert.strictEqual(result.status, 200, 'POST should return 200')
	assert.strictEqual(
		mockConfig.streamingChannel.streamKey,
		'old_key',
		'WO-261: incoming streamKey is ignored; existing config value preserved as migration fallback'
	)
	assert.strictEqual(
		mockConfig.streamingChannel.rtmpServerUrl,
		'rtmp://old.example.com/app',
		'WO-261: incoming rtmpServerUrl is ignored; existing config value preserved'
	)

	console.log('✓ WO-261 config-write-ignored test passed')
}

/**
 * Test 3: WO-261 — config credentials are no longer client-clearable via settings-post. The legacy
 * clearCredentials flag is ignored; config values are preserved (migration/project owns clearing now).
 */
async function testClearCredentials() {
	const { handlePost } = require('../../src/api/settings-post')
	const defaults = require('../../src/config/defaults')

	const mockConfig = {
		...defaults,
		streamingChannel: {
			enabled: true,
			rtmpServerUrl: 'rtmp://live.example.com/app',
			streamKey: 'existing_secret_key_12345',
			videoMode: '1080p5000',
			videoSource: 'program_1',
			audioSource: 'follow_video',
			casparChannel: null,
			dedicatedOutputChannel: false,
			contentLayer: 10,
			decklinkDevice: 0,
			rtmpQuality: 'medium',
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
			contentLayer: 10,
			decklinkDevice: 0,
			rtmpServerUrl: '',
			streamKey: '',
			clearCredentials: true,
		},
	})

	const result = await handlePost('/api/settings', incomingBody, mockCtx)
	assert.strictEqual(result.status, 200, 'POST should return 200')
	assert.strictEqual(
		mockConfig.streamingChannel.streamKey,
		'existing_secret_key_12345',
		'WO-261: clearCredentials no longer clears config; existing value preserved'
	)
	assert.strictEqual(
		mockConfig.streamingChannel.rtmpServerUrl,
		'rtmp://live.example.com/app',
		'WO-261: clearCredentials no longer clears config rtmpServerUrl'
	)

	console.log('✓ WO-261 clearCredentials-ignored test passed')
}

/**
 * Test 4: settings-get masks streamKey and adds hasStreamKey
 */
async function testSettingsGetMask() {
	const { handleGet } = require('../../src/api/settings-get')

	const mockConfig = {
		caspar: { host: '127.0.0.1', port: 5250 },
		server: { httpPort: 3000, bindAddress: '0.0.0.0' },
		osc: { enabled: true, listenPort: 6251, listenAddress: '0.0.0.0', peakHoldMs: 2000, emitIntervalMs: 100, staleTimeoutMs: 5000, wsDeltaBroadcast: true },
		ui: { oscFooterVu: true, rundownPlaybackTimer: true },
		streaming: { enabled: false, quality: 'medium', fps: 25, resolution: '1080p', maxBitrate: 8000, basePort: 9000, autoRelocateBasePort: false, hardware_accel: '', captureMode: 'udp', ndiNamingMode: 'auto', ndiSourcePattern: 'CasparCG Channel {ch}', ndiChannelNames: {}, localCaptureDevice: 'auto', x11Display: ':0', drmDevice: '/dev/dri/card0', _effectiveBasePort: 9000, _casparHost: '127.0.0.1' },
		streamingChannel: {
			enabled: true,
			rtmpServerUrl: 'rtmp://live.youtube.com/rtmp/',
			streamKey: 'secret_youtube_key_abc123xyz',
			videoMode: '1080p5000',
			videoSource: 'program_1',
			audioSource: 'follow_video',
			casparChannel: null,
			dedicatedOutputChannel: false,
			contentLayer: 10,
			decklinkDevice: 0,
			rtmpQuality: 'medium',
		},
		composePreview: { mode: 'canvas', fps: 25, resolutionScale: 'half', jpegQuality: 10, companionThumbEnabled: false },
		audioRouting: { outputDevices: [], programLayout: { main: { in: [], out: [] }, monitor: { in: [], out: [] } } },
		periodic_sync_interval_sec: 30,
		periodic_sync_interval_sec_osc: 30,
		osc_info_supplement_ms: null,
		offline_mode: false,
		dmx: { enabled: false, debugLogDmx: false, fps: 25, fixtures: [] },
		rtmp: { host: '127.0.0.1', port: 1935 },
		companion: { host: '127.0.0.1', port: 8000 },
		screenDestinations: [],
		deviceGraph: [],
		gpuPhysicalTopology: [],
		casparServer: { screen_count: 1 },
		usbIngest: { enabled: false, defaultSubfolder: '', overwritePolicy: 'rename', verifyHash: false },
		operatorTools: { pointerConfineMultiview: false },
		projectScopedMedia: { enabled: true, location: 'internal' },
		screen_count: 1,
		audioOutputs: [],
		streamOutputs: [],
		recordOutputs: [],
		machineProfile: { defaultProjectFps: 25 },
		network: { tailscale: { enabled: false } },
		security: { enforceAuth: false },
	}

	const mockCtx = {
		config: mockConfig,
	}

	const result = await handleGet('/api/settings', mockCtx)
	assert.strictEqual(result.status, 200, 'GET should return 200')

	const payload = JSON.parse(result.body)
	assert.strictEqual(
		payload.streamingChannel.streamKey,
		'',
		'streamKey should be masked to empty string'
	)
	assert.strictEqual(
		payload.streamingChannel.hasStreamKey,
		true,
		'hasStreamKey should be true when config has a key'
	)
	assert.strictEqual(
		payload.streamingChannel.rtmpServerUrl,
		'rtmp://live.youtube.com/rtmp/',
		'rtmpServerUrl should not be masked'
	)

	console.log('✓ Settings GET mask test passed')
}

/**
 * Test 5: settings-get shows hasStreamKey: false when no key exists
 */
async function testSettingsGetNoKey() {
	const { handleGet } = require('../../src/api/settings-get')

	const mockConfig = {
		caspar: { host: '127.0.0.1', port: 5250 },
		server: { httpPort: 3000, bindAddress: '0.0.0.0' },
		osc: { enabled: true, listenPort: 6251, listenAddress: '0.0.0.0', peakHoldMs: 2000, emitIntervalMs: 100, staleTimeoutMs: 5000, wsDeltaBroadcast: true },
		ui: { oscFooterVu: true, rundownPlaybackTimer: true },
		streaming: { enabled: false, quality: 'medium', fps: 25, resolution: '1080p', maxBitrate: 8000, basePort: 9000, autoRelocateBasePort: false, hardware_accel: '', captureMode: 'udp', ndiNamingMode: 'auto', ndiSourcePattern: 'CasparCG Channel {ch}', ndiChannelNames: {}, localCaptureDevice: 'auto', x11Display: ':0', drmDevice: '/dev/dri/card0', _effectiveBasePort: 9000, _casparHost: '127.0.0.1' },
		streamingChannel: {
			enabled: false,
			rtmpServerUrl: '',
			streamKey: '',
			videoMode: '1080p5000',
			videoSource: 'program_1',
			audioSource: 'follow_video',
			casparChannel: null,
			dedicatedOutputChannel: false,
			contentLayer: 10,
			decklinkDevice: 0,
			rtmpQuality: 'medium',
		},
		composePreview: { mode: 'canvas', fps: 25, resolutionScale: 'half', jpegQuality: 10, companionThumbEnabled: false },
		audioRouting: { outputDevices: [], programLayout: { main: { in: [], out: [] }, monitor: { in: [], out: [] } } },
		periodic_sync_interval_sec: 30,
		periodic_sync_interval_sec_osc: 30,
		osc_info_supplement_ms: null,
		offline_mode: false,
		dmx: { enabled: false, debugLogDmx: false, fps: 25, fixtures: [] },
		rtmp: { host: '127.0.0.1', port: 1935 },
		companion: { host: '127.0.0.1', port: 8000 },
		screenDestinations: [],
		deviceGraph: [],
		gpuPhysicalTopology: [],
		casparServer: { screen_count: 1 },
		usbIngest: { enabled: false, defaultSubfolder: '', overwritePolicy: 'rename', verifyHash: false },
		operatorTools: { pointerConfineMultiview: false },
		projectScopedMedia: { enabled: true, location: 'internal' },
		screen_count: 1,
		audioOutputs: [],
		streamOutputs: [],
		recordOutputs: [],
		machineProfile: { defaultProjectFps: 25 },
		network: { tailscale: { enabled: false } },
		security: { enforceAuth: false },
	}

	const mockCtx = {
		config: mockConfig,
	}

	const result = await handleGet('/api/settings', mockCtx)
	assert.strictEqual(result.status, 200, 'GET should return 200')

	const payload = JSON.parse(result.body)
	assert.strictEqual(
		payload.streamingChannel.hasStreamKey,
		false,
		'hasStreamKey should be false when config has no key'
	)

	console.log('✓ Settings GET no key test passed')
}

/**
 * Run all tests
 */
async function runTests() {
	try {
		await testPreserveOnEmpty()
		await testReplaceWithNewValue()
		await testClearCredentials()
		await testSettingsGetMask()
		await testSettingsGetNoKey()
		console.log('\n✓ All WO-244 smoke tests passed')
		process.exit(0)
	} catch (e) {
		console.error('\n✗ Smoke test failed:', e.message)
		console.error(e.stack)
		process.exit(1)
	}
}

runTests()
