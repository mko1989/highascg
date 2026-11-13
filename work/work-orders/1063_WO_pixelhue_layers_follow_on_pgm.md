# WO-1063 — Look layers made from PixelHue layers follow the switcher live while on PGM

**Area:** video-io, engine
**Status: DONE (13.11 — on air on the box: switcher layer moved 300 px, border followed; survives a server restart)**

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

## Round 2 (owner 13.11: "masking worked, but the live follow doesnt")

Found on air with "Look 1" on PGM (ch 4):

1. The follower DID nudge (`MIXER 4-111 FILL …` on every move) — but a look layer made from a switcher layer is an
   empty placeholder (`#00000000`); what is seen is its PIP overlay (border on 4-624, edge strip on 4-620), and the
   PGM nudge moves only the layer itself. → `src/pixelhue/pixelhue-follow-overlays.js`: after the nudge every overlay
   of a moved layer is updated in place (`buildPipOverlayUpdateLines`: CG UPDATE + MIXER FILL, never re-added, on the
   PGM take chain, active bank).
2. L10's link said `Screen 1 · Layer 3` but its `layerId` 88145923 was by then the switcher's "Layer 1" (3072×1024):
   the switcher hands layer ids out again. → `linkedLayer()`: the id counts only while that layer still has the link's
   name, else the one program layer of that screen with that name, else the look layer stays put (seen again later
   the same day: after a take on the switcher 88145922 was "Layer 1" and Layers 3 / 4 were on PVW only).
3. `live-scene-reconcile.js` compared the placeholder's colour value as a media path at every server start
   ("channel 4 layer 10 … mismatch … clearing persisted live look") — the look was dropped from the live state and the
   follow stopped until a retake. → colour sources are skipped in that compare.

Verified on the box: Look 1 taken to PGM; switcher Layer 4 window moved +300 px through the API → live L11 fill
0.0755 → 0.1732, `CG 4-624 UPDATE` + `MIXER 4-624 FILL` within one tick, RGBA `PRINT 4` before / after shows the border
300 px further right with the edge strip of L10 still running; layer moved back. After a server restart the live
entry of ch 4 is kept and a +100 px move is followed again. Smoke: 9 tests; offline suite 6191 pass.

Left open: the stored look keeps its drop-time rectangle (a take starts there and snaps within 250 ms).
