/**
 * playlist-live-sync.js — owner 27.07: playlist edits made while the look is LIVE must reach the
 * running engine (the server's OSC advance loop reads liveSceneState, not the project). Fire and
 * forget after every playlist mutation; the server patches only channels where the scene is live
 * (patched:0 otherwise) and broadcasts the updated live map.
 */

import { api } from './api-client.js'

/** @param {string} sceneId @param {number|string} layerNumber @param {Array<object>} playlist */
export function pushLivePlaylistUpdate(sceneId, layerNumber, playlist) {
	if (!sceneId || !Array.isArray(playlist)) return
	void api
		.post('/api/playlist/control', { action: 'update_live', sceneId, layerNumber: Number(layerNumber), playlist })
		.catch(() => {})
}
