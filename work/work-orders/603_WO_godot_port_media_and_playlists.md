**Status: IN PROGRESS (2026-10-20) — slice 1 done (desktop drop → server local-path ingest, box-verified with a real XDND drop); media context menu, multi-rename, HAP, playlists still open. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599 (HTTP upload layer), WO-600 (sources panel K = the media browser tree), WO-601 (media file inspector).**

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

### Still open

Media context menu (copy/move/delete/rename/new folder/versions), multi-rename with preview, HAP encode options,
playlists footer, remote (HTTP streaming) upload, parity checklist.
