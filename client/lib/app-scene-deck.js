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

/* WO-334: content memo — a deck payload identical to the last one sent is an echo (typically
 * a reaction to a server broadcast that originated from our own sync, or a two-client
 * ping-pong) and re-sending it feeds the storm. Cleared on (re)connect so a restarted server
 * still gets the deck. flushSceneDeckSync stays unconditional (pre-take correctness beats
 * a duplicate frame). */
let lastSentDeckJson = null
export function resetSceneDeckSyncMemo() {
	lastSentDeckJson = null
}

function sendSceneDeckSync(ws, sceneState, { force } = {}) {
	const data = buildSceneDeckPayload(sceneState)
	const json = JSON.stringify(data)
	if (!force && json === lastSentDeckJson) return
	lastSentDeckJson = json
	try { ws.send({ type: 'scene_deck_sync', data }) } catch {}
}

let sceneDeckSyncTimer = null
export function scheduleSceneDeckSync(ws, sceneState) {
	if (!canPushProjectToServer()) return
	if (sceneDeckSyncTimer) clearTimeout(sceneDeckSyncTimer)
	sceneDeckSyncTimer = setTimeout(() => {
		sceneDeckSyncTimer = null
		sendSceneDeckSync(ws, sceneState)
	}, 100)
}

/** Send deck sync immediately (e.g. before program take so server resolves sceneId). */
export function flushSceneDeckSync(ws, sceneState) {
	if (!canPushProjectToServer()) return
	if (sceneDeckSyncTimer) {
		clearTimeout(sceneDeckSyncTimer)
		sceneDeckSyncTimer = null
	}
	sendSceneDeckSync(ws, sceneState, { force: true })
}
