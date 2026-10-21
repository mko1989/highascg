**Status: IN PROGRESS (2026-10-21) — done: C1 take by id + C2 PRV push by id (verified on real Caspar), B golden round trip in both languages, C4 constants endpoint, A generated contract docs + CI guard, D (multiview presets/layouts, GPU rows, DeckLink order, hardware policy on the node); C3 is server-side for the Godot client. Open: switching the web client to C1/C2/C3 (owner QA), optional `project.schema.json`. Parent: [WO-593](./593_WO_godot_client_port_epic.md). PREREQUISITE for every editing feature in the Godot client (WO-600 step 3 onward).**

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

- [x] T1 contract docs (A) + CI guard ✔ 2026-10-21 — generated `docs/wiki/api/contract/{http,ws}.md` + `smoke-wo598-api-contract`; `project.schema.json` not done (the T2 golden fixtures pin the document instead).
- [x] T2 golden round trip: Godot side ✔ (`test_project_roundtrip.gd`); JS side ✔ 2026-10-21 (`smoke-wo598-web-project-roundtrip`).
- [ ] T3 take-by-id parity diff test → switch web client (C1).
- [~] T4 PRV-push-by-id (C2) ✔ server endpoint + verified on Caspar; web client switch pending owner QA.
- [x] T5 constants endpoint (C4) ✔ 2026-10-21 — `GET /api/contract/constants`; client copies pinned by a CI parity smoke instead of a boot fetch (see below).
- [~] T6 effects/PIP/border server routes (C3): server side ✔ — registries served as JSON (`GET /api/scene/effect-registry`), PIP overlay preview-push mode, global-border routes, effects via take/preview-push; the Godot client builds none of it. The web client still builds its own PRV AMCP (`amcp-preview-batch.js` → `/api/raw`) until its switch with T4 (owner QA).
- [x] T7 client-local storage migration (D): multiview presets + multiviewer 2+ layouts ✔ 2026-10-21 (`/api/client-prefs`); slice 2 ✔ 2026-10-21: GPU layout rows, DeckLink rear order, hardware policy. Previs view state (2D/3D, ghost, coverage) stays per screen on purpose; previs tags/presets are already project data (WO-607).

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

## 2026-10-20 — host-channel layer actions moved server-side (via WO-623 D)

- [WO-623](./623_WO_godot_owner_notes_next_md_2.md) D added `POST /api/host-live/layer` (`stop` / `decklink` / `route`).
  - The Godot client now makes no `/api/raw`, `/api/amcp/*` or WS `amcp` call.
  - The web DeckLink add/remove, Sources Live Restart/Stop/Remove, extra-live-source remove, live-audio inspector Stop and
    live-audio PGM routes use the endpoint. Request plans were golden-checked, and it was box-verified through Caspar's log.
- **Still composed in the web client (open here):**
  - ~~`shader-live-editor.js` MIXER / CG ADD, `shader-cg-update.js` CG UPDATE~~ — done 2026-10-21, see below.
  - ~~`multiview-editor-canvas-apply.js` audio focus~~ — done 2026-10-21 (8c93f7a9): `POST /api/multiview/audio-focus`.
  - `amcp-preview-batch.js`: the web PRV preview pipeline (scene PRV push, global border, live effects, edit-chrome
    clear, PRV runtime clear). Godot stages PRV through `/api/scene/*` instead.
  - `logs-modal.js` stays a raw console by design.
- **Rule for the Godot port:** a port of any of these lands its server endpoint first. It never uses `/api/raw`.

## 2026-10-21 — web shader-live editor and multiview audio focus moved server-side

- **What was done:**
  - New `POST /api/shader-live/push { shaderId, payload, prvOnly? }` in `routes-shader-live.js`. It CG UPDATEs the
    web editor's unsaved working copy onto every live instance of the shader, or only the PRV instances for a wiggle.
    It reuses `pushPayload`: AMCP escaping, and a 403 re-hosts once via CG ADD. A payload with any key other than
    `common` / `passes.*.source` is rejected (400), so the endpoint is not a raw AMCP pipe.
  - `shader-cg-update.js` now has `pushShaderPayload()` (the `cgUpdateJson` / `pushCgUpdateTo` raw path is gone).
    `shader-live-editor.js` `pushLive` is one endpoint call, and the MIXER rides go to `/api/shader-live/mixer`.
  - Multiview audio focus (WO-600 M slice 1) is `POST /api/multiview/audio-focus`. It also fixed a web bug: the
    old batch sent `MIXER <ch> VOLUME <layer> -60`, a dB value with the layer in the volume slot.
