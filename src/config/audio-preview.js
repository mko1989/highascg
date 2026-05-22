'use strict'

const { readCasparSetting } = require('./routing-map')

/**
 * @param {object} config
 * @returns {{ enabled: boolean, bus: string, screenIndex: number, deviceName: string, soloLayerStart: number, soloLayerCount: number, defaultSource: string }}
 */
function normalizeAudioPreview(config) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const ar =
		config?.audioRouting?.audioPreview && typeof config.audioRouting.audioPreview === 'object'
			? config.audioRouting.audioPreview
			: {}
	const flatEnabled =
		cs.audio_preview_enabled === true ||
		cs.audio_preview_enabled === 'true' ||
		ar.enabled === true ||
		ar.enabled === 'true'
	const busRaw = String(
		ar.bus ?? cs.audio_preview_bus ?? readCasparSetting(config, 'audio_preview_bus') ?? 'preview_1'
	).toLowerCase()
	const bus = busRaw === 'multiview' || busRaw === 'mvr' ? 'multiview' : 'preview_1'
	const screenIndex = Math.max(1, parseInt(String(ar.screenIndex ?? cs.audio_preview_screen ?? 1), 10) || 1)
	const deviceName = String(ar.deviceName ?? cs.audio_preview_device_name ?? '').trim()
	const soloLayerStart = Math.max(1, parseInt(String(ar.soloLayerStart ?? cs.audio_preview_solo_layer_start ?? 1), 10) || 1)
	const soloLayerCount = Math.min(16, Math.max(1, parseInt(String(ar.soloLayerCount ?? cs.audio_preview_solo_layer_count ?? 8), 10) || 8))
	const defaultSource = String(ar.defaultSource ?? cs.audio_preview_default_source ?? (bus === 'multiview' ? 'multiview' : 'preview_1')).toLowerCase()
	return {
		enabled: flatEnabled,
		bus,
		screenIndex,
		deviceName,
		soloLayerStart,
		soloLayerCount,
		defaultSource,
	}
}

/**
 * Caspar channel used for headphone preview / solo (system-audio on that channel).
 * @param {object} config
 * @param {ReturnType<import('./routing-map').getChannelMap>} map
 * @returns {number|null}
 */
function resolveAudioPreviewChannel(config, map) {
	const ap = normalizeAudioPreview(config)
	if (!ap.enabled) return map.monitorCh ?? null
	if (ap.bus === 'multiview') return map.multiviewCh ?? null
	const ch = map.previewCh(ap.screenIndex)
	return ch != null ? ch : map.previewCh(1)
}

/**
 * Default route played on preview bus when solo is cleared.
 * @param {object} config
 * @param {ReturnType<import('./routing-map').getChannelMap>} map
 * @returns {string|null}
 */
function resolveAudioPreviewDefaultRoute(config, map) {
	const ap = normalizeAudioPreview(config)
	const src = ap.defaultSource
	if (src === 'multiview' && map.multiviewCh != null) {
		const { getRouteString } = require('./routing-map')
		return getRouteString(map.multiviewCh)
	}
	const pm = src.match(/^program[_-]?(\d+)$/)
	if (pm) {
		const { getRouteString } = require('./routing-map')
		const i = parseInt(pm[1], 10)
		if (i >= 1 && i <= map.screenCount) return getRouteString(map.programCh(i))
	}
	const pr = src.match(/^preview[_-]?(\d+)$/) || src === 'preview_1' || src === 'prv'
	const i = pr && pr[1] != null ? parseInt(pr[1], 10) : ap.screenIndex
	const p = map.previewCh(i) || map.previewCh(1)
	if (p != null) {
		const { getRouteString } = require('./routing-map')
		return getRouteString(p)
	}
	return null
}

/**
 * Flat keys for config generator (preview / multiview system-audio).
 * @param {Record<string, unknown>} merged
 */
function applyAudioPreviewToGeneratorConfig(merged) {
	const ap = normalizeAudioPreview(merged)
	if (!ap.enabled) return
	if (ap.bus === 'multiview') {
		merged.multiview_system_audio_enabled = true
		merged.multiview_system_audio_device_name = ap.deviceName
	} else {
		const n = ap.screenIndex
		merged[`screen_${n}_preview_system_audio_enabled`] = true
		merged[`screen_${n}_preview_system_audio_device_name`] = ap.deviceName
	}
}

module.exports = {
	normalizeAudioPreview,
	resolveAudioPreviewChannel,
	resolveAudioPreviewDefaultRoute,
	applyAudioPreviewToGeneratorConfig,
}
