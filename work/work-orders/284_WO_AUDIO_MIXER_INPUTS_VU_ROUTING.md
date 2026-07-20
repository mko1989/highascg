# WO-284 / WO-293 — Audio mixer: missing DeckLink inputs, VU meters, cross-screen routing

**Sources:** todos19.07.26 —
- (WO-293) "decklink's input audio mixer doesnt show up."
- (WO-284) "the audio mixer does not show 'vu' meters on the inputs, highascg should be aware which
  input produces sound. it should be possible to route audio playing on a layer in a channel to
  another screen, now the ui blocks it."

Handled as one work order: all three complaints live on the same surface (the audio mixer panel and
the input channels behind it), and fixing them separately would mean two passes over the same files.

## Three deliverables

### 1. DeckLink input strips appear in the mixer (WO-293) — do this first
A DeckLink input is a real audio source and must get a mixer strip. Establish why it does not
appear today: is the input channel absent from whatever list the mixer iterates, filtered out by a
role/kind check, or present but rendered with nothing in it? Start from
`client/components/audio-mixer-panel.js` and the channel-map plumbing
(`client/lib/input-channels.js` — it already knows about DeckLink input channels and slots, see
`isDecklinkInputChannel`, used by the looks-thumbnail work in WO-291).

### 2. VU meters on inputs — "know which input produces sound"
Per-input level metering, so an operator can see at a glance which input is live.
- CasparCG emits audio levels over **OSC** (`/channel/N/mixer/audio/...` pVU/dBFS style paths).
  This box already has an OSC receiver on :6250 — `src/` OSC handling, and note the historical
  little-endian float quirk of this 2.6-dev binary (there is already an auto-swap in the receiver;
  do not re-fix it, but be aware levels arrive as floats).
- Prefer consuming levels that are ALREADY being received over subscribing to new OSC traffic. Grep
  the OSC handlers for existing audio/VU state before adding anything.
- The meter must be cheap: the mixer panel already learned this lesson once (its ticker uses stored
  records with change guards rather than re-rendering). No per-frame DOM churn, no per-frame
  `getBoundingClientRect`, and no work at all when the panel is not visible.
- A silent input must read as silent, and an input with no data at all must be visually distinct
  from one that is present and quiet.

### 3. Route a layer's audio to another screen (UI currently blocks it)
Find the block first and state whether it is a deliberate guard or an accident. If deliberate,
say what it was protecting against before removing it. Then allow the routing, with validation:
the target must be a real audio-capable destination, and the change must go through the same
persistence/apply path other mixer changes use.

## Constraints
- LIVE playout box: audio changes are audible on air. Never apply an intermediate state, and never
  auto-route anything as a side effect of rendering.
- DeckLink 4 currently has a powered-off camera; a missing/dead input must render a clear "no
  signal" strip, never a hang or a retry storm. Reuse the backoff/single-flight helpers in
  `src/preview/compose-preview-backpressure.js` if throttling is needed.
- Do not restart the service, do not run `npm run build:client` (the main session does both).

## Acceptance
- DeckLink inputs have mixer strips; a written root cause for why they did not.
- VU meters driven by real levels, with the cheapness constraints above respected.
- Cross-screen audio routing possible, validated, persisted the same way as sibling settings.
- Offline smoke tests for the pure parts (input enumeration, level→meter mapping incl. silence vs
  no-data, routing validation). `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.