- **What was VERIFIED:**
  - Smoke `smoke-wo606-shader-live-server` gained a push test. It covers: 3 targets, a 403 re-host, exact AMCP
    escaping of quotes and `\n`, `prvOnly` → PRV only, 5 bad payloads → 400 with nothing sent, and an unknown
    shader → 0 targets.
  - Offline suite 2983/0. On the box after a node restart: an unknown shader gives `{ok, targets:0}` and a bad
    payload gives 400.
- **Open:** a real shader edit / wiggle needs a shader on air, so it is an owner check (box rules: no landing).
  The remaining raw paths are `amcp-preview-batch.js` (needs owner QA to switch) and `logs-modal.js` (by design).

## 2026-10-21 — T2 JS side: web exportProject∘importProject pinned (two web load bugs fixed)

- **Investigation:** the real web state modules (`scene-state`, `timeline-state`, `multiview-state`,
  `program-output-state`, `placeholder-state`, `project-state`) load in node with a small browser stub. All 60 shows
  in `projects/` were run through import → export twice. Every one reached a fixed point after one pass. The only
  first-pass changes were documented one-way ones: WO-160 layer renumbering, and the flat legacy
  `scenes.previewSceneId` rewritten from `previewSceneIdByMain`. The server keeps its own deck PRV id across a save.
- **Bugs found by the committed fixture** (`take-payload-coverage.json`):
  1. A legacy single `pipOverlay` was **deleted on every web load**. `migrateScene` spreads `defaultLayerConfig()`,
     which carries `pipOverlays: []`, so the "no list yet → migrate the legacy overlay" branch never ran. The server,
     Godot `pip_model.gd` and the web `getPipOverlaysFromLayer` all read an empty list as "use the legacy overlay".
     The migration now tests the stored layer with the same rule.
  2. A look with no `globalBorder` got a default without `activePgmLayer`, and the next load added 998. A second
     load + save therefore differed from the first (rev bump + broadcast for nothing). The default now carries 998.
- **What was done:** new fixture `tools/fixtures/projects/web-roundtrip-show.json` (a real show shape, media names
  anonymised, already web-normalised). The Godot round-trip test reads the same directory. New smoke
  `smoke-wo598-web-project-roundtrip` (curated list), with 3 tests:
  - the fixture is byte-identical per slice after a web load + save (values + key order);
  - every fixture loses no input leaf beyond the documented normalisations and is a fixed point;
  - an unknown layer key survives.
  Look-level keys are a whitelist (WO-572); the Godot client writes none of its own.
- **What was VERIFIED:**
  - The smoke fails with the old `pipOverlays` check (mutation run) and passes with the fix.
  - Offline suite 2986/0, Godot suite 20364/0 (+3 fixture cases), all gates green.
- **Open:** nothing for T2. A show saved with a legacy `pipOverlay` and opened in the web client before this fix has
  already lost that overlay on disk; that cannot be recovered.

## 2026-10-21 — T5 / C4: `GET /api/contract/constants`

- **What was done:**
  - New `src/api/routes-contract.js`, registered on the existing router line, so router.js stays at 499 lines.
  - It serves `{ version: 1, layers }`, built from the modules that own each band: `look-layer-ranges.js`,
    `global-border(-control).js`, `multiview-apply.js`, `routes-shader-stack.js` and `live-audio-input.js`.
  - Contents: audio buses, look bank A/B, audio-only 200, timelines 210+50, PIP 260–979 ×4, edit chrome 990,
    borders 996/997/998, ceiling 999, live-audio layer 10, shader stack 10–20, and multiview BG / cells / overlay.
  - `routes-scene-global-border.js` imports the PRV mirror 997 instead of redefining it.
- **Decision:** the clients keep their compile-time copies. Both render before any fetch returns, and making the
  copies async would touch dozens of call sites for no runtime change. Instead, `smoke-wo598-contract-constants`
  reads 22 copies (16 web, 5 Godot, 1 in `src/routing-map.js`) and fails CI when any of them differs from the
  document. It also checks that the bands are ordered without overlap, and that the route runs without Caspar.
