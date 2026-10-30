# src/previs — sweep 29.10.2026 (batch 088)

Files: 3 · lines: 452 · findings: 0 BUG-HIGH, 1 BUG, 1 DEAD, 1 RISK, 4 QUALITY

Method: all three files read in full; callers traced through src/module-registry.js, src/api/router-dispatch.js:84 and src/server/http-server.js (multipart bodies are not pre-consumed, :303-308; `result.stream` is piped, :358-368); WO-17 / WO-30 / WO-612 consulted. Repro used `require.cache` mocks for `repo-paths` and `persistence` so nothing was written in the repo.

## src/previs/register.js
- `QUALITY` src/previs/register.js:31,33,67 — stale self-description: `status: 'phase-2'`, the log says "module skeleton booted", the header says "Current status: skeleton", and the two TODO routes (:41-42) are WO-17 leftovers, while the module now serves the model store that the Godot Previs tab depends on. `see: 'work/17_WO_3D_PREVIS.md'` points at a path that does not exist (the file is work/work-orders/17_WO_3D_PREVIS.md). `JSON_HEADERS` is redeclared locally.

## src/previs/routes-models.js
- `BUG` src/previs/routes-models.js:250-265,298 — a client abort mid-upload leaves an orphan file and a promise that never settles. Failing case: POST a multipart body, send the first 5000 bytes of the file part, then destroy the request. → repro (PassThrough req, mocked storage root): `handle()` never resolved, `<storage>/models/0064e34c2d2d60f0.glb` stayed on disk at 5000 bytes with no record in `previs.models`, and nothing ever deletes it. Cause: `req.pipe(bb)` never ends the parser on an aborted request, so neither `writeStream 'finish'` nor `cleanupAndFail` runs; there is no `req.on('aborted'|'close')` handler. Fix: on `req` close without end, destroy the writeStream, unlink `savePath` and `settle(...)`.
- `RISK` src/previs/routes-models.js:122-124 — uploads (up to 100 MB each) land in `<repo>/.highascg-previs/models/`, which is in neither .gitignore nor .stignore (`git check-ignore -v .highascg-previs/models/x.glb` → not ignored; `grep highascg-previs .stignore .gitignore` → nothing). CLAUDE.md says server-written paths must be in `.stignore` or peers sync/revert them; the deploy scripts already know the dir (scripts/lib/archive-common.sh:95, scripts/deploy/dev-push.sh:109). Add it to both ignore files (and the Mac's .stignore).
- `QUALITY` src/previs/routes-models.js:312 — the 410 body says "record will be cleaned up" but nothing removes the record; the list keeps returning the dead model and the Godot dropdown shows an item that always 410s. Delete the record in that branch, or fix the message.
- `QUALITY` src/previs/routes-models.js:320 — `Content-Disposition: attachment; filename="${encodeURIComponent(name)}"`: percent-encoding inside a plain quoted `filename=` is not decoded by browsers, so "My Rig.glb" downloads as `My%20Rig.glb`. Use `filename*=UTF-8''…` (the Godot client uses `get_bytes`, so only browser downloads are affected).
- `DEAD` src/previs/routes-models.js:345 `getStorageRoot` export — no caller outside the file (`grep -rIwn getStorageRoot src client godot tools` → only the definition and internal uses).

## src/previs/types.js
- `QUALITY` src/previs/types.js:1-14,45 — a typedef-only file (`module.exports = {}`) that nothing requires (`grep -rn "previs/types\|require('./types')"` → only comments in client/lib/previs-*.js). The header claims "the Node server and the browser both include" it; they do not. The client comments cite a `ScreenTag` type that is not defined here, and the header's link `../../work/17_WO_3D_PREVIS.md` is wrong (work/work-orders/…). Keep as docs, but fix the claim and paths.
