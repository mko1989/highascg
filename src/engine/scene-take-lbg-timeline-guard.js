/**
 * WO-546/548/550: which timeline (if any) counts as exiting a take, given the engine's global
 * playback state and this channel's own scene diff — split out of scene-take-lbg.js to stay under
 * the 500-line CI limit and so this guard can be tested directly, without standing up the rest of
 * `runSceneTakeLbg`.
 */

'use strict'

/**
 * Three independent reasons a timeline that LOOKS like it is exiting actually is not:
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
 * 3. **This call has no business touching program at all** (WO-550): every PRV-only call site in
 *    routes-scene-take.js (staging, preview-exchange, and the standalone "preview-only path" used
 *    when an operator previews a DIFFERENT look on PRV while a timeline is live on PGM) now passes
 *    `restrictTimelineToPreview` (WO-549, originally added only to stop those calls from ROUTING a
 *    timeline onto program). The same flag closes a second, independent hole: if the currently-air
 *    timeline is ALSO currently routed to program, a preview-scoped call must never be the one that
 *    tears it down — `timelineEngine.stop()` kills a timeline everywhere at once (there is no
 *    "remove from preview only" primitive), so a PRV-only call correctly concluding "not part of my
 *    own incoming content" and calling stop() anyway would take PROGRAM off the air over an action
 *    that was only ever supposed to affect preview. Measured on the wire (WO-550): previewing an
 *    unrelated look on PRV while a timeline was live on PGM produced `STOP 1-210/211/212` AND
 *    `STOP 2-210/211/212` together, with no replay on either channel.
 *
 * @param {{ timelineId?: string, sendTo?: object } | null | undefined} pbNow
 * @param {object[] | undefined} diffExit
 * @param {object[] | undefined} incomingLayers — the layers of THIS call's own incoming scene
 * @param {number} channel
 * @param {string | null | undefined} protectedTimelineId
 * @param {(sendTo: object) => number[]} channelsFor
 * @param {(layer: object) => boolean} hasContent
 * @param {boolean} [previewOnlyCall] — WO-550: this call is restricted to the preview bus
 *   (routes-scene-take.js's `restrictTimelineToPreview`) and must never tear down program
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
	previewOnlyCall,
) {
	if (!pbNow?.timelineId) return null
	if (protectedTimelineId && pbNow.timelineId === protectedTimelineId) return null
	const stillWantedByThisIncomingScene = (incomingLayers || []).some(
		(l) => hasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId,
	)
	if (stillWantedByThisIncomingScene) return null
	if (previewOnlyCall && pbNow.sendTo?.program) return null
	const isPlayingOnThisChannel = channelsFor(pbNow.sendTo).includes(channel)
	const exitingTimeline = (diffExit || []).find(
		(l) => hasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId,
	)
	return exitingTimeline || isPlayingOnThisChannel ? pbNow.timelineId : null
}

/**
 * WO-555: `resolveActiveTimelineIdToFadeOut`'s reason 3 correctly protects program by doing
 * NOTHING when a preview-scoped call's own incoming content has left a program-routed timeline
 * behind — but "nothing" also means the timeline's PREVIEW claim is never released either, since
 * routing revocation only happens inside `startSceneTimelineLayer`, which only runs for a timeline
 * that IS part of the incoming scene. A look with no timeline layer at all never reaches it, so an
 * old timeline that is legitimately still live on program keeps rendering on preview forever after
 * the operator previews something else — "pgm and prv show the same thing until i clear the prv".
 *
 * This resolves the complementary, SAFE action: release just the preview claim (never program) for
 * a timeline this preview-scoped call's own content does not want, when it is currently on BOTH
 * buses. Safe only because `TimelineEngine.setSendTo`'s routing-change STOP now only clears
 * channels being REMOVED (WO-555, timeline-playback-runtime.js) — dropping preview here can no
 * longer reach program's physical layers.
 *
 * @param {{ timelineId?: string, sendTo?: object } | null | undefined} pbNow
 * @param {object[] | undefined} incomingLayers
 * @param {(layer: object) => boolean} hasContent
 * @param {boolean} previewOnlyCall
 * @returns {string | null}
 */
function resolveTimelineIdToReleaseFromPreview(pbNow, incomingLayers, hasContent, previewOnlyCall) {
	if (!previewOnlyCall || !pbNow?.timelineId) return null
	if (!pbNow.sendTo?.program || !pbNow.sendTo?.preview) return null
	const stillWantedByThisIncomingScene = (incomingLayers || []).some(
		(l) => hasContent(l) && l.source?.type === 'timeline' && l.source.value === pbNow.timelineId,
	)
	return stillWantedByThisIncomingScene ? null : pbNow.timelineId
}

module.exports = { resolveActiveTimelineIdToFadeOut, resolveTimelineIdToReleaseFromPreview }
