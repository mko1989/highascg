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

/* WO-334 (rev 2026-07-26): content memo — a deck payload identical to the last one sent within
 * ECHO_WINDOW_MS is an echo (a reaction to a server broadcast of our own sync, or a two-client
 * ping-pong at broadcast speed) and re-sending it feeds the storm. The window is SHORT on
 * purpose: the first version suppressed identical payloads forever, which silently blocked
 * remote-laptop edits whenever a send landed while the server rejected/missed the merge.
 * Cleared on (re)connect; flushSceneDeckSync stays unconditional. */
const ECHO_WINDOW_MS = 2000
let lastSentDeckJson = null
let lastSentDeckAt = 0
export function resetSceneDeckSyncMemo() {
	lastSentDeckJson = null
	lastSentDeckAt = 0
}

function sendSceneDeckSync(ws, sceneState, { force } = {}) {
	const data = buildSceneDeckPayload(sceneState)
	const json = JSON.stringify(data)
	if (!force && json === lastSentDeckJson && Date.now() - lastSentDeckAt < ECHO_WINDOW_MS) return
	lastSentDeckJson = json
	lastSentDeckAt = Date.now()
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
