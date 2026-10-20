**Status: IN PROGRESS (2026-10-20) — A (performance overlay), B (new look: deck drop / "+" / delete) and C (Sources Templates / Timelines tabs) DONE and box-verified; D (Godot raw-AMCP sites → server endpoints) to follow. Parent: [WO-593](./593_WO_godot_client_port_epic.md). D continues [WO-598](./598_WO_client_contract_and_thin_client.md).**

# WO-623 — Godot: owner's next.md notes (round 2)

Owner, 20.10 (`next.md`, added after WO-621):

1. *"i dont see a way to create a new look. dragging a media file onto an empty space in looks deck should create a new
   look with that media on first layer."*
2. *"sources tab is lacking tabs with media templates live and timelines."* (Media and Live exist since WO-622.)
3. *"as a bigger task i also need you to make sure anything that happens in casparcg is composed in the node server
   and not in the client. this way im a sure each function or set of actions is an api endpoint."*
4. *"the godot client is coming up very nice by the way. im wondering about performance and how it affects resources.
   can i get a system overlay that can be turned on/off with performance stats. cpu gpu ram etc."*

Each part is its own unit: A = note 4, B = note 1, C = note 2, D = note 3.

## Investigation

The research was split across four read-only Haiku agents (one per note). Their load-bearing claims were then
re-checked by hand as noted.

### A — what the server already measures (note 4)

- **`GET /api/host-stats`** (`src/api/router.js:107` → `src/api/routes-host-stats.js` `handleGet`). Checked live on the
  box. It returns:
  - `cpu {load1, load5, load15, cores}` from `os.loadavg()`. That is a run-queue length (load1 9.76 on a box whose CPUs
    were about 21 % busy), not a utilisation.
  - `memory {totalBytes, freeBytes, usedBytes}`.
  - `media.disk` (statfs).
  - `gpu {text, utilizationPct, source}` from `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total`,
    cached 5 s, with the negative result cached too (smoke `smoke-host-stats-gpu-negative-cache`). VRAM appears only
    inside the `text` string, and there is no temperature.
  - `processes.caspar` / `processes.highascg` `{pid, cpuPct, rssBytes, cpuPctOfMachine}` from `/proc`
    (`src/system/proc-stats.js`, WO-165).
  - Preshow (`offline_mode`) returns a stub of nulls.
- The web shows these figures only in the connection-eye hover tooltip (`client/components/connection-eye.js:277`,
  fetched on mouseenter, throttled to 2.5 s). No WS message carries them and nothing polls them.
- **What the Godot client can measure itself:**
  - Godot's `Performance` monitors (`TIME_PROCESS`, `RENDER_TOTAL_DRAW_CALLS_IN_FRAME`, `RENDER_TOTAL_OBJECTS_IN_FRAME`,
    `RENDER_VIDEO_MEM_USED`) and `Engine.get_frames_per_second()`.
  - Per-viewport render time (`RenderingServer.viewport_get_measured_render_time_cpu/gpu`, as the dev
    `app/perf_probe.gd` already used for WO-617).
  - Its own CPU and RSS from `/proc/self/stat|status`.
- **Gotcha, measured:** `FileAccess.get_file_as_string("/proc/self/stat")` returns `""`, because procfs reports length
  0. A headless probe printed `as_string len=0` but `get_line len=1558 has VmRSS=true`. The first overlay build
  therefore showed CPU "—" and silently fell back to Godot's static-memory figure for RAM. `/proc` must be read line by
  line.
- The root window's measured GPU time is near 0 (it is 2D). The 3D previs renders in SubViewports, so the overlay must
  sum every viewport, as `perf_probe.gd` does.

### B — new look (note 1)

- **The web has two paths:**
  - The "+" tile at the end of each main's deck: `client/components/scene-list-column.js:427-440` calls
    `sceneState.addScene(undefined, {mainScope: col})` and then opens the look in the editor.
  - A media drop on blank deck space: `scene-list-column.js:461-490` → `scenes-editor-deck-drop.js:34-130`. It calls
    `addScene` (mainScope `'0'` with one screen, else the column), then for each payload `addLayer` + `setLayerSource` +
    `applyNativeFillForSource`, opens the look, and pushes PRV. Timer payloads do not create a look.
- **`addScene`** (`client/lib/scene-state.js:291-295`) builds `{id: uuid, name: "Look N+1", layers: [], mainScope,
  defaultTransition: {...defaultTransition(), ...globalDefaultTransition}}` and appends it to the end of the list.