- **What was VERIFIED:** the smoke passes 4/4; offline suite 2990/0. On the box after a node restart, the endpoint
  returns the document (200).
- **Open:** none. A new copy elsewhere should be added to the smoke's `COPIES` table.

## 2026-10-21 — T7 / D slice 1: multiview presets and multiviewer 2+ layouts on the node

- **Investigation:** the web client kept the four multiview preset slots of every multiviewer, plus the layouts of
  multiviewers 2+, in browser localStorage. The Godot port (WO-600 M) kept them in `ui.cfg`. So a preset saved in
  one client never reached the other. Multiviewer 1's layout was already shared (the project's `multiview` slice).
- **What was done:**
  - New `src/api/routes-client-prefs.js` (registered on the existing router line):
    - `GET /api/client-prefs` returns `{ prefs }`.
    - `POST { key, n, value }` writes one multiviewer's entry, so two clients on different multiviewers never
      clobber each other. `value: null` removes it.
    - Keys are whitelisted (`multiviewPresets` = 4 slots of `{cells}`|null, `multiviewLayouts` = `{cells}`, n 2–16)
      and capped at 512 KB.
    - Data is stored in the node's test-isolated persistence file (`clientPrefs`, already in .gitignore + .stignore).
      Each write broadcasts WS `client_prefs`.
  - Web: new `client/lib/client-prefs.js` mirror, loaded on every WS connect. `multiview-state.js` reads the node's
    copy first and falls back to localStorage, and writes both. After a load, entries only this browser had are
    pushed up once (empty ones are skipped). The echo of our own write is ignored, so there's no redraw or autosave.
  - Godot: `mv_prefs.gd` (pure) + `multiview_tab.gd` follow the same rules against `ui.cfg`. A change to the open
    multiviewer reloads it (not mid-drag).
