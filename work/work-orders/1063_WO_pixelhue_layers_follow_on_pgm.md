# WO-1063 — Look layers made from PixelHue layers follow the switcher live while on PGM

**Area:** video-io, engine
**Status: IN PROGRESS (13.11 — built; dry run against the box's P80; not yet seen on air)**

Owner, 13.11: *"when there are pixelhue layers used on pgm they should live follow the layers from pixelhue"*

## Investigation

- A look layer dropped from the PixelHue list keeps `layer.pixelhue = { layerId, screenId, name, drive }` (WO-1038) and
  a copy of the rectangle taken at drop time. Nothing re-reads the switcher afterwards.
- The live entry (`src/state/live-scene-state.js`) is built by `buildServerIncomingScene` and does not carry
  `pixelhue`; the link is read from the stored look (`resolveLiveSceneById`), joined by `layerNumber`.
- Moving a layer of the look on air already exists: `/api/preview/mixer-nudge` with `target: 'pgm'` (WO-1044), which
  is bank-aware and queued behind takes on the channel.

## What was done

`src/pixelhue/pixelhue-follow.js`, started in `index.js`, stopped in `shutdown.js`:

- every 250 ms, for each program channel whose live look has linked layers, read the switcher (shared reader, one
  request pair; no linked layer on air → no read) and, for each linked layer whose rectangle differs by more than
  ~half a pixel from the switcher layer's shown rectangle (WO-1062), send the PGM nudge for those layers only and
  update the live entry in place (take time kept; skipped when a take landed meanwhile);
- the stored look is not changed;
- not followed: a layer the look drives ("looks drive the switcher" on, layer drive not off) — two masters;
- a switcher that stops answering is logged once, not 4×/s.

## Verified

- `tools/smoke/smoke-wo1063-pixelhue-follow.test.js` (6).
- Dry run on the box (real P80 read, stored narvil "Look 1", fake nudge): L11 → 817×669 at 240,132 (the masked
  Layer 4), L10 → the switcher layer's current 3072×1024; second tick: no nudge.
- NOT verified: on air (a take of a look with linked layers, then moving the layer on the switcher) — PGM was the
  owner's during the session. Open points to look at then: the PIP border / edge strip of the layer moving with it,
  and the first-take jump when the stored rectangle is stale.