- **No server endpoint creates a look.** Looks are persisted by the client through deck sync. `POST
  /api/scene/new-layer` (WO-600 / 622) already builds the layer the drop needs, from a source.

### C — Sources Templates / Timelines (note 2)

- **Templates** (`client/components/sources-panel-templates.js:32-115`):
  - The data comes from `GET /api/templates`, which is Caspar TLS (`src/api/media-catalog.js:58-66`), as `{id, label}`.
  - Rows show an FT pill. Shader rows (`shaders/sh-…`) show an FX pill with the library name from `/api/shaders`.
  - CG Studio lower-thirds get an "Edit" button.
  - The drag payload is `{type:'template', value:id, label}`.
- **Timelines:** `renderSourceList(…, 'timeline')` over `timelineState.getAll()`. The rows are `{id, label: name}` with
  the drag payload `{type:'timeline', value:id, label}`. Right-click renames the timeline (PUT `/api/timelines/:id`).

### D — client-composed AMCP (note 3)

- **Godot** sends raw AMCP from three sites:
  - `features/devices/decklink_input_model.gd:144`: `PLAY c-l DECKLINK n` after `HS.stop_cmds`.
  - `input_slots_model.gd:194`: STOP + `MIXER c-l CLEAR`.
  - `host_source_model.gd:356`: the same STOP + `MIXER c-l CLEAR` pair.
- **The web** composes AMCP in about 10 features (31 sites):
  - live-audio routing;
  - DeckLink add/change;
  - Sources Live row stop/start;
  - extra live source remove;
  - inspector live-audio stop;
  - shader live editor MIXER/CG;
  - shader CG UPDATE;
  - multiview audio focus (`/api/amcp/batch`);
  - logs console (raw by design);
  - the shared PRV preview pipeline (`client/lib/amcp-preview-batch.js`), used by scene PRV push, global border, live
    effects, edit-chrome clear and PRV runtime clear.
- The server pass-throughs are `/api/raw`, `/api/amcp/raw`, `/api/amcp/batch` and `/api/amcp/raw-batch`
  (`src/api/routes-amcp.js`), plus WS `amcp`.

## What was done

### A — performance overlay (DONE)

- **Server** (`src/system/host-cpu-usage.js`, new):
  - Whole-machine CPU busy % from the `/proc/stat` `cpu` line. Idle counts iowait, and guest columns are excluded
    because the kernel already counts them in user/nice.
  - The delta window is the time since the previous call, so a 2 s poller gets a 2 s average. The first call, or one
    made within 250 ms of the last, measures 200 ms.
- **Server** (`routes-host-stats.js`):
  - Adds `cpu.usagePct`.
  - Adds `temperature.gpu` to the nvidia-smi query, and returns numeric `gpu.vramUsedMiB`, `vramTotalMiB` and `tempC`
    beside the unchanged `text`, so the web tooltip is untouched.
  - The cache-hit path now returns the whole cached probe. The negative-cache stamp is unchanged.
- **Godot** `app/perf_overlay_model.gd` (pure) and `app/perf_overlay.gd`:
  - A `CanvasLayer` (layer 90) holding a click-through panel at the top right, under the header, in two sections.
  - **THIS CLIENT:** FPS, frame (process) ms, render cpu/gpu ms summed over the window and every SubViewport (rescanned
    every 5 s, because tabs build theirs lazily), draw calls and objects, Godot VRAM, CPU % per core with its share of
    the box, and RSS.
  - **BOX:** CPU % with load, RAM used/total, GPU % and °C, VRAM used/total, media disk free, and CasparCG / HighAsCG
    process CPU and RSS.
  - Warn and alarm colours use the theme's WARN / ERROR (e.g. CPU ≥ 70 / 90 %, GPU temperature ≥ 80 / 88 °C, disk ≥ 85
    / 95 % full, FPS < 45 / 20).
  - It polls only while shown. Client figures refresh every 0.5 s and `/api/host-stats` every 2 s, with no overlapping
    requests. Labels are reused rather than rebuilt.
- **Toggle:**
  - A pulse icon in the header, left of the connection eyes (`assets/ui/icons/pulse.svg`). It is tinted ACCENT while
    on.
  - `F3` toggles from anywhere (`shell.gd` `_shortcut_input`).
  - The state is remembered in `ui.cfg [overlay] perf`. The dev arg `--perf=1` forces it on without saving.
- **Why not a WS stats broadcast:** polling only while the overlay is visible costs the server nothing when it is off.
  The web tooltip already pulls the same route.

