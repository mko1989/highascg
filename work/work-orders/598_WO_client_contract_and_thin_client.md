**Status: IN PROGRESS (2026-10-18) — C1 (take by id) and C2 (PRV push by id) implemented + verified on real Caspar; B Godot side done (wire JSON byte-compatible, golden round-trip test); two server data-safety bugs found and fixed on the way (stale-disk look resolution, deck-sync write overwriting autosaves). Open: B JS side (web exportProject∘importProject), A contract doc, C3/C4, D, switching the web client to C1/C2 (owner QA). Parent: [WO-593](./593_WO_godot_client_port_epic.md). PREREQUISITE for every editing feature in the Godot client (WO-600 step 3 onward).**

# WO-598 — Client contract: document it, make it testable, move show logic to the server ("thin client")

Two clients (web for remote browsers, Godot on the box) will edit the **same show** at the same
time. Today the web client is not a thin view: it owns the show document and builds AMCP. Porting
that logic into GDScript would create two copies that must stay identical forever. This WO shrinks
what each client must know, and pins what remains with shared golden tests.

## Investigation

Sources: inventories [`shell-settings-contract.md`](../godot-port/inventory/shell-settings-contract.md) §2–4, §10,
[`live-core-scenes-preview.md`](../godot-port/inventory/live-core-scenes-preview.md) §G/H/J; facts marked ✔ re-read by hand.

### Transport (small, easy to port)

- WS envelope `{type, data}`; client dispatches on `type` and passes `data` (`client/lib/ws-client.js:127-147` ✔).
  Reconnect 1-2-4-8-16-30 s capped, jitter ≤ 20 %, forever (`computeWsReconnectDelay`, `:13-21` ✔).
  Sends are dropped while not OPEN. Server terminates slow clients at a buffer threshold.
- Inbound types: 23 server types + client events (table in the inventory §2b): `state` (full
  snapshot, authoritative on every connect), `change {path, value, seq?}` (dotted-path patches;
  `scene.live` has a **seq-gap rule** → `GET /api/state`), `project_sync`, `mixer_update`,
  `timeline.tick|playback`, `osc`, `log_line`, `variable_update`, `dmx:colors`, `streaming_channel`,
  `compose.preview`, `operatorGuiLayout`, `companion.buttonPreview`, `global_border_sync`,
  `lower-third.state`, `gpu_topology_changed`, `replication_status`, `usb:*`, `catalog_chunk|error`.
  Server-side broadcast census: 26 distinct types, `change` at 35 call sites (`grep broadcast(` in `src/`).
- Outbound: `scene_deck_sync` (debounced 100 ms, memo 2 s), `catalog_request|subscribe`
  (currently double-encoded — WO-611), `device_view_subscribe`; server also accepts `amcp`,
  `osc_resync`, `multiview_sync`, `selection_sync` (`src/server/ws-server.js:324-382`).
- HTTP: **216 distinct `/api/...` paths referenced by the client** (grep of string literals,
  2026-10-17) vs **256 route registrations** in `src/api/router.js`. Top prefixes: system 30,
  media 16, project 14, replication 12, timelines 10, audio 10, lower-thirds 8, scene 7.
- Boot: `GET /api/settings` → `GET /api/state` → `GET /api/project` (fallback `POST /api/project/load`).
- State store: dotted paths + `'*'` listener (`client/lib/state-store.js`, 121 LOC); IndexedDB cache of
  `media`, `templates`, `channelMap`, `mediaProbe`. Settings: whole-object `POST /api/settings`,
  600 ms debounce, no Save button.

### The show document lives in the client ✔

- `projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)` →
  `normalizeProjectMediaRefs` → `POST /api/project/autosave {project}` with optimistic `rev`
  (`client/app.js:164-200`); 409 `stale_rev` → adopt `storedRev`, retry ≤ 3 (last write wins);
  410 `project_gone` latch (WO-311); 3 s debounce, flush on focus loss / tab change / pagehide.
- Server echoes `project_sync` to all clients → silent `importProject`, echo-skip latch
  (`project-remote-sync.js`), `meta.remote` guard against writing back (WO-341).
- Client-local persistence that a native client cannot see: `localStorage['casparcg_scenes_v2']`
  (scene state, 1 s debounce), previs tags/presets (WO-607 T1), `highascg_hardware_policy`,
  GPU layout keys, `highascg_publish_target`; IndexedDB catalog cache.

### Show logic and AMCP built in the browser ✔

- 12 client files send raw AMCP: `/api/raw` (34 call sites), `/api/amcp/batch`, `/api/amcp/raw-batch`.
- PRV push pipeline builds AMCP batches client-side (`lib/scenes-preview-push-scene.js` 488,
  `components/scenes-editor-support.js` takeGroup fan-out, 13 files / 2,104 LOC in total).
- Takes: client builds `incomingScene` (`buildIncomingScenePayload`, `scenes-preview-runtime.js:215-240`),
  although the server can already resolve a look by id (`src/api/routes-scene-take.js:84-90`, WO-585).
