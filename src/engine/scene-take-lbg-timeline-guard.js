/**
 * WO-546: which timeline (if any) counts as exiting a take, given the engine's global playback
 * state and this channel's own scene diff — split out of scene-take-lbg.js to stay under the
 * 500-line CI limit and so this specific guard can be tested directly, without standing up the
 * rest of `runSceneTakeLbg`.
 */

'use strict'

/**
 * `protectedTimelineId` exists because `routes-scene-take.js`'s pgm/prv preview-exchange path runs
 * a SECOND, concurrent `runSceneTakeLbg` call (flipping the previous look onto the preview bus)
 * WHILE the real program take is still in flight — deliberately concurrent, not serialized (see
 * that call site: serializing it reintroduces WO-150 B150.1). `startSceneTimelineLayer` always
 * routes a timeline to BOTH the program and preview channel of its screen, so the real take's own
 * incoming timeline shows up as "currently playing on this channel" from the preview-exchange
 * call's point of view too — which would otherwise misread it as exiting and tear it down mid-take.
 * Measured on the wire (WO-546): PLAY, a duplicate PLAY, then a bare STOP with no replay.
 *
 * @param {{ timelineId?: string, sendTo?: object } | null | undefined} pbNow
 * @param {object[] | undefined} diffExit
 * @param {number} channel
 * @param {string | null | undefined} protectedTimelineId
 * @param {(sendTo: object) => number[]} channelsFor
 * @param {(layer: object) => boolean} hasContent
 * @returns {string | null}
 */
function resolveActiveTimelineIdToFadeOut(pbNow, diffExit, channel, protectedTimelineId, channelsFor, hasContent) {
	if (!pbNow?.timelineId) return null
	if (protectedTimelineId && pbNow.timelineId === protectedTimelineId) return null
	const isPlayingOnThisChannel = channelsFor(pbNow.sendTo).includes(channel)
	const exitingTimeline = (diffExit || []).find(
		(l) => hasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId,
	)
	return exitingTimeline || isPlayingOnThisChannel ? pbNow.timelineId : null
}

module.exports = { resolveActiveTimelineIdToFadeOut }
