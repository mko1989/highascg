# WO-357 — Shader Live: ▶ take (fixed) + PGM layer stack

**Status: DONE (2026-07-27, endpoint live-validated; on-air land = owner QA)** · Source: owner
mid-day: "there is still no play button in the shaders editor. id also like to use empty space on
the right of parameters to be able to stack shaders on layers… click layer 10 to exchange
(transition mix) with what was on pgm or click layer 11-20 and it transitions to that layer.
remeber minimalizm."

## ▶ take — why it was missing

WO-356d added the take LISTENER but the button's HTML insert silently no-oped (unmatched python
replace, unverified) — worse, the listener then null-dereferenced `#shl-take` during overlay
construction. Fixed with asserted replaces; the button now sits next to the instance dropdown and
fires the deck's global take (identical transition semantics).

## PGM layer stack (right of the parameters)

- New right column (`shader-live-stack.js`): the active main's look-band layers 10–20, one thin
  row each — layer number + occupant name ('—' when empty, red-tinted border when live).
- Clicking a row while the SELECTED instance is on PRV lands that shader on the clicked PGM
  layer via new `POST /api/shader-stack` (routes-shader-stack.js):
  LOADBG + PLAY with the deck default transition — an occupied layer crossfades old→new
  (the "exchange" on L10), an empty layer fades in from transparent. One code path for both.
- The producer lands PLAY-hosted (that is what makes MIX possible); Shader Live's existing 403
  re-host covers later live edits. Any playlist runtime on the exchanged layer is killed
  (channel-scoped key) so a stale timer can't hop the fresh shader away.
- scene.live is upserted + broadcast (serialized with take work via chainSceneTakeWork), so the
  stack panel, both GUIs, and the deck all follow.
- Non-PRV selection → toast pointing at the audition flow. Minimal chrome throughout.

## Verification

Route rejects out-of-range layers (live-probed 400); test:ci 1555/0; lint 0; gates 0; service
restarted + kiosk reloaded. Owner QA: exchange on L10 mixes, 11–20 stack, edits after landing
re-host once then ride live.