### B — new look (DONE)

- **Server** `src/api/routes-scene-new-look.js` (new) — `POST /api/scene/new-look {mainIdx, mainScope?, source?}`.
  - It builds, but does not store, web `addScene`'s object, using the web's own `migrateScene` / `newId` /
    `defaultTransition` from `client/lib/scene-state-helpers.js`:
    - name `Look N+1`, where N is the live deck's snapshot count, else the stored project's;
    - the column's `mainScope`;
    - `{...defaultTransition(), ...project.scenes.globalDefaultTransition}`.
  - With a `source`, the look's first layer (L10) is built by `buildLayerForSource`. That function was split out of
    `routes-scene-new-layer.js` `handleNewLayer`, so the deck drop and the editor drop share one implementation:
    editor defaults, images never loop, file trim/mute defaults, native fill on that main's canvas, and the WO-156
    route rule.
  - Timer payloads are refused, as in the web deck drop. A look is never stored by the server: the client appends it
    and deck-syncs it like any edit.
  - Routed in `routes-scene.js`.
- **Godot** `deck_view.gd`:
  - Each screen column and its card grid are drop targets (`set_drag_forwarding`). The columns now fill the deck's
    height, so all the blank space under the cards takes a drop.
  - A "+" tile follows the cards. A click makes an empty look, and a drop makes a look with that source.
  - `create_look()` POSTs, appends to `project.scenes.scenes`, commits (deck sync + autosave), and opens the look in
    the editor. That stages it on PRV, as the web's `setEditingScene` + preview push does.
  - `mainScope` is `'0'` with one screen, else the column, following the web drop.
