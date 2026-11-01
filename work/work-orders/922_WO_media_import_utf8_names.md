# WO-922 — Media import keeps Polish file names on every path (URL downloads saved the %-escaped name)

**Area:** media
**Status: DONE (01.11.26 — offline smoke 3/3, live: upload, flagged + macOS zips, Godot local drop, URL download all land as UTF-8 and CINF in Caspar)**

Owner, 01.11.26:
> The garbled name was a bug with importing media. Check if it's fixed for sure.

The WO-919 sweep showed the frontex missing-asset notice listing `Spoty_Ptt_2026 MichaÅ.mp4` and similar names.

## Investigation

- **Root cause:** the original bug was busboy's default `latin1` decode of multipart file names. A browser sends them as
  raw UTF-8, so `ł` (C5 82) became `Å` + U+0082 on disk. It was fixed in WO-592 (04.10) with `defParamCharset: 'utf8'`
  plus NFC in `src/api/routes-ingest.js`. At that time the 10 garbled files in `projects/airport` were renamed and their
  references followed.
- **Where the frontex names come from:** they are references STORED in the show, written while the bug was live.
  - No such file exists on the box under either the garbled or the correct name (`find /` on both).
  - Shows that still hold garbled references (project and `_autosave`):
    - `frontex`, `kongres_trans`: 6 names (`Michał`, `Sobierańska-Grenda`).
    - `moj1`, `mojtest`, `newtest`, `newtest2/3/4/7/8`: `Mównica pusta serce.png`.
  - None of those clips is on the box, so the references are dead either way.
- **Every import path, probed live with Polish names:**
  - `POST /api/ingest/upload`, the web upload: `Enc Michał Żółć.png` → correct UTF-8 on disk.
  - The same upload with a zip that has the UTF-8 flag (0x800), and with one WITHOUT it (macOS Archive Utility style;
    `unzipper` falls back to UTF-8) → both entries correct.
  - `POST /api/media/ingest-local`, the Godot drop: a filesystem copy → correct.
  - `POST /api/media/version/upload` and the Godot `core/stream_upload.gd` both send raw UTF-8 bytes to a busboy with
    `defParamCharset: 'utf8'`, the same as the upload above.
  - **`POST /api/ingest/download` (URL): broken.** `handleDownload` saved `path.basename(new URL(url).pathname)`, which is
    the still-percent-encoded segment. `http://…/Url%20Micha%C5%82.png` landed as `Url%20Micha%C5%82.png`.

## What was done

- `src/api/routes-ingest.js`: new `urlFileName(url)`.
  - It decodes the last path segment, takes the basename again (an encoded `%2F` cannot climb out; `resolveSafe` still
    guards) and applies NFC like the upload path.
  - A malformed escape keeps the raw segment instead of failing the download.
- New `tools/smoke/smoke-wo922-ingest-utf8-names.test.js`:
  - URL name decoding: NFD → NFC, encoded slash, broken escape, empty path.
  - The busboy `utf8` pins.
  - Zip extraction with and without the UTF-8 flag, using hand-built zips.
- **Stored references repaired (owner, 01.11.26: "Push and repair").**
  - A scan of every `projects/**/*.json` (not `_trash`) for a UTF-8 lead byte read as Latin-1 (`[Â-ô]` followed by
    U+0080–U+00BF) found 20 files: the 9 + 2 shows above (project + `_autosave`). It also found one more:
    `llkk` holds `01_Grzegorz ZÌ\x87ytka.mov`. That is a macOS NFD name (Z + U+0307) that went through the same bug.
  - The repair edits the raw text, so the file formatting stays as the server wrote it. Each garbled run is decoded
    `latin1` → `utf8` and composed with the letter before it (NFC), so `llkk` now reads `Żytka` (NFC, like uploads).
  - Each file was checked before writing: it parses before and after, and only the repaired strings differ. The
    rescan afterwards finds 0. The active show (`mhp_harder`) was not touched.
  - `/api/project/list` lists all 14 repaired shows.
  - The originals are backed up in the session scratchpad.
  - None of these clips is on the box, so the shows still report them missing until the files are imported; they now
    match by name when they are.

## What was verified

- Offline: the new smoke passes 3/3. The URL test fails on the old `path.basename` (it returns the escaped name).
- Live, after a node restart: `/api/ingest/download` of `http://127.0.0.1:8765/Url%20Micha%C5%82.png` →
  `download-status` "Saved Url Michał.png"; on disk the bytes are `C5 82`.
- The media list after a refresh has all the test clips with `resolution 1×1`, so Caspar CINF reads the UTF-8 names.
- The test files were removed afterwards (`media/wo_enc_test/`, `media/projects/mhp_harder/Url Michał.png`).
