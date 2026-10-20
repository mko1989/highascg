**Status: IN PROGRESS (2026-10-20) — slices 1–4 done (desktop drop → server local-path ingest; multi-select + Copy/Move/Delete/New folder bar, CLS folders merged; multi-rename planned in node; HAP encode dialog/progress/cancel, on-air decided in node), box-verified; playlists, multi-drag still open. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599 (HTTP upload layer), WO-600 (sources panel K = the media browser tree), WO-601 (media file inspector).**

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

### Still open

Drag of a multi-selection, playlists footer, remote (HTTP streaming) upload, parity checklist.