- **Godot** `look_editor.gd`:
  - `open()` no longer pushes a look with no sourced layer. The take route refuses one ("incomingScene has no layers
    with sources"), which showed as "push failed" on a fresh "+" look. The web "+" stages nothing either. The status
    line says to drop a source instead.
  - The Close button's body became `close_editor()`.
- **Delete look** (needed to undo a stray new look; the Godot deck had no delete):
  - The card menu gains "Delete look…" with the web's confirm text (`Delete look "X"?`).
  - `look_edits.gd` `remove_look()` mirrors web `removeScene`: it drops the look and the look presets pointing at it.
  - The live tab closes the editor if it shows the deleted look.

### C — Sources Templates / Timelines (DONE)

- **Tabs.** `media_panel.gd` now has four tabs in the owner's order: Media / Templates / Live / Timelines. The web's
  Effects tab stays as the EFFECTS group in the Media tree (WO-602 slice 9).
  - Tab switches go by control rather than index. That covers the DeckLink drop → Live switch and ↻ reloading the
    current tab.
  - The dev arg `--sources-tab` is now 0..3.
- **`source_lists_model.gd`** (pure) mirrors the web:
  - `template_rows`: the TLS `{id, label}` with the web's fallbacks. The filter matches the TLS label, not the display
    name.
    - `shaders/sh-…` rows get an FX pill and their library name from `/api/shaders` (owner bug 27.07.26), while the
      drag label stays the TLS label.
    - CG Studio `lower-thirds/lt-` rows are kind `cg`; everything else is FT.
  - `timeline_rows`: `{id: t.id || t.name, label: t.name || t.id}` from `project.timelines.timelines`, with a tooltip
    showing duration and layer count.
  - Payloads are the web's `{type: "template" | "timeline", value, label}`.
- **`source_list_panel.gd`** is a reusable list: filter, two-column Tree (pill | label), drag forwarding, a render-key
  skip, and an empty-state line.
  - Templates load lazily on first view (`/api/templates` + `/api/shaders`); ↻ re-reads them.
  - Timelines rebuild on `project_changed` and on tab show.
- **Left out of the web rows:**
  - The CG Studio "Edit" button, which opens the web studio or :4300.
  - The shader "Edit" (the web Shader FX modal) and the shader audition click (the web Shader Live mode).
  - Timeline rename by right-click; the Timeline tab owns the name.
- Both kinds drop anywhere a source does: look editor frame, deck blank space / "+" (B), and timeline clips.

## What was VERIFIED

### A

- **Offline smoke:** `smoke-wo623-host-cpu-usage` 4/4 (parse, delta, a live sample in 0..100, route fields), plus the
  existing `smoke-host-stats-gpu-negative-cache` 2/2. Added to the curated list.
- **Full offline suite:** 2781/2784. The single failure is the pre-existing `smoke-wo577-shader-controls`, caused by
  the untracked `data/shaders/sh-sa-fluidic-space.json`, and is unrelated.
- **Godot:** `test_perf_overlay.gd` (34 assertions), with the host body captured from the box. The full suite passes
  15487/15487, and `--check` boots clean.
- **Box, after a server restart:**
  - `/api/host-stats` → `cpu.usagePct 21.1` (then 20.5 two seconds later) and `gpu {utilizationPct 32, vramUsedMiB
    2321, vramTotalMiB 24467, tempC 57}`.
  - In the overlay on the Live tab, client RAM 747 MiB matched `ps` RSS 765452 kB, and client CPU 22–26 % matched `top`
    (20.0 / 22.9 / 25.0 %).
  - The box rows matched the API. On Previs, render showed `cpu 0.6 · gpu 0.2 ms`; before the SubViewport sum, the
    root window alone read gpu 0.0.
  - A header click hid the overlay, with the icon white. F3 showed it again, with the icon blue, and `ui.cfg` gained
    `[overlay] perf=true`. `ui.cfg` was restored to the owner's copy afterwards, so the overlay starts off.
- **Owner-QA:** whether the panel's position and contents are what they want, and whether it should start on.

### B

- **Offline smoke:** `smoke-wo623-new-look` 5/5:
  - the "+" shape equals web `migrateScene` of the `addScene` object;
  - a media drop gives L10 with native fill on a 3840×1080 main;
  - the live deck count wins over the stored project;
  - mainScope rules and unique ids;
  - refusals: empty value, timer, and self-route — the last is the WO-156 message, checked by hand.
- `smoke-wo600-new-layer` is still 12/12 after the `buildLayerForSource` split.
- **Full offline suite:** 2786/2789, with only the known `wo577` shader failure.
- **Godot:** `test_look_edits` `test_remove_look`; the full suite is 15493/15493.
- **Box** (server restarted for the route):
  - `curl POST /api/scene/new-look {mainIdx:0}` returned an empty "Look 4" with mainScope `"0"` and MIX 12 linear.
  - **Drop on blank space:** "4. Tło 4 - delikatne fale.mp4" (Sources tree) dropped on blank deck space under the
    cards. The result was "Look 4" with L10 = that clip, opened in the editor, and "PRV: take". `/api/scene/live`
    channel 2 = Look 4 with fill x −0.5, scaleX 2, scaleY 1.244. That is native for the clip, whose ffprobe size is
    3840×1344.
  - **"+" click:** made an empty "Look 5". The first build showed the push-failed line; after the fix, reopening it
    shows the "Empty look — drop a source…" hint, and PRV was untouched (still Background).
  - **Drop on "+":** "Bankiet.PNG" made "Look 6" with L10 `loop:false` and native fill 0.667 centred. It was staged on
    PRV.
  - All three looks survived a client relaunch, so they were persisted.
- **Cleanup through the new Delete:**
  - Background was re-staged on PRV, then Looks 6, 5 and 4 were deleted via the card menu and confirm dialog.
  - The project is back to `['Opening', 'Background', 'Waves']` with lookPresets `[]`. PGM = Opening, PRV =
    Background.
  - The `config/` md5 manifest is identical before and after.

### C

- **Godot:** `test_source_lists.gd` (shader names, rows / pills / kinds with the box's uppercase TLS ids, backslash ids,
  label/id fallbacks, filter-on-TLS-label, timeline rows / tooltips / filter). The full suite is 15509/15509 and `--check`
  boots clean.
- **Box:**
  - The Templates tab listed the 221 TLS entries.
  - Filter "sh-3d" showed seven FX rows named "mirrors c2…c7" and "mirrors", not the TLS ids.
  - **BLACK → blank deck space:** made a look with L10 `{type: template, value: BLACK}` and full-frame fill, staged on
    PRV (`/api/scene/live` ch 2). Two such looks came out, because the first drop landed just before the owner switched
    the workspace to Previs ("that was me").
  - **Timelines tab:** listed "Timeline" (the project's one).
  - **Timeline → blank deck space:** made "Look 6" with L10 `{type: timeline, value: tmve1ppeug1t}`, staged on PRV. The
    timeline state went to `playing: true, position 3003`, which is WO-541's timeline-only look take.
- **Cleanup:**
  - Re-staging Background on PRV stopped the timeline (`playing: false, position 0`).
  - Looks 6/5/4 were deleted through the card menu. The project is back to Opening / Background / Waves, with PGM
    Opening and PRV Background.
  - The `config/` md5 manifest is identical.
