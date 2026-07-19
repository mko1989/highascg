'use strict'

const { casparServerDefaults } = require('./defaults-caspar-server')
const { editorDefaultsDefaults } = require('./editor-defaults')
const { replicationDefaults } = require('./defaults-replication')
const { resolveDefaultTopologyForGpu } = require('../utils/known-gpu-topology')

/** Top-level defaults excluding casparServer (merged in defaults.js). */
function coreDefaults() {
	return {
		caspar: {
			host: '127.0.0.1',
			port: 5250,
		},
		amcp_batch: false,
		amcp_max_batch_commands: 64,
		amcp_mixer_commit_before_amcp_batch: true,
		/** WO-259: two-phase BEGIN…COMMIT batching for the live take pipeline. `false` = pre-WO-259
		 * byte-identical sequential AMCP line sequence (instant no-code-change rollback). */
		take_two_phase_batch: true,
		offline_mode: false,
		screen_1_force_os_resolution: false,
		screen_2_force_os_resolution: false,
		screen_3_force_os_resolution: false,
		screen_4_force_os_resolution: false,
		host_stats: {
			scan_folder: false,
		},
		osc_info_supplement_ms: 2000,
		hq_thumbnail_prewarm_on_start: true,
		hq_thumbnail_prewarm_on_media_refresh: true,
		casparServer: casparServerDefaults(),
		usbIngest: {
			enabled: true,
			defaultSubfolder: '',
			overwritePolicy: 'rename',
			verifyHash: false,
		},
		operatorTools: {
			pointerConfineMultiview: false,
			cefInteractiveBridge: true,
			cefInteractiveLayer: 999,
			cefRemoteDebuggingPort: 9222,
		},
		projectScopedMedia: {
			enabled: true,
			location: 'internal',
		},
		local_template_path: '',
		server: {
			httpPort: 4200,
			wsPort: 4200,
			bindAddress: '0.0.0.0',
		},
		security: {
			enforceAuth: false,
			exposeToNetwork: true,
			apiToken: '',
		},
		osc: {
			enabled: true,
			listenPort: 6251,
			listenAddress: '0.0.0.0',
			peakHoldMs: 2000,
			emitIntervalMs: 50,
			staleTimeoutMs: 5000,
		},
		ui: {
			oscFooterVu: true,
			rundownPlaybackTimer: true,
			nuclearRequirePassword: false,
			nuclearPassword: '',
			nuclearPasswordHash: '',
			/**
			 * WO-242: JS pixel-mapping (Pixel Map tab editor + fixture DMX Art-Net/sACN output engine,
			 * src/sampling/dmx-*) is deprecated in favor of native `pixelmap` screen destinations.
			 * Default off/absent hides the legacy editor's UI entry points; the code itself is untouched
			 * and this flag restores it (sACN output + restart-free remapping only exist on the legacy
			 * path — native is Art-Net + config+restart only, see docs/ARTNET_PIXEL_MAPPING.md).
			 */
			legacyJsPixelmap: false,
		},
		composePreview: {
			mode: 'ffmpeg_jpeg',
			fps: 25,
			resolutionScale: 'half',
			jpegQuality: 10,
			basenamePrefix: 'highascg_preview',
			maxWidth: 480,
			channels: 'compose_visible',
			embedConsumersInCasparConfig: true,
			attachViaAmcp: true,
			pauseConsumerWhenIdle: false,
			companionThumbEnabled: true,
			companionThumbSize: 144,
			companionThumbIntervalMs: 1000,
		},
		live_thumbnail_ttl_ms: 30000,
		/** Invalidate cached live thumbs after PGM/PRV activity (no automatic Caspar PRINT). */
		live_thumbnail_refresh_on_bus: true,
		live_thumbnail_refresh_delay_ms: 600,
		editorDefaults: editorDefaultsDefaults(),
		audioRouting: {
			programLayout: 'stereo',
			programOutput: 'default',
			programAlsaDevice: '',
			programFfmpegPath: '',
			programFfmpegArgs: '',
			monitorOutput: 'default',
			monitorAlsaDevice: '',
			monitorFfmpegPath: '',
			monitorFfmpegArgs: '',
			browserMonitor: 'pgm',
			programSystemAudioDevices: ['', '', '', ''],
			previewSystemAudioEnabled: [false, false, false, false],
			previewSystemAudioDevices: ['', '', '', ''],
			audioPreview: {
				enabled: false,
				bus: 'preview_1',
				screenIndex: 1,
				deviceName: '',
				soloLayerStart: 1,
				soloLayerCount: 8,
				defaultSource: 'preview_1',
			},
		},
		x11_horizontal_swap: false,
		multiview_system_id: '',
		multiview_os_mode: '',
		multiview_os_rate: '',
		dmx: {
			enabled: false,
			debugLogDmx: false,
			fps: 25,
			fixtures: [],
			artnetInputEnabled: true,
			artnetInputPort: 6454,
			artnetInputScreenIndex: 0,
			artnetInputLogIntervalMs: 60_000,
			artnetInputWsIntervalMs: 500,
			artnetInputStatsIntervalMs: 10_000,
		},
		rtmp: {
			enabled: false,
			programOutputsEnabled: true,
			previewOutputsEnabled: false,
			multiviewOutputEnabled: true,
			destinations: [
				{
					enabled: false,
					label: 'Encoder 1',
					rtmpServerUrl: '',
					streamKey: '',
					rtmpUrl: '',
					inputTarget: 'program_1',
					videoCodec: 'h264',
					videoBitrateKbps: 4500,
					encoderPreset: 'veryfast',
					audioSource: 'muxed',
					audioBitrateKbps: 128,
				},
				{
					enabled: false,
					label: 'Encoder 2',
					rtmpServerUrl: '',
					streamKey: '',
					rtmpUrl: '',
					inputTarget: 'program_1',
					videoCodec: 'h264',
					videoBitrateKbps: 4500,
					encoderPreset: 'veryfast',
					audioSource: 'muxed',
					audioBitrateKbps: 128,
				},
				{
					enabled: false,
					label: 'Encoder 3',
					rtmpServerUrl: '',
					streamKey: '',
					rtmpUrl: '',
					inputTarget: 'multiview',
					videoCodec: 'h264',
					videoBitrateKbps: 4500,
					encoderPreset: 'veryfast',
					audioSource: 'muxed',
					audioBitrateKbps: 128,
				},
				{
					enabled: false,
					label: 'Encoder 4',
					rtmpServerUrl: '',
					streamKey: '',
					rtmpUrl: '',
					inputTarget: 'program_1',
					videoCodec: 'h264',
					videoBitrateKbps: 4500,
					encoderPreset: 'veryfast',
					audioSource: 'muxed',
					audioBitrateKbps: 128,
				},
			],
		},
		// videoSource/quality/audioSourcePair sync from Devices-tab cabling (device-graph-output-mapping);
		// videoMode '' inherits the cabled screen's mode. casparChannel/dedicatedOutputChannel/
		// contentLayer/decklinkDevice are config-file escape hatches with cable-derived fallbacks.
		streamingChannel: {
			enabled: false,
			videoMode: '',
			videoSource: 'program_1',
			audioSource: 'follow_video',
			audioSourcePair: 'all',
			casparChannel: null,
			dedicatedOutputChannel: false,
			rtmpServerUrl: '',
			streamKey: '',
			rtmpQuality: 'medium',
			contentLayer: 10,
			decklinkDevice: 0,
		},
		plugins: {
			entries: {},
		},
		cgStudio: {
			httpPort: 4300,
			bindAddress: '127.0.0.1',
		},
		recordOutputs: [
			{
				id: 'rec_1',
				label: 'Rec1',
				enabled: true,
				name: 'Rec1',
				source: 'program_1',
				crf: 26,
				videoCodec: 'h264',
				videoBitrateKbps: 4500,
				encoderPreset: 'veryfast',
				audioCodec: 'aac',
				audioBitrateKbps: 128,
			},
		],
		screenDestinations: {
			version: 1,
			edidNotes: '',
		},
		screenLabels: [],
		gpuPhysicalTopology: resolveDefaultTopologyForGpu(null),
		deviceGraph: {
			version: 1,
			devices: [{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' }],
			connectors: [],
			edges: [],
			layout: {},
		},
		replication: replicationDefaults(),
		companion: {
			host: '127.0.0.1',
			port: 8000,
			satelliteEnabled: true,
			satelliteHost: '',
			satellitePort: 16622,
			previewBitmapSize: 72,
			pickerGridSize: 8,
		},
		machineProfile: {
			defaultProjectFps: 50,
		},
		network: {
			primaryInterface: '',
			mode: 'dhcp',
			static: {
				address: '',
				prefixLength: 24,
				gateway: '',
				dns: [],
			},
		},
	}
}

module.exports = { coreDefaults }
