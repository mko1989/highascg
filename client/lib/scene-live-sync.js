/**
 * Keep client scene.live / per-main preview slots aligned with server after AMCP compose pushes.
 */

import { api } from './api-client.js'

/**
 * @param {Record<string, { sceneId?: string, scene?: object }>} raw
 * @returns {Record<string, { sceneId: string, scene?: object }>}
 */
function normalizeSceneLiveEntries(raw) {
	const out = {}
	if (!raw || typeof raw !== 'object') return out
	for (const [k, v] of Object.entries(raw)) {
		if (!v || typeof v !== 'object' || v.sceneId == null) continue
		out[k] = { sceneId: String(v.sceneId), scene: v.scene }
	}
	return out
}

/**
 * Register the look currently on PRV for one main (metadata only — no AMCP).
 * @param {string} sceneId
 * @param {number} mainIdx
 * @param {{ sceneState?: object, stateStore?: object }} [opts]
 */
export async function syncPreviewLiveToServer(sceneId, mainIdx, opts = {}) {
	const { sceneState, stateStore } = opts
	if (!sceneId) return null
	const mIdx = Math.max(0, parseInt(String(mainIdx), 10) || 0)
	const res = await api.post('/api/scene/live/preview', {
		sceneId: String(sceneId),
		mainIndex: mIdx,
	})
	const channels = normalizeSceneLiveEntries(res?.sceneLive)
	if (stateStore && Object.keys(channels).length > 0) {
		const merged = { ...(stateStore.getState()?.scene?.live || {}), ...channels }
		stateStore.applyChange('scene.live', merged)
		sceneState?.applyServerLiveChannels(merged, stateStore.getState()?.channelMap)
	}
	return res
}

/**
 * Pull authoritative scene.live from server into stateStore + sceneState.
 * @param {object} sceneState
 * @param {object} stateStore
 */
export async function refreshSceneLiveFromServer(sceneState, stateStore) {
	const data = await api.get('/api/scene/live')
	const channels = normalizeSceneLiveEntries(data?.channels)
	if (Object.keys(channels).length === 0) return data
	stateStore.applyChange('scene.live', channels)
	sceneState.applyServerLiveChannels(channels, stateStore.getState()?.channelMap)
	return data
}

/**
 * Clear PRV look registration on server scene.live (metadata only — no AMCP).
 * @param {number} mainIdx
 * @param {{ sceneState?: object, stateStore?: object }} [opts]
 */
export async function clearPreviewLiveOnServer(mainIdx, opts = {}) {
	const { sceneState, stateStore } = opts
	const mIdx = Math.max(0, parseInt(String(mainIdx), 10) || 0)
	const res = await api.post('/api/scene/live/preview/clear', { mainIndex: mIdx })
	if (stateStore && res?.sceneLive != null) {
		const channels = normalizeSceneLiveEntries(res.sceneLive)
		stateStore.applyChange('scene.live', channels)
		sceneState?.applyServerLiveChannels(channels, stateStore.getState()?.channelMap)
	}
	return res
}
