**Status: IN PROGRESS (2026-10-20) — slices 1–4 done (desktop drop → server local-path ingest; multi-select + Copy/Move/Delete/New folder bar, CLS folders merged; multi-rename planned in node; HAP encode dialog/progress/cancel, on-air decided in node) + slice 5 (Playlists footer, timeless/missing/Set all planned in node) + slice 6 (look-layer playlist editor, every edit planned by `POST /api/playlist/edit`; multi-selection drag) + slice 7 (files dropped on a media folder move / Alt-copy) + slice 8 ("+" menu: Select file(s)… / New folder… / Download from URL…; HTTP streaming upload when the server refuses a local path), box-verified; parity checklist open. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599 (HTTP upload layer), WO-600 (sources panel K = the media browser tree), WO-601 (media file inspector).**

# WO-603 — Godot port: media library operations, ingest/uploads, HAP encode, multi-rename, playlists

## Investigation

Inventories (Haiku): [`timeline-audio-media-secondary.md` §3–4](../godot-port/inventory/timeline-audio-media-secondary.md)
(media ops 10 files / 1,015 LOC + 541 CSS; playlists footer 3 / 282) and
[`live-core-scenes-preview.md` §K](../godot-port/inventory/live-core-scenes-preview.md) (sources
panel incl. media tree + ingest, 16 / 2,683 LOC).

- Operator features: folder picker → copy/move (`GET /api/media` tree), delete (`POST /api/media/delete`,
  final — WO-592), multi-rename with renumbering + live conflict preview (all-or-nothing; refs follow
  — WO-592 links), HAP encode (Alpha/HQ; probe + cancel), per-file trim/mute defaults, clip lengths in
  playlist rows, missing-media warning on take (`media-exists.js:87`).
- **Uploads / OS drops today:** drag files *and folders* from the OS (WO-591: folder drop walks
  `webkitGetAsEntry` and uploads per subfolder; multi-select drag fills playlists). Upload with
  progress (`03b-ingest-drag-upload-progress.css`), version upload `POST /api/media/version/upload?path=`
  via XHR `form-upload`.
- Playlists: compact footer panel + layer playlist inspector (WO-601): reorder by drag, timeless vs
  timed rules (`playlist-timeless.js`, pure), Next, transition settings.
- Rendering: DOM only; modals via `innerHTML`; a native `alert()` on the folder-picker error path.
- Pure, portable: `media-multi-rename.js`, `media-ext.js`, `media-exists.js`, `playlist-timeless.js`.

### Godot specifics to verify (WO-595 / research G)

- `Window.files_dropped(files: PackedStringArray)` ✔ exists (4.6.3 probe) — gives **local paths**,
  which only make sense when the client runs on the box. On the box the server can then **copy from
  the path** instead of the client uploading bytes over HTTP (new `POST /api/media/ingest-local
  {paths[], destFolder}` — server walks folders itself; replaces the WO-591 browser folder walk).
  Remote Godot clients (WO-610) still need HTTP upload → multipart streaming from `HTTPClient`
  (research item: large-file streaming without loading into RAM).

## Port plan

- Media tree in the sources panel (WO-600 K) with multi-select, typed drag payload
  `{type:'media', value, label}` (+ `multi`), context menu (copy/move/delete/rename/HAP/versions).
- Modals as Godot `Window`/`AcceptDialog` scenes (folder picker, multi-rename with live preview
  table, HAP options) — no `alert()`.
- Local ingest path (above) for the on-box client; HTTP upload with progress for remote.
- Playlist footer + reorder via Godot drag API.

## Acceptance

- Parity checklist `work/godot-port/parity/media-playlists.md`, owner-ticked.
- Drop a folder with a subfolder from the desktop → files land in the right folders (WO-591 case).
- Multi-rename keeps numbering and every look/playlist/timeline ref follows (WO-592 case).

## Slice 1 (20.10) — desktop files / folders → media library, copied by the server

### Investigation

- Web path: `client/components/sources-panel-ingest-logic.js` walks a drop with `webkitGetAsEntry`, then sends one
  multipart `POST /api/ingest/upload` per folder (`path` field = target subdir, busboy 64-file chunks). Placement:
  a dropped file → `<target>/<name>`, a dropped folder → `<target>/<folder>/…` with its subfolders; same-name files
  are overwritten (`src/api/routes-ingest.js:166` `createWriteStream`); a `.zip` is unpacked next to itself and
  removed. Target = the explicit subdir or `getDefaultIngestSubdir` (active project's media folder when
  project-scoped media is on, `src/media/project-media-root.js:94`).
- USB import (`src/media/usb-drives-copy.js`) already copies from local paths, but is bound to a mounted drive id
  and its `overwritePolicy` ('rename'), so it is not the drop semantics.
- `GET /api/media` mixes Caspar CLS rows (upper-case, no extension: `PROJECTS/AIRPORT/1. GŁÓWNE TŁO`) with the
  on-disk rows (`projects/airport/…`), and the Godot tree builds folders from both. A drop on the upper-case folder
  must not create a second `PROJECTS/AIRPORT` directory next to `projects/airport` on Linux.
- Godot: `Window.files_dropped(files)` carries only paths; the cursor position at the signal says where it landed.

### What was done

