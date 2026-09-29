**Status: IMPLEMENTED (2026-09-21, offline suite 2496 tests / 0 fail / 2 skipped, max-file-lines clean, client rebuilt) — needs kiosk reload (F5) + owner on-hardware confirmation**

## Investigation

Owner: look layer inspector "Start behaviour override" had a third option, "Same as timeline
clip"; choosing anything else and playing the look snapped the dropdown back to it. Wanted exactly
two: start from the beginning, or relative to the clip that was playing on the same layer.

Root cause of the revert — a whitelist, same trap as WO-570's trim fields:

- `buildIncomingScenePayload` ([scenes-shared.js](../../client/components/scenes-shared.js)) builds each
  wire layer row from an explicit field list; `startBehaviour` was not in it.
- After a take, [scenes-editor-support.js](../../client/components/scenes-editor-support.js) calls
  `applySceneFromTakePayload`, which does `scene.layers = payload.layers`
  ([scene-state-look-logic.js](../../client/lib/scene-state-look-logic.js)) — the deck look's layers are
  replaced by the whitelisted copy, so `startBehaviour` vanished and the inspector rendered
  "inherit" (`undefined` → "Same as timeline clip").
- Evidence: `config/.highascg-state.json` — every persisted layer in `scene_deck` /
  `web_project` / live scenes has no `startBehaviour` key at all.
- Side effect: the server's `resolveEffectiveStartBehaviour` never saw the layer's value either,
  so the choice was never honoured server-side (fell through to timeline clip / 'beginning').

"Same as timeline clip" = inherit the start behaviour of the timeline clip on the same layer
index; meaningless for a look, and the owner does not want it.

## What was done

- **scenes-shared.js** — whitelist row carries `startBehaviour` (only the two valid values).
- **inspector-scene-layer.js** — dropdown is now "Clip start point" with two options:
  *Start from beginning* / *Relative to the clip playing on this layer*; hint text rewritten.
- **scene-state-helpers.js** — `defaultLayerConfig` has `startBehaviour: 'beginning'`; `migrateScene`
  normalises anything else to `'beginning'`, so legacy layers get an explicit value (matches what
  they effectively did: no timeline clip → beginning).
- **scene-state-layer-logic.js** — `patchLayer`, `applyLayerStyleData`, style-clipboard/preset export
  never unset the field; null/'inherit' map to `'beginning'` (old presets holding 'inherit' still load).
- Server engine untouched: `resolveEffectiveStartBehaviour` keeps its fallback for legacy payloads.
- New smoke `tools/smoke/smoke-wo576-look-clip-start-point.test.js` (registered in run-offline-tests.js).

## VERIFIED

- Offline suite 2496 tests, 0 fail. New smoke: 4/4 (whitelist, two-option dropdown, layer-logic
  normalisation, legacy migration). Client build clean.
- NOT verified on hardware: a real take with "Relative" against a playing clip. Owner QA: pick
  Relative on a layer, take, confirm the dropdown stays and the clip continues from the live frame.
