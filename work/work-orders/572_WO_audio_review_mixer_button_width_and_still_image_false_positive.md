**Status: IN PROGRESS (2026-09-12) — Part A (mixer button width) and Part B (still-image false
positive) implemented, offline suite green, client build clean; not yet kiosk-reloaded/restarted
on the box (live show, owner-QA owed). Part C (audio-only looks) not started — needs an owner
decision, see §3.**

**Source:** `work/work-orders/todos12.09.26` (owner, verbatim):
> i need you to do a review and fixing of the audio implementation and settings in highascg.
> while youre at it in the compact audio mixer in bottom right the routing buttons are stretched
> to fill width instead of being pretty small.
> highascg needs to be doing better job at determining wheter there is audio present on a layer,
> right now there are 2 layers on screen with jpg media, so no audio, yet they appear in the mixer.
> i also need audio only looks (single or playlist) that can be played without changing the video
> layers of the screen.
> on show so dont do anything destructive.

## Part A — compact mixer routing buttons stretched to fill width

**Found:** `.audio-mixer-view__matrix-buttons` in
[07c4-audio-mixer-view-matrix-empty-modal.css:21-26](../../client/styles/07c4-audio-mixer-view-matrix-empty-modal.css#L21)
was a hardcoded `display: grid; grid-template-columns: repeat(2, 1fr)`. With the common case of
1-2 PGM screens, each single/double-digit channel button stretched to half the strip's width.
This class is shared by every "Screens" routing matrix on the box: the Inspector's compact
Program-audio panel (`audio-mixer-panel-input-layers.js`), the Live Audio Mixer modal's
cross-screen matrix (`audio-mixer-console-input-groups.js`), and the live-input matrix
(`audio-mixer-console-live-inputs.js`).

**Fix:** switched the container to `display: flex; flex-wrap: wrap` and the buttons to
`flex: 0 0 auto; min-width: 1.6em` (was implicit full-cell width) — buttons now size to their own
label instead of stretching, and still wrap sanely if a box ever has many PGM screens.

No smoke test pins this class's layout rules (checked `tools/smoke/smoke-wo227-mixer-dense.test.js`
— that WO covers per-screen fader-strip width at 8 channels, a different CSS family, not this
button grid).

## Part B — still-image layers get a full audio strip in the mixer

**Found:** `layerHasMixerAudio(layer)` in
[audio-mixer-rows.js:11-16](../../client/lib/audio-mixer-rows.js#L11) — the sole gate deciding
whether a look layer gets a fader/meter/routing strip in `collectProgramAudioRows` (the compact
Inspector mixer's per-layer rows) — only checked `isMediaOrFileSource(src)`: `type === 'media' |
'file'` and a non-empty `value`. No media-kind check at all, so a layer whose source is a static
`.jpg` passed identically to a real audio-bearing clip.

**Fix:** reuse the box's existing, already-trusted filename classifier,
`classifyMediaKind()` ([media-ext.js](../../client/lib/media-ext.js) — the same function gating
loop/thumbnail behavior elsewhere) — a media/file source now needs `classifyMediaKind(src.value)
!== 'still'` to earn a mixer strip. Still images (jpg/jpeg/png/gif/bmp/webp/tiff/tif) no longer
appear; everything else (video, audio files, route://, extensionless clip ids) is unaffected —
`classifyMediaKind` returns `'unknown'` for those, which is not `'still'`.

**Deliberately not done:** consulting the server's real ffprobe `hasAudio` flag (already computed
in `local-media-ffmpeg.js` and merged onto `state.media`/`GET /api/media`, per investigation) to
also catch a genuinely silent **video** file. The owner's reported symptom was specifically jpg
stills — a filename-only, zero-ambiguity case. Wiring the probe cache in too would mean extending
`media-duration.js`'s index (or building a sibling) with the same normalization/conflict-handling
care that file already documents at length for duration — real work, not needed to fix what was
reported, and higher risk to make correctness-critical on a live box today. If a genuinely silent
video file turns out to also need excluding, that's a follow-up with its own WO.

## Verification (Parts A & B)

- `node tools/ci/run-offline-tests.js`: 2421/2424 pass, 2 skipped (pre-existing, both
  local-server-spawn tests that always skip under `CI=1`), 1 failing
  (`smoke-wo537-look-timeline-starts-where-asked.test.js` — a pre-existing timing flake, off by
  1ms under full-suite load; passes 9/9 in isolation, confirmed unrelated to this change).
- `npm run build:client`: clean, no new errors/warnings (pre-existing chunk-size and
  ineffective-dynamic-import warnings only).
- **Owner-QA owed:** kiosk reload to see the buttons at their new size and confirm the two jpg
  layers drop out of the mixer live, on this show.

## Part C — audio-only looks (single or playlist) that don't touch video layers

**Not started — needs an owner decision before writing any code**, flagged live in this session
via AskUserQuestion rather than guessed at, because the two shapes have very different blast
radius and neither is obviously "smaller":

1. **Per-screen, additive:** the audio-only look plays into a small number of layer slots
   reserved outside the normal look band (mirroring the existing reserved 1-9 / 101-109 band that
   always-on live-audio buses already use — see
   [look-layer-ranges.js](../../src/engine/look-layer-ranges.js)), on a chosen screen's own
   program channel. Taking/clearing it must never enter the normal look diff/exit path for that
   channel's 10-99/110-199 band, so it can start, change, or stop without touching whatever video
   look is live. Playlists reuse the existing per-layer `sourceMode: 'list'` mechanism
   ([scene-take-lbg-jobs.js](../../src/engine/scene-take-lbg-jobs.js)).
2. **Channel-decoupled:** mirror `route://` live-audio-inputs
   ([live-audio-input.js](../../src/config/live-audio-input.js)) — its own dedicated Caspar
   channel, not bound to any screen, mixed into PGM(s) via `route://<ch>`. Plays regardless of
   which look is live on any screen, at the cost of a new channel + routing-map allocation
   (`extra_audio_channel_count` / `audioOnlyChannels[]` already exists as a building block in
   `routing-map.js`, per investigation, currently unused).

Note for whoever picks this up: WO-306 (media-layer cross-channel audio routing — a *different*
per-layer routing feature) was explicitly **rejected by the owner** ("the current way is how
caspar works and is fine"). Neither shape above proposes that; both are scoped to a dedicated new
look type, not a routing toggle on ordinary look layers. Worth naming that distinction to the
owner up front so the rejection doesn't get assumed to cover this too.

## Files touched (Parts A & B)

- `client/styles/07c4-audio-mixer-view-matrix-empty-modal.css`
- `client/lib/audio-mixer-rows.js`
