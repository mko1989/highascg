/**
 * Settings POST handler for HighAsCG.
 */
'use strict'

const fs = require('fs')
const defaults = require('../config/defaults')
const { normalizeAudioRouting } = require('../config/config-generator')
const { normalizeCasparServerConfigPath } = require('./routes-caspar-config')
const { normalizeOscConfig } = require('../osc/osc-config')
const { startOscPlaybackInfoSupplement } = require('../utils/periodic-sync')
const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('./response')
const { normalizeRtmpConfig } = require('../config/rtmp-output')
const { validateDecklinkCasparSlice, validateDecklinkOutputResolution } = require('../config/decklink-config-validate')
const { validateV4l2CasparSlice } = require('../capture/v4l2-input-config-validate')
const { resolveMainScreenCount } = require('../config/routing')
const { normalizeScreenDestinations } = require('../config/screen-destinations')
const { normalizeDeviceGraph } = require('../config/device-graph')
const { mergeSystemDisplaySettings, pickOscForPersistence, SYSTEM_DISPLAY_KEYS } = require('./settings-os')
const { normalizeEditorDefaults } = require('../config/editor-defaults')
const { resolveEffectiveProgramLayout } = require('../config/program-audio-layouts')
const { normalizeNetworkSettings } = require('../config/network-settings')
const { normalizeProjectFps, applyProjectFpsToInheritedOutputs, resolveProjectFps } = require('../config/project-fps')
const { getSatellitePreviewClient } = require('../companion/satellite-preview-client')
const { mergeCompanionSettings } = require('../companion/companion-config')
const { mergeUiNuclearPasswordSettings } = require('../utils/nuclear-password')

