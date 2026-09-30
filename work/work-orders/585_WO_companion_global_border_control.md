# WO-585 — Global border control from Companion (server endpoint + sceneId-take border fix)

**Status: IN PROGRESS (2026-09-30) — server side DONE (offline suite 2541/0/2, endpoint probed live, non-visual calls only); Companion module actions/feedbacks/presets in `companion-module-highpass-highascg` (uncommitted there, see §2b). Owner QA owed: visible on/off from a Companion button.**

Source: owner — "companion module is missing global borders controls, mainly on/off is needed but others might be nice."

## 1. Investigation

- The global border on/off state lives per screen in `project.scenes.globalBorders[i]`
  (`client/lib/scene-state-global-border.js:17` template). **Only the web client applies it**: the
  inspector patches sceneState, then `pushBorderOnlyNow` (`client/lib/scenes-preview-global-border.js`)
  asks `POST /api/scene/border-lines` for AMCP lines and runs them itself. The server has no
  "switch the border" entry point — Companion (no browser) had nothing to call.
- **Latent bug that Companion control would expose:** Companion takes by `sceneId` only; the take
  route resolves the look from disk (`src/api/routes-scene-take.js:84-87`) and the look carries its
  own stale `globalBorder` copy — `enabled:false` in all 5 looks of the live project. The web UI
  never uses that copy: it overrides it with the screen slot on every take
  (`client/components/scenes-preview-runtime.js:236`). So with the border ON, a Companion take sent
  `incoming.globalBorder.enabled=false` → `scene-take-lbg.js:276-289` computes `gbWillFadeOut` →
  the border faded out on take.
- Art-Net already drives the border server-side (`src/artnet/artnet-output.js`) — precedent for
  building lines server-side and keeping `live.scene.globalBorder` in step.

## 2. What was done

### 2a. HighAsCG (this repo)
- `src/engine/global-border-control.js` (new) — pure slot logic: `applyControlToSlot` (on / off /
  toggle, type, params merge with `side:'inside'` forced, fadeDuration, preset recall),
  `screenBorderCasparSlots` (same PGM 998/996 + PRV-mirror 997 rules as the web
  `globalBorderCasparSlots`/`…ClearSlots`), `pgmAirSnapshotOf`, and `withScreenGlobalBorder[ForChannel]`.
- `src/api/routes-scene-border.js` — the body of `handleBorderLines` extracted as
  `computeBorderLines(ctx, {channel, layer, border, isUpdate})` so the web push and the new
  endpoint share one implementation (live-file write, type tracking, fade + post-fade clear).
- `src/api/routes-scene-global-border.js` (new) — `POST /api/scene/global-border`
  `{ screen, enabled?: true|false|'toggle', type?, params?, fadeDuration?, preset? }`: loads the
  project, applies the request, runs the AMCP (per-channel `MIXER n COMMIT` when DEFER lines are
  present), stores the slot + `pgmAirSnapshot`, `persistProject` + `project_sync` broadcast (web UIs
  import it; Companion reads it), and patches the PGM `live.scene.globalBorder` so the next take
  fades from the real on-air state. Preset recall while on = the web's dual-layer crossfade (998↔996).
  Registered in `routes-scene.js` (covered by the existing `/api/scene/*` route).
- `src/api/routes-scene-take.js` — a disk-resolved look now takes with the screen's slot
  (`withScreenGlobalBorderForChannel`), matching the web. Only the sceneId-only branch; client
  takes that send `incomingScene` are untouched.

Why server-side rather than Companion replaying the web's push via `/api/scene/border-lines` +
`/api/amcp/raw`: Companion would have to write the project itself (clobber risk against the web
UI's autosave) and duplicate the slot/layer rules; one server endpoint keeps a single source of truth.

Known minor: the web client keeps `lastGlobalBorderPushMeta` locally, so after a Companion "on" the
first web inspector edit does a full re-ADD (a short re-fade) rather than a live UPDATE.

### 2b. Companion module (`~/companion-module-dev/companion-module-highpass-highascg`)
Actions (Global border: on/off/toggle, set colour, opacity, width, type, fade, recall preset),
feedback `global_border_on`, variables `highascg_global_border_<n>_{state,type,color,opacity}`, presets
"HighAsCG · Global border". Left uncommitted in that repo because it already carries the owner's
uncommitted playlist/FTB work in the same shared files (and reuses its `buildScreenDropdown`). Module tests 73/73 (9 new), touched files lint + prettier clean. Companion runs installed bundles from `~/.config/companion/modules/`, so it needs a `yarn package` + import to go live.

## 3. Verified

- `tools/smoke/smoke-wo585-global-border-control.test.js` — 15 tests (slot logic, slot/layer
  rules, take overlay + source pin, handler with project/live-file/AMCP stubbed: on = ADD + fade on
  998 + COMMIT, style change while on = no AMCP, off = fade both PGM layers, off-when-off = nothing,
  preset recall = crossfade to 996, validation). Added to the curated CI list.
- `npm run test:ci` → 2543 tests, 2541 pass / 0 fail / 2 skip. File-size gate 0 over. Touched
  files lint clean; `check-unwired-exports` has no WO-585 entries.
- Live on the box after `kill -TERM` restart: validation errors (screen 9, `enabled:"maybe"`,
  empty preset 7) return 400 with messages; `{screen:0, enabled:false}` on the already-off border
  → `ok, lines: []`, journal `[global-border] screen 1 off (edge_strip) via API`, project rev 392,
  5 looks and the slot intact.
- NOT done live (visible on air): an actual on/off. Owner QA: press the Companion toggle on
  screen 1, check the edge strip fades in/out, then take a look from Companion with the border on
  and check it stays on.

Pre-existing, not WO-585: CI on `main` is red at "Unwired exports" (6 entries from WO-577
shader-controls / WO-572 `AUDIO_ONLY_TRANSITION`), and ESLint behind it is at 219/218 warnings
(`inspector-global-border-artnet.js:199`, `routes-scene-shared.js:11`).
