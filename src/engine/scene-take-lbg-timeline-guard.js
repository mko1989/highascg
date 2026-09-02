/**
 * WO-546/WO-548: which timeline (if any) counts as exiting a take, given the engine's global
 * playback state and this channel's own scene diff — split out of scene-take-lbg.js to stay under
 * the 500-line CI limit and so this guard can be tested directly, without standing up the rest of
 * `runSceneTakeLbg`.
 */

'use strict'

/**
 * Two independent reasons a timeline that LOOKS like it is exiting actually is not:
 *
 * 1. **It is still wanted** (WO-548): if THIS call's own incoming scene still contains the exact
 *    same timeline, it is continuing, not exiting — regardless of `isPlayingOnThisChannel`, which
 *    only checks engine routing state and has no idea whether the incoming content re-declares it.
 *    Without this, re-taking a look whose timeline is already on air (a plain retake, no other
 *    look involved) misread its own incoming timeline as exiting and killed it mid-take — measured
 *    on the wire: a PLAY, then ~1.4s later a bare STOP with no replay, for a take whose incoming
 *    AND outgoing scene were the identical look.
 *
 * 2. **It belongs to a concurrent take** (WO-546): `routes-scene-take.js`'s pgm/prv preview-exchange
 *    path runs a SECOND, concurrent `runSceneTakeLbg` call (flipping the previous look onto the
 *    preview bus) WHILE the real program take is still in flight — deliberately concurrent, not
 *    serialized (serializing it reintroduces WO-150 B150.1). `startSceneTimelineLayer` always
 *    routes a timeline to BOTH the program and preview channel of its screen, so the real take's
 *    own incoming timeline shows up as "currently playing on this channel" from the preview-
 *    exchange call's point of view too, even though THAT call's own incoming scene (the OLD look)
 *    never mentions it — reason 1 above cannot catch this, since it only looks at the object's own
 *    incoming layers. `protectedTimelineId` is how a caller with outside knowledge (the orchestrator
 *    in routes-scene-take.js, which knows about the sibling concurrent call) shields it.
 *
 * @param {{ timelineId?: string, sendTo?: object } | null | undefined} pbNow
 * @param {object[] | undefined} diffExit
 * @param {object[] | undefined} incomingLayers — the layers of THIS call's own incoming scene
 * @param {number} channel
 * @param {string | null | undefined} protectedTimelineId
 * @param {(sendTo: object) => number[]} channelsFor
 * @param {(layer: object) => boolean} hasContent
 * @returns {string | null}
 */
function resolveActiveTimelineIdToFadeOut(
	pbNow,
	diffExit,
	incomingLayers,
	channel,
	protectedTimelineId,
	channelsFor,
	hasContent,
) {
	if (!pbNow?.timelineId) return null
	if (protectedTimelineId && pbNow.timelineId === protectedTimelineId) return null
	const stillWantedByThisIncomingScene = (incomingLayers || []).some(
		(l) => hasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId,
	)
	if (stillWantedByThisIncomingScene) return null
	const isPlayingOnThisChannel = channelsFor(pbNow.sendTo).includes(channel)
	const exitingTimeline = (diffExit || []).find(
		(l) => hasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId,
	)
	return exitingTimeline || isPlayingOnThisChannel ? pbNow.timelineId : null
}

module.exports = { resolveActiveTimelineIdToFadeOut }
