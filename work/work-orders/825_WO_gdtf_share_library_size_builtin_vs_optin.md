# WO-825 — GDTF Share library: built in (~100 MB?) or an opt-in download (like Capture)

**Status: OPEN (30.10) — owner decided the shape (below); implementation in progress; GDTF Share redistribution terms not checked yet**

## Owner decision (30.10)

*"lets do the XML plus re-encoded small thumbnails built-in and per model fetch when used in a project. or full model
library download from settings."*

- Built in: every fixture's description XML plus a re-encoded small thumbnail (~110 MB measured).
- A fixture's 3D models (and gobos) are fetched from GDTF Share when that fixture is used in a project.
- Settings offers a full model-library download (the opt-in, like Capture).

Owner (29.10): "Calculate how much would a full gdtf share archive take up space. If it'd be around 100mb it would be
worth having it built in. Or opt in library download like in capture."

## Investigation

Source: the box's cached revision list `~/.highascg/cache/gdtf-share-list.json` (getList.php, refreshed 29.10 10:53;
every entry carries `filesize`) + a seeded random sample of 80 files (newest revision each) downloaded with the box
account and unpacked (`description.xml` / `models/` / `thumbnail*` / `wheels/`).

| What | Files | Size |
|---|---|---|
| Every revision on GDTF Share | 13 441 | **14.9 GB** (exact, list `filesize`) |
| Newest revision per fixture (manufacturer + name) | 10 472 | **12.1 GB** (exact); median 455 kB, mean 1.15 MB, max 156 MB |
| — only files ≤ 1 MB / ≤ 2 MB / ≤ 5 MB | 7 968 / 9 409 / 10 100 | 2.7 / 4.7 / 6.8 GB |
| — the biggest 100 files alone | 100 | 3.1 GB |
| Revision list (index) | — | 7.2 MB raw, **0.8 MB** xz |

Inside a GDTF (sample, % of zipped bytes): thumbnails 34 %, wheel images (gobos/colours) 34 %, `description.xml`
18 %, 3D models 13 %. The XML is usually stored **uncompressed** in the zip (137 kB/file raw) and compresses ~25–45×:

| Slice of the newest-revision library (10 472 fixtures) | Estimate |
|---|---|
| XML only, xz per file | **~60 MB** |
| XML only, one solid xz archive | **~30 MB** |
| XML + 3D models (previs bodies) | ~1.1–1.7 GB |
| XML + thumbnails as shipped | ~2.8 GB (thumbnails re-encoded small would be ~+50 MB) |
| Everything | 12.1 GB |

The sample mean (763 kB) is below the population mean (1153 kB): random sampling misses the few huge files, so the
image/model rows are low-side; the XML rows do not depend on those outliers.

What HighAsCG reads from a GDTF: modes/channels/attributes (`src/fixtures/gdtf-parse.js`, `gdtf-features.js`) →
patch, DMX out, programmer; models → previs bodies (WO-767/784; a fixture without a model already renders a generic
body); wheel media + thumbnails → programmer pickers (`godot/client/features/previs/fixtures/programmer_*.gd`).
On-demand fetch already exists (WO-637/785: MVR placeholders resolved from GDTF Share into the type store).

## Recommendation (not built)

- The **full** archive is 12–15 GB — not "around 100 MB"; not built in.
- **Built in: the XML-only library + index, ~30–60 MB.** Every fixture on GDTF Share patches, outputs DMX and shows in
  the programmer offline, previs with generic bodies. Models/wheels/thumbnail for a fixture fetched on demand when
  online (existing WO-637 path), cached in the type store.
- **Opt-in (Capture-style) "download full library"**, 12 GB, or a "with 3D models" tier ~1.5 GB, for offline venues.
- Before shipping any mirror: check GDTF Share's terms on bulk download / redistribution (files belong to their
  uploaders; 61 % are user uploads, 39 % manufacturer). The opt-in per-user download with the user's own account
  avoids redistribution entirely; the built-in XML set is the one that needs the permission check.

## What was verified

Numbers above: computed from the full list (exact) and the 80-file sample (extrapolated). Nothing built.
