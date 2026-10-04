**Status: IMPLEMENTED (2026-10-04, commit b7c8962a, offline-verified only) — NOT built/deployed (box on show). Needs `npm run build:client` + kiosk F5 after the show, then owner QA**

# WO-591 — Media browser: folder drop ingests contents; multi-select drag fills playlists

Owner, 04.10: "i cant drop folders into the media browser. i mean i can but it only creates the
folder. i should be able to select multiple files and drag and drop them into a playlist."
(Larger file-management / versioning ask split out to WO-592.)

## Investigation

1. **Folder drop.** `root.ondrop` in
   [sources-panel-ingest-ui.js](../../client/components/sources-panel-ingest-ui.js) passed
   `e.dataTransfer.files` straight to `uploadFiles`. For a dropped directory the browser exposes a
   single zero-content `File` named after the folder and never its children, so only the
   folder name reached the server. The tree is only reachable through
   `DataTransferItem.webkitGetAsEntry()` (supported by kiosk firefox-esr), and only synchronously
   inside the drop handler.
2. **Upload target ordering.** `uploadFiles` appended the `path` field *after* the files.
   Busboy streams parts in order (`routes-ingest.js` `bb.on('field')` / `bb.on('file')`), so an
   explicit subdir arrived after every file had already been written to the default base. It was
   harmless while `path` always equalled the server default; per-folder uploads need it first.
3. **Multi-drag → playlist.** `makeDraggable` in
   [sources-panel-helpers.js](../../client/components/sources-panel-helpers.js) sends a selection as
   `{ type: 'multi', items }`. The playlist dropzone in
   [inspector-layer-playlist.js](../../client/components/inspector-layer-playlist.js) did its own
   `JSON.parse` and required `data.value`, so a multi payload (no `.value`) was silently ignored.
   `parseDraggableSourcesPayload` in `scenes-shared.js` already handles `multi` for the deck.

## What was done

- `sources-panel-ingest-logic.js`: `collectDroppedFiles(dt)` walks entries recursively
  (loops `readEntries` until empty, because it returns batches) → `{ file, dir }[]`.
  `uploadDroppedEntries` groups by folder and sends one request per folder
  (`path = <default upload subdir>/<dropped folder path>`), chunked at busboy's 64-file limit.
  No server change: `getIngestEffectiveBase` + recursive mkdir already accept nested subdirs.
  `uploadFiles` now appends `path` first and returns ok/fail so the batch stops on the first error.
- `sources-panel-ingest-ui.js`: the drop handler collects entries; plain file drops still go
  through the old single request; drops with no `Files` type (internal row drags) are ignored.
- `inspector-layer-playlist.js`: the dropzone uses `parseDraggableSourcesPayload` and appends every
  item in selection order; the layer `source` is set from the first item only if the playlist was empty.

## Verified

- Mocked `FileSystemEntry` tree (folder › subfolder › files + a loose file) through
  `collectDroppedFiles` → correct `dir` per file (`Show`, `Show/Loops`, `.`).
- `smoke-wo370-playlist-media-durations` and `smoke-wo266-shader-fx` (both read these files) pass;
  eslint 0 errors (2 pre-existing innerHTML warnings); `check-max-file-lines` clean. Prettier
  drift on the three files predates this change (checked at HEAD).
- **Not verified on the box:** no build, no reload (show running). Owner QA after deploy:
  (a) drop a folder with a subfolder → the tree appears under the project media folder;
  (b) ctrl/shift-select 3 clips → drag onto a playlist dropzone → all 3 appended in order.
