'use strict'

/**
 * WO-1073 — `editOnAir` on POST /api/scene/take (set only by the edit pushes through take-look: the look editor's PGM
 * edit, routes-scene-pgm-edit-push.js, and its PRV push, routes-scene-preview-push.js). Decided INSIDE the per-channel
 * take chain, against what the live map holds there now:
 *   - the same look is still on that channel → the take keeps its unchanged layers playing (scene-take-edit-on-air.js);
 *   - PGM: another look went on air meanwhile → refused (409 not_on_air) — an edit never puts a look back on air;
 *   - PRV: another look was staged meanwhile → a plain staging take, as before.
 */

const liveSceneState = require('../state/live-scene-state')

/**
 * @param {object} b take body
 * @param {number|null} channel the channel the take lands on (PRV bus for a preview take)
 * @param {object} inc incoming scene
 * @param {boolean} previewOnly
 * @returns {boolean}
 */
function editOnAirFor(b, channel, inc, previewOnly) {
	if (b?.editOnAir !== true || !(Number(channel) > 0)) return false
	const live = liveSceneState.getChannel(Number(channel))
	if (live?.scene && inc?.id != null && String(live.sceneId ?? '') === String(inc.id)) return true
	if (previewOnly) return false
	const e = new Error(`not_on_air: look ${inc?.id ?? '?'} is no longer on PGM ch ${channel} — an edit never re-takes it`)
	e.statusCode = 409
	throw e
}

module.exports = { editOnAirFor }
