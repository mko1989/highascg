/**
 * WO-284 — apply + persist for cross-screen audio routing.
 *
 * Kept out of the two mixer components so both surfaces (Inspector panel and the full mixer
 * console) share one code path, and so the pure rules in `audio-cross-screen-routing.js` stay
 * importable by the offline smokes without dragging in scene state or the API client.
 *
 * SAFETY: this is only ever called from a click handler. Rendering must never call it — nothing
 * here is idempotent-by-accident, and every call is audible on air.
 */

import { sceneState } from './scene-state.js'
import { clearRouteFromChannel, playRouteOnChannel } from './live-audio-routing.js'
import {
	nextCrossScreenTargets,
	parseCrossScreenTargets,
	validateCrossScreenAudioTarget,
} from './audio-cross-screen-routing.js'

/**
 * Toggle one layer's audio route to another screen's program channel.
 *
 * Order matters: apply to air first, persist only on success. A failed AMCP must not leave a
 * persisted target that nothing on air matches (the operator would see an "active" button for
 * audio nobody can hear).
 *
 * @param {{
 *   row: { ch: number, layer: number, sceneId?: string | null, audioScreens?: unknown, audioRoute?: string },
 *   targetChannel: number,
 *   enable: boolean,
 *   programChannels: Array<number | string>,
 *   channelMap: object | null | undefined,
 *   pgmAudioOnly?: boolean,
 * }} req
 * @returns {Promise<{ ok: boolean, reason?: string, targets: number[] }>}
 */
export async function toggleCrossScreenAudio(req) {
	const { row, targetChannel, enable, programChannels, channelMap } = req || {}
	const current = parseCrossScreenTargets(row?.audioScreens)

	const check = validateCrossScreenAudioTarget({
		sourceChannel: row?.ch,
		sourceLayer: row?.layer,
		targetChannel,
		programChannels,
		channelMap,
	})
	if (!check.ok) return { ok: false, reason: check.reason, targets: current }

	if (enable) {
		await playRouteOnChannel(check.targetChannel, check.destLayer, check.route, {
			audioOnly: req?.pgmAudioOnly !== false,
		})
	} else {
		await clearRouteFromChannel(check.targetChannel, check.destLayer)
	}

	const targets = nextCrossScreenTargets(current, check.targetChannel, enable)
	persistCrossScreenTargets(row, targets)
	return { ok: true, targets }
}

/**
 * Persist through the SAME path the sibling mixer settings use: `sceneState.patchLayer`, exactly
 * like `audioRoute`, `volume` and `muted` on this strip.
 * @param {{ sceneId?: string | null, layer?: number }} row
 * @param {number[]} targets
 */
export function persistCrossScreenTargets(row, targets) {
	const sceneId = row?.sceneId
	if (!sceneId) return false
	const scene = sceneState.getScene(sceneId)
	if (!scene || !Array.isArray(scene.layers)) return false
	const idx = scene.layers.findIndex((l) => l && l.layerNumber === row.layer)
	if (idx < 0) return false
	sceneState.patchLayer(sceneId, idx, { audioScreens: targets })
	return true
}
