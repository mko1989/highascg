/**
 * Scene Deck sync logic (Companion support).
 */
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
	if (sceneDeckSyncTimer) clearTimeout(sceneDeckSyncTimer)
	sceneDeckSyncTimer = setTimeout(() => {
		sceneDeckSyncTimer = null
		try { ws.send({ type: 'scene_deck_sync', data: buildSceneDeckPayload(sceneState) }) } catch {}
	}, 100)
}
