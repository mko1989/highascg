# WO-1009 — Project documents: upload MVR / GLB / PDF / Excel to the project folder; browse them in Sources ("media only" off)
**Area:** godot-client, media, tracking-vr
**Status: DONE (09.11 — smoke 3/3, Godot suite 26178/0, boot check, live on the owner's client with the pointer: Files window upload/open/save/remove, project .glb in Previs Models, project MVR import, Sources "media only" off → open / right-click / delete)**

Owner, 09.11:
- "build mvr and glb pdf and xls (excel) doc files upload to project folder."
- "add to the media browser a toggle media only and let me browse the other project files there."

## Investigation

- **Where a project's files live.** Each project already has a media folder, `<media>/projects/<slug>`, from
  `getProjectMediaRoot(config, null, slug)` (src/media/project-media-root.js). The Sources tree shows it as
  `projects/narvil/`. A project rename moves the folder, and project-media sync carries it to the peer box. That makes
  it the natural home for show documents; no second store is needed.
- **Caspar never lists these kinds.** `src/media/local-media-paths.js:11` `SCAN_EXT` holds only clip and still
  extensions, so `.mvr .glb .pdf .xls(x)` placed there stay out of `/api/media` and Caspar's CLS.
- **No upload path existed.** The Godot client had no way to add a `.glb`: the Previs said "add one through the web
  UI's drop zone". The previs MVR import (`POST /api/stage/mvr`, routes-stage-mvr.js) parsed the file and then threw
  the bytes away.
- **Routing.** `/api/project/*` has GET / DELETE / POST wildcards that would swallow new `/api/project/files…` routes
  (memory: router matches in order), so the new routes sit under `/api/project-files` and `/api/media-docs`.
  `src/server/http-server.js:305` skips body pre-read for multipart, so busboy can stream large MVRs (10 MB+) to disk.
- **Viewers on the box.** firefox-esr opens PDFs (`OS.shell_open` → xdg-open). There is no LibreOffice, but no desktop
  program is needed for spreadsheets: the server already reads them for lower thirds (WO-601,
  `src/api/routes-lower-third-roster.js` → `client/lib/lower-third-roster-import.js parseSpreadsheetFile`, exceljs,
  2 MB cap). The owner flagged this (09.11: "that shouldnt be true. we have a built in reader to use as data input for
  lower thirds"). That reader cannot read legacy binary `.xls` (exceljs is xlsx-only; SheetJS was dropped in WO-105) and
  says so.

## What was done

Server:
- `src/media/project-files.js` (new): the kinds (`.mvr` mvr, `.glb` model, `.pdf` pdf, `.xls/.xlsx` sheet), `cleanName`
  (base name only, no control or reserved characters, no dotfiles), `folder`/`list`/`resolve`, `begin` + `place`
  (streamed to a hidden `.upload-*.part`, then renamed in; identical bytes (sha1) → kept once, `existed: true`; another
  file with that name → `name (2).ext`, never overwritten), `saveBuffer`, `remove`. `listMediaDocs(config)` walks the whole media
  root (skipping hidden entries, depth ≤ 12, at most 5000) and returns media-style ids; `resolveMediaDoc` goes through
  `resolveSafe` plus a kind check, so it never leaves the root and never touches a clip.
- `src/api/routes-project-files.js` (new): `GET/POST /api/project-files` (multipart, several files, 2 GB limit, other
  kinds rejected per file), `GET/DELETE /api/project-files/<name>`, `POST /api/project-files/<name>/mvr` (import an MVR
  already in the folder via `routes-stage-mvr.importReply`), `GET /api/media-docs`, `GET/DELETE
  /api/media-docs/file?id=`. Every change broadcasts WS `change {path: 'projectFiles'}`. Registered in
  `src/api/router.js:476`.
- `src/api/routes-stage-mvr.js`: the import logic is exported as `importReply(buf, name)`. An uploaded MVR is also kept in the
  project folder (`saveBuffer`) so it travels with the show.
- `src/media/project-media-gather.js`: exports `activeProject`.
- Spreadsheets: `GET /api/media-docs/sheet?id=` and `GET /api/project-files/<name>/sheet` (`sheetReply` in
  routes-project-files.js) run the lower-thirds reader and return `{ok, fileName, headers, rows (≤ 5000), total}`.

Godot client:
- `core/project_files.gd` (new): helpers + `list / upload / fetch / open / open_from` (a copy in
  `user://project-files/`, then `OS.shell_open`).
- `app/sheet_view.gd` (new): Open on an `.xls/.xlsx` (Files window or Sources) shows the sheet in the client's own table
  (title = file name, a filter box matching any cell, "N of M rows"); `core/project_files.gd open_from` routes
  spreadsheets there (`sheet_url`, `is_sheet`), everything else to `OS.shell_open`.
- `app/project_files_dialog.gd` (new) + `app/header_project.gd`: a **Files** button in the header (after New project)
  opens "Project files": a list with Add files… / Open / Save copy… / Remove, OS file drops onto the window, and a live
  refresh on the WS event.
- `features/previs/previs_models.gd` (new, out of previs_tab.gd for the 500-line limit): the Models list shows the
  project's `.glb` files first, then the library; the "web drop zone" hint is gone.
- `features/previs/mvr_import.gd`: Import… offers "From the project: <name>" for each MVR in the folder, or "From this
  computer…".
- **Sources "media only"** (`features/live/project_media_bar.gd`, `features/live/media_docs.gd` new,
  `features/live/media_panel.gd`): a check box beside "project only", on by default and stored in ui.cfg
  `[sources] media_only`. Off → `GET /api/media-docs` rows join the tree in their folders, in muted text with
  "kind · size". A document row's metadata is `{doc}` only (no `value`/`row`), so it never drags onto a layer, never
  joins a media selection and never opens the media Inspector. Double-click opens it with this machine's viewer;
  right-click → Open · Download to this computer… · Delete… (confirm). `media_ops.gd` gained `file_at` / `folder_at`
  (moved out of media_panel.gd for the line limit). The choice holds even when the project bar is hidden (no project
  folder), because it is read from ui.cfg.

Why the media root and not only the open project's folder in Sources: the tree already shows every folder, so documents
appear wherever they sit (e.g. `projects/a_s/IDE Serock mvr.mvr`); the Files window is the per-project view.

## What was verified

- `tools/smoke/smoke-wo1009-project-files.test.js` 3/3 (in `tools/ci/offline-test-files-3.js`): kinds, dedupe, `(2)`
  names, path cut to the file name, list, download with MIME, traversal → 404, delete, 409 without a project,
  `saveBuffer`, the MVR import keeps its file (source grep), media docs across folders / hidden skipped / clip never
  served or deleted.
- Smoke test 4 (also run in a loop of 20, after fixing a flake: `saved` follows write-finish order, so the test now sorts)
  covers the spreadsheet reader: an exceljs-written `.xlsx` → headers/rows/total by media id and by project name, legacy
  `.xls` → "Legacy .xls…" error, a PDF → 404.
- Godot suite 26185/0 (`tests/test_project_files.gd`: helpers, URL encoding, media_docs `merged`/`decorate` (a document
  is never a media row), `sheet_url`/`is_sheet`, sheet_view render + filter) and `--check` boot OK.
- Live on the box (node restarted; pointer allowed by the owner):
  - Files window: added an MVR, a GLB and a PDF; re-adding was deduped. Open launched firefox-esr with the PDF. Save copy and
    Remove both worked.
  - Previs: the project `.glb` appeared first in Models and loaded. Import… → "From the project: Narvil IDE 11.2026.mvr" →
    "Already imported".
  - `curl /api/media-docs` listed the documents across `projects/*`; `GET …/file?id=` returned 200 application/pdf.
  - Sources: unticked "media only" → `projects/narvil/` showed "Narvil IDE … MVR scene · 9.7 MB", the GLB and the PDF.
    Double-click on the PDF opened it in firefox-esr ("Opened wo1009-test.pdf"). Right-click showed Open / Download /
    Delete…; Delete → confirm → the file was gone from disk and the tree reloaded ("Deleted wo1009_test_set.glb").
    Ticked it back on and ui.cfg holds `media_only=true`.
  - Spreadsheet: put a 3-row `wo1009-crew.xlsx` in `projects/narvil/`, then double-clicked it in Sources → a
    "wo1009-crew.xlsx" window with Name / Role / Company and 3 rows ("3 of 3 rows"). The status line read "Opened
    wo1009-crew.xlsx". Both curl routes returned the same rows.
- Test files removed afterwards. `Narvil IDE 11.2026.mvr` stays in `media/projects/narvil/` as the show's own scene.
- Not covered: legacy binary `.xls` cannot be read (the reader says "save the sheet as .xlsx or CSV"); `.xlsx` over
  2 MB is refused by the reader's cap. Deleting a document
  re-collapses the tree, as every media reload already does.
