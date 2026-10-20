# Parity checklist — media library, ingest, playlists (WO-603)

One row per "What the operator can do" bullet in the inventory: `inventory/timeline-audio-media-secondary.md` §3
(media ops) and §4 (playlists), and `inventory/live-core-scenes-preview.md` §K (Sources panel). There are also rows for
web features found while porting.

- **Status:** ported = in the Godot client and box-verified (slice named, see WO-603); gap = not ported yet;
  other WO = belongs to another port WO.
- **Owner ✓:** tick after trying it in the Godot GUI.

## Media library (§3, §K)

| # | Web capability | Godot | Status | Owner ✓ |
|---|---|---|---|---|
| 1 | Browse media and folders, filter | Sources → Media tree (folders merged with CLS like the web), Filter field | ported (WO-600 K, slice 2) | [ ] |
| 2 | Select several files (Ctrl / Shift click) | multi-select tree + selection bar ("N selected") | ported (slice 2) | [ ] |
| 3 | Copy / Move selected files to a folder (picker, per-file errors) | Copy to… / Move to… with folder picker; result line names the first failure | ported (slice 2) | [ ] |
| 4 | Drag files onto a folder (move) | drop on a folder row = move, Alt = copy | ported (slice 7) | [ ] |
| 5 | Delete selected files | Delete button, same confirm | ported (slice 2) | [ ] |
| 6 | Delete / Backspace deletes the selection | Delete / Backspace on the tree | ported (9b) | [ ] |
| 7 | Delete a folder and its contents (✕ on the folder row) | right-click folder → Delete folder…; the library no longer keeps a ghost of it (node fix) | ported (9b) | [ ] |
| 8 | New folder | "+" → New folder… (under the selected folder) | ported (slices 2, 8) | [ ] |
| 9 | Rename one file | media Inspector → Rename… | ported (WO-592 / WO-601) | [ ] |
| 10 | Multi-rename (title, renumber start / step / pad, live preview + conflicts, all-or-nothing, references follow) | Rename… on the selection bar, planned in node (`POST /api/media/rename/plan`) | ported (slice 3) | [ ] |
| 11 | Encode to HAP (Alpha / HQ, probe, progress, cancel) | HAP… dialog, progress line, Cancel HAP | ported (slice 4) | [ ] |
| 12 | Per-file trim / mute defaults copied onto a new layer | media Inspector In / Out / Mute; the new-layer drop copies them in node | ported (WO-592 / WO-600) | [ ] |
| 13 | Upload files (picker) | "+" → Select file(s)…; on the box a local-path copy, off the box a streamed HTTP upload | ported (slice 8) | [ ] |
| 14 | Drop files / folders from the desktop | XDND drop onto the panel → folder under the cursor | ported (slice 1; off-box upload slice 8) | [ ] |
| 15 | Download from a URL, with progress | "+" → Download from URL…, status polled | ported (slice 8) | [ ] |
| 16 | Warn on take when the look's media is missing | take reply `missingMedia` (node) → "⚠ Missing in Caspar media: …" on the deck status line | ported (9a) | [ ] |
| 17 | Name the AMCP commands that failed during a take | same status line, "⚠ N command(s) failed during take — first: …" | ported (9a) | [ ] |
| 18 | Download a file to this computer (web: Alt+click) | right-click a file → Download to this computer… (media_download.gd, streamed to disk) | ported (slice 11) | [ ] |
| 19 | Remove a file from the server (web: Ctrl+Alt+click, with confirm) | right-click a file → Delete… ; Delete key; bar button (all confirm) | ported (slice 11; owner: right-click menu instead of shortcuts) | [ ] |
| 20 | Project media bar: project folder path, "project only" filter, Gather referenced clips into it | project_media_bar.gd above the Media filter; server plans + moves (GET /api/media/project, POST /api/media/gather) | ported (slice 10) | [ ] |
| 21 | Import USB… (drive picker, copy into media) | Media + → Import from USB (N)… — drive picker, folders, checked files, progress, cancel, eject (WO-608 `usb_import_dialog.gd`) | ported (WO-608) | [ ] |
| 22 | Drag media onto a look / layer | look editor drop, multi-file drop onto a layer playlist | ported (WO-600, slice 6) | [ ] |
| 23 | Drag media onto the multiview editor | — | other WO (WO-600 multiview editor) | [ ] |
| 24 | Drag an effect onto a layer | effects drop on timeline clips; layer effects via the Inspector | other WO (WO-601 / WO-602) | [ ] |
| 25 | Templates tab | Sources → Templates (TLS, shader library names) | ported (WO-623 C) | [ ] |
| 26 | Placeholders tab + "Add Placeholder…" | Sources → Placeholders (offline mode only): + Add placeholder… (label / template / resolution / fill colour), right-click → Remove, rows drag onto looks; project `placeholders` slice | ported (12) | [ ] |
| 27 | ShaderFX "New shader…", shader audition, sub-app at :4300 | — | other WO (WO-606 Shader Live / FX, WO-608 modules) | [ ] |
| 28 | Rename a timeline (right-click in Sources) | Timeline tab ✎ Rename timeline | ported (WO-602) — not from the Sources row | [ ] |

## Playlists (§4)

| # | Web capability | Godot | Status | Owner ✓ |
|---|---|---|---|---|
| 29 | See every LIVE playlist on any channel (2 s poll while open) | "▸ Playlists" footer of the Inspector column | ported (slice 5) | [ ] |
| 30 | Select a playlist and an item; selecting an item = go to it (`set_start`) | same, decided in node | ported (slice 5) | [ ] |
| 31 | Prev / Play / Next live; on a non-live playlist Prev / Next step the preview index | same | ported (slice 5) | [ ] |
| 32 | Set the duration of all timeless items (1–86400 s), applied to the project | Set all…, decided in node | ported (slice 5) | [ ] |
| 33 | Edits while a look is live are pushed to the engine | `POST /api/playlist/edit` patches the live playlist | ported (slices 5–6) | [ ] |
| 34 | Clip lengths in playlist rows | durations from node (`media-duration.js`) | ported (slice 6) | [ ] |
| 35 | Look-layer playlist editor: mode, reorder, remove, per-item loop, advance / loop / transition / frames / timeless, Apply to all, Next | layer Inspector → Playlist section | ported (slice 6) | [ ] |
