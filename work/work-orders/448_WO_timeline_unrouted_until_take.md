# WO-448 — Timeline routes NOWHERE on PGM-only screens until Take / look playback

**Status: DONE (06.08.26 — engine + client + UI fixed, smokes green; client build + service restart in the day's batch tail)**

Owner (todos06.08 follow-up): *"the timeline defaults to be already linked to pgm, meaning
when i do edits and jump the playhead it starts displaying over the already playing look. it
should be routed to prv (or not routed at all for pgm only screens) unless the timeline is
taken to screen by pressing the take button in timeline or playing it from a look."*

## 1. Investigation

The intended semantic already exists in the engine — `timeline-playback-runtime.js:160`
demotes a timeline to preview-only when it leaves air ("the only thing that puts a timeline
back on PGM is an explicit Take"). The leak was PGM-only screens, in two independent places:

1. **Client** `client/lib/timeline-state-model.js` `coerceTimelineSendTo()`: when the
   selected screen has no PRV bus, it forced `preview:false, program:true` — every timeline
   on this mapping-only rig was BORN routed to PGM. The transport's PGM checkbox was even
   rendered `checked disabled` (`timeline-transport.js:224`), so the owner could not
   un-route it.
2. **Engine** `src/engine/timeline-playback-amcp-send.js` `_channelsFor()`: the
   `ch.length === 0` fallback crossed a PRV-only request over to `programCh(1)` when the
   screen had no PRV bus — so even a correctly preview-only timeline scrubbed straight onto
   PGM channel 1. This also fired for the post-air demoted state.

Playhead jumps reach the engine via `POST /api/timelines/:id/seek` → `eng.seek()` →
`_applyAt()` at the CURRENT sendTo channels — with either bug active, that painted over the
playing look.

## 2. What was done

- `coerceTimelineSendTo`: PGM-only now only drops the impossible `preview` flag; `program`
  is left alone — default `{preview:false, program:false}` = **unrouted**. An explicit PGM
  tick survives coercion.
- `_channelsFor`: `{preview:false, program:false}` → `[]` (apply nothing); a PRV request
  with no PRV bus routes NOWHERE (fallback to a program channel now happens only when
  program was explicitly requested). Every consumer of `_channelsFor`/`_channels()` iterates
  the list, so `[]` is a clean no-op.
- Transport UI: PGM checkbox reflects real state and stays clickable on PGM-only screens.
- Take (`timeline-take.js:142`/`:237` sets `program:true` explicitly) and look-driven
  playback are untouched — they are the two sanctioned routes onto PGM, per the owner.

## 3. What was VERIFIED

- New `tools/smoke/smoke-wo448-timeline-unrouted-default.test.js` 4/4 (unrouted → no
  channels; PRV-only on pgm_only → NOWHERE; explicit program still routes; pgm_prv PRV
  unaffected) — registered in the curated FILES list.
- `smoke-preview-amcp-channel.mjs` assertions REPOINTED (reason recorded inline): pgm_only
  coercion now asserts unrouted + explicit-PGM-survives; suite passes.
- `smoke-timeline-sendto.test.js` 1/1 unchanged.
- Owner QA: with a look playing, jump the timeline playhead — PGM must not change; tick PGM
  (or Take) and the timeline appears.
