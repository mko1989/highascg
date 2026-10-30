# WO-622 — Godot Sources panel: "Live" tab (live sources draggable into looks)

**Area:** godot-client, media
**Status: DONE (2026-10-20, box-verified: Live tab rows, DeckLink → look editor layer, DeckLink port → Sources lands on the highlighted source; suite 15453/15453, offline smoke 12/12) — Parent: [WO-593](./593_WO_godot_client_port_epic.md). Follows [WO-605](./605_WO_godot_port_device_view.md) slice 12 (DeckLink drop on Sources) and [WO-600](./600_WO_godot_port_live_core.md) K (Sources panel) / "route sources (WO-156 rules server-side)".**

Owner, 20.10: *"the live sources should be available to use in looks or the compose preview from a tab inside sources
browser. right now i can see the live source ready at the bottom, but it means nothing does nothing and is in a wrong
place"*

## Investigation

- **The bottom line.** WO-605 slice 12 added a status `Label` under the Sources tree (`media_panel.gd` `_status`). A
  DeckLink dropped on Sources printed "Live source ready: …" there. That was the only trace of the new source. There was
  no Live list to find it in or drag it from.
- **The web Sources panel** has tabs (Media / Templates / Effects / Live / Timelines). The Live tab is
  `client/components/sources-panel-live-render.js` `renderLiveTab`.
  - **Rows, in order:**
    1. Saved extras (`state.extraLiveSources`) whose value is not already in the base list. Each goes through
       `migrateLegacyInputRoute` and then `reconcileExtraLiveSourceChannel`.
    2. The base list, `buildLiveSources` (`sources-panel-helpers.js:342`):
       - the System Timers template;
       - PGM / PRV routes (`route://<ch>`, named "PGM: <virtual main>" or "Program N");
       - DeckLink inputs (`listInputChannels`, labelled by entry, else connector label, else "DeckLink N");
       - live audio and USB inputs (with the configured slots from `GET /api/audio/live-inputs` and
         `GET /api/v4l2-inputs`);
       - audio zones.
  - **Per row:**
    - line 2 is resolution · rate, plus device path, host channel, page size, route, "Direct (legacy)" and
      "CG template" where they apply;
    - line 3 is a warning from `decklinkSlotStatusMessage` / `liveAudioSlotStatusMessage` / `v4l2SlotStatusMessage`;
    - the thumbnail is `getLiveThumbnailChannelForSource` → `/api/thumbnail/live/<ch>`;
    - dragging (`makeDraggable`) sends `{type, value, label, resolution, fps, routeType, thumbnailChannel?,
      useDirect?, browserAsCg?}`.
  - The channel map is `effectiveChannelMap`: the planned (Settings) map while host channels wait for Apply.
- **The drop target refused routes.** The Godot look editor frame drops through `POST /api/scene/new-layer`
  (WO-600 F). That handler returned 400 "route sources are not supported here yet (WO-156 rules are client-side)"
  (`src/api/routes-scene-new-layer.js:68`). The first box drag of DeckLink 2 into a look showed exactly that refusal.
- **The web compose drop for routes** (`scenes-compose.js` `addLayerFromMedia` → `routeLayerDropAllowed`):
  - `routeDropRejectionMessage(value, {editChannel, pgmChannel, targetLayerNumber})` refuses whole-channel routes
    into the main's own PGM / PRV, and a route onto its own channel-layer (WO-156).
  - The channels come from `resolveLookStackChannelForBus(cm, sceneState, scene, 'edit' | 'pgm')`.
  - The fill comes from `fetchMediaContentResolution`: the payload's resolution first, then `getContentResolution`
    (routed channel → input / program resolution).
  - `type: 'live_audio'` layers start at opacity 0.
  - The rule lived in `client/components/scenes-shared.js`. That module imports `scene-state.js`, so it is not safe to
    require on the server. `input-channels.js` already hosts `parseRouteValue` for the same reason (WO-323).
- **Thumbnails on the box:** DeckLink channels 4–7 return PNGs (~4.4 MB each). PGM / PRV channels 1–2 return 404. The
  web shows its fallback icon there, and Godot leaves the box empty.

## What was done

- **`godot/client/features/live/live_sources_model.gd`** (new, pure): the web row assembly as data.
  - `effective_cm`, `build` (buildLiveSources), `migrate_route`, `reconcile_extra`, `sources` (extras + base).
  - `hint`, `meta`, `slot_message` (all three kinds), `thumb_channel`, `drag_payload`, `format_fps`.
  - It reuses `host_channels.gd` for the slot / channel lookups.
- **`godot/client/features/live/live_sources_panel.gd`** (new): the Live tab.
  - **Rows:** thumbnail, name, line 2 muted, line 3 in WARN colour, a tooltip with the route.
  - **Dragging** a row hands the look editor the web payload. The look editor's existing `_can_drop` / `_drop` accept
    it unchanged.
  - **Data:** connectors, live-audio and USB configs are fetched on open, on ↻ and after a DeckLink drop. Rows rebuild
    on `Store.changed` (channelMap, extraLiveSources, the three status objects) and on Settings load / change.
  - **Render key:** the list is rebuilt only when what it shows changes (WO-401: the status objects re-stamp
    `updatedAt` on every retry).
  - **Thumbnails** are fetched once per channel until ↻.
  - **DeckLink drop** (WO-605 slice 12 flow, moved here from `media_panel.gd`):
    - progress and errors show at the TOP of the Live tab;
    - on success the note hides and the new source's row is outlined (matched by `connectorId`) and scrolled into
      view;
    - it then re-reads its data.
  - The web hint paragraph is not shown. Its text describes web-only row actions ("Use Stop", "click a tile",
    "Shift+↗"), and the standing UI principle is minimalism. The row tooltip says "Drag onto the look editor to add a
    layer".
