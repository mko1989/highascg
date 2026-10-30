# WO-825 — GDTF Share library: built in (~100 MB?) or an opt-in download (like Capture)

**Status: IN PROGRESS (30.10) — tooling, server, Settings pane built and mock-tested; terms checked (shipping the library in the ISO is NOT clearly allowed → built on each box instead); full build not run (coordinator/owner decide when; it downloads ~12 GB)**

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


## GDTF Share terms (read 30.10, https://gdtf-share.com/landing/pages/termsAndConditions.php)

Quoted from the page (fetched through a summariser, so re-read the page before relying on a clause):

- §5: uploaded material is "non-confidential and non-proprietary"; the *website owner* may "use, copy, distribute and disclose
  to third parties any such material for any purpose" — a right the terms give GDTF Share, not us.
- §9: "You may print off one copy, and may download extracts, of any page(s) from our Website for your personal reference";
  "You must not modify … materials you have … downloaded"; "You may not … copy"; "You must not use any part of the materials
  on our Website for commercial purposes … without obtaining a license"; "The content is provided to you as a whole and is
  not severable."
- §6: the site must not be framed; no deep links. No clause on bulk / automated download, none on API use.
- API page (gdtf.eu/gdtf/share_api): an account is required; the API "is not intended to be used as a replacement for the
  GDTF Share website"; "If you are not the end user, you should direct your customers … to the GDTF Share website."
  No rate limit stated.

Reading: nothing grants permission to bundle a mirror of the content (not even the XML) in a product; §9 points the other
way (personal reference, no copying, no commercial use without a licence, "not severable"). So **the library is not put in
git or the ISO**: each box builds it from its own GDTF Share account (the shared box account does ship, owner 22.10).
Written permission from VPLT / the GDTF group would change that — owner's call. Upload ownership is also per uploader
(61 % user uploads).

## 2. What was done

Shape (owner 30.10): XML + small thumbnails as the "built-in" library, a fixture's models fetched when it is used in a
project, a Settings action for the full model library.

**Where it lives:** `~/.highascg/cache/gdtf-library/` (`index.json`, `x/<rid>.xml.br`, `t/<rid>.webp`, `full/<rid>.gdtf`,
`pending.json`). Outside the repo (no `.gitignore`/`.stignore` line needed) and under `~/.highascg/cache/*`, which both eggs
exclude lists already drop (`penguins-eggs-exclude-highascg-fragment.list` / `-embed-server.list`) — pinned by the new wiring
smoke. `HIGHASCG_GDTF_SHARE_DIR` moves it with the account (tests).

