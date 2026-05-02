/**
 * Settings POST handler for HighAsCG.
 */
'use strict'

const defaults = require('../config/defaults')
const { normalizeAudioRouting } = require('../config/config-generator')
const { normalizeCasparServerConfigPath } = require('./routes-caspar-config')
const { normalizeOscConfig } = require('../osc/osc-config')
const { startOscPlaybackInfoSupplement } = require('../utils/periodic-sync')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { normalizeRtmpConfig } = require('../config/rtmp-output')
const { validateDecklinkCasparSlice } = require('../config/decklink-config-validate')
const { resolveMainScreenCount } = require('../config/routing')
const phClient = require('../pixelhue/client')
const { normalizeTandemTopology } = require('../config/tandem-topology')
const { normalizeDeviceGraph } = require('../config/device-graph')
const { mergeSystemDisplaySettings, pickOscForPersistence, SYSTEM_DISPLAY_KEYS } = require('./settings-os')

async function handlePost(path, body, ctx) {
	if (path !== '/api/settings') return null
	const settings = parseBody(body); if (!settings || typeof settings !== 'object') return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid settings' }) }
	const warnings = []; const oldC = { ...ctx.config.caspar }; const oldS = { ...ctx.config.streaming }

	const cfg = ctx.config; if (settings.caspar) { if (settings.caspar.host) cfg.caspar.host = settings.caspar.host; if (settings.caspar.port) cfg.caspar.port = parseInt(settings.caspar.port, 10) }
	if (settings.streaming) {
		const s = settings.streaming; if (s.enabled !== undefined) cfg.streaming.enabled = !!s.enabled; if (s.quality) cfg.streaming.quality = s.quality; if (s.basePort) cfg.streaming.basePort = parseInt(s.basePort, 10)
		if (s.hardware_accel !== undefined) cfg.streaming.hardware_accel = s.hardware_accel; if (s.captureMode) cfg.streaming.captureMode = s.captureMode; if (s.ndiNamingMode) cfg.streaming.ndiNamingMode = s.ndiNamingMode; if (s.ndiSourcePattern !== undefined) cfg.streaming.ndiSourcePattern = s.ndiSourcePattern
		if (s.ndiChannelNames) cfg.streaming.ndiChannelNames = { ...s.ndiChannelNames }; if (s.localCaptureDevice) cfg.streaming.localCaptureDevice = s.localCaptureDevice; if (s.x11Display) cfg.streaming.x11Display = s.x11Display; if (s.drmDevice) cfg.streaming.drmDevice = s.drmDevice
		if (s.go2rtcLogLevel !== undefined) { const t = String(s.go2rtcLogLevel).trim().toLowerCase(); if (!t) delete cfg.streaming.go2rtcLogLevel; else cfg.streaming.go2rtcLogLevel = t }
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
	if (settings.ui) cfg.ui = { ...defaults.ui, ...cfg.ui, ...settings.ui }
	if (settings.audioRouting) cfg.audioRouting = normalizeAudioRouting({ ...defaults.audioRouting, ...cfg.audioRouting, ...settings.audioRouting })
	if (settings.offline_mode !== undefined) cfg.offline_mode = !!settings.offline_mode
	if (settings.casparServer) { cfg.casparServer = { ...defaults.casparServer, ...cfg.casparServer, ...settings.casparServer }; normalizeCasparServerConfigPath(cfg.casparServer); warnings.push(...validateDecklinkCasparSlice(cfg.casparServer).warnings) }
	if (settings.dmx) cfg.dmx = { ...defaults.dmx, ...settings.dmx }
	if (settings.rtmp) cfg.rtmp = normalizeRtmpConfig({ ...defaults.rtmp, ...(cfg.rtmp || {}), ...settings.rtmp })
	if (settings.companion) cfg.companion = { host: String(settings.companion.host || '127.0.0.1').trim(), port: parseInt(settings.companion.port, 10) || 8000 }
	if (settings.pixelhue) { const x = settings.pixelhue; cfg.pixelhue = { ...defaults.pixelhue, ...(cfg.pixelhue || {}), enabled: x.enabled === true || x.enabled === 'true', host: String(x.host ?? '').trim(), unicoPort: parseInt(x.unicoPort || 19998, 10), apiPort: x.apiPort ? parseInt(x.apiPort, 10) : null, targetSerial: String(x.targetSerial ?? '').trim() }; phClient.clearConnectionCache() }
	if (settings.tandemTopology) cfg.tandemTopology = normalizeTandemTopology(settings.tandemTopology)
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
	}
	if (settings.usbIngest) { const u = settings.usbIngest; const p = String(u.overwritePolicy || 'rename'); cfg.usbIngest = { enabled: u.enabled !== false, defaultSubfolder: String(u.defaultSubfolder ?? '').trim(), overwritePolicy: ['skip', 'overwrite', 'rename'].includes(p) ? p : 'rename', verifyHash: !!u.verifyHash } }
	if (settings.streamingChannel) {
		const s = settings.streamingChannel
		const rawA = s.casparChannel
		let casparChannel = null
		if (rawA != null && rawA !== '' && String(rawA).toLowerCase() !== 'dedicated') {
			const a = parseInt(String(rawA), 10)
			if (Number.isFinite(a) && a >= 1) casparChannel = a
		}
		const rq = String(s.rtmpQuality || s.quality || 'medium').toLowerCase()
		cfg.streamingChannel = {
			enabled: s.enabled === true || s.enabled === 'true',
			videoMode: String(s.videoMode || '1080p5000').trim(),
			videoSource: String(s.videoSource || 'program_1').trim(),
			audioSource: String(s.audioSource || 'follow_video').trim(),
			contentLayer: Math.max(1, parseInt(s.contentLayer ?? 10, 10) || 10),
			decklinkDevice: Math.max(0, parseInt(s.decklinkDevice ?? 0, 10) || 0),
			casparChannel,
			dedicatedOutputChannel: s.dedicatedOutputChannel === true || s.dedicatedOutputChannel === 'true',
			rtmpServerUrl: String(s.rtmpServerUrl ?? '').trim(),
			streamKey: String(s.streamKey ?? '').trim(),
			rtmpQuality: ['low', 'medium', 'high'].includes(rq) ? rq : 'medium',
		}
	}
	if (Array.isArray(settings.streamOutputs)) {
		cfg.streamOutputs = settings.streamOutputs
			.map((x, i) => {
				if (!x || typeof x !== 'object') return null
				const idx = i + 1
				const id = String(x.id || `str_${idx}`).trim() || `str_${idx}`
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
					rtmpServerUrl: String(x.rtmpServerUrl || '').trim(),
					streamKey: String(x.streamKey || '').trim(),
					srtUrl: String(x.srtUrl || '').trim(),
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
				return {
					id,
					label,
					enabled: x.enabled !== false,
					deviceName: String(x.deviceName || '').trim(),
					channelLayout: String(x.channelLayout || 'stereo').trim(),
				}
			})
			.filter(Boolean)
	}

	mergeSystemDisplaySettings(ctx, settings)
	const mainCount = resolveMainScreenCount(cfg); cfg.screen_count = mainCount; if (!cfg.casparServer) cfg.casparServer = { ...defaults.casparServer }; cfg.casparServer.screen_count = mainCount

	if (ctx.configManager) {
		const cur = ctx.configManager.get(); const newConfig = { ...cur, screen_count: cfg.screen_count, caspar: cfg.caspar, streaming: { ...cfg.streaming }, periodic_sync_interval_sec: cfg.periodic_sync_interval_sec, periodic_sync_interval_sec_osc: cfg.periodic_sync_interval_sec_osc, osc_info_supplement_ms: cfg.osc_info_supplement_ms, osc: pickOscForPersistence(cfg.osc), ui: cfg.ui || defaults.ui, audioRouting: cfg.audioRouting || defaults.audioRouting, offline_mode: cfg.offline_mode, dmx: { ...defaults.dmx, ...(cfg.dmx || {}) }, casparServer: cfg.casparServer || defaults.casparServer, companion: cfg.companion || { host: '127.0.0.1', port: 8000 }, pixelhue: { ...defaults.pixelhue, ...(cfg.pixelhue || {}) }, tandemTopology: normalizeTandemTopology(cfg.tandemTopology), deviceGraph: normalizeDeviceGraph(cfg.deviceGraph), gpuPhysicalTopology: Array.isArray(cfg.gpuPhysicalTopology) && cfg.gpuPhysicalTopology.length ? cfg.gpuPhysicalTopology : defaults.gpuPhysicalTopology, rtmp: normalizeRtmpConfig(cfg.rtmp), usbIngest: { ...defaults.usbIngest, ...(cfg.usbIngest || {}) }, streamingChannel: { ...defaults.streamingChannel, ...(cfg.streamingChannel || {}) }, streamOutputs: Array.isArray(cfg.streamOutputs) ? cfg.streamOutputs : (Array.isArray(cur.streamOutputs) ? cur.streamOutputs : []), recordOutputs: Array.isArray(cfg.recordOutputs) ? cfg.recordOutputs : (Array.isArray(cur.recordOutputs) ? cur.recordOutputs : (Array.isArray(defaults.recordOutputs) ? defaults.recordOutputs : [])), audioOutputs: Array.isArray(cfg.audioOutputs) ? cfg.audioOutputs : (Array.isArray(cur.audioOutputs) ? cur.audioOutputs : []) }
		delete newConfig.streaming._effectiveBasePort; delete newConfig.streaming._casparHost
		for (const k of SYSTEM_DISPLAY_KEYS) { if (settings[k] !== undefined) { if (cfg[k] !== undefined) newConfig[k] = cfg[k]; else delete newConfig[k] } }
		ctx.configManager.save(newConfig)
	}

	let oscRestarted = false; if (settings.osc && typeof ctx.restartOscSubsystem === 'function') { ctx.restartOscSubsystem(); oscRestarted = true }
	let sideEffects = []
	if (oldC.host !== cfg.caspar.host || oldC.port !== cfg.caspar.port) { if (ctx.casparConnection) { sideEffects.push('Reconnecting to CasparCG…'); ctx.casparConnection.reconnect(cfg.caspar.host, cfg.caspar.port) } }
	const sChanged = (oldS.enabled !== cfg.streaming.enabled || oldS.quality !== cfg.streaming.quality || oldS.basePort !== cfg.streaming.basePort || oldS.hardware_accel !== cfg.streaming.hardware_accel || oldS.captureMode !== cfg.streaming.captureMode || oldS.ndiNamingMode !== cfg.streaming.ndiNamingMode || oldS.ndiSourcePattern !== cfg.streaming.ndiSourcePattern || JSON.stringify(oldS.ndiChannelNames || {}) !== JSON.stringify(cfg.streaming.ndiChannelNames || {}) || oldS.localCaptureDevice !== cfg.streaming.localCaptureDevice || oldS.x11Display !== cfg.streaming.x11Display || oldS.drmDevice !== cfg.streaming.drmDevice || oldS.go2rtcLogLevel !== cfg.streaming.go2rtcLogLevel || oldS.autoRelocateBasePort !== cfg.streaming.autoRelocateBasePort)
	if (sChanged) { sideEffects.push('Applying streaming changes…'); if (typeof ctx.toggleStreaming === 'function') await ctx.toggleStreaming(cfg.streaming.enabled); else if (typeof ctx.restartStreaming === 'function') await ctx.restartStreaming() }
	if (settings.osc_info_supplement_ms !== undefined) startOscPlaybackInfoSupplement(ctx)
	if (typeof ctx._wsBroadcast === 'function' && typeof ctx.getState === 'function') { const st = ctx.getState(); if (st?.channelMap) ctx._wsBroadcast('change', { path: 'channelMap', value: st.channelMap }) }

	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, sideEffects, oscRestarted, ...(warnings.length ? { warnings } : {}) }) }
}

module.exports = { handlePost }
