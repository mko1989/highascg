# WO-360 — Playout status surfacing: missing media / failed inputs must TELL the operator

**Status: v1 SHIPPED 2026-07-28 — missing-media marks + take toasts + live-input failure toasts; deck-card badge and per-command AMCP-failure plumbing remain.** · Source: owner checklist note 27.07 (item 3): "here we enter something that
hasent been done yet properly, which is status check and message to the user if anything is
missing or input hasent started properly and failed bring alive pass."

## Scope (investigation first at pickup)

The operator currently learns about a missing file or a dead input by seeing black. Wanted: a
status layer across the playout surfaces:

1. **Missing media**: playlist items / look layers whose clip is not in Caspar's CLS (or PLAY
   answered 404) get a visible ⚠ marker in the playlist rows, the deck card, and the Playlists
   panel — plus a toast at take time naming the file. The full path matters exactly here (the
   rows now show basenames; the warning should show the path).
2. **Input didn't come up**: live inputs (decklink/live-audio/v4l2) that fail their
   bring-alive pass must surface: device-view badge + header toast, with the failure reason
   (the "all_variants_failed" class of errors), not just a journal line.
3. **Route to nothing**: a route:// layer whose target layer/channel is empty after take →
   same ⚠ treatment (ties into WO-359's INFO probing approach).

## Investigation pointers

- PLAY failures already surface per-command (WO-281: inner 404s reported in failures) — the gap
  is the pipe from those failures to a USER-VISIBLE state keyed by scene/layer/item.
- CLS cache exists server-side (query-cycle mediaDetails) for existence checks without a probe.
- Live-input bring-alive: src/bootstrap/audio-capture-lifecycle.js + decklink input retry
  (smoke-decklink-input-retry) already know success/failure — need a status bus → client.

## v1 implementation (2026-07-28)

- `client/lib/media-exists.js` — singleton index over `state.media` (CLS-backed), tolerant like
  playout (case/extension/basename); returns null for non-media values (templates, route://,
  live, html) so nothing is wrongly flagged. Unit-checked against fake state.
- Playlist rows (inspector) + Playlists panel items show ⚠ + red with "MISSING in Caspar
  media: <full path>" tooltip.
- Take time (deck take AND preview recall): `warnMissingMediaOnTake` toasts every missing
  value's basename before the take posts (full paths in console).
- Live-input bring-alive failures now TOAST: `initLiveInputFailureToasts` watches
  `liveAudioInputsStatus` / `v4l2InputsStatus` (already in getState, previously silent) with
  the decklink toast's transition semantics — failures once (including already-dead at page
  load), recoveries as success.

## Remaining

- Deck-card ⚠ badge for looks containing missing media.
- Per-command AMCP failure plumbing (batch `failures[]` → take response → client toast) for
  failures the static index can't predict.
- Route-to-empty detection post-take.

## Acceptance

A playlist with one misspelled clip: the row, the deck card and the panel all show ⚠ before
take; taking it toasts the missing path; the rest of the playlist plays. A failed live input
shows a red badge in device view + one toast with the reason.
