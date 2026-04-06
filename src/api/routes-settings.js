/**
 * Settings API — handles getting, saving, and applying app-wide configuration.
 * @see 05_WO_LIVE_PREVIEW_SETTINGS.md Phase 4
 */

'use strict'

const defaults = require('../../config/default')
const { normalizeOscConfig } = require('../osc/osc-config')
const { startOscPlaybackInfoSupplement } = require('../utils/periodic-sync')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getConnectedDisplayNames } = require('../utils/hardware-info')
const { applyX11Layout, restartDisplayManager } = require('../utils/os-config')

function pickOscForPersistence(o) {
	return {
		enabled: o.enabled,
		listenPort: o.listenPort,
		listenAddress: o.listenAddress,
		peakHoldMs: o.peakHoldMs,
		emitIntervalMs: o.emitIntervalMs,
		staleTimeoutMs: o.staleTimeoutMs,
		wsDeltaBroadcast: o.wsDeltaBroadcast,
	}
}

/**
 * @param {string} path
 * @param {object} ctx
 */
async function handleGet(path, ctx) {
	if (path !== '/api/settings') return null

	// Return current live config merged with defaults
	// Note: some fields might come from process.env but we want to show current effective values
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			caspar: {
				host: ctx.config.caspar.host,
				port: ctx.config.caspar.port,
			},
			streaming: {
				enabled: ctx.config.streaming.enabled,
				quality: ctx.config.streaming.quality,
				basePort: ctx.config.streaming.basePort,
				ffmpeg_path: ctx.config.streaming.ffmpeg_path,
				hardware_accel: ctx.config.streaming.hardware_accel,
				captureMode: ctx.config.streaming.captureMode || 'auto',
				ndiNamingMode: ctx.config.streaming.ndiNamingMode || 'auto',
				ndiSourcePattern: ctx.config.streaming.ndiSourcePattern || 'CasparCG Channel {ch}',
				ndiChannelNames: ctx.config.streaming.ndiChannelNames || {},
				localCaptureDevice: ctx.config.streaming.localCaptureDevice || 'auto',
				x11Display: ctx.config.streaming.x11Display || ':0',
				drmDevice: ctx.config.streaming.drmDevice || '/dev/dri/card0',
			},
			server: {
				httpPort: ctx.config.server.httpPort,
				bindAddress: ctx.config.server.bindAddress,
			},
			osc: {
				enabled: ctx.config.osc.enabled,
				listenPort: ctx.config.osc.listenPort,
				listenAddress: ctx.config.osc.listenAddress,
				peakHoldMs: ctx.config.osc.peakHoldMs,
				emitIntervalMs: ctx.config.osc.emitIntervalMs,
				staleTimeoutMs: ctx.config.osc.staleTimeoutMs,
				wsDeltaBroadcast: ctx.config.osc.wsDeltaBroadcast,
			},
			ui: ctx.config.ui || defaults.ui,
			audioRouting: { ...(defaults.audioRouting || {}), ...(ctx.config.audioRouting || {}) },
			periodic_sync_interval_sec: ctx.config.periodic_sync_interval_sec,
			periodic_sync_interval_sec_osc: ctx.config.periodic_sync_interval_sec_osc,
			osc_info_supplement_ms: ctx.config.osc_info_supplement_ms ?? defaults.osc_info_supplement_ms,
			channelMap: ctx.getState().channelMap, // Includes programChannels, previewChannels, etc.
			offline_mode: !!ctx.config.offline_mode,
			casparServer: { ...(defaults.casparServer || {}), ...(ctx.config.casparServer || {}) },
		}),
	}
}

/**
 * Handle Hardware Discovery API.
 * @param {string} path
 */
async function handleHardwareGet(path) {
	if (path === '/api/hardware/displays') {
		const displays = getConnectedDisplayNames()
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ displays }) }
	}
	return null
}

