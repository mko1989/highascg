# WO-1123 — Sources browser: Shift held on a drop from the file manager moves the files instead of copying

**Area:** godot-client, media
**Status: IN PROGRESS (17.11.26 — built, smoke-tested; a real Shift-drag from Thunar not yet done on the box)**

Owner 17.11: "when drag and dropping files/folders from thunar into sources browser, holding shift should do a move
to the project folder."

## Investigation

- `godot/client/features/live/media_panel.gd` `_on_files_dropped` → `_ingest` → `POST /api/media/ingest-local
  {paths, folder}` → `src/media/local-ingest.js` `copyPlanned` (copy only; default target = the active project's media
  folder, or the folder row under the cursor).
- During a drag from Thunar the keyboard focus stays with Thunar: the client's `Input.is_key_pressed(KEY_SHIFT)` cannot
  be relied on. The X server's modifier mask (XQueryPointer) has it — checked with `xdotool keydown shift`.

## What was done

- Server: `move: true` in the request → `copyPlanned(…, { move })`: a rename when source and target share a
  filesystem (instant), else copy, compare sizes, then remove the source; folders of a dropped folder that end up
  empty are removed (never above the dropped folder; a folder holding a skipped link stays). Result line "Moved n file(s)".
- Client: `media_ingest.gd` `shift_held()` (own key state, else `scripts/desktop/x-shift-held.py`), passed as `move`
  on a desktop drop. The ＋ menu's file chooser still copies. An off-box client uploads, as before (no move).
- Target unchanged: the folder under the cursor, else the project's media folder.

## What was verified

- `tools/smoke/smoke-wo603-ingest-local.test.js` 9 pass (two new: move of a file + a folder, copy keeps sources).
- `x-shift-held.py`: exit 1 idle, exit 0 with Shift down. Client `--check` boot OK.

## Not verified

- The gesture itself on the glass (Shift-drag from Thunar onto the Sources list) and the progress line.
- A move across filesystems (the copy + remove path) with a large file.