async function handlePost(path, body, ctx) {
	if (path !== '/api/settings') return null
	const parsed = parseBodyStrict(body)
	if (!parsed.ok) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Invalid JSON body', detail: parsed.error }),
		}
	}
	const settings = parsed.value
	if (!settings || typeof settings !== 'object') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid settings' }) }
	}
	const warnings = []; const sideEffects = []; const oldC = { ...ctx.config.caspar }; const oldS = { ...ctx.config.streaming }

	const cfg = ctx.config; if (settings.caspar) { if (settings.caspar.host) cfg.caspar.host = settings.caspar.host; if (settings.caspar.port) cfg.caspar.port = parseInt(settings.caspar.port, 10) }
	if (settings.streaming) {
		const s = settings.streaming; if (s.enabled !== undefined) cfg.streaming.enabled = !!s.enabled; if (s.quality) cfg.streaming.quality = s.quality; if (s.basePort) cfg.streaming.basePort = parseInt(s.basePort, 10)
		if (s.hardware_accel !== undefined) cfg.streaming.hardware_accel = s.hardware_accel; if (s.captureMode) cfg.streaming.captureMode = s.captureMode; if (s.ndiNamingMode) cfg.streaming.ndiNamingMode = s.ndiNamingMode; if (s.ndiSourcePattern !== undefined) cfg.streaming.ndiSourcePattern = s.ndiSourcePattern
		if (s.ndiChannelNames) cfg.streaming.ndiChannelNames = { ...s.ndiChannelNames }; if (s.localCaptureDevice) cfg.streaming.localCaptureDevice = s.localCaptureDevice; if (s.x11Display) cfg.streaming.x11Display = s.x11Display; if (s.drmDevice) cfg.streaming.drmDevice = s.drmDevice
		if (s.autoRelocateBasePort !== undefined) cfg.streaming.autoRelocateBasePort = !!s.autoRelocateBasePort
	}
	if (settings.periodic_sync_interval_sec !== undefined) cfg.periodic_sync_interval_sec = parseInt(settings.periodic_sync_interval_sec, 10)
	if (settings.periodic_sync_interval_sec_osc !== undefined) cfg.periodic_sync_interval_sec_osc = parseInt(settings.periodic_sync_interval_sec_osc, 10)
	if (settings.osc_info_supplement_ms !== undefined) { const v = settings.osc_info_supplement_ms; if (v === '' || v === null) cfg.osc_info_supplement_ms = null; else cfg.osc_info_supplement_ms = parseInt(String(v), 10) }

	if (settings.osc && typeof settings.osc === 'object') {
		const o = settings.osc; if (o.listenPort) cfg.osc.listenPort = parseInt(o.listenPort, 10)
		if (o.listenAddress) cfg.osc.listenAddress = String(o.listenAddress).trim(); if (o.peakHoldMs) cfg.osc.peakHoldMs = parseInt(o.peakHoldMs, 10)
		if (o.emitIntervalMs) cfg.osc.emitIntervalMs = parseInt(o.emitIntervalMs, 10); if (o.staleTimeoutMs) cfg.osc.staleTimeoutMs = parseInt(o.staleTimeoutMs, 10); if (o.wsDeltaBroadcast !== undefined) cfg.osc.wsDeltaBroadcast = !!o.wsDeltaBroadcast
		ctx.config.osc = normalizeOscConfig(cfg)
	}
	if (settings.ui) {
		cfg.ui = mergeUiNuclearPasswordSettings(
			{ ...defaults.ui, ...cfg.ui, ...settings.ui },
			cfg.ui,
		)
	}
	if (settings.composePreview && typeof settings.composePreview === 'object') {
		const prev = cfg.composePreview || {}
		const { normalizeComposePreviewSettings } = require('../preview/compose-preview-mode')
		const merged = { ...prev, ...settings.composePreview }
		// Full settings POST from the client must not revert mode when composePreview.mode is omitted.
		if (settings.composePreview.mode === undefined && prev.mode) {
			merged.mode = prev.mode
		}
		const next = normalizeComposePreviewSettings(merged, defaults.composePreview)
		const modeChanged = prev.mode !== next.mode
		const ffmpegParamsChanged =
			prev.fps !== next.fps ||
			prev.resolutionScale !== next.resolutionScale ||
			prev.jpegQuality !== next.jpegQuality
		cfg.composePreview = next
		if (next.mode === 'ffmpeg_jpeg' && (modeChanged || ffmpegParamsChanged)) {
			sideEffects.push(
				'Compose preview uses Caspar ffmpeg consumers — apply/regenerate Caspar config and restart Caspar for FPS/scale changes.',
			)
		}
	}
	if (settings.editorDefaults) {
		cfg.editorDefaults = normalizeEditorDefaults(settings.editorDefaults, cfg.editorDefaults)
	}
	if (settings.machineProfile && typeof settings.machineProfile === 'object') {
		const prevFps = resolveProjectFps(cfg)
		const nextFps = normalizeProjectFps(settings.machineProfile.defaultProjectFps ?? prevFps)
		cfg.machineProfile = { ...(cfg.machineProfile || {}), defaultProjectFps: nextFps }
		if (nextFps !== prevFps) {
			applyProjectFpsToInheritedOutputs(cfg, nextFps, prevFps)
			sideEffects.push(`Project frame rate set to ${nextFps} fps`)
		}
	}
	if (settings.network) {
		cfg.network = normalizeNetworkSettings(settings.network, cfg.network)
	}
	if (settings.audioRouting) cfg.audioRouting = normalizeAudioRouting({ ...defaults.audioRouting, ...cfg.audioRouting, ...settings.audioRouting })
	if (settings.offline_mode !== undefined) cfg.offline_mode = !!settings.offline_mode
	if (settings.local_media_path !== undefined) {
		const newPath = String(settings.local_media_path).trim()
		const oldPath = cfg.local_media_path || ''
		if (newPath !== oldPath) {
			cfg.local_media_path = newPath
			try {
				const mediaLink = '/home/casparcg/highascg/media'
				if (newPath) {
					// Verify target exists
					if (fs.existsSync(newPath)) {
						// Check if mediaLink exists
						if (fs.existsSync(mediaLink)) {
							const st = fs.lstatSync(mediaLink)
							if (st.isSymbolicLink()) {
								fs.unlinkSync(mediaLink)
							} else if (st.isDirectory()) {
								// Rename existing directory to avoid data loss
								const bak = mediaLink + '.bak_' + Date.now()
								fs.renameSync(mediaLink, bak)
								sideEffects.push(`Moved existing media folder to ${bak}`)
							}
						}
						fs.symlinkSync(newPath, mediaLink)
						sideEffects.push(`Symlinked media folder to ${newPath}`)
					} else {
						warnings.push(`Target media path ${newPath} does not exist. Symlink not created.`)
					}
				} else {
					// If cleared, remove symlink and restore default folder
					if (fs.existsSync(mediaLink)) {
						const st = fs.lstatSync(mediaLink)
						if (st.isSymbolicLink()) {
							fs.unlinkSync(mediaLink)
							fs.mkdirSync(mediaLink)
							sideEffects.push(`Restored default media folder`)
						}
					}
				}
			} catch (e) {
				warnings.push(`Failed to update media symlink: ${e.message}`)
			}
		}
	}
	if (settings.casparServer) { cfg.casparServer = { ...defaults.casparServer, ...cfg.casparServer, ...settings.casparServer }; normalizeCasparServerConfigPath(cfg.casparServer); warnings.push(...validateDecklinkCasparSlice(cfg.casparServer).warnings); warnings.push(...validateV4l2CasparSlice(cfg.casparServer).warnings) }
	if (settings.dmx) cfg.dmx = { ...defaults.dmx, ...settings.dmx }
	if (settings.rtmp) cfg.rtmp = normalizeRtmpConfig({ ...defaults.rtmp, ...(cfg.rtmp || {}), ...settings.rtmp })
	if (settings.companion) {
		cfg.companion = mergeCompanionSettings(settings.companion, cfg.companion)
		getSatellitePreviewClient().configure(cfg)
	}
	if (settings.screenDestinations) cfg.screenDestinations = normalizeScreenDestinations(settings.screenDestinations)
	else if (settings.tandemTopology && typeof settings.tandemTopology === 'object') {
		cfg.screenDestinations = normalizeScreenDestinations({
			destinations: settings.tandemTopology.destinations,
			edidNotes: settings.tandemTopology.edidNotes,
		})
	}
	if (settings.deviceGraph) cfg.deviceGraph = normalizeDeviceGraph(settings.deviceGraph)
	if (Array.isArray(settings.gpuPhysicalTopology)) {
		cfg.gpuPhysicalTopology = settings.gpuPhysicalTopology
			.map((row, i) => {
				if (!row || typeof row !== 'object') return null
				const physicalPortId = String(row.physicalPortId || '').trim()
				if (!physicalPortId) return null
				const normalizeDp = (v) => String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
				const dpA = normalizeDp(row.dpA)
				const dpB = normalizeDp(row.dpB)
				return {
					physicalPortId,
					slotOrder: Number.isFinite(Number(row.slotOrder)) ? Number(row.slotOrder) : i,
					dpA,
					dpB,
					connectorNumber: Number.isFinite(Number(row.connectorNumber)) ? Number(row.connectorNumber) : i,
					location: Number.isFinite(Number(row.location)) ? Number(row.location) : i,
				}
			})
			.filter(Boolean)
			.sort((a, b) => a.slotOrder - b.slotOrder)
		cfg.gpuPhysicalTopologyOperatorSaved = true
	}
	if (settings.usbIngest) { const u = settings.usbIngest; const p = String(u.overwritePolicy || 'rename'); cfg.usbIngest = { enabled: u.enabled !== false, defaultSubfolder: String(u.defaultSubfolder ?? '').trim(), overwritePolicy: ['skip', 'overwrite', 'rename'].includes(p) ? p : 'rename', verifyHash: !!u.verifyHash } }
	if (settings.operatorTools) {
		// WO-268: preserve already-saved keys and only apply the keys present in the patch —
		// this used to rebuild from defaults + pointerConfineMultiview only, silently wiping
		// every other operatorTools customization on ANY settings save.
		cfg.operatorTools = {
			...defaults.operatorTools,
			...(cfg.operatorTools || {}),
		}
		if (settings.operatorTools.pointerConfineMultiview !== undefined) {
			cfg.operatorTools.pointerConfineMultiview = settings.operatorTools.pointerConfineMultiview === true
		}
		if (settings.operatorTools.cefEnableGpu !== undefined) {
			cfg.operatorTools.cefEnableGpu = settings.operatorTools.cefEnableGpu === true
		}
	}
	if (settings.projectScopedMedia) {
		const { normalizeProjectMediaLocation } = require('../media/project-media-location')
		cfg.projectScopedMedia = {
			enabled: settings.projectScopedMedia.enabled !== false,
			location: normalizeProjectMediaLocation(settings.projectScopedMedia.location),
		}
	}
	if (settings.streamingChannel) {
		const s = settings.streamingChannel
		const rawA = s.casparChannel
		let casparChannel = null
		if (rawA != null && rawA !== '' && String(rawA).toLowerCase() !== 'dedicated') {
			const a = parseInt(String(rawA), 10)
			if (Number.isFinite(a) && a >= 1) casparChannel = a
		}
		const rq = String(s.rtmpQuality || s.quality || 'medium').toLowerCase()
		// WO-261: config no longer accepts stream credentials from clients. Existing config values are
		// carried forward untouched (never taken from the incoming payload) as MIGRATION FALLBACK only —
		// the one-shot migration on the next project save moves them into the project and blanks them.
		// Credentials now live in the active project via /api/project/streaming-credentials.
		const current = ctx.configManager?.get()?.streamingChannel || {}
		const rtmpServerUrl = String(current.rtmpServerUrl ?? '').trim()
		const streamKey = String(current.streamKey ?? '').trim()
		cfg.streamingChannel = {
			enabled: s.enabled === true || s.enabled === 'true',
			videoMode: String(s.videoMode || '').trim(),
			videoSource: String(s.videoSource || 'program_1').trim(),
			audioSource: String(s.audioSource || 'follow_video').trim(),
			audioSourcePair: String(s.audioSourcePair || 'all').trim() || 'all',
			contentLayer: Math.max(1, parseInt(s.contentLayer ?? 10, 10) || 10),
			decklinkDevice: Math.max(0, parseInt(s.decklinkDevice ?? 0, 10) || 0),
			casparChannel,
			dedicatedOutputChannel: s.dedicatedOutputChannel === true || s.dedicatedOutputChannel === 'true',
			rtmpServerUrl,
			streamKey,
			rtmpQuality: ['low', 'medium', 'high'].includes(rq) ? rq : 'medium',
		}
	}
	if (Array.isArray(settings.streamOutputs)) {
		// WO-261: per-output rtmpServerUrl/streamKey are project-scoped credentials — never taken from
		// the incoming payload. Existing config values (matched by id) are carried forward untouched as
		// migration fallback only. Non-credential fields still round-trip through config as before.
		const curStreamOutputs = Array.isArray(ctx.configManager?.get()?.streamOutputs)
			? ctx.configManager.get().streamOutputs
			: Array.isArray(cfg.streamOutputs)
				? cfg.streamOutputs
				: []
		cfg.streamOutputs = settings.streamOutputs
			.map((x, i) => {
				if (!x || typeof x !== 'object') return null
				const idx = i + 1
				const id = String(x.id || `str_${idx}`).trim() || `str_${idx}`
				const curOut = curStreamOutputs.find((o) => String(o?.id || '') === id) || {}
				const typeRaw = String(x.type || 'rtmp').trim().toLowerCase()
				const type = ['rtmp', 'ndi', 'srt', 'udp'].includes(typeRaw) ? typeRaw : 'rtmp'
				const name = String(x.name || x.label || `Str${idx}`).trim() || `Str${idx}`
				const videoCodecRaw = String(x.videoCodec || 'h264').trim().toLowerCase()
				const videoCodec = ['h264', 'hevc'].includes(videoCodecRaw) ? videoCodecRaw : 'h264'
				const audioCodecRaw = String(x.audioCodec || 'aac').trim().toLowerCase()
				const audioCodec = ['aac', 'copy', 'none'].includes(audioCodecRaw) ? audioCodecRaw : 'aac'
				const encoderPresetRaw = String(x.encoderPreset || 'veryfast').trim().toLowerCase()
				const encoderPreset = encoderPresetRaw || 'veryfast'
				return {
					id,
					label: String(x.label || name).trim() || name,
					enabled: x.enabled !== false,
					type,
					name,
					quality: String(x.quality || 'medium').trim() || 'medium',
					rtmpServerUrl: String(curOut.rtmpServerUrl || '').trim(),
					streamKey: String(curOut.streamKey || '').trim(),
					srtUrl: String(x.srtUrl || '').trim(),
					// SRT-specific options (owner: "srt has its own options in casparcg"). Latency is
					// OWNER-FACING MILLISECONDS; the µs conversion ffmpeg wants happens in exactly one
					// place (streaming-channel-ffmpeg.js buildSrtOutputUrl). No passphrase here on
					// purpose — a secret belongs in the WO-261 project credentials, not plain settings.
					srtLatencyMs: Math.min(8000, Math.max(20, parseInt(String(x.srtLatencyMs ?? 120), 10) || 120)),
					srtStreamId: String(x.srtStreamId || '').trim(),
					srtMode: ['caller', 'listener'].includes(String(x.srtMode || '').trim().toLowerCase())
						? String(x.srtMode).trim().toLowerCase()
						: 'caller',
					udpUrl: String(x.udpUrl || '').trim(),
					videoCodec,
					videoBitrateKbps: Math.max(200, parseInt(String(x.videoBitrateKbps ?? 4500), 10) || 4500),
					encoderPreset,
					audioCodec,
					audioBitrateKbps: Math.max(32, parseInt(String(x.audioBitrateKbps ?? 128), 10) || 128),
				}
			})
			.filter(Boolean)
	}
	if (Array.isArray(settings.recordOutputs)) {
		cfg.recordOutputs = settings.recordOutputs
			.map((x, i) => {
				if (!x || typeof x !== 'object') return null
				const idx = i + 1
				const id = String(x.id || `rec_${idx}`).trim() || `rec_${idx}`
				const name = String(x.name || x.label || `Rec${idx}`).trim() || `Rec${idx}`
				const source = String(x.source || 'program_1').trim() || 'program_1'
				const crfRaw = parseInt(String(x.crf ?? 26), 10)
				const crf = Number.isFinite(crfRaw) ? Math.min(51, Math.max(18, crfRaw)) : 26
				const videoCodecRaw = String(x.videoCodec || 'h264').trim().toLowerCase()
				const videoCodec = ['h264', 'hevc'].includes(videoCodecRaw) ? videoCodecRaw : 'h264'
				const audioCodecRaw = String(x.audioCodec || 'aac').trim().toLowerCase()
				const audioCodec = ['aac', 'copy', 'none'].includes(audioCodecRaw) ? audioCodecRaw : 'aac'
				const encoderPresetRaw = String(x.encoderPreset || 'veryfast').trim().toLowerCase()
				const encoderPreset = encoderPresetRaw || 'veryfast'
				return {
					id,
					label: String(x.label || name).trim() || name,
					enabled: x.enabled !== false,
					name,
					source,
					crf,
					videoCodec,
					videoBitrateKbps: Math.max(200, parseInt(String(x.videoBitrateKbps ?? 4500), 10) || 4500),
					encoderPreset,
					audioCodec,
					audioBitrateKbps: Math.max(32, parseInt(String(x.audioBitrateKbps ?? 128), 10) || 128),
				}
			})
			.filter(Boolean)
	}
	if (Array.isArray(settings.audioOutputs)) {
		cfg.audioOutputs = settings.audioOutputs
			.map((x, i) => {
				if (!x || typeof x !== 'object') return null
				const idx = i + 1
				const id = String(x.id || `audio_${idx}`).trim() || `audio_${idx}`
				const label = String(x.label || x.name || `Audio ${idx}`).trim() || `Audio ${idx}`
				const type = String(x.type || 'portaudio').toLowerCase() === 'system-audio' ? 'system-audio' : 'portaudio'
				const channelLayout = String(x.channelLayout || 'stereo').trim() || 'stereo'
				const out = {
					id,
					label,
					enabled: x.enabled !== false,
					type,
					deviceName: String(x.deviceName || '').trim(),
					channelLayout: type === 'system-audio' ? 'stereo' : channelLayout,
				}
				if (type === 'portaudio') {
					out.hostApi = String(x.hostApi || 'auto').trim() || 'auto'
					const buf = parseInt(String(x.bufferFrames ?? 128), 10)
					const lat = parseInt(String(x.latencyMs ?? 40), 10)
					const fifo = parseInt(String(x.fifoMs ?? 50), 10)
					if (Number.isFinite(buf) && buf > 0) out.bufferFrames = buf
					if (Number.isFinite(lat) && lat >= 0) out.latencyMs = lat
					if (Number.isFinite(fifo) && fifo > 0) out.fifoMs = fifo
					if (x.autoTuneLatency === false || x.autoTuneLatency === 'false') out.autoTuneLatency = false
				}
				return out
			})
			.filter(Boolean)
	}

	if (Array.isArray(cfg.audioOutputs)) {
		const ar = normalizeAudioRouting({ ...defaults.audioRouting, ...(cfg.audioRouting || {}) })
		cfg.audioRouting = {
			...ar,
			programLayout: resolveEffectiveProgramLayout(ar, cfg.audioOutputs, cfg),
		}
	}

	mergeSystemDisplaySettings(ctx, settings)
	const mainCount = resolveMainScreenCount(cfg); cfg.screen_count = mainCount; if (!cfg.casparServer) cfg.casparServer = { ...defaults.casparServer }; cfg.casparServer.screen_count = mainCount

	if (ctx.configManager) {
		const cur = ctx.configManager.get(); const newConfig = { ...cur, screen_count: cfg.screen_count, caspar: cfg.caspar, streaming: { ...cfg.streaming }, periodic_sync_interval_sec: cfg.periodic_sync_interval_sec, periodic_sync_interval_sec_osc: cfg.periodic_sync_interval_sec_osc, osc_info_supplement_ms: cfg.osc_info_supplement_ms, osc: pickOscForPersistence(cfg.osc), ui: cfg.ui || defaults.ui, composePreview: { ...defaults.composePreview, ...(cfg.composePreview || {}) }, audioRouting: cfg.audioRouting || defaults.audioRouting, offline_mode: cfg.offline_mode, dmx: { ...defaults.dmx, ...(cfg.dmx || {}) }, casparServer: cfg.casparServer || defaults.casparServer, companion: cfg.companion || { host: '127.0.0.1', port: 8000 }, screenDestinations: normalizeScreenDestinations(cfg.screenDestinations), deviceGraph: normalizeDeviceGraph(cfg.deviceGraph), gpuPhysicalTopology: Array.isArray(cfg.gpuPhysicalTopology) && cfg.gpuPhysicalTopology.length ? cfg.gpuPhysicalTopology : defaults.gpuPhysicalTopology, rtmp: normalizeRtmpConfig(cfg.rtmp), usbIngest: { ...defaults.usbIngest, ...(cfg.usbIngest || {}) }, operatorTools: { ...defaults.operatorTools, ...(cfg.operatorTools || {}) }, projectScopedMedia: { ...defaults.projectScopedMedia, ...(cfg.projectScopedMedia || {}) }, streamingChannel: { ...defaults.streamingChannel, ...(cfg.streamingChannel || {}) }, streamOutputs: Array.isArray(cfg.streamOutputs) ? cfg.streamOutputs : (Array.isArray(cur.streamOutputs) ? cur.streamOutputs : []), recordOutputs: Array.isArray(cfg.recordOutputs) ? cfg.recordOutputs : (Array.isArray(cur.recordOutputs) ? cur.recordOutputs : (Array.isArray(defaults.recordOutputs) ? defaults.recordOutputs : [])), audioOutputs: Array.isArray(cfg.audioOutputs) ? cfg.audioOutputs : (Array.isArray(cur.audioOutputs) ? cur.audioOutputs : []), local_media_path: cfg.local_media_path, machineProfile: cfg.machineProfile || { ...defaults.machineProfile }, network: normalizeNetworkSettings(cfg.network, defaults.network) }
		delete newConfig.mediaMount
		delete newConfig.streaming._effectiveBasePort; delete newConfig.streaming._casparHost
		for (const k of SYSTEM_DISPLAY_KEYS) { if (settings[k] !== undefined) { if (cfg[k] !== undefined) newConfig[k] = cfg[k]; else delete newConfig[k] } }
		// T161.6: legacy WO-88 host-live migration is retired for versioned configs
		// (it ran once at load / before the configVersion stamp). Explicit
		// /api/host-live migration endpoints remain available regardless.
		if (!(parseInt(String(newConfig.configVersion ?? ''), 10) >= 1)) {
			const { migrateHostLiveSourcesConfig } = require('../config/host-live-sources-migrate')
			const hostLiveMig = migrateHostLiveSourcesConfig(newConfig, ctx)
			if (hostLiveMig.changed) {
				newConfig.extraLiveSources = hostLiveMig.extraLiveSources
				if (hostLiveMig.casparServerPatch && Object.keys(hostLiveMig.casparServerPatch).length) {
					newConfig.casparServer = { ...newConfig.casparServer, ...hostLiveMig.casparServerPatch }
				}
			}
			if (hostLiveMig.warnings.length) warnings.push(...hostLiveMig.warnings)
		}
		ctx.configManager.save(newConfig)
		const { syncOperatorPointerConfine } = require('../system/pointer-confine')
		syncOperatorPointerConfine(newConfig, { log: (level, msg) => ctx.log?.(level, msg) })
	}

	let oscRestarted = false; if (settings.osc && typeof ctx.restartOscSubsystem === 'function') { ctx.restartOscSubsystem(); oscRestarted = true }
	if (oldC.host !== cfg.caspar.host || oldC.port !== cfg.caspar.port) { if (ctx.casparConnection) { sideEffects.push('Reconnecting to CasparCG…'); ctx.casparConnection.reconnect(cfg.caspar.host, cfg.caspar.port) } }
	const sChanged = (oldS.enabled !== cfg.streaming.enabled || oldS.quality !== cfg.streaming.quality || oldS.basePort !== cfg.streaming.basePort || oldS.hardware_accel !== cfg.streaming.hardware_accel || oldS.captureMode !== cfg.streaming.captureMode || oldS.ndiNamingMode !== cfg.streaming.ndiNamingMode || oldS.ndiSourcePattern !== cfg.streaming.ndiSourcePattern || JSON.stringify(oldS.ndiChannelNames || {}) !== JSON.stringify(cfg.streaming.ndiChannelNames || {}) || oldS.localCaptureDevice !== cfg.streaming.localCaptureDevice || oldS.x11Display !== cfg.streaming.x11Display || oldS.drmDevice !== cfg.streaming.drmDevice || oldS.autoRelocateBasePort !== cfg.streaming.autoRelocateBasePort)
	if (sChanged) { sideEffects.push('Applying streaming changes…'); if (typeof ctx.toggleStreaming === 'function') await ctx.toggleStreaming(cfg.streaming.enabled); else if (typeof ctx.restartStreaming === 'function') await ctx.restartStreaming() }
	if (settings.osc_info_supplement_ms !== undefined) startOscPlaybackInfoSupplement(ctx)
	if (typeof ctx._wsBroadcast === 'function' && typeof ctx.getState === 'function') { const st = ctx.getState(); if (st?.channelMap) ctx._wsBroadcast('change', { path: 'channelMap', value: st.channelMap }) }

	warnings.push(...validateDecklinkOutputResolution(cfg).warnings)

	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, sideEffects, oscRestarted, ...(warnings.length ? { warnings } : {}) }) }
}

module.exports = { handlePost }