/**
 * @param {string} path
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (path !== '/api/settings') return null

	const settings = parseBody(body)
	if (!settings || typeof settings !== 'object') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid settings object' }) }
	}

	const oldCaspar = { ...ctx.config.caspar }
	const oldStreaming = { ...ctx.config.streaming }

	// Update live config object
	if (settings.caspar) {
		if (settings.caspar.host) ctx.config.caspar.host = settings.caspar.host
		if (settings.caspar.port) ctx.config.caspar.port = parseInt(settings.caspar.port, 10)
	}
	if (settings.streaming) {
		const s = settings.streaming
		if (s.enabled !== undefined) ctx.config.streaming.enabled = !!s.enabled
		if (s.quality) ctx.config.streaming.quality = s.quality
		if (s.basePort) ctx.config.streaming.basePort = parseInt(s.basePort, 10)
		if (s.hardware_accel !== undefined) ctx.config.streaming.hardware_accel = s.hardware_accel
		if (s.captureMode !== undefined && s.captureMode !== '') ctx.config.streaming.captureMode = s.captureMode
		if (s.ndiNamingMode !== undefined && s.ndiNamingMode !== '') ctx.config.streaming.ndiNamingMode = s.ndiNamingMode
		if (s.ndiSourcePattern !== undefined) ctx.config.streaming.ndiSourcePattern = s.ndiSourcePattern
		if (s.ndiChannelNames !== undefined && typeof s.ndiChannelNames === 'object') {
			ctx.config.streaming.ndiChannelNames = { ...s.ndiChannelNames }
		}
		if (s.localCaptureDevice !== undefined && s.localCaptureDevice !== '') {
			ctx.config.streaming.localCaptureDevice = s.localCaptureDevice
		}
		if (s.x11Display !== undefined && s.x11Display !== '') {
			ctx.config.streaming.x11Display = s.x11Display
		}
		if (s.drmDevice !== undefined && s.drmDevice !== '') {
			ctx.config.streaming.drmDevice = s.drmDevice
		}
	}
	if (settings.periodic_sync_interval_sec !== undefined) {
		ctx.config.periodic_sync_interval_sec = parseInt(settings.periodic_sync_interval_sec, 10)
	}
	if (settings.periodic_sync_interval_sec_osc !== undefined) {
		ctx.config.periodic_sync_interval_sec_osc = parseInt(settings.periodic_sync_interval_sec_osc, 10)
	}
	if (settings.osc_info_supplement_ms !== undefined) {
		const v = settings.osc_info_supplement_ms
		if (v === '' || v === null) ctx.config.osc_info_supplement_ms = null
		else {
			const n = parseInt(String(v), 10)
			ctx.config.osc_info_supplement_ms = Number.isFinite(n) ? n : null
		}
	}

	if (settings.osc && typeof settings.osc === 'object') {
		const o = settings.osc
		if (o.listenPort != null && o.listenPort !== '') ctx.config.osc.listenPort = parseInt(String(o.listenPort), 10)
		if (o.listenAddress != null && String(o.listenAddress).trim() !== '') {
			ctx.config.osc.listenAddress = String(o.listenAddress).trim()
		}
		if (o.peakHoldMs != null && o.peakHoldMs !== '') ctx.config.osc.peakHoldMs = parseInt(String(o.peakHoldMs), 10)
		if (o.emitIntervalMs != null && o.emitIntervalMs !== '') ctx.config.osc.emitIntervalMs = parseInt(String(o.emitIntervalMs), 10)
		if (o.staleTimeoutMs != null && o.staleTimeoutMs !== '') ctx.config.osc.staleTimeoutMs = parseInt(String(o.staleTimeoutMs), 10)
		if (o.wsDeltaBroadcast !== undefined) ctx.config.osc.wsDeltaBroadcast = !!o.wsDeltaBroadcast
		ctx.config.osc = normalizeOscConfig(ctx.config)
	}

	if (settings.ui && typeof settings.ui === 'object') {
		ctx.config.ui = { ...defaults.ui, ...(ctx.config.ui || {}), ...settings.ui }
	}

	if (settings.audioRouting && typeof settings.audioRouting === 'object') {
		ctx.config.audioRouting = { ...(defaults.audioRouting || {}), ...(ctx.config.audioRouting || {}), ...settings.audioRouting }
	}

	if (settings.offline_mode !== undefined) {
		ctx.config.offline_mode = !!settings.offline_mode
	}

	if (settings.casparServer && typeof settings.casparServer === 'object') {
		ctx.config.casparServer = {
			...(defaults.casparServer || {}),
			...(ctx.config.casparServer || {}),
			...settings.casparServer,
		}
	}

	// Persist to file (Refactored T1.2)
	if (ctx.configManager) {
		const newConfig = {
			...ctx.configManager.get(),
			caspar: ctx.config.caspar,
			streaming: ctx.config.streaming,
			periodic_sync_interval_sec: ctx.config.periodic_sync_interval_sec,
			periodic_sync_interval_sec_osc: ctx.config.periodic_sync_interval_sec_osc,
			osc_info_supplement_ms: ctx.config.osc_info_supplement_ms,
			osc: pickOscForPersistence(ctx.config.osc),
			ui: ctx.config.ui || defaults.ui,
			audioRouting: ctx.config.audioRouting || defaults.audioRouting,
			offline_mode: ctx.config.offline_mode,
			casparServer: ctx.config.casparServer || defaults.casparServer,
		}
		ctx.configManager.save(newConfig)
	}

	let oscRestarted = false
	if (settings.osc && typeof settings.osc === 'object' && typeof ctx.restartOscSubsystem === 'function') {
		ctx.restartOscSubsystem()
		oscRestarted = true
	}

	// Apply side effects
	let sideEffects = []

	// 1. Caspar connection change
	if (oldCaspar.host !== ctx.config.caspar.host || oldCaspar.port !== ctx.config.caspar.port) {
		if (ctx.casparConnection) {
			sideEffects.push('Reconnecting to CasparCG…')
			ctx.casparConnection.reconnect(ctx.config.caspar.host, ctx.config.caspar.port)
		}
	}

	// 2. Streaming change
	const streamingChanged = (
		oldStreaming.enabled !== ctx.config.streaming.enabled ||
		oldStreaming.quality !== ctx.config.streaming.quality ||
		oldStreaming.basePort !== ctx.config.streaming.basePort ||
		oldStreaming.hardware_accel !== ctx.config.streaming.hardware_accel ||
		oldStreaming.captureMode !== ctx.config.streaming.captureMode ||
		oldStreaming.ndiNamingMode !== ctx.config.streaming.ndiNamingMode ||
		oldStreaming.ndiSourcePattern !== ctx.config.streaming.ndiSourcePattern ||
		JSON.stringify(oldStreaming.ndiChannelNames || {}) !== JSON.stringify(ctx.config.streaming.ndiChannelNames || {}) ||
		oldStreaming.localCaptureDevice !== ctx.config.streaming.localCaptureDevice ||
		oldStreaming.x11Display !== ctx.config.streaming.x11Display ||
		oldStreaming.drmDevice !== ctx.config.streaming.drmDevice
	)
	if (streamingChanged) {
		sideEffects.push('Applying streaming changes…')
		if (typeof ctx.toggleStreaming === 'function') {
			await ctx.toggleStreaming(ctx.config.streaming.enabled)
		} else if (typeof ctx.restartStreaming === 'function') {
			await ctx.restartStreaming()
		}
	}

	if (settings.osc_info_supplement_ms !== undefined) {
		startOscPlaybackInfoSupplement(ctx)
	}

	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, sideEffects, oscRestarted }),
	}
}

/**
 * Handle OS-specific Apply logic.
 * @param {string} path
 * @param {object} ctx
 */
async function handleOsPost(path, ctx) {
	if (path === '/api/settings/apply-os') {
		const config = ctx.configManager ? ctx.configManager.get() : ctx.config
		applyX11Layout(config)
		const dmRestarted = restartDisplayManager()
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, dmRestarted }) }
	}
	return null
}

module.exports = { handleGet, handlePost, handleHardwareGet, handleOsPost }
