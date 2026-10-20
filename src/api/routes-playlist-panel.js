'use strict'

/**
 * WO-603 — the Playlists panel's rules, decided in node (owner D directive) instead of in each client:
 *   - every item of GET /api/playlist/state carries `timeless` (isTimelessPlaylistItem, the engine's own rule) and
 *     `missing` (clipMissing against the server media list — web media-exists.js); each playlist carries
 *     `timelessSecs` (the duration already set on its timeless items, else 20 — web timelessSecsOf);
 *   - "Set all" (POST /api/playlist/control action:'set_timeless') plans the new playlist from the look and patches
 *     the running engine's copy where the look is live. The web patched the look in the browser
 *     (playlist-control-panel.js) and pushed it with update_live; the client now only stores the returned playlist.
 */

const liveSceneState = require('../state/live-scene-state')
const { isTimelessPlaylistItem } = require('../engine/scene-take-lbg-playlist')
const { clipMissing } = require('../media/media-exists')

const DEFAULT_TIMELESS_SECS = 20
/** Web timelessSecsOf: the first timeless item's positive duration, else 20 (one copy: engine/playlist-edit.js). */
const { timelessSecsOf } = require('../engine/playlist-edit')

/** Panel rows for one playlist — label, value, duration, type, loop, timeless, missing. */
function panelItems(playlist, mediaIndex) {
	return (playlist || []).map((it) => ({
		label: it.label || it.value,
		value: it.value,
		duration: it.duration ?? null,
		type: it.type || 'media',
		loop: it.loop === true,
		timeless: isTimelessPlaylistItem(it),
		missing: clipMissing(it.value, mediaIndex) === true,
	}))
}

const { mediaIndexFor } = require('./media-index')

/**
 * Pure: every timeless item gets `duration: secs` (1…86400, web clamp).
 * @returns {{ playlist: object[], touched: number, secs: number } | { error: string }}
 */
function planTimeless(playlist, secs) {
	if (!Number.isFinite(Number(secs)) || Number(secs) <= 0) return { error: 'secs must be a positive number' }
	const s = Math.min(86400, Math.max(1, Number(secs)))
	let touched = 0
	const next = (playlist || []).map((it) => {
		if (!isTimelessPlaylistItem(it)) return it
		touched++
		return { ...it, duration: s }
	})
	return { playlist: next, touched, secs: s }
}

/**
 * Owner 27.07 (update_live): playlist edits while the look is LIVE must reach the running engine — the OSC advance
 * loop reads liveSceneState. Patches every channel where `sceneId` is live; broadcasts when anything changed.
 * @returns {Promise<number>} channels patched
 */
async function patchLivePlaylist(ctx, sceneId, layerNumber, items) {
	let patched = 0
	for (const [chKey, entry] of Object.entries(liveSceneState.getAll() || {})) {
		const scene = entry?.scene
		if (!scene || String(scene.id) !== sceneId || !Array.isArray(scene.layers)) continue
		const idx = scene.layers.findIndex((l) => Number(l?.layerNumber) === layerNumber)
		if (idx < 0) continue
		const next = JSON.parse(JSON.stringify(scene))
		next.layers[idx] = { ...next.layers[idx], playlist: items }
		await liveSceneState.setChannel(parseInt(chKey, 10), { sceneId: entry.sceneId, scene: next })
		patched++
	}
	if (patched > 0) liveSceneState.broadcastSceneLive(ctx, { skipChannelMap: true })
	return patched
}

/**
 * action:'set_timeless' { sceneId, layerNumber, secs } → { ok, playlist, touched, secs, patched }. Nothing is
 * written to the project here: the caller stores `playlist` on the look (client-owned project, deck sync).
 * @returns {Promise<{ status: number, body: object }>}
 */
async function setTimeless(b, ctx, deps = {}) {
	const sceneId = String(b?.sceneId || '').trim()
	const layerNumber = parseInt(b?.layerNumber, 10)
	if (!sceneId || !Number.isFinite(layerNumber)) return { status: 400, body: { ok: false, error: 'sceneId and layerNumber required' } }
	const resolve = deps.resolveScene || ((id) => require('../engine/project-scenes-transform').resolveLiveSceneById(ctx, id))
	const scene = resolve(sceneId)
	const layer = (scene?.layers || []).find((l) => Number(l?.layerNumber) === layerNumber)
	if (!layer || layer.sourceMode !== 'list' || !Array.isArray(layer.playlist) || layer.playlist.length === 0) {
		return { status: 404, body: { ok: false, error: 'No playlist on that look/layer' } }
	}
	const plan = planTimeless(layer.playlist, b?.secs)
	if (plan.error) return { status: 400, body: { ok: false, error: plan.error } }
	const patched = plan.touched ? await patchLivePlaylist(ctx, sceneId, layerNumber, plan.playlist) : 0
	return { status: 200, body: { ok: true, sceneId, layerNumber, ...plan, patched } }
}

module.exports = { DEFAULT_TIMELESS_SECS, timelessSecsOf, panelItems, mediaIndexFor, planTimeless, patchLivePlaylist, setTimeless }
