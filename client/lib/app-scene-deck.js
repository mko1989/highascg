/**
 * Scene Deck sync logic (Companion support).
 */
import { canPushProjectToServer } from './server-project-sync.js'

export function buildSceneDeckPayload(sceneState) {
	const prv = sceneState.previewSceneId
	const scenes = Array.isArray(sceneState.scenes) ? sceneState.scenes : []
	return {
		looks: scenes.map(s => ({
			id: String(s.id), name: String(s.name || 'Untitled look'),
			mainScope: s.mainScope ? String(s.mainScope) : 'all'
		})),
		sceneSnapshots: scenes.map(s => JSON.parse(JSON.stringify(s))),
		previewSceneId: prv ? String(prv) : null,
		layerPresets: JSON.parse(JSON.stringify(Array.isArray(sceneState.layerPresets) ? sceneState.layerPresets : [])),
		lookPresets: JSON.parse(JSON.stringify(Array.isArray(sceneState.lookPresets) ? sceneState.lookPresets : []))
	}
}

let sceneDeckSyncTimer = null
export function scheduleSceneDeckSync(ws, sceneState) {
	if (!canPushProjectToServer()) return
	if (sceneDeckSyncTimer) clearTimeout(sceneDeckSyncTimer)
	sceneDeckSyncTimer = setTimeout(() => {
		sceneDeckSyncTimer = null
		try { ws.send({ type: 'scene_deck_sync', data: buildSceneDeckPayload(sceneState) }) } catch {}
	}, 100)
}

/** Send deck sync immediately (e.g. before program take so server resolves sceneId). */
export function flushSceneDeckSync(ws, sceneState) {
	if (!canPushProjectToServer()) return
	if (sceneDeckSyncTimer) {
		clearTimeout(sceneDeckSyncTimer)
		sceneDeckSyncTimer = null
	}
	try { ws.send({ type: 'scene_deck_sync', data: buildSceneDeckPayload(sceneState) }) } catch {}
}
