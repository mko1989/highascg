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
const { normalizeScreenDestinations } = require('../config/screen-destinations')
const { normalizeDeviceGraph } = require('../config/device-graph')
const { buildChannelMap } = require('../config/channel-map-from-ctx')
const { normalizeEditorDefaults } = require('../config/editor-defaults')
const { resolveEffectiveProgramLayout } = require('../config/program-audio-layouts')
const { normalizeNetworkSettings } = require('../config/network-settings')
const { resolveProjectFps } = require('../config/project-fps')
const { redactObject } = require('../support/redact-settings')
const { getExpectedApiToken } = require('../server/auth')
const projectStore = require('../engine/project-store')
const { buildStreamCredentialStatus, maskDeviceGraphConnectorKeys } = require('../engine/project-stream-credentials')

async function handleGet(path, ctx) {
	if (path !== '/api/settings') return null
	const cfg = ctx.config
	// WO-261: report project-held stream credentials as { rtmpServerUrl, hasStreamKey } (never the raw
	// key) so the inspector's URL prefill + "saved in project" placeholder keep working.
	let activeProject = null
	try {
		activeProject = projectStore.loadProjectBySlug(ctx.persistence || require('../utils/persistence'))
	} catch (_) {}
	const streamCredentials = buildStreamCredentialStatus(cfg, activeProject)
	const cs = { ...defaults.casparServer, ...cfg.casparServer }
	normalizeCasparServerConfigPath(cs)
	const payload = {
			caspar: { host: cfg.caspar.host, port: cfg.caspar.port },
			streaming: { enabled: cfg.streaming.enabled, quality: cfg.streaming.quality, resolution: cfg.streaming.resolution, fps: cfg.streaming.fps, maxBitrate: cfg.streaming.maxBitrate, basePort: cfg.streaming.basePort, autoRelocateBasePort: cfg.streaming.autoRelocateBasePort !== false, effectiveBasePort: cfg.streaming._effectiveBasePort ?? cfg.streaming.basePort, ffmpeg_path: cfg.streaming.ffmpeg_path, hardware_accel: cfg.streaming.hardware_accel, captureMode: cfg.streaming.captureMode || 'udp', ndiNamingMode: cfg.streaming.ndiNamingMode || 'auto', ndiSourcePattern: cfg.streaming.ndiSourcePattern || 'CasparCG Channel {ch}', ndiChannelNames: cfg.streaming.ndiChannelNames || {}, localCaptureDevice: cfg.streaming.localCaptureDevice || 'auto', x11Display: cfg.streaming.x11Display || ':0', drmDevice: cfg.streaming.drmDevice || '/dev/dri/card0' },
			server: { httpPort: cfg.server.httpPort, bindAddress: cfg.server.bindAddress },
			osc: { enabled: cfg.osc.enabled, listenPort: cfg.osc.listenPort, listenAddress: cfg.osc.listenAddress, peakHoldMs: cfg.osc.peakHoldMs, emitIntervalMs: cfg.osc.emitIntervalMs, staleTimeoutMs: cfg.osc.staleTimeoutMs, wsDeltaBroadcast: cfg.osc.wsDeltaBroadcast },
			ui: cfg.ui || defaults.ui,
			composePreview: { ...defaults.composePreview, ...(cfg.composePreview || {}) },
			editorDefaults: normalizeEditorDefaults(cfg.editorDefaults),
			audioRouting: (() => {
				const ar = normalizeAudioRouting({ ...defaults.audioRouting, ...(cfg.audioRouting || {}) })
				const outputs = Array.isArray(cfg.audioOutputs) ? cfg.audioOutputs : []
				return { ...ar, programLayout: resolveEffectiveProgramLayout(ar, outputs, cfg) }
			})(),
			periodic_sync_interval_sec: cfg.periodic_sync_interval_sec,
			periodic_sync_interval_sec_osc: cfg.periodic_sync_interval_sec_osc,
			osc_info_supplement_ms: cfg.osc_info_supplement_ms ?? defaults.osc_info_supplement_ms,
			channelMap: buildChannelMap(ctx),
			offline_mode: !!cfg.offline_mode,
			dmx: { ...defaults.dmx, ...(cfg.dmx || {}) },
			rtmp: normalizeRtmpConfig(cfg.rtmp),
			decklinkInputsStatus: ctx._decklinkInputsStatus ?? null,
			casparServer: cs,
			screen_count: resolveMainScreenCount(cfg),
			companion: { ...defaults.companion, ...(cfg.companion || {}) },
			screenDestinations: normalizeScreenDestinations(cfg.screenDestinations), deviceGraph: maskDeviceGraphConnectorKeys(normalizeDeviceGraph(cfg.deviceGraph)),
			gpuPhysicalTopology: Array.isArray(cfg.gpuPhysicalTopology) && cfg.gpuPhysicalTopology.length ? cfg.gpuPhysicalTopology : defaults.gpuPhysicalTopology,
			screen_1_system_id: cfg.screen_1_system_id ?? '', screen_2_system_id: cfg.screen_2_system_id ?? '', screen_3_system_id: cfg.screen_3_system_id ?? '', screen_4_system_id: cfg.screen_4_system_id ?? '', screen_1_os_mode: cfg.screen_1_os_mode ?? '', screen_2_os_mode: cfg.screen_2_os_mode ?? '', screen_3_os_mode: cfg.screen_3_os_mode ?? '', screen_4_os_mode: cfg.screen_4_os_mode ?? '', screen_1_os_backend: cfg.screen_1_os_backend ?? 'xrandr', screen_2_os_backend: cfg.screen_2_os_backend ?? 'xrandr', screen_3_os_backend: cfg.screen_3_os_backend ?? 'xrandr', screen_4_os_backend: cfg.screen_4_os_backend ?? 'xrandr', screen_1_os_rate: cfg.screen_1_os_rate ?? '', screen_2_os_rate: cfg.screen_2_os_rate ?? '', screen_3_os_rate: cfg.screen_3_os_rate ?? '', screen_4_os_rate: cfg.screen_4_os_rate ?? '',
			screen_1_force_os_resolution: !!(cfg.screen_1_force_os_resolution ?? cs.screen_1_force_os_resolution), screen_2_force_os_resolution: !!(cfg.screen_2_force_os_resolution ?? cs.screen_2_force_os_resolution), screen_3_force_os_resolution: !!(cfg.screen_3_force_os_resolution ?? cs.screen_3_force_os_resolution), screen_4_force_os_resolution: !!(cfg.screen_4_force_os_resolution ?? cs.screen_4_force_os_resolution),
			x11_horizontal_swap: !!cfg.x11_horizontal_swap, multiview_system_id: cfg.multiview_system_id ?? '', multiview_os_mode: cfg.multiview_os_mode ?? '', multiview_os_backend: cfg.multiview_os_backend ?? 'xrandr', multiview_os_rate: cfg.multiview_os_rate ?? '',
			usbIngest: { ...defaults.usbIngest, ...(cfg.usbIngest || {}) },
			operatorTools: { ...defaults.operatorTools, ...(cfg.operatorTools || {}) },
			projectScopedMedia: { ...defaults.projectScopedMedia, ...(cfg.projectScopedMedia || {}) },
			streamingChannel: (() => {
				const sc = { ...defaults.streamingChannel, ...(cfg.streamingChannel || {}) }
				return {
					...sc,
					streamKey: '',
					hasStreamKey: !!sc.streamKey,
				}
			})(),
			local_media_path: cfg.local_media_path ?? '',
			hostLiveMigrationWarnings: (() => {
				const { collectHostLiveConfigWarnings, migrateExtraLiveSourcesList } = require('../config/host-live-sources-migrate')
				const mig = migrateExtraLiveSourcesList(Array.isArray(cfg.extraLiveSources) ? cfg.extraLiveSources : [], {
					config: cfg,
					...ctx,
				})
				return [...collectHostLiveConfigWarnings(cfg), ...mig.warnings]
			})(),
			streamCredentials,
			/* WO-393: seed only when the key is ABSENT (legacy/fresh config). An empty array is a
			 * deliberate operator choice (all outputs removed) and must NOT resurrect a phantom. */
			streamOutputs: (Array.isArray(cfg.streamOutputs) ? cfg.streamOutputs : [{
				id: 'str_1',
				label: 'Str1',
				enabled: true,
				type: 'rtmp',
				name: 'Str1',
				quality: 'medium',
				rtmpServerUrl: '',
				streamKey: '',
				srtUrl: '',
				udpUrl: '',
				videoCodec: 'h264',
				videoBitrateKbps: 4500,
				encoderPreset: 'veryfast',
				audioCodec: 'aac',
				audioBitrateKbps: 128,
			}]).map((o) => {
				// WO-261: never emit the raw per-output key; expose the resolved (project-first) URL and a
				// hasStreamKey boolean for the inspector placeholder.
				const id = String(o?.id || '')
				const st = streamCredentials[id] || {}
				return { ...o, rtmpServerUrl: st.rtmpServerUrl || String(o?.rtmpServerUrl || ''), streamKey: '', hasStreamKey: !!st.hasStreamKey }
			}),
			/* WO-473: no implicit rec_1 — a fresh box ships zero record outputs (defaults-core). */
			recordOutputs: Array.isArray(cfg.recordOutputs) ? cfg.recordOutputs : [],
			audioOutputs: Array.isArray(cfg.audioOutputs) && cfg.audioOutputs.length ? cfg.audioOutputs : [],
			machineProfile: {
				defaultProjectFps: resolveProjectFps(cfg),
			},
			network: normalizeNetworkSettings(cfg.network, defaults.network),
			security: {
				enforceAuth: !!(cfg.security && cfg.security.enforceAuth),
				exposeToNetwork: cfg.security?.exposeToNetwork !== false,
				hasApiToken: !!getExpectedApiToken(cfg),
			},
		}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody(redactObject(payload)),
	}
}

module.exports = { handleGet }