- **Server (the owner's D directive: the action is an endpoint):** `src/media/local-ingest.js`:
  - `planLocalIngest(paths, mediaBase)` walks the drop (lstat; symlinks and special files skipped, never followed),
    with the web placement. It refuses relative or missing paths, a source inside the media root or containing it,
    more than 50 000 files, and empty drops.
  - `resolveTarget(config, folder)` maps each folder segment onto an existing directory case-insensitively (NFC),
    so CLS ids land in the real folder. Empty → the web default.
  - `copyPlanned` streams to `<dest>.partial` and renames; it cancels between and inside files and unpacks `.zip`
    via `extractZipSafely`.
- `src/api/routes-media-ingest-local.js`:
  - `POST /api/media/ingest-local {paths[], folder?}` → 202 and a background copy, with progress over WS
    `media:ingest-progress` (250 ms throttle). A media rescan runs at the end.
  - `GET /api/media/ingest-local` returns the state; `POST …/cancel`; 409 while a copy runs.
  - **Loopback only** (403 otherwise): a local path means nothing to a remote client, and a LAN caller must never pull
    arbitrary box files into the downloadable library. Remote Godot (WO-610) keeps the HTTP upload path.
  - Registered before the `/api/media/*` catch-all.
- **Godot:** `features/live/media_ingest.gd` holds the pure helpers: drop folder (a folder row is itself, a file its
  parent, empty space the default), the status line and the request body. In `media_panel.gd`:
  - `get_window().files_dropped` → it ingests only when the cursor is over the Sources panel; it switches to Media
    and targets the tree row under the cursor;
  - folder rows carry `{folder}` metadata and are not draggable;
  - a status line with ✕ (cancel while copying, else hide); `Ws.message` progress; the tree reloads when the copy
    finishes.
- Kept: same-name overwrite (web parity). It bypasses WO-592 versions exactly as the web upload does; recorded, not
  changed.

### What was VERIFIED

- Offline: `smoke-wo603-ingest-local.test.js` 7/7 (curated) covers placement, symlink skip, refusals, the CLS-case
  folder mapping, overwrite, zip unpack, no `.partial` left, cancel, loopback 403 / 202 / 409, broadcasts + rescan,
  and route order. Full suite 2841 pass / 1 fail (known smoke-wo577). Godot `test_media_ingest.gd`: suite 15973 pass.
  Line limit OK; `format:check` clean.
- Box (node restarted, Godot relaunched):
  - curl: folder `WO603 Drop` to `PROJECTS/AIRPORT` landed in `media/projects/airport/WO603 Drop/{a.txt, sub/b.txt}`;
    the same request from the LAN IP → 403.
  - **A real XDND drop** (a GTK drag source driven by xdotool) of folder `WO603 Probe` onto the `testowe` row:
    `media/testowe/WO603 Probe/{wo603_probe.png, sub/wo603_sub.png}`. The panel showed "✓ Imported 2 file(s)" and
    the tree (filter `wo603`) listed `testowe › WO603 Probe › sub › wo603_sub.png`.
  - The same drag released over the Live preview is ignored (nothing copied, no client errors).
  - Probes removed via `POST /api/media/delete` + rmdir. Config md5 is identical except `device_graph.json`,
    rewritten at node boot (18:06:16, the boot-time save seen in WO-604 slice 3), not by the ingest.
- Owner-QA: drop a large folder (progress line), and a drop on an upper-case CLS folder.

## Slice 2 (20.10) — multi-select + selection bar (Copy to… / Move to… / Delete / New folder…)

### Investigation

- Web: `client/components/sources-panel-shell.js` selection bar ("N selected · Rename… · Copy to… · Move to… · Encode to
  HAP… · Delete · Clear") + "+" menu "New Folder…". Ops are `client/lib/media-file-ops.js`: batch
  `POST /api/media/copy|move {sourceIds, targetId}` and `/delete {ids}`. `sources-panel-media-selection.js:92` does a
  `mkdir` before a move into a typed new folder, but the server already creates the target dir
  (`src/media/local-media-api.js:297,340`), so that extra round trip is not ported. A batch with failures answers
  **HTTP 200** `{ok:false, count, errors[]}` (`routes-media.js` runBatchMediaOp), so the result must read the body.
- Web tree (`sources-panel-media.js:11,76`): isDir rows first, folders merged **case-insensitively** under the
  first (on-disk) spelling. The Godot tree built folders from file ids only, so it showed `PROJECTS` next to
  `projects` (the Caspar CLS rows) and never showed empty folders, so a new folder was invisible.
- Every operation already has a server endpoint; nothing new is composed on the client.

### What was done

- `features/live/media_ops.gd` (pure):
  - `folders` (picker: on-disk isDir rows only); `clean_folder` / `join_folder`; request bodies; `result_text`
    (all / partial-in-200 / refused);
  - `tree_entries(rows, filter)`: the web grouping. Folder rows feed the on-disk spelling even under a filter, so
    New folder… and drops under a filtered `PROJECTS/AIRPORT` hit `projects/airport`.
- `features/live/media_selection_bar.gd`:
  - HFlow bar (wraps, so the Sources column keeps its width; the first HBox try widened it ~60 px);
  - Copy/Move folder picker: a ConfirmationDialog with a folder Tree and an editable path, where a typed new path is
    created by the server;
  - Delete confirmation (final; stops a running inspector preview of a file being deleted first);
  - New folder… under the focused folder (Enter submits).
- `media_panel.gd`: `Tree.SELECT_MULTI`. `multi_selected` is coalesced (deferred) into one update: files → bar, the
  focused row → folder, one file → Inspector. `_build` materializes `tree_entries`.

### What was VERIFIED

- Godot suite 15989 pass (`test_media_ops.gd`: picker folders, bodies, result lines, CLS merge, filter spelling,
  parent order). Boot `--check` clean.
- Box (real GUI, xdotool):
  - ctrl-click and shift-click selected 2 files and the bar read "2 selected";
  - Move to… → typed `testowe/wo603moved` → both files moved on disk, "✓ Moved 2 files", tree refreshed and
    selection cleared;
  - New folder… under `wo603moved` → `wo603new` on disk and in `/api/media`;
  - Delete → confirm → files gone, "✓ Deleted 2 files";
  - the unfiltered tree shows `projects`/`testowe` once (CLS duplicates merged), plus the empty on-disk folders.
  - Probe folders removed via `POST /api/media/delete`. Config md5 unchanged apart from the boot-time
    `device_graph.json` (slice 1).
- No client errors in the GUI log.

## Slice 3 (20.10) — multi-rename, planned in node

### Investigation

- Web (WO-592 D): `client/lib/media-multi-rename.js` (pure `parseNumberedName` / `buildMultiRenamePlan`) runs in the
  browser. `client/components/media-multi-rename-modal.js` re-plans on every input, with the conflict check against
  the **client's** media list (`sources-panel.js:317`). Only the final `POST /api/media/rename {renames}`
  (all-or-nothing, references follow, `src/media/media-links.js:109`) is on the server.
- Under the owner's D directive the plan belongs in node, and a second client-side copy (GDScript) would be a third
  implementation to keep in sync.

### What was done

- `src/media/media-multi-rename.js`: verbatim CommonJS port of the web planner (the web keeps its copy until WO-609).
- `POST /api/media/rename/plan {ids, title?, renumber?}` (`routes-media-library.js` `handleRenamePlan`): plans
  against `getRawMediaCatalog(ctx)` (the server's list) and returns `{plan, renames, ok, commonTitle}`. Nothing
  changes on disk.
- Godot `features/live/media_rename_dialog.gd`: title field (seeded with the server's `commonTitle`), Renumber
  from/step/digits, and a preview (conflicts red, unchanged muted). Every edit re-plans in node; stale replies are
  dropped by a sequence number. "Rename N files" posts the plan's `renames` and stays open with the error on
  failure. "Rename…" is the first button of the selection bar. `media_ops.plan_body` is pure (tested).

### What was VERIFIED

- Offline: `smoke-wo603-multi-rename-plan.test.js` 5/5 (curated):
  - 7 cases give identical plans and `parseNumberedName` from the server port and the web ESM module;
  - the rules are pinned;
  - the handler: catalogue conflicts, `commonTitle`, renumber normalization, 400.
  - Full suite 2846 pass / 1 known fail (smoke-wo577). Godot 15991 pass; boot check clean.
- Box (node restarted, real GUI):
  - three probes `01_/02_Probe Alpha`, `07_Probe Beta`;
  - the dialog seeded "Probe Alpha" with "Rename 0 files" disabled;
  - title "Probe Beta" + Renumber from 7 showed `01_Probe Alpha → 07_Probe Beta (a file with this name exists)` in red
    with Rename disabled;
  - from 3 → `03_/04_Probe Beta`, Rename → renamed on disk, "✓ Renamed 2 files — looks follow", tree refreshed.
  - Probes deleted via the API; config md5 unchanged (bar the boot-time `device_graph.json`).

## Slice 4 (20.10) — HAP encode: options dialog, progress, cancel

### Investigation

- The web encode is already server-side: `POST /api/media/hap-encode/probe`, `POST /api/media/hap-encode` (202, the
  queue runs ffmpeg), `GET /api/media/hap-encode`, `POST /api/media/hap-encode/cancel`, WS `media:hap-encode`
  (`src/api/routes-media-hap.js`).
- The browser held one decision: the on-air warning. `client/components/sources-panel-hap-encode.js:48` passed
  `isAnythingPlaying(stateStore.getState())` (`client/lib/hap-encode-status.js:17`), which reads the client's copy of
  the playback matrix. The rest of `hap-encode-status.js` only formats the dialog text and the progress text.

### What was done

- `routes-media-hap.js`: `isAnythingPlaying(ctx)` reads `getMatrixForState(ctx)` (OSC or tracker matrix) on the
  server; the probe reply adds `onAir`. Under the D directive the decision is made in node, not in a client.
- Godot `features/live/hap_status.gd`: a GDScript port of the web formatting functions (`format_for`,
  `modal_warnings`, `job_active`, `progress_text`, `finished_summary`). It is pure text; the GOLD cases come from the
  web module.
- `features/live/media_hap_dialog.gd`: file list, Alpha / HAP Q options, the format line and warnings (from the probe
  reply: no-alpha source, oversize, on-air). Autowrap labels get a min width, and the dialog re-fits after each
  warning change; otherwise it grows screen-tall.
- `media_selection_bar.gd`: "HAP…" opens the dialog, Encode posts the job, and the bar follows `media:hap-encode`. It
  re-attaches to a running job via GET on open. The status line has its own full-width row ("Encoding HAP Q 1/3 ·
  N%", then the summary), and "Cancel HAP" sits beside "New folder…" while a job is active.
- `media_rename_dialog.gd`: the same autowrap min-width fix for the error label.

### What was VERIFIED

- Offline:
  - `smoke-wo603-hap-onair.test.js` 1/1 (curated);
  - full suite 2847 pass / 1 known fail (smoke-wo577);
  - Godot `test_hap_status.gd` (GOLD from the web module), total 16009 pass;
  - eslint, prettier and line-limit checks clean.
- Box (real GUI, node restarted):
  - a 2 s and a 40 s 1080p clip → `_HAP.mov`, "✓ HAP: 1 encoded";
  - a 4K clip as HAP Q → `_HAP.mov`;
  - three 4K clips with HAP Q ticked: the dialog showed "Format: HAP Q" plus the on-air warning (owner's audio-only
    look playing), and the bar showed "Encoding HAP Q 1/3 · 0%" unclipped.
  - "Cancel HAP" → GET shows `cancelled: 3`, finished, no `_HAP` leftovers on disk. The bar shows "HAP: 3 cancelled"
    and the Cancel button is hidden.
  - Probes deleted via the API; config md5 unchanged (bar the boot-time `device_graph.json`).

## Slice 5 (20.10) — Playlists footer panel, its rules in node

### Investigation

- Web `client/components/playlist-control-panel.js` (235 LOC, inspector footer, collapsed by default) lists
  `GET /api/playlist/state` (live playlists first, then every playlist in the looks, WO-347 / WO-581) and drives
  `POST /api/playlist/control`: `goto` / `prev` / `next` (live) and `set_start` / `step_preview` (not live).
- The browser decided three things itself:
  - **Timeless items.** `client/lib/playlist-timeless.js`, a mirror of the engine's
    `isTimelessPlaylistItem` (`src/engine/scene-take-lbg-playlist.js:17`), decides which items are timeless. That
    decides which items get "(Ns)" and the value the "Timeless (s)" field shows.
  - **Missing media.** The ⚠ marker came from `clipMissing` (`client/lib/media-exists.js:63`), checked against the
    client's media list.
  - **"Set all".** The browser rewrote the look's playlist (`sceneState.patchLayer`, panel line ~135), then
    `update_live` reached the running engine (`client/lib/playlist-live-sync.js`).
- Looks are client-owned in this system (deck sync / autosave; `new-layer` and `new-look` are computed by the
  server and stored by the client). The server can plan an edit but not write it, or the next client sync would
  overwrite it.

### What was done

- `src/media/media-exists.js`: CommonJS port of the web index (`buildMediaIndex`, `clipMissing`); pure.
- `src/api/routes-playlist-panel.js`:
  - `panelItems` adds `timeless` (the engine's own rule, now exported) and `missing` (against
    `getRawMediaCatalog`) to every state item;
  - `timelessSecsOf` gives each playlist `timelessSecs`;
  - `planTimeless` and `setTimeless` serve `action:'set_timeless' {sceneId, layerNumber, secs}`: the new playlist
    is planned from the look (`resolveLiveSceneById`), pushed into every channel where that look is live, and
    returned as `{playlist, touched, secs, patched}`;
  - `patchLivePlaylist` is the former `update_live` body, now shared.
- `routes-playlist.js` uses the panel module (342 lines).
- Godot:
  - `features/live/playlists_model.gd` (pure): list and item labels (● playing / ▸ start item, ⚠ missing,
    basename, "(Ns)" only on timeless items) and the request bodies; `store_playlist` puts the server's plan on
    the look.
  - `features/live/playlists_panel.gd`: collapsible "Playlists" section with a count; playlist and item pickers,
    Timeless (s) + Set all, and ⏮ ▶ ⏭ (▶ only while live). It polls every 2 s while open, and the open/closed
    state is kept in `ui.cfg`. "Set all" stores the returned playlist and runs `deck_changed` + `mark_dirty`. The
    status line clears when its playlist is no longer shown.
  - `app/inspector_panel.gd` gains `add_footer()` (the web inspector footer, outside the scroll), and `shell.gd`
    mounts the panel there, so it is on every tab (WO-608 R2).
  - `assets/ui/icons/prev.svg` / `next.svg` (the web transport paths; the font has no ⏮ / ⏭).

### What was VERIFIED

- Offline:
  - `smoke-wo603-playlist-panel.test.js` 5/5 (curated): parity with the web `playlist-timeless.js` (`timeless`,
    `timelessSecsOf`) and the `media-exists` rules; `planTimeless` clamps and refuses bad input;
    `set_timeless` patches a live channel without mutating the look, and returns 404 / 400.
  - The playlist smokes wo224 / wo371 / wo581 still pass.
  - Full suite 2852 pass / 1 known fail (smoke-wo577).
  - Godot `test_playlists_model.gd`, total 16029 pass; boot check clean after the status-line change.
- Box (node restarted, real GUI):
  - A temporary look "WO603 Playlist" was added via `scene_deck_sync`, with a still, a clip and a missing still.
  - The state API marked them timeless / timed / timeless + `missing`.
  - The panel showed "WO603 Playlist · L10 · not live", "▸ 1. t9_pedestrians.png", Timeless 20, and ▶ disabled;
    the item list showed "⚠ 3. WO603_MISSING.png".
  - Picking item 3 → `startIndex` 2; ⏭ → 0 (wrap); ⏮ → 2.
  - Timeless 7 + Set all → "✓ 2 timeless items → 7s". The server project (via the client's deck sync) then had
    durations `[7, null, 7]` and `timelessSecs` 7; the item read "(7s)".
  - The look was deleted through the deck's "Delete look…" and the project is back to its 4 looks; the panel shows
    "— no playlists in the looks —".
- Not proven on the box: the live path (`goto` / `prev` / `next` on program and `set_timeless` patching a live
  copy). A take would have replaced the owner's program. Covered offline; owner QA.

### Still open (after slice 5)

Drag of a multi-selection, remote (HTTP streaming) upload, parity checklist. The layer playlist editor (add /
reorder items, advance mode) is WO-601's "layer playlist + playback mode" sub-feature. Godot cannot create a
playlist yet. → the editor and the multi-drag are slice 6.

## Slice 6 (20.10) — look-layer playlist editor + multi-selection drag, edits planned in node

### Investigation

- Web `client/components/inspector-layer-playlist.js` (414 LOC) is the layer inspector's "Layer Playback Mode" group:
  - **Mode.** Single Media / Playlist Workflow. Switching to a list seeds it from `source`; switching back takes
    `source` from item 0.
  - **Item list.** Drag to reorder, ✕, a duration field on timeless items (else the clip length from
    `client/lib/media-duration.js`), and a per-item Loop check.
  - **Drop zone.** It takes one source or a `{type:'multi', items}` payload.
  - **Settings.** Advance (auto / manual), Loop List, Transition type + frames, Timeless "Apply to all", and
    "Next ▶" (shown for manual advance or when an item loops).
  - **Who decided.** Every rule ran in the browser, which patched the look through `sceneState.patchLayer` and
    pushed live copies with `update_live`. Against the owner's D directive ("anything that happens in casparcg is
    composed in the node server"), that is the same split slice 5 removed for "Set all".
- Looks stay client-owned (deck sync), so the server can only plan. It returns a layer patch; the client stores it
  through its normal look-edit path (`patch` → look editor → PRV push + deck sync + autosave).
- Multi-drag: the web `media-browser` builds the multi payload only when the dragged tile is part of the selection.
  The Godot media tree dragged one row only.
- Box finding during the test: clicking a file in Sources presents the media-file inspector (WO-592), which
  **covers the look layer's page**. The drop zone is then unreachable exactly when a multi-selection exists, so
  the multi-drag could not land without a rule change.

### What was done

- Server (all pure planning, plus one live push):
  - `src/engine/playlist-edit.js`: `planPlaylistEdit(layer, op, args)` with ops `mode`, `add {items}`,
    `move {from,to}`, `remove`, `item {index, duration|loop}`, `settings {advance, loop, transition}` and
    `timeless {secs}`. These are the web rules: list seeding, `source` follows item 0, durations only on timeless
    items, clamped to 1–86400 s. Also `showsNext` and the shared `timelessSecsOf` (the panel module now imports it;
    one copy).
  - `src/media/media-duration.js`: a CommonJS port of the web clip-length index.
  - `src/api/routes-playlist-edit.js`:
    - `POST /api/playlist/edit` returns `{patch, rows, showsNext, timelessSecs, patched}`. Rows carry name,
      timeless, missing, duration, clip length and loop. Op `describe` returns rows only. When the playlist changed
      and the look is live, the shared `patchLivePlaylist` updates the running engine.
    - `POST /api/playlist/edit/next` returns 409 unless the look is on a program channel (a PRV recall is not
      live, WO-581), then delegates to `/api/playlist/next`.
    - Both routes are wired in `router.js`.
- Godot:
  - `features/live/playlist_edit_model.gd` (pure): the label tables, the request body, the ⚠ row name,
    `drop_index` (the tree drop position mapped to the server's splice index) and `droppable`.
  - `features/live/playlist_section.gd`, mounted in `layer_inspector.gd` under the mixer as in the web order:
    - the mode picker;
    - a Tree with drag-reorder, an editable seconds cell on timeless rows (clip length otherwise), a Loop check
      and a ✕ (`close.svg`);
    - the drop zone (the tree also accepts drops);
    - Advance / Loop List / Transition / Frames, Timeless (s) + Apply to all, and Next with an error line.
    - It never edits the playlist itself. Every change is a POST, and the returned patch is emitted.
  - `media_ops.drag_payload` + `media_panel._drag_data`: dragging a row that is part of a 2+ selection sends the
    web multi payload (preview "＋ N files").
  - `app/inspector_panel.gd`: `release()` brings back the page the released one covered, unless its owner released
    it meanwhile. `media_panel` releases the file inspector when the selection grows past one file (several
    files have no single inspector). Ctrl-clicking a second file therefore gives the look layer back, and its drop
    zone with it. The alternative, "never cover a look layer", would have broken the owner-requested WO-592 file
    inspector.

### What was VERIFIED

- Offline:
  - `smoke-wo603-playlist-edit.test.js` 6/6 (curated): every op against the web rules; refusals; `describe` rows
    (timeless, missing, clip length); a changed playlist is pushed into the live copy; Next resolves the program
    channel (never the PRV one, ch2) and is 409 off program.
  - Panel smoke 5/5 still passes after the `timelessSecsOf` move.
  - Full suite 2858 pass / 1 known fail (smoke-wo577).
  - Prettier clean, eslint clean on the new files, no file over 500 lines.
  - Godot: `test_playlist_edit_model.gd` (drop-index splice cases, droppable, bodies),
    `test_media_ops.gd::drag_payload` and `test_inspector_panel.gd` (covered page returns; a released page stays
    gone). Total 16062 pass; boot check clean.
- Box (node restarted, real GUI, temporary look "WO603 S6" injected via `scene_deck_sync`, edited on PRV):
  - Selecting layer L10 showed "Layer Playback Mode · 2. Playlist Workflow" with the drop zone and a
    "10Dealz.PNG · 20 · Loop · ✕" row.
  - Clicking one file showed the file inspector. Ctrl-clicking two more showed "3 selected" and the layer page came
    back.
  - Dragging the selection showed "3 files" and the drop added 3 rows: 10Dealz (20), "4. Tło 4" (1:00) and
    "5. Filmy w przerwie" (4:53). The server project held them with `pl_…` ids, `image` / `media` types and a
    duration on the still only.
  - Dragging the last row above the first gave the order `[5. Filmy, 10Dealz, 10Dealz, 4. Tło 4]`, and `source`
    followed item 0.
  - ✕ on row 3 left 3 items. Loop on "4. Tło 4" stored `loop: true` and Next appeared.
  - Typing 7 into the duration cell stored `duration: 7`, and "Timeless items (s)" read 7.
  - Pressing Next showed "This look is not on program — Next works while it plays." (409).
  - Apply to all = 9 stored `duration: 9`.
  - Advance → Manual Next, Transition → CUT and Loop List off were stored as `manual`, `{type:'CUT', duration:12}`
    and `false`.
  - Mode → Single stored `sourceMode: single` and `source` = "5. Filmy w przerwie.mp4" (PRV showed it), with the
    3-item list kept as on the web.
  - Cleanup: PRV was re-staged with the owner's Look 4, the test look was removed with "Delete look…", and the
    project is back to its 4 looks. The GUI is left running.
- Not proven on the box: edits reaching a look that is live on program (`patched` > 0) and Next on air. A take
  would replace the owner's program. Covered offline; owner QA.

### Still open (after slice 6)

Remote (HTTP streaming) upload; parity checklist; multi-drop onto compose tiles and a multi-selection "Move to"
by drag (the web accepts both). → slice 7.

## Slice 7 (20.10) — drop files on a media folder (move, Alt = copy)

### Investigation

- Web `client/components/sources-panel-media.js:136-170`: every folder row is a drop target.
  - `mediaIdsFromDragPayload` (line 31) takes the `media` items of a single or multi payload.
  - The row accepts when at least one id is not already inside that folder, at any depth (`startsWith(folder +
    '/')`). It then moves them all through `onMoveItems` (Alt → `onCopyItems`). The server reports the ones
    already there.
- The Godot media tree only accepted desktop DeckLink connector drops (`live.can_drop_connector`), so the only way
  to move files was the "Move to…" picker.
- Compose tiles: the web `normalizeSourceDropItems` flattens a multi payload, but `sourceTileRejection` refuses
  anything that is not `route://`. In Godot the only multi payloads are media-file selections; the Live sources
  tab drags one input at a time. A multi-drop onto the compose canvas would therefore be refused item by item,
  so there is nothing to port. `compose_tile_math.droppable` (route values only) already refuses the payload.

### What was done

- `media_ops.folder_drop_ids(data, folder)` (pure): the web rule above.
- `media_selection_bar.transfer(op, ids, target)`: the picker's copy / move + report, now shared by the "Copy to…"
  / "Move to…" dialog and the drop.
- `media_panel`: `_can_drop` / `_drop`. A folder row that takes the payload shows the on-item outline and moves
  the files (Alt held at release → copy). Everything else still falls through to the DeckLink connector drop.

### What was VERIFIED

- Godot `test_media_ops.gd::test_folder_drop_ids_web_rule`: single, multi, already there, media-only, live
  sources, a folder onto itself. Total 16068 pass; boot check clean.
- Box (real GUI), with throwaway copies `media/wo603dnd/src/dnd_{a,b}.png` and an empty `dst/`:
  - Ctrl-selecting both files and dropping them on their ancestor `wo603dnd` was refused (the web rule; no
    request).
  - Dropping them on `dst` (on-item outline, "2 files") showed "✓ Moved 2 files", and both are in `dst/` on disk.
  - Alt-dropping `dst/dnd_a.png` on `src` showed "✓ Copied 1 file", leaving a copy in `src/` with the original
    kept.
  - Cleanup: `POST /api/media/delete {ids:["wo603dnd"]}`; the folder is gone.

### Still open (after slice 7)

Remote (HTTP streaming) upload; parity checklist. → slice 8.

## Slice 8 (20.10) — the "+" menu (files, folder, URL) and HTTP upload for an off-box client

### Investigation

- Web Sources footer "+" dropup (`client/components/sources-panel-shell.js`, `ingest-dropup-menu`):
  - Select File(s) → multipart `POST /api/ingest/upload` with `path` sent first
    (`sources-panel-ingest-logic.js:60-71`);
  - New Folder…; Import USB…; Add Placeholder… (offline only);
  - a URL row → `POST /api/ingest/download {url, path}`, then `GET /api/ingest/download-status` polled every
    450 ms (`createDownloadPoller`).
- Godot had a "New folder…" button only. Desktop drops used the loopback-only `ingest-local`
  (`routes-media-ingest-local.js:41` → 403 for any other caller). A client off the box (WO-610, deferred) could
  not add media at all.
- `core/stream_upload.gd` (the WO-601 "New version…" upload) already streams one file in 1 MiB chunks over raw TCP.
  It lacked form fields, and the ingest route reads its target folder from a `path` field that busboy must see
  before the file (`routes-ingest.js:145`).

### What was done

- `core/stream_upload.gd`: `multipart_parts` / `upload` take form `fields`, framed before the file.
- `features/live/media_add_menu.gd`: a "+" MenuButton with Select file(s)… (a FileDialog with multi-select,
  starting in ~/Downloads), New folder… (the bar's existing dialog) and Download from URL…. It replaces the bar's
  "New folder…" button.
- `media_panel`:
  - Desktop drops and picked files share `_ingest(paths, folder)`. It tries the local-path ingest first; on 403
    it falls back to one streamed `POST /api/ingest/upload` per file, following `Ingest.upload_plan` (a dropped
    folder keeps its name and subfolders, as the server-side walk does), with an "Uploading i/n · %" line.
  - `_download(url)` posts to the selected folder and polls the status with the web poller's wording
    (`Ingest.download_text`).
- No server change. Picking the ingest path by the server's 403, rather than by guessing whether the origin is
  local, keeps the decision with the server.

### What was VERIFIED

- Godot:
  - `test_stream_upload.gd`: the `path` field is framed before the file.
  - `test_media_ingest.gd`: the folder walk keeps names and subfolders, hidden and missing paths are skipped;
    upload and download lines.
  - Total 16076 pass; boot check clean (a `match` inside a lambda did not parse and was moved into a method).
- Box, on-box client (`--server` default 127.0.0.1), target folder `wo603up` selected:
  - + → Select file(s)… → `up_one.png` showed "✓ Imported 1 file(s)" (local-path ingest).
  - + → Download from URL… `http://127.0.0.1:8765/url_dl.png` (a scratch `http.server`) showed "✓ Saved
    url_dl.png". The journal shows `[Ingest] HTTP download starting → url_dl.png … complete`.
- Box, client launched with `--server=http://192.168.50.64:4200`, so the server sees a LAN caller:
  - The same pick showed "✓ Uploaded 1 file" (the upload wording, not "Imported"), and the file was rewritten at
    19:12:36.
  - A real XDND drop of the folder `dropdir/` (`up_two.png`, `sub/up_three.png`) from a GTK drag source showed
    "✓ Uploaded 2 files" and landed as `wo603up/dropdir/up_two.png` and `wo603up/dropdir/sub/up_three.png`.
- Cleanup: `POST /api/media/delete {ids:["wo603up"]}`; the scratch HTTP server was stopped; the GUI was relaunched
  against 127.0.0.1.
- Not covered: a remote client on another machine (WO-610, deferred) and a WeTransfer link. The upload has no
  Cancel; the web upload has none either.

### Still open (after slice 8)

Parity checklist; the slice-9 gaps below.

## Slice 9 (20.10) — parity gaps: take warnings, …

Gaps found while checking slices 1–8 against the web: no warning when a take carries media Caspar does not have, no
AMCP-failure note on a take, no Delete key on the media selection, no folder delete.

### 9a — missing media and failed commands on a take

#### Investigation

- The web warns before every take, PRV staging included: `scenes-preview-runtime.js:226` and
  `scenes-editor-support.js:198` call `warnMissingMediaOnTake(incomingScene)`, which toasts
  `⚠ Missing in Caspar media: <basenames>` from `missingMediaInScene` (`client/lib/media-exists.js:74`). Layers whose
  `source.type` is timeline / template / live_audio / placeholder / effect / browser / route are skipped (WO-560).
  Playlist items count like the source.
- After the take, `toastTakeAmcpFailures(res)` (`media-exists.js:96`) names the first of `res.amcpFailures`. The
  server already collects these per take (WO-360).
- The Godot deck takes through `POST /api/scene/take-look` (`deck_view.gd:231`). That route builds the incoming
  look in node and hands it to `handleSceneTake`, so one field on the take reply reaches every client. Godot read
  neither field and showed only "PRV ok" / "TAKE ok".
- `src/media/media-exists.js` already had `clipMissing` and `buildMediaIndex` (slice 5). `routes-scene-take.js`
  was at 496 lines.

#### What was done

- `src/media/media-exists.js`: `missingMediaInScene(scene, index)`, the web rule with the same
  `NON_PLAIN_MEDIA_LAYER_TYPES`.
- New `src/api/media-index.js`:
  - `mediaIndexFor(ctx)` moved here from `routes-playlist-panel.js`, which re-exports it, so existing imports still
    work.
  - `missingMediaField(ctx, scene)` returns `{ missingMedia }` or `{}`.
- `routes-scene-take.js`: the 200 body spreads `...missingMediaField(ctx, b.incomingScene)`, which costs 2 lines (the
  file is now 498). The warning is decided in node, so the web can later read it from the reply as well.
- Godot:
  - `deck_model.gd`: `take_warning(data)` builds the web wording, joining missing media and the first AMCP failure
    with " · ".
  - `deck_view.request_take`: a 200 reply with a warning shows "PRV ⚠ …" / "TAKE ⚠ …" in the error colour instead of
    "ok".

#### What was VERIFIED

- Offline:
  - new `smoke-wo603-take-missing-media.test.js` (curated, 4 pass), covering missing and duplicate values, playlist
    items, timeline / route / template sources, no media list, the ctx catalog read, and the take spread;
  - full suite 2862 pass / 1 known fail (smoke-wo577);
  - Godot 16081 pass, including `test_take_warning_names_missing_media_and_amcp_failures`.
- Box (node restarted, GUI relaunched):
  - A test look "WO603 S9" with one media layer `wo603/missing_clip_s9` was injected and clicked once to stage it on
    PRV. The status line read
    `PRV ⚠ Missing in Caspar media: missing_clip_s9 · ⚠ 1 command(s) failed during take — first: LOADBG 2-10 WO603/MISSING_CLIP_S9 → 404 LOADBG FAILED`,
    so both fields came from the real take.
  - Re-staging Opening read "PRV ok", so there was no false positive on a clean look.
  - Cleanup: the test look was deleted from the deck, leaving 4 looks with PGM and PRV both on look-1, as they were.
    Nothing was taken to PGM.

### 9b — Delete key on the selection, delete a folder (and the ghost it left)

#### Investigation

- The web deletes the media selection on Delete / Backspace unless an input has focus
  (`client/components/sources-panel.js:336-343`), through the same confirm as the Delete button.
- Every web folder row has a ✕ (`sources-panel-media.js:114-131`): confirm
  `Delete folder "<name>" and all its contents?\n\nThis cannot be undone.`, then `POST /api/media/delete {id: path}`.
  `unlinkMediaById` removes directories recursively (`src/media/local-media-api.js:150-151`).
- Godot had neither.
- **Box finding (20.10), a node bug and not Godot's:**
  - After deleting `wo603del` (holding `sub/del_two.png`), the disk was clean and Caspar's own CLS no longer listed
    the clip.
  - Node's library (`GET /api/media`) still had `WO603DEL/SUB/DEL_TWO` 30 s later; `POST /api/media/refresh`
    cleared it.
  - Reproduced via the API with `wo603race/sub/r.png`: CLS polled right after the delete still listed it, and it was
    gone about 2 s later.
  - `handleMediaDelete` ran its one rescan (`triggerMediaRescan`, the CLS cycle) immediately, so it re-read Caspar
    before Caspar's scanner had caught up.
  - The web calls the same endpoint, so it had the same ghost.

#### What was done

- `src/api/routes-media.js`: `triggerMediaRescanSettled` rescans at once and again after `DELETE_SETTLE_MS` (3 s,
  unref'd timer). Both delete paths use it.
- Godot:
  - `media_selection_bar.gd`: `_confirm_delete` is now the public `confirm_delete`. New `confirm_delete_folder(path)`
    uses the web text and reports "✓ Deleted folder <path>" or "✗ Delete failed: …".
  - `media_panel._tree_input`:
    - Delete / Backspace with files selected opens `confirm_delete`. The tree must have focus, so typing in the filter
      never deletes.
    - Right-clicking a folder row pops a one-item menu, "Delete folder…", placed in window coordinates like
      `deck_view._card_menu`. Adding the window position first pushed it to the screen edge.
  - `media_ops.covers(sel, id)`: the delete hook stops a running preview whose file is inside a deleted folder, not
    only one deleted by name.

#### What was VERIFIED

- Offline:
  - new `smoke-wo603-media-delete-settle.test.js` (curated) deletes a real temp folder, with the registry and versions
    redirected to temp, and checks 1 rescan at once, still 1 at 2999 ms and 2 at 3000 ms under mock timers;
  - `smoke-media-file-ops-routes` still passes;
  - Godot 16087 pass, including `test_covers_files_and_folders`;
  - full suite 2863 pass / 1 known fail (smoke-wo577), confirmed over two runs. One earlier run reported a second
    failure that never recurred and that I could not identify; treat it as a flake to watch.
- Box (node restarted, GUI relaunched):
  - In a scratch `wo603del`, selecting `del_one.png` and pressing Delete opened "Delete 1 file permanently?". Delete
    showed "✓ Deleted 1 file" and the file was gone from disk.
  - Right-clicking the folder showed "Delete folder…" at the pointer, then the web confirm text. Delete showed
    "✓ Deleted folder wo603del".
  - With the settle pass, the library still had `WO603DEL/SUB/DEL_TWO` 1 s after the delete and nothing at 5 s. The
    GUI tree was clean without a manual ↻.
  - Before the fix, the same entry was still listed after 30 s.
  - Cleanup: both scratch folders are gone, and the media root is back to bridge / drive / exfat / projects / testowe.

### Parity checklist

`work/godot-port/parity/media-playlists.md` has 35 rows, one per inventory "What the operator can do" bullet (§3,
§4, §K) plus web features found while porting. 27 rows are ported, 2 belong to other port WOs, and these remain:

- Ctrl+click download; Ctrl+Alt+click remove without a confirm (owner question: keep that shortcut?);
- the project media bar (path, "project only" filter, Gather);
- Import USB (WO-608);
- Placeholders tab and Add Placeholder (unassigned);
- multiview media drop (WO-600);
- ShaderFX / audition / :4300 (WO-606 / WO-608).

The Owner ✓ column is the QA hand-off.

### Still open (after slice 9)

- Ctrl+click download, the project media bar, and Placeholders (next WO-603 slices unless the owner moves them).
- The owner's ticks on the checklist.

## Slice 10 (20.10) — project media bar: folder, "project only", Gather

**Status of this slice: DONE (20.10, smoke + Godot tests + box GUI; the move itself was proven offline only, see
VERIFIED)**

### Investigation

- Web: `client/components/sources-panel-project-gather.js` and `client/lib/project-media-gather.js` (343 lines).
  - The browser exported the whole project, matched each media ref against the media list, planned moves into
    `projects/<slug>/`, moved the files with `/api/media/move`, and then rewrote and re-imported the project itself.
  - "project only" is `filterMediaForActiveProject` (`client/lib/project-media-context.js:230`): folders at or under
    the project folder, plus files inside it.
- The server already owns both halves.
  - **Moves where every reference follows:** `followMediaMoves` (`src/media/media-links.js:155`, WO-592) rewrites
    every project; the active one goes through persistProject + project_sync.
  - **Ref resolution in all three value shapes:** `resolveRefValue` and `refMatchesPath` in
    `src/media/media-reference-rewrite.js`.
  - So, per owner directive D, the planning moves to node and the client keeps no project-rewrite code.
- Live probe on the box: the open project `untitled` references 4 to 5 clips in `projects/airport`, `dtlodz` and
  `npcc`, and its own folder is empty.
- Side finding, fixed in WO-626: the offline suite had left empty `newshow`, `raceshow` and similar folders in the
  live `media/projects`.

### What was done

- `src/media/media-reference-rewrite.js`: `projectReferencedFiles(project, slug, catalogIds, config)`. It returns the
  catalog files a project references, deduped, using the same resolver as rename/move. CLS-form values with no
  extension resolve too.
- New `src/media/project-media-gather.js`:
  - `planGather`: the referenced files outside the folder (pure);
  - `projectMediaInfo`: `{ enabled, slug, folder, pending[] }`;
  - `gatherProjectMedia`: `moveMediaFile` for each pending clip, then one `followMediaMoves`. It replies
    `{ moved[], failed[], refs, folder }` and returns 409 when project folders are off or no project is open.
- Routes (`src/api/routes-media-library.js`, `router.js`):
  - `GET /api/media/project`;
  - `POST /api/media/gather`, which runs a settled rescan after moving (`triggerMediaRescanSettled`, exported from
    `routes-media.js`).
- Godot:
  - new `features/live/project_media_bar.gd` above the Media filter. It shows the folder name (full path on hover),
    a "project only" CheckBox, and a "Gather (N)" button that is visible only when clips are pending. The button
    opens a confirm dialog listing the files (first 8). The bar re-plans 0.4 s after project edits settle (the web's
    debounce) and after every media reload.
  - `media_ops.gd`: `in_folder` (the web filter, case-insensitive so CLS rows count) and `gather_text` (the result
    line).
  - `media_panel.gd` filters the tree through `in_folder` while "project only" is on, expands folders in that mode,
    and reloads after a gather.

Gather moves clips OUT of other projects' folders, as the web did. Those projects' references follow, so nothing
breaks. The confirm dialog lists the source paths, so this is visible before it happens.

### What was VERIFIED

- `tools/smoke/smoke-wo603-media-gather.test.js` (curated): 4/4 pass, on temp media and projects dirs.
  - It covers the pure plan: dedupe, CLS form, inside/missing/route refs skipped.
  - GET returns the folder and the pending list.
  - Gather moves two files. The look ref, the CLS-form ref (shape kept) and the timeline ref all follow, unreferenced
    clips stay, and nothing is pending afterwards.
  - It returns 409 when folders are off or no project is open.
- Godot: `test_in_folder_project_only_rule` and `test_gather_text`. All 16093 tests pass.
- Full offline suite on a clean export: 2870 pass, with 1 known archive-only failure (wo498).
- Box, after a node restart, `GET /api/media/project` returned
  `{"enabled":true,"slug":"untitled","folder":"projects/untitled","pending":[4 clips]}`.
- Godot GUI (screenshots):
  - The bar shows `untitled/`, "project only" and "Gather (5)".
  - Ticking "project only" leaves only `projects ▸ untitled` (expanded).
  - Gather opens "Move 5 files into projects/untitled/?" with the 5 paths. I pressed **Cancel**, and the owner's
    clips were not moved.
- Owner QA: press Gather on a real project (or on a throwaway one) and confirm the looks still play.

### Still open (after slice 10)

- Placeholders (slice 11 below did the download).
- The owner's ticks on the checklist.

## Slice 11 (20.10) — download to this computer; right-click file menu

**Status of this slice: DONE (20.10, Godot tests + box GUI download byte-identical)**

### Investigation

- The parity rows were wrong about the web (`client/components/sources-panel-helpers.js:79-110`):
  - **Alt**+click downloads (Ctrl+click is multi-select);
  - Ctrl+Alt+click removes, and it DOES confirm ("Remove … from the server? This cannot be undone.").

  So the owner question on row 19 ("keep the no-confirm shortcut?") was moot.
- `GET /api/local-media/<encoded id>/file` already streams the file with `Content-Disposition` and
  `Content-Length`. Box check: an 823 MB WAV arrived at its exact size.
- Box: openbox grabs Alt+Left for window moves, so an Alt+click never reaches the app. Owner 20.10: "no need for
  intricate shortcuts in godot as we have the right click menu here".

### What was done

- New `features/live/media_download.gd`.
  - A save FileDialog: the system Downloads dir, falling back to `~/Downloads` when Godot answers `$HOME`. The file
    name is prefilled.
  - Then an `HTTPRequest.download_file` stream straight to disk (HAP clips are GBs and are never buffered), with no
    timeout and a progress line every 0.5 s ("Downloading x… 45% (370 MB of 823 MB)").
  - ✕ cancels, and a cancelled or failed download deletes its partial file.
  - The caller passes `Config.origin` (the test runner has no autoloads).
- `media_panel.gd`: a right-click on a FILE opens "Download to this computer…" / "Delete…". Delete selects the file
  and uses the bar's normal confirm. A right-click on a folder still offers "Delete folder…". There are no modifier
  shortcuts.

### What was VERIFIED

- Godot: `test_download_url_and_progress` (the id is encoded as one segment, matching `encodeURIComponent`) and
  `test_downloads_dir_fallback`. All 16098 tests pass.
- Box GUI: right-clicked `projects/airport/Slide5.PNG`, chose Download, and saved into the scratchpad. The result
  was 127390 bytes and `cmp` with the media file found it IDENTICAL.
