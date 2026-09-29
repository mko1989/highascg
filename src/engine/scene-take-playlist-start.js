/**
 * WO-581: which playlist item a take stages FIRST.
 *
 * The operator picks the start item in the Playlists panel (set_start / step_preview, WO-347 /
 * WO-371) — the look recalled on PRV shows it, and the take to PGM must go out ON it. Before
 * this, buildTakeJobs always loaded item 0 and setupLayerPlaylists hopped to the start item
 * 400 ms later (item 0 flashed on air and its timer/AUTO preload was already armed).
 * `playlistStartIndices` is keyed `${sceneId}-${layerNumber}` with no channel (pre-playout,
 * WO-347), so PRV recall and PGM take read the same value.
 */

'use strict'

/**
 * @param {{ playlistStartIndices?: Record<string, number> }} self
 * @param {string} sceneId
 * @param {{ layerNumber: number|string, playlist?: unknown[] }} layer
 * @returns {number} a valid index into layer.playlist (0 when unset/out of range)
 */
function resolvePlaylistStartIndex(self, sceneId, layer) {
	const len = Array.isArray(layer?.playlist) ? layer.playlist.length : 0
	const idx = (self?.playlistStartIndices || {})[`${sceneId}-${layer?.layerNumber}`]
	return Number.isInteger(idx) && idx >= 0 && idx < len ? idx : 0
}

module.exports = { resolvePlaylistStartIndex }
