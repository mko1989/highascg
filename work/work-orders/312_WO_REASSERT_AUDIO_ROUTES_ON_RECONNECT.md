# WO-312 — Reassert live-input audio-only routes after Caspar restart

**Status: OPEN** (gap noted while landing 2d2e294)

## Context
The audio route matrix for DeckLink/v4l2 is now config-persisted
(`<kind>_input_<slot>_audio_targets`, 2d2e294) and authoritative at take time. But the
audio-only route layers themselves (band 320+slot on program channels) are AMCP state — they die
with a Caspar restart. Today only the CLIENT recreates them (button press / applyPgmRoutesForSlot),
so after a Caspar crash/apply-restart the matrix says "routed to Ch3" while nothing plays there
until someone toggles the button twice.

## Task
- On caspar (re)connect — same hook family as template-cg-orphan-sweep / operator-gui
  reconnect-reassert — the SERVER replays the matrix: for each decklink/v4l2 slot with targets
  and policy != never, PLAY the audio-only route on each target channel at layer
  INPUT_PGM_AUDIO_LAYER_BASE+slot (idempotent: skip if INFO already shows it).
- Respect audio_send policy and the input's host channel from the channel map (never hardcode).
- ALSA live_audio slots keep their existing client-driven flow for now (localStorage targets) —
  migrating them to config targets is a natural follow-up, note it, don't block on it.

## Acceptance
- Kill caspar (systemd respawns) with a matrix-routed input → within reconnect settle the route
  layer is playing again (INFO shows route:// on 32X) with no client involvement (kiosk closed).
- Offline smoke over the reassert plan builder (targets × policy matrix), non-vacuous.
