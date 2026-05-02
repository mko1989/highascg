/**
 * Settings GET handler for HighAsCG.
 */
'use strict'

const defaults = require('../config/defaults')
const { normalizeAudioRouting } = require('../config/config-generator')
const { normalizeCasparServerConfigPath } = require('./routes-caspar-config')
const { JSON_HEADERS, jsonBody } = require('./response')
const { normalizeRtmpConfig } = require('../config/rtmp-output')
const { resolveMainScreenCount } = require('../config/routing')
const { normalizeTandemTopology } = require('../config/tandem-topology')
const { normalizeDeviceGraph } = require('../config/device-graph')

async function handleGet(path, ctx) {
	if (path !== '/api/settings') return null
	const cfg = ctx.config
	const cs = { ...defaults.casparServer, ...cfg.casparServer }
	normalizeCasparServerConfigPath(cs)
	return {
		status: 200, headers: JSON_HEADERS,
		body: jsonBody({
			caspar: { host: cfg.caspar.host, port: cfg.caspar.port },
			streaming: { enabled: cfg.streaming.enabled, quality: cfg.streaming.quality, resolution: cfg.streaming.resolution, fps: cfg.streaming.fps, maxBitrate: cfg.streaming.maxBitrate, basePort: cfg.streaming.basePort, autoRelocateBasePort: cfg.streaming.autoRelocateBasePort !== false, effectiveBasePort: cfg.streaming._effectiveBasePort ?? cfg.streaming.basePort, ffmpeg_path: cfg.streaming.ffmpeg_path, hardware_accel: cfg.streaming.hardware_accel, captureMode: cfg.streaming.captureMode || 'udp', ndiNamingMode: cfg.streaming.ndiNamingMode || 'auto', ndiSourcePattern: cfg.streaming.ndiSourcePattern || 'CasparCG Channel {ch}', ndiChannelNames: cfg.streaming.ndiChannelNames || {}, localCaptureDevice: cfg.streaming.localCaptureDevice || 'auto', x11Display: cfg.streaming.x11Display || ':0', drmDevice: cfg.streaming.drmDevice || '/dev/dri/card0', go2rtcLogLevel: cfg.streaming.go2rtcLogLevel || '' },
			server: { httpPort: cfg.server.httpPort, bindAddress: cfg.server.bindAddress },
			osc: { enabled: cfg.osc.enabled, listenPort: cfg.osc.listenPort, listenAddress: cfg.osc.listenAddress, peakHoldMs: cfg.osc.peakHoldMs, emitIntervalMs: cfg.osc.emitIntervalMs, staleTimeoutMs: cfg.osc.staleTimeoutMs, wsDeltaBroadcast: cfg.osc.wsDeltaBroadcast },
			ui: cfg.ui || defaults.ui, audioRouting: normalizeAudioRouting({ ...defaults.audioRouting, ...(cfg.audioRouting || {}) }), periodic_sync_interval_sec: cfg.periodic_sync_interval_sec, periodic_sync_interval_sec_osc: cfg.periodic_sync_interval_sec_osc, osc_info_supplement_ms: cfg.osc_info_supplement_ms ?? defaults.osc_info_supplement_ms, channelMap: ctx.getState().channelMap, offline_mode: !!cfg.offline_mode, dmx: { ...defaults.dmx, ...(cfg.dmx || {}) }, rtmp: normalizeRtmpConfig(cfg.rtmp), decklinkInputsStatus: ctx._decklinkInputsStatus ?? null, casparServer: cs, screen_count: resolveMainScreenCount(cfg), companion: cfg.companion || { host: '127.0.0.1', port: 8000 },
			pixelhue: { ...defaults.pixelhue, ...(cfg.pixelhue || {}) }, tandemTopology: normalizeTandemTopology(cfg.tandemTopology), deviceGraph: normalizeDeviceGraph(cfg.deviceGraph),
			gpuPhysicalTopology: Array.isArray(cfg.gpuPhysicalTopology) && cfg.gpuPhysicalTopology.length ? cfg.gpuPhysicalTopology : defaults.gpuPhysicalTopology,
			screen_1_system_id: cfg.screen_1_system_id ?? '', screen_2_system_id: cfg.screen_2_system_id ?? '', screen_3_system_id: cfg.screen_3_system_id ?? '', screen_4_system_id: cfg.screen_4_system_id ?? '', screen_1_os_mode: cfg.screen_1_os_mode ?? '', screen_2_os_mode: cfg.screen_2_os_mode ?? '', screen_3_os_mode: cfg.screen_3_os_mode ?? '', screen_4_os_mode: cfg.screen_4_os_mode ?? '', screen_1_os_backend: cfg.screen_1_os_backend ?? 'xrandr', screen_2_os_backend: cfg.screen_2_os_backend ?? 'xrandr', screen_3_os_backend: cfg.screen_3_os_backend ?? 'xrandr', screen_4_os_backend: cfg.screen_4_os_backend ?? 'xrandr', screen_1_os_rate: cfg.screen_1_os_rate ?? '', screen_2_os_rate: cfg.screen_2_os_rate ?? '', screen_3_os_rate: cfg.screen_3_os_rate ?? '', screen_4_os_rate: cfg.screen_4_os_rate ?? '', x11_horizontal_swap: !!cfg.x11_horizontal_swap, multiview_system_id: cfg.multiview_system_id ?? '', multiview_os_mode: cfg.multiview_os_mode ?? '', multiview_os_backend: cfg.multiview_os_backend ?? 'xrandr', multiview_os_rate: cfg.multiview_os_rate ?? '',
			usbIngest: { ...defaults.usbIngest, ...(cfg.usbIngest || {}) }, streamingChannel: { ...defaults.streamingChannel, ...(cfg.streamingChannel || {}) },
			streamOutputs: Array.isArray(cfg.streamOutputs) && cfg.streamOutputs.length ? cfg.streamOutputs : [{
				id: 'str_1',
				label: 'Str1',
				enabled: true,
				type: 'rtmp',
				name: 'Str1',
				quality: 'medium',
				rtmpServerUrl: '',
				streamKey: '',
				srtUrl: '',
				videoCodec: 'h264',
				videoBitrateKbps: 4500,
				encoderPreset: 'veryfast',
				audioCodec: 'aac',
				audioBitrateKbps: 128,
			}],
			recordOutputs: Array.isArray(cfg.recordOutputs) && cfg.recordOutputs.length ? cfg.recordOutputs : [{
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
			}],
			audioOutputs: Array.isArray(cfg.audioOutputs) && cfg.audioOutputs.length ? cfg.audioOutputs : []
		})
	}
}

module.exports = { handleGet }