- **`godot/client/features/live/media_panel.gd`:**
  - The bottom `_status` label is removed.
  - The panel is now a `TabContainer`: **Media** (filter + tree, EFFECTS group as before) and **Live**.
  - A DeckLink dropped on the Media tree switches to Live and hands the drop over.
  - ↻ reloads the current tab.
  - Live's signals are re-emitted, so `shell.gd` is unchanged (Live workspace tab, Devices restart-dirty, device-view
    re-read).
  - Dev arg `--sources-tab=0|1`.
- **`godot/client/features/live/look_editor.gd`:** the layer list and frame labels name live / template layers by their
  label ("DeckLink 2", as the web layer row `src.label || src.value`). Before, they showed the last path segment of
  the value ("5-2"). Media layers keep the file name.
- **`src/api/routes-scene-new-layer.js`:** route sources are accepted under the web rule.
  - `inputs.routeDropRejectionMessage` runs with `stack.resolveLookStackChannelForBus(map, {activeScreenIndex: mainIdx},
    scene, 'edit' | 'pgm')` and the new layer's number. A refusal is a 400 with the web's toast text.
  - Fill: the payload resolution, else `mixer-fill.js` `getContentResolution` over the channel map, else the media
    paths as before.
  - `live_audio` layers start at opacity 0.
  - The channel map / mainIdx lookup moved above the route check.
- **`client/lib/input-channels.js` / `client/components/scenes-shared.js`:** `routeDropRejectionMessage` moved to
  `input-channels.js` unchanged, and is re-exported from `scenes-shared.js` for the four web importers. This keeps one
  implementation, as with `parseRouteValue`.

### Not ported (first cut)

- Per-row actions: Stop, Apply PLAY, ⛶ operator monitor, webpage / browser / NDI host inspectors, the timers-row
  click, capture / upload thumbnail.
- Multi-select drag.
- Dropping onto a look deck card. The look editor frame is the compose drop target, as in the web.

## What was VERIFIED

- **Golden** `godot/client/tests/golden/live_sources.json`: `renderLiveTab` run under Node on a fake DOM (generator in
  the session scratchpad). Inputs are the box fixtures (state, settings, live-audio / USB configs, device-view
  connectors) plus 11 cases:
  - box; no channel map; pending apply (planned map used); no extras;
  - legacy + duplicate extras; host routes (webpage / NDI / browser display, NDI direct, CG page);
  - all four DeckLink warnings; AMCP offline; audio + USB inputs with failures;
  - virtual-main names + hidden preview + audio zone; connector label / externalRef;
  - audio running + USB offline.

  `test_live_sources.gd` compares label, line 2, warning, thumbnail channel and the drag payload per row, plus the
  hint and the helpers. The Godot suite passes 15453 / 15453 (+510). `--check` boots clean, and no file is over
  500 lines.
- **Server:** `tools/smoke/smoke-wo600-new-layer.test.js` 12/12.
  - DeckLink route → layer 11 fitted to the 1280×720 input on 1080p (⅔ centred);
  - the payload resolution wins;
  - `route://1` / `route://2` refused with the PGM / PRV texts;
  - `route://2-11` onto layer 11 refused, `route://2-10` allowed;
  - PGM-only main allows `route://2`;
  - `live_audio` opacity 0.

  Offline suite: one failure, `smoke-wo577-shader-controls`, caused by the untracked runtime file
  `data/shaders/sh-sa-fluidic-space.json` (30.09, junk "Value" control). It predates this WO and is not in git. ESLint
  is clean on the touched files. `npm run build:client` OK, and the server was restarted.
- **Box (GUI on screen 0):**
  - The Sources Live tab lists System Timers Template, Program 1, Preview 1 and DeckLink 1–4, with "1920×1080 · 50 fps"
    lines and DeckLink thumbnails.
  - Real XTEST drag of the DeckLink 2 row onto the Waves look editor frame:
    - before the server change: "Add layer refused: route sources are not supported here yet";
    - after: layer **L11 `route://5-2`** added full-frame (1920×1080), and DeckLink 2's camera picture showed in the
      compose frame / PRV.
  - The layer was then removed with Remove layer. The project scenes are identical to the pre-test copy.
  - Real drag of the "DeckLink 2" label from the Devices rear panel onto the Sources **Media** tree:
    - Sources switched to Live with "Mapping dlsdi_2 as live input…" at the top;
    - the workspace switched to Live;
    - the note cleared and the DeckLink 2 row was outlined;
    - there was no bottom line.
  - Config: the drop rewrote `device_graph.json` (as in slice 12). It was restored with POST `/api/device-view
    {deviceGraph}` plus the backup file, and the second test ends md5-identical to its baseline.
- **Side effect found and repaired:** the server restart re-applied a stale operator-GUI layout.
  - The project's mirrored `operatorCompose` still held the old 0.2625 × 0.1556 cells. The persisted
    `operatorGuiLayout` held the owner's resized windows (PRV 0.348, PGM 0.393).
  - The boot re-apply shrank the Live preview windows.
  - The owner's cells were POSTed back to `/api/operator-gui/layout`. That also re-mirrored them into the project, so
    the two copies now agree.
  - Remaining state-file differences: project `rev`, a 1-ulp previs yaw from the project round-trip, and connector
    ORDER in the project's device-graph mirror.
- **Owner QA:** drag other live sources by hand (PGM / PRV into a look on another main: the WO-156 refusal text appears
  in the look editor status line). Also check that the outlined row after a DeckLink drop is enough of a "here it is".
