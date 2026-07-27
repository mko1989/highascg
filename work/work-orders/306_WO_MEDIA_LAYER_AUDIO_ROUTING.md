# WO-306 — Media-layer audio routing: unroute from own channel, route to another channel

**Status: DEPRECATED (2026-07-27) — REJECTED by owner 2026-07-21 ("the current way is how caspar works and is fine"). Do not build this; kept only as a record of the decision.**

**Status: NOT WANTED — closed 2026-07-21.** Owner: "the current way is how caspar works and is
fine." Do not build. Kept below for context only.

## Owner ask (verbatim)
"even media inputs should be able to be unrouted from the channel its playing on, as well as
routed to another channel. (channel in casparcg)"

## Context — what already exists (2026-07-21)
- Live inputs (DeckLink/v4l2) got the full model in 42c6676 + 2d2e294: per-input audio-send
  policy (afv/always/never), AUTO MIX toggle, and a route matrix that is authoritative at take
  time via `<kind>_input_<slot>_audio_targets` in casparServer.
- Media (clip) layers already have per-layer strips with mute/fader in the mixer's PGM sections
  (audio-mixer-panel-input-layers.js), applied as MIXER VOLUME on the look layer.
- The suppression point is settled law: gate audio on the PROGRAM-channel layer, never the source
  (f343e5e — layer routes tap the source before its channel mixer).

## What is genuinely new here
1. **Unroute from own channel** as a matrix act: a per-layer Ch toggle that, when the layer's own
   channel is deselected, forces the layer's take volume to 0 (policy-style, in
   resolveTakeVolumeForSceneLayer or a sibling for media layers). Persist per look layer —
   this changes the LOOK model (scene layer gains an audioTargets field), so it saves/loads with
   the project and re-applies on retake.
2. **Route to another caspar channel**: play an audio-only `route://<pgmCh>-<lookLayer>` on the
   other channel (mirror of live-audio-routing.js playRouteOnChannel audioOnly). Layer band must
   not collide: live inputs own 320+slot (INPUT_PGM_AUDIO_LAYER_BASE); pick a distinct band for
   media cross-routes (proposal: 340+, max 8 per channel) and document it next to the 320 constant.
3. **Lifecycle**: take/retake/clear of the look must create/move/remove those cross-routes.
   Hook: same place scene-exit-layers tears down look layers. A cross-route with no living source
   layer must never survive (orphan sweep band addition).

## Acceptance
- A clip on PGM1 can play video on PGM1 with audio ONLY on PGM2 (unrouted own, routed other).
- Retake reasserts; clearing the look removes the cross-route (verify via INFO).
- Doubling impossible: own-channel embedded and cross-route to the same channel are mutually
  exclusive by construction.
- Offline smokes for the policy + lifecycle plan lines; proven non-vacuous.

## Files
- src/engine/live-input-audio-policy.js (extend or sibling media-layer-audio-policy)
- src/engine/scene-take-lbg-jobs.js, scene-take-pgm-only.js, scene-exit-layers.js
- client/components/audio-mixer-panel-input-layers.js (per-layer Ch buttons)
- scene model: scene layer `audioTargets` (persistence + project save/load)