- **What was VERIFIED:**
  - Smoke `smoke-wo598-client-prefs`, 4 tests: per-n writes, 8 refused shapes changing nothing, the GET shape, and
    the real web modules with a stubbed fetch (node wins, migration pushes only what the node lacked, own echo
    ignored, the other client's layout reloads).
  - Godot `test_multiview_prefs.gd` (+22). Offline suite 2994/0, Godot suite 20386/0.
  - On the box (node restarted, GUI relaunched on Multiview):
    - The empty `presets_1` in `ui.cfg` was not pushed.
    - Clicking preset 2 in Godot put it on the node.
    - A write from another client (curl) lit preset 3 in Godot over WS.
    - Right-click → Clear on both cleared `ui.cfg` and the node. The node entry was then removed, which restores the
      starting state; GUI log 0 errors.
- **Open:** a live web ↔ Godot check (web editor in a browser) is on the owner checklist. Still per client: GPU
  layout view prefs (hidden ports / labels), DeckLink rear order, hardware policy, live-audio play targets.

## 2026-10-21 — T1 / A: generated HTTP + WebSocket contract, CI guard

- **Investigation:** routes are declared in two ways. Some go through the RouteRegistry (`routes.get/post/delete` in
  `router.js` and the modules' `register(routes)`, 301 at runtime). The rest are matched by path literal inside the
  fallthrough handlers of `router-dispatch.js` (`p === '/api/…'`). WS types are sent with `_wsBroadcast` /
  `broadcast` / `JSON.stringify({ type })` and handled in `src/server/` and `src/tracking/register.js`. Structured
  AMCP types map to HTTP routes through `TYPE_TO_PATH`.
- **What was done:**
  - New `tools/dev/gen-api-contract.js` scans `src/` and writes:
    - `docs/wiki/api/contract/http.md`: 447 routes as Method | Path | registry/handler | module, plus a blurb per
      module.
    - `docs/wiki/api/contract/ws.md`: 81 types (83 after the correction below) as direction | type | module | note, where the note gives the
      `TYPE_TO_PATH` target.
  - No line numbers, so unrelated edits don't make the docs stale. `--check` exits 1 when they are stale.
  - `router.js` also exports `routes` (on the existing export line; still 499 lines).
  - New smoke `smoke-wo598-api-contract` (curated list), 3 tests:
    - the committed docs equal the generator output;
    - every runtime registry route is in http.md;
    - both directions and both route kinds are present, and the `typeof t !== 'string'` false positive is not.
- **What was VERIFIED:**
  - Smoke 3/3.
  - Mutation check: a temporary `routes.get('/api/zz-mutation')` module failed the smoke as "http.md is stale", and
    it passed again once the module was removed.
  - Runtime cross-check: 301/301 registry routes are in http.md.
  - Offline suite 2997/0 (2 skipped); lint 216; lines OK.
- **Open:** payload schemas are not generated. The table points at each module's JSDoc.
- **Correction (same day):** `log_line` and `timeline.playback` looked like listeners with no sender. Both are
  broadcast from `index.js` (boot wiring), which the first scan left out. The generator now scans `index.js` too (83 types).

## 2026-10-21 — T7 / D slice 2: GPU layout rows, DeckLink rear order, hardware policy on the node

- **Investigation:**
  - Three more pieces of operator setup lived in one client's storage:
    - the Device View GPU rows (hidden flags + labels): web `gpu_custom_layout`, Godot `devices.cfg [gpu] layout`;
    - the DeckLink rear-panel order: web `decklink_rear_panel_order`, Godot `devices.cfg [decklink] rear_order`;
    - the project-load hardware policy: web `highascg_hardware_policy`, Godot `ui.cfg [project] hardware_policy`.
  - Both clients already used the same shapes: rows with an `id`, string ids, and one of three words.
  - "Live-audio play targets" (listed as open in slice 1) are not client prefs. DeckLink / v4l2 / ALSA targets are
    server config already (WO-604 slices 3 + 5). The remaining input kinds' targets in `live-audio-play-targets.js`
    are the WO-604 leftover and belong there, not in this key-value store.
- **What was done:**
  - `routes-client-prefs.js` gained **global keys** (no `n`): `gpuLayout`, `decklinkRearOrder`, `hardwarePolicy`.
    - Strict shapes; `null` = none / remove.
    - The broadcast is `client_prefs {key, value}`.
    - GET returns all five keys.
  - Web:
    - `client-prefs.js` gained `readGlobalPref` (the node's value, else localStorage) and `writeGlobalPref` (both).
      After a load, values only this browser had are pushed up once.
    - The three owner modules read through it. `saveDecklinkOrder` and `saveGpuLayoutPrefs` replace seven direct
      localStorage writes.
    - The device view reloads when another client changes the rows or the order: right away when on screen, otherwise
      when the Devices tab is next shown.
  - Godot:
    - New `core/client_prefs.gd`: a static mirror plus `attach()` from main.gd (GET on every connect, push-up, WS).
    - `gpu_layout.gd`, `decklink_order.gd` and `hardware_reconcile.gd` read the node first and write both. The Devices
      tab refreshes on a change.
    - Autoloads are looked up by name at runtime, so the pure test runner (which has no autoloads) can't write to the
      live node.
  - The DeckLink reset tooltip no longer says "for this browser".
- **What was VERIFIED:**
  - Smoke `smoke-wo598-client-prefs`, 6 tests (+2): global writes, 4 refused shapes, no `n` in the broadcast, and the
    real web modules (node wins, push-up of browser-only values, the localStorage copy kept, own echo ignored,
    another client's rows applied). A mutation that disables the push-up fails it.
  - Godot `test_client_prefs_global.gd` (+25 → 20411/0). Offline suite 2999/0; lint 216.
  - On the box (node restarted, GUI relaunched on Devices):
    - With no local copies, nothing was pushed.
    - A curl write (`gpu_p0` label "SHARED TEST", DeckLink order 1·2·3·4) showed on the Godot rear panel live.
    - GPU pencil → **Show all** in Godot put the four rows on the node.
    - Restored: node keys back to null, the `[gpu]` key the click wrote removed from `devices.cfg`, GUI relaunched on
      Multiview; GUI log 0 errors.
- **Open:**
  - A web ↔ Godot check with a browser is on the owner checklist.
  - The web **New project** now clears the shared GPU rows for every client (before, it cleared one browser's copy).
    Owner to confirm.

## Earlier notes

Nothing yet. Facts ✔ re-read by hand; counts from greps (2026-10-17).
