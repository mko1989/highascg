/**
 * Device View refresh helpers — avoid full GET on every edit (WO-82 Phase D).
 */
import { settingsState } from './settings-state.js'

/** @typedef {'full' | 'live' | 'settings' | 'none'} DeviceViewRefreshMode */

/**
 * Merge POST /api/device-view or /api/settings response fields into the in-memory payload.
 * @param {object | null} lastPayload
 * @param {object | null | undefined} res
 * @param {object | null} [currentSettings]
 */
export function mergeDeviceViewMutation(lastPayload, res, currentSettings = null) {
	if (!lastPayload || !res || typeof res !== 'object') return lastPayload
	if (res.graph) lastPayload.graph = res.graph
	if (res.screenDestinations) {
		lastPayload.screenDestinations = res.screenDestinations
		if (currentSettings) currentSettings.screenDestinations = res.screenDestinations
	}
	if (Array.isArray(res.audioOutputs)) lastPayload.audioOutputs = res.audioOutputs
	if (Array.isArray(res.mappingTemplates)) lastPayload.mappingTemplates = res.mappingTemplates
	return lastPayload
}

/**
 * Sync cached settings into device-view state without GET /api/settings.
 * @param {object | null} lastPayload
 * @param {object | null} currentSettings
 * @returns {{ lastPayload: object | null, currentSettings: object | null }}
 */
export function syncDeviceViewSettingsCache(lastPayload, currentSettings) {
	const s = settingsState.getSettings?.() || settingsState.settings
	if (!s || typeof s !== 'object') return { lastPayload, currentSettings: currentSettings }
	const nextSettings = { ...s }
	const nextPayload = lastPayload ? { ...lastPayload } : null
	if (nextPayload) {
		if (s.gpuPhysicalTopology != null) nextPayload.gpuPhysicalTopology = s.gpuPhysicalTopology
		if (s.screenDestinations != null) nextPayload.screenDestinations = s.screenDestinations
		if (Array.isArray(s.audioOutputs)) nextPayload.audioOutputs = s.audioOutputs
		if (Array.isArray(s.streamOutputs)) nextPayload.streamOutputs = s.streamOutputs
		if (Array.isArray(s.recordOutputs)) nextPayload.recordOutputs = s.recordOutputs
		if (Array.isArray(s.mappingTemplates)) nextPayload.mappingTemplates = s.mappingTemplates
		nextPayload._settings = nextSettings
	}
	return { lastPayload: nextPayload, currentSettings: nextSettings }
}

/**
 * @param {DeviceViewRefreshMode | { refresh?: DeviceViewRefreshMode }} [opts]
 * @returns {DeviceViewRefreshMode}
 */
export function normalizeRefreshMode(opts) {
	if (opts == null) return 'full'
	if (typeof opts === 'string') return opts
	if (typeof opts === 'object' && opts.refresh) return opts.refresh
	return 'full'
}
