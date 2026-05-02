/**
 * Parked switcher-related Device View actions (PixelHue and similar).
 *
 * This module intentionally isolates switcher integrations while Device View
 * is focused on Caspar/HighAs host setup only.
 *
 * SWITCHER INTEGRATION STATUS: DISABLED (PARKED)
 * - Do not import from active Caspar-only Device View flow.
 * - Re-enable only when the switcher path is redesigned end-to-end.
 */
import { pixelhueApi } from '../lib/pixelhue-api.js'

export async function getPixelhueDeviceData() {
	const [status, screens, presets, layers, interfaces, layerPresets, sourceBackup] = await Promise.all([
		pixelhueApi.getStatus(),
		pixelhueApi.getScreens(),
		pixelhueApi.getPresets(),
		pixelhueApi.getLayers(),
		pixelhueApi.getInterfaces(),
		pixelhueApi.getLayerPresets(),
		pixelhueApi.getSourceBackup().catch(() => null),
	])
	return {
		status: status || {},
		screens: Array.isArray(screens) ? screens : [],
		presets: Array.isArray(presets) ? presets : [],
		layers: Array.isArray(layers) ? layers : [],
		interfaces: Array.isArray(interfaces) ? interfaces : [],
		layerPresets: Array.isArray(layerPresets) ? layerPresets : [],
		sourceBackup: sourceBackup || null,
	}
}

export async function applyPixelhuePresetToRegion(preset, targetRegion) {
	const serial = Number(preset?.serial) || 1
	const presetId = String(preset?.guid || preset?.presetId || '').trim()
	if (!presetId) throw new Error('Preset guid is missing')
	const body = {
		auxiliary: {
			keyFrame: { enable: 1 },
			switchEffect: { type: 1, time: 500 },
			swapEnable: 1,
			effect: { enable: 1 },
		},
		serial,
		targetRegion: Number(targetRegion) === 2 ? 2 : 4,
		presetId,
	}
	return await pixelhueApi.setPresetApply(body)
}

export async function takePixelhueScreen(screen, opts = {}) {
	const direction = Number.isFinite(Number(opts?.direction)) ? Number(opts.direction) : 0
	const effectSelect = Number.isFinite(Number(opts?.effectSelect)) ? Number(opts.effectSelect) : 0
	const swapEnable = opts?.swapEnable === false ? 0 : 1
	const switchType = Number.isFinite(Number(opts?.switchType)) ? Number(opts.switchType) : 1
	const switchTime = Number.isFinite(Number(opts?.switchTime)) ? Number(opts.switchTime) : 500
	const body = [{
		direction,
		effectSelect,
		screenGuid: screen?.guid,
		screenId: Number(screen?.screenId),
		screenName: String(screen?.general?.name || screen?.screenName || ''),
		swapEnable,
		switchEffect: { type: switchType, time: switchTime },
	}]
	return await pixelhueApi.setTake(body)
}

export async function cutPixelhueScreen(screen, opts = {}) {
	const direction = Number.isFinite(Number(opts?.direction)) ? Number(opts.direction) : 0
	const swapEnable = opts?.swapEnable === false ? 0 : 1
	const body = [{ direction, screenId: Number(screen?.screenId), swapEnable }]
	return await pixelhueApi.setCut(body)
}

export async function setPixelhueScreenFtb(screenId, enable, time = 500) {
	return await pixelhueApi.setFtb([{ screenId: Number(screenId), ftb: { enable: enable ? 1 : 0, time: Number(time) || 500 } }])
}

export async function setPixelhueScreenFreeze(screenId, enable) {
	return await pixelhueApi.setFreeze([{ screenId: Number(screenId), freeze: enable ? 1 : 0 }])
}

export async function setPixelhueFtbAll(enable, time = 500) {
	const screens = await pixelhueApi.getScreens()
	const body = (Array.isArray(screens) ? screens : []).map((s) => ({
		screenId: Number(s?.screenId),
		ftb: { enable: enable ? 1 : 0, time: Number(time) || 500 },
	}))
	return await pixelhueApi.setFtb(body)
}

export async function setPixelhueFreezeAll(enable) {
	const screens = await pixelhueApi.getScreens()
	const body = (Array.isArray(screens) ? screens : []).map((s) => ({
		screenId: Number(s?.screenId),
		freeze: enable ? 1 : 0,
	}))
	return await pixelhueApi.setFreeze(body)
}

export async function selectPixelhueLayer(layerId) {
	const layers = await pixelhueApi.getLayers()
	const chosen = Number(layerId)
	const body = (Array.isArray(layers) ? layers : [])
		.map((l) => ({ layerId: Number(l?.layerId), selected: Number(l?.layerId) === chosen ? 1 : 0 }))
		.filter((x) => Number.isFinite(x.layerId) && x.layerId > 0)
	return await pixelhueApi.setLayerSelect(body)
}

export async function setPixelhueLayerSource(layerId, interfaceId, interfaceType, connectorType) {
	const body = [
		{
			layerId: Number(layerId),
			source: {
				general: {
					sourceId: Number(interfaceId),
					sourceType: Number(interfaceType) || 0,
					connectorType: Number(connectorType) || 0,
				},
			},
		},
	]
	return await pixelhueApi.setLayerSource(body)
}

export async function setPixelhueLayerZorder(layerId, to) {
	const body = [{ layerId: Number(layerId), zorder: { type: 1, para: Number(to) || 0 } }]
	return await pixelhueApi.setLayerZorder(body)
}

export async function setPixelhueLayerWindow(layerId, x, y, width, height) {
	const body = [
		{
			layerId: Number(layerId),
			window: {
				x: Number(x) || 0,
				y: Number(y) || 0,
				width: Number(width) || 0,
				height: Number(height) || 0,
			},
		},
	]
	return await pixelhueApi.setLayerWindow(body)
}

export async function setPixelhueLayerUmdText(layerId, text) {
	const body = [{ layerId: Number(layerId), UMD: [{ sourceType: 0, text: String(text || '') }] }]
	return await pixelhueApi.setLayerUmd(body)
}

export async function applyPixelhueLayerPreset(layerId, layerPreset) {
	const body = [{ layerIds: [{ layerId: Number(layerId) }], layerPreset }]
	return await pixelhueApi.setLayerPresetApply(body)
}

export async function setPixelhueSourceBackupRaw(payload) {
	return await pixelhueApi.setSourceBackup(payload)
}

