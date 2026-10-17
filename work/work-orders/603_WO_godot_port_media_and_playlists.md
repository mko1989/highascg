**Status: OPEN (2026-10-17) — investigation + port plan written; nothing implemented. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599 (HTTP upload layer), WO-600 (sources panel K = the media browser tree), WO-601 (media file inspector).**

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

## What was done / What was VERIFIED

Nothing yet. `files_dropped` presence verified (headless ClassDB probe, 4.6.3).