**The catch the numbers hide:** the GDTF Share API only serves whole `.gdtf` files (getList.php has footprints only), so
building the 70 MB library means *downloading the 12 GB* once per box (≈ 2–3 h at the sample's ~1.7 MB/s). That is why
"built in" cannot be a per-install first-run step without hitting the service 10 000× per box — see the owner decisions
below. The full-library download can reuse the same files; `ensureFull` reads `full/` before the network.

Files (all new unless noted):
- `src/fixtures/gdtf-library.js` — paths, index (atomic write, mtime-cached read), `search`, `xml`/`thumb`, `typeIdFor`
  (hash of maker|fixture, **stable across revisions**), `useType` (description-only stub .gdtf built with jszip → type store),
  `installed`, `usage`.
- `src/fixtures/gdtf-library-build.js` — `newestPerFixture` (maker+name case-insensitive, newest `lastModified`, stable
  pseudo-random order so `--limit N` is a spread sample), `extractParts` (description.xml + the `Thumbnail=` PNG, else any
  root thumbnail PNG; SVG-only fixtures get none), `encodeThumb` (ffmpeg → WebP, longest side ≤ 128 px, never enlarged; WebP
  chosen over PNG: 2 kB vs ~15 kB each, Godot 4 and browsers both load it), `build` (resumable: entry skipped when its rid
  and XML file exist; index saved every 50; a superseded revision's files deleted).
- `src/fixtures/gdtf-share-job.js` — `Job` (progress, cancel) + polite `run` (one request at a time, 300 ms pause, 3 retries
  with 2/4/8 s backoff, 401/403/no-account not retried, run ends `error` after 12 failures in a row).
- `src/fixtures/gdtf-share-full.js` — `useFixture` (stub now, full file in the background), `ensureFull` (full file swapped in
  **under the same type id** so patched fixtures keep working; offline → id into `pending.json`, retried every 10 min by a
  server timer), `adoptPatch` (hook), `estimate`, `runFull` (cancellable, resumable by file size, refuses when the disk
  cannot hold the rest, `.part` + rename), `deleteFull`.
- `src/fixtures/gdtf-store.js` — `importGdtf(buf, name, {id, share})`: stable id + `share:{rid,full}` marker (summary carries
  `share`), rig cache dropped when a type is replaced in place.
- `src/fixtures/gdtf-share.js` — exports `download`, `home`.
- `src/fixtures/follow-service.js` — the fixture-add hook: on every project change `adoptPatch(typeIds)`: a library type
  missing from the store (project from another box / cleared store) is imported from the built-in XML; a stub starts its
  full fetch (at most one try per 10 min per type, so project saves do not hit the network offline); `reload()` re-resolves
  the patch when something changed. Placed after `sender.setInterface(...)` (WO-698 smoke pins the line before it).
- `src/api/routes-gdtf-library.js` (registered from `routes-gdtf-share.js`): `GET /api/fixtures/library/status|search|thumb/<rid>`,
  `POST …/use {rid}`, `POST …/build {limit?}`, `POST …/full`, `POST …/cancel`, `DELETE …/full`; one job at a time (409).
- `tools/gdtf/build-library.js` — CLI: `--limit N`, `--full`, `--delay MS`, `--status`; Ctrl-C stops after the current file.
- Godot (new files): `features/settings/library_pane.gd`, `library_model.gd`, `tests/test_library_model.gd`; registration in
  `features/settings/settings_tab.gd` (const line 21, `_pane("GDTF library")…` line 58). The pane: library line, "Build /
  update library", the full-library size ("x GB of ~12 GB downloaded"), "Download full model library" (confirm with the size
  still to fetch), "Delete downloaded models", Stop, live progress (poll 1.5 s while running), the offline queue count.

**Not done (out of my scope):** a library picker in the Previs fixtures section (`features/previs/fixtures/fixtures_section.gd`
adds only from the type store today): it should call `GET /api/fixtures/library/search?q=` (thumbnails from
`/thumb/<rid>`) and `POST /api/fixtures/library/use {rid}` → `type.id`, then add as for an imported type. The server side of
"fixture from the library added to a project → models fetched" is complete without it (a patch whose typeId is a library id
is adopted by the hook). No first-run auto build is wired (see decisions).

## 3. Verified

- `node --test tools/smoke/smoke-wo825-library.test.js tools/smoke/smoke-wo825-wiring.test.js` — 8 + 3 pass: newest-revision
  selection; build keeps XML + thumbnail, drops the rest, resumes (second run downloads nothing), replaces a superseded
  revision; `--limit`; cancel; failure counting; ffmpeg 128 px WebP; stub under a stable id → offline queue → upgrade in
  place (gobo member appears, same id, reload fired); `adoptPatch` imports a missing library type and respects the retry
  window; full download estimate / disk guard / resume / delete; all routes incl. 409 and cancel; wiring pins. The Share HTTP
  client is mocked (login cookie, getList, downloadFile); no network in tests.
- Regression: wo637, wo633, wo785, wo615 (gdtf, dmx, visual, follow-ik), wo700, wo807 (2), wo695, wo712, wo698 — all pass
  (wo698 pins the `configure(slice)` / `setInterface` lines; the hook sits after them).
- `npx eslint` on all changed/new JS clean; `check-max-file-lines` shows only 2 pre-existing >500 files; `check-tdz-reads`,
  `check-unwired-exports` clean for the new code. Godot: `tests/run_tests.gd` 23 211 passed / 0 failed, `run-client.sh --check`
  boots with no script errors.
- **Live sample, real GDTF Share, the box account, scratch home (live cache untouched):**
  `HIGHASCG_GDTF_SHARE_DIR=<scratch> node tools/gdtf/build-library.js --limit 20` → 20 fixtures in 14.7 s, 0 failed, 13 MB
  downloaded (mean 740 kB/file; the population mean is 1.15 MB). Per fixture: XML 4.3 kB brotli (max 16 kB; the raw XML is
  ~25–45× larger), thumbnail 2.1 kB WebP 128×128 (16 of 20; 3 have no thumbnail at all, 1 only an SVG), index 385 B →
  ≈ **6.8 kB/fixture**.
  Extrapolated to 10 487 fixtures: XML ≈ 45 MB, thumbnails ≈ 18 MB, index ≈ 4 MB → **≈ 67 MB of data, ≈ 110 MB on a 4 kB-block
  disk** (20 k small files) — consistent with the WO's 110 MB. Download cost ≈ 11.5 GB (exact from the list: 10 487 files,
  11 534 MB), ≈ 2–3 h at the sample's rate. `--status`: "full download: 10487 files, 11534.4 MB".
- Not verified: the running server has not loaded the routes (no restart allowed); the Godot pane was not rendered
  (compile-checked only); a real on-demand fetch through the server. Owner QA after a node restart: Settings → GDTF library.

## Open decisions for the owner

1. **Redistribution.** Terms do not grant it. Ask VPLT / the GDTF group for written permission to bundle description XML +
   thumbnails (then build once on a dev box, ship the directory, and the 12 GB per-box cost disappears), or keep it per-box.
2. **Per-box build cost.** Per-box = 12 GB download from GDTF Share per install. Options: build on demand from Settings only
   (current), or build once and copy via the existing exFAT/stick drop (still copies content between boxes).
3. First-run auto build: not wired (heavy, hits the service); a one-liner `build.build(new Job('library'), {})` at boot when
   an account is set and the library is empty would do it.