- Duplicated constants/rules "keep in sync with src/…": layer bands (LOOK_LAYER_*, PIP 260–979,
  borders 996–998), `scene-look-kind.js`, `project-fps.js`, `project-media-location.js`,
  `timeline-clip-interp.js` (mirrors `timeline-playback.js`).

## Plan

### A. Document + version the contract (both clients read the same spec)

- `docs/wiki/api/` already exists: add `contract/ws.md` (every type, payload schema, direction),
  `contract/http.md` (generated table from `router.js` + handler JSDoc), `contract/project.schema.json`
  (JSON Schema of the project document, versioned; today's `project.version` field).
- A CI check that fails when a new route/WS type appears without a contract entry.

### B. Golden tests for the project document

- `tools/fixtures/projects/*.json` — real projects (owner's current show, anonymised if needed),
  plus edge cases (CG-only looks, audio-only looks, PIP, borders, timelines with keyframes).
- JS: `exportProject(importProject(x)) == x` (normalised). Godot: same fixtures, same assertion,
  in gdUnit4. Both suites run in CI. **This is what makes two editors on one show safe.**

### C. Thin client: move show logic to the server (ranked by payoff)

**Owner, 17.10: "i didnt know takes werent on server. of course we have to move them." → C is APPROVED.**

1. **Takes by id only** — the server builds `incomingScene` from the stored project (exists for
   Companion). Prove parity first: for every look in the fixtures, server-built payload == client-built
   payload (diff test), then switch the web client, then the Godot client never ports the builder.
2. **PRV push by id** — `POST /api/scene/preview {sceneId, screen}`; server owns the
   full-re-PLAY vs MIXER-only decision (`scenes-preview-snapshot.js` logic moves to `src/`).
3. **Effects / PIP / global border AMCP builders** to server routes (registries become shared JSON).
4. **Layer bands and look-kind rules** exported from `src/` as one JSON constants file consumed by
   both clients at build/boot (`GET /api/contract/constants`).
5. Raw AMCP from clients (`/api/raw`) reduced to diagnostics (logs modal) only.

What stays client-side by design: the editing model itself (selection, drag, in-progress edits),
layout, and the autosave/rev protocol — specified in A and pinned by B.

### D. Client-local storage → server

Previs state (WO-607 T1), hardware-policy preference, GPU layout keys: move to server-side user
prefs (`/api/settings` `ui.*` or a `clientPrefs` object) so any client sees the same setup.

## Tasks

- [ ] T1 contract docs (A) + CI guard.
- [~] T2 golden round trip: Godot side ✔ (`test_project_roundtrip.gd`); JS exportProject∘importProject still open.
- [ ] T3 take-by-id parity diff test → switch web client (C1).
- [~] T4 PRV-push-by-id (C2) ✔ server endpoint + verified on Caspar; web client switch pending owner QA.
- [ ] T5 constants endpoint (C4); web client consumes it.
- [ ] T6 effects/PIP/border server routes (C3).
- [ ] T7 client-local storage migration (D).

## Acceptance

- Godot client (WO-600) implements takes/PRV push without any AMCP string building.
- Golden round-trip passes in both languages on the same fixture set.
- Web client behaviour unchanged (owner QA on PRV/take/borders/PIP).

## What was done (2026-10-17) — C1

| File | What |
|------|------|
| `src/engine/scene-take-payload.js` (new) | `buildServerIncomingScene(scene, {mainIdx, channelMap, pgmOnly})` — mirrors `buildIncomingScenePayload` (`client/components/scenes-shared.js:274`) and **imports the same pure client/lib modules** (`lower-third-cg-data`, `pip-overlay-registry`, `audio-volume-scale`, `transition-presets`; no DOM/singletons, checked) via dynamic `import()` → one source for LT/PIP/dB/PGM-only rules. Canvas = `channelMap.programResolutions[main]` (what the web client feeds `setCanvasResolutions`), fallback 1920×1080. No `playSeekFrames` (the take engine's own OSC read wins — `scene-play-seek.js:247-256`). |
| `src/api/routes-scene-take-look.js` (new) + `routes-scene.js` | `POST /api/scene/take-look {sceneId, mainIdx?, target?: program|preview, forceCut?}` → builds the payload, applies the screen's global border (`withScreenGlobalBorderForChannel`), hands **the exact body the web client sends** to `handleSceneTake` — no second take path. PGM-only rule = web fan-out (`scenes-editor-support.js:178-189`). |
| `tools/fixtures/projects/take-payload-coverage.json` (new) | synthetic coverage: media (fill/trim/startBehaviour/effects/fades/volume), playlist, template data/params, lower third, templateData, route + PIP overlays (array + legacy single), NDI, null source, global border, audio-only, `'all'` scope, no default transition |
| `tools/smoke/smoke-wo598-take-payload-parity.test.js` (new, in curated list) | parity (all looks × mains × PGM-only), canvas/fallback, take-look body + 400/404 cases. `HIGHASCG_PARITY_PROJECTS_DIR=<dir>` adds real shows locally (not committed — owner's shows). |
| `godot/client/features/live/deck_view.gd` | click = PRV, double-click = TAKE via `/api/scene/take-look`; result shown under the video |

Side observation (not changed): `buildIncomingScenePayload` comments (WO-532) say a scoped look uses its OWN
screen's canvas, but `resolveMainIndexForScene(scene, sceneState, canvasIdx)` returns the override whenever
`mainIdx` is passed, so the TARGET canvas always wins. Equivalent in practice (scoped looks go to their own
main); the server port reproduces the code, not the comment.

## What was VERIFIED

**Contract finding (2026-10-17, proven on the simulator) — look edits travel over the WebSocket, not the
autosave.** `POST /api/project/autosave` runs `enrichProjectScenesFromLiveDeck()` first
(`src/api/routes-data-project-handlers.js:380`): once the server has a live deck mirror (`ctx.sceneDeck`,
set by any persist or `scene_deck_sync`), the INCOMING looks are replaced by the mirror's. A look renamed
only through autosave came back `changed:false` (curl and Godot alike). The web client never notices
because it sends `scene_deck_sync {looks, sceneSnapshots, previewSceneId, layerPresets, lookPresets}`
100 ms after every deck edit (`client/lib/app-scene-deck.js`), and the server merges that into the
project (`mergeDeckSyncIntoProject`, persisted with `bumpRev:false`). This is a load-bearing contract rule
→ the contract doc (A) must state it; the Godot `ProjectSync` now does both (deck sync, then autosave),
and resends a deck edit made while the socket was down (the web drops it). Verified: Godot rename →
`deck_syncs:1`, server `rev 3`, `GET /api/project` shows the new name.

- Parity: synthetic fixture **10/10 payloads identical**; owner's real shows (38 distinct files from `projects/` +
  `_autosave/`, copied to the scratchpad) **312/312 identical** (`playSeekFrames` excluded by design).
- Simulator (`--no-caspar`, scratchpad copy, a PGM/PRV destination added to its config): Godot →
  `take-look preview` → 200, AMCP SIM `LOADBG/PLAY 2-10 "TESTOWE/422 TEST 2"` (Look 1 on PRV ch2);
  `take-look program` → 200, `LOADBG 1-110 …` (bank layer) and `scene.live["1"] = Look 1`.
- Full offline suite: no new failures vs clean baseline (one timing flake, `smoke-wo537-look-timeline-starts-where-asked`,
  failed 1/3 standalone runs with no related code change). Boot check OK.
- NOT verified: real Caspar, transitions/takeGroup barrier with multiple mains, owner QA. Web client + Companion
  still use their existing paths (switching them is T3, after owner QA).

## What was done (2026-10-18) — C2, B (Godot), two server fixes

| Change | Why / evidence |
|---|---|
| `src/api/routes-scene-preview-push.js` — `POST /api/scene/preview-push {sceneId, mainIdx?}` | Editing a look staged on PRV: geometry/opacity/rotation/crop only → existing mixer-nudge (same fill math as takes) + staged payload refreshed; anything else → take-look preview + forceCut. Decision = the web's `isGeometryOnlyPreview` (imported) on live-scene-state's staged payload. No new AMCP builder. PGM-only main → `mode:'none'`. |
| `resolveLiveSceneById` (project-scenes-transform.js), used by take-look + preview-push | They read the look from DISK, written 750 ms after a deck sync → a push right after an edit used the previous version (proven: first live geometry push sent the old FILL). Now the validated in-memory deck first. |
| `godot/client/core/net_util.gd` `to_json` at every wire call site | Godot's default JSON sorts keys + 15 digits; server `projectContentEquals` compares stringify output → every Godot save of an unchanged show bumped the rev + broadcast, and web floats were rounded. A/B on the box: old encoder rev 358→359 + write; fixed: no change. |
| `project-scenes.js` deck-sync flush re-reads the stored project | The 750 ms deferred deck-sync write persisted the snapshot from sync time and overwrote an autosave persisted meanwhile (rev regressed, non-deck fields reverted). Proven from mtimes + journal; replay after fix: both files rev 360 with the edit. Affects the web client too. |

## What was VERIFIED (2026-10-18, shop dev box: PGM ch1 DP-7, PRV ch2)

- preview-push after a real `scene_deck_sync`: geometry edit → `mode:nudge`, Caspar `MIXER 2-10 FILL 0.1 0.2 0.6 0.6 0 DEFER`,
  `OPACITY 0.7`, `MIXER 2 COMMIT` (no reload); clip edit → `mode:take`, `LOADBG 2-10 "PROJECTS/AIRPORT/1. TLO 1 …"` + `PLAY 2-10`.
- Smokes: `smoke-wo598-preview-push` (decision + routing + live-deck resolution, 13), `smoke-wo598-deck-sync-persist-race` (3,
  fails on the old code), C1 parity still green; Godot `test_project_roundtrip` (fixtures + synthetic, exact floats + key order).
- Offline suite 2620/2623 — the shader-library failure also fails on `main`. Godot headless 275/0, `--check` OK.

## Earlier notes

Nothing yet. Facts ✔ re-read by hand; counts from greps (2026-10-17).
