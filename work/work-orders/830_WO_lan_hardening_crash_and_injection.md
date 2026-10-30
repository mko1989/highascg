# WO-830 — LAN hardening: remote crash, injection, secrets (sweep §2, without the auth switch)

**Status: IN PROGRESS (30.10) — 830a crash class DONE offline (26 new smoke tests; each crash reproduced on the old tree); 830b/830c in progress**
**Source:** the 29.10 code sweep, `work/sweep-29.10.2026/REPORT.md` §2 (items 1–24). Owner 30.10: *"yes we need better
auth handling. im putting that off till last … id like it to be hardened"* and *"there are a lot of bugs to fix"*.
**Related:** WO-811 (the auth switch itself stays there and comes last), REVIEW-2026-08-03, WO-418/419.

Three commits, none needs the auth decision:

- **830a — crash class (items 1–8):** each is a one-request remote restart, because process-guards exits(1) on any
  uncaught exception.
- **830b — injection and validation (items 9–15, 23):** root command injection via the vcam label, arbitrary file write
  via caspar-config apply, unchecked update asset, plugin id traversal, replication host/rsync, nuclear password fail-open,
  AMCP CR/LF.
- **830c — secrets and UI (items 16–22, 24):** nuclear password field autosave, redacted GET echo, open redirect,
  malformed cookie, support-bundle redaction, SRT passphrase drop, config dump in the journal, release from a dirty tree.

Item 25 (nuclear routes open to the LAN) is the WO-811 decision.

## 1. Investigation

See REPORT §2 tables and the batch MDs named there; each item carries file:line and how it was checked ([V] verified, [A] agent-read).

## 2a. What was done (crash class) — WO-830a

Each item was re-read and reproduced before fixing; all eight were real. Comments in the code cite `WO-830a`.

| # | Change |
|---|---|
| 1 | `src/system/video-feed.js` `onUpgrade`: `new URL(req.url)` wrapped in try/catch → `HTTP/1.1 400` + destroy (before the origin/auth checks, which never ran for `GET //`). |
| 2 | `src/server/ws-server.js`: `ws.on('error', …)` logged, on both the `/api/ws` and the replication connection handlers (file is exactly 500 lines, so the listeners are single lines with trailing comments). Same fix on the video-feed client sockets (`video-feed.js` `addClient`) — it had the identical gap (invalid UTF-8 frame). |
| 3 | `src/osc/osc-state-audio.js`: `MAX_AUDIO_CHANNELS = 64`; clamps `nb_channels`, the `/N/dBFS` meter index (also an unbounded `levels.push` loop, not in the sweep) and the bundled-`volume` / per-layer sample counts. **Bind (coordinator):** `src/bootstrap/osc-lifecycle.js` `effectiveOscBind`: the wildcard `0.0.0.0` narrows to `127.0.0.1` when the Caspar host is loopback (this box: Caspar's `<predefined-client>` is 127.0.0.1:6251). An explicit address or a remote Caspar keeps the configured bind. |
| 4 | `src/utils/safe-unzip.js`: `entry.stream().pipe(ws)` → `stream/promises.pipeline()`. Reproduced pre-fix as a *hung* extraction (the error is swallowed by `.pipe()`, the promise never settles, the upload request never answers) rather than a hard crash; pipeline rejects and destroys both streams. Not done: the size caps trust the zip's declared `uncompressedSize`; a lying header is not capped on actual bytes. |
| 5 | `src/api/routes-ingest.js`: the hand-rolled read/`write()` loop is replaced by `writeBodyToFile()` (exported) = `pipeline(Readable.fromWeb(body), progress Transform, createWriteStream)`: error handling from the first write, real backpressure. The progress callback keeps the existing `setDownloadState` updates. |
| 6 | `src/stage/mvr-scene.js`: Symdef expansion keeps an *open path* set (a Symbol whose symdef is already being expanded is skipped), plus a visit budget of 4096 nodes per object and 500 000 per scene. `src/stage/mvr-gdtf.js`: GeometryReference target already open on the path is skipped (the old guard only caught `ref === node`); the fixture walk is capped at 4096 nodes / 512 parts. Reusing a symdef side by side (non-nested) is unaffected. |
| 7 | `routes-screens.js` (`src/api/`): `screenIdx` must be `0..15` (matches the `Math.min(16, …)` screen caps elsewhere) → 400 otherwise, so the legacy `screenLabels` padding loop cannot be driven to 1e9. `src/companion/satellite-preview-client.js` `subscribePageSession`: every row/col bound is truncated and clamped to `0..31`, min <= max (Companion pages are <= 32×32). `src/api/routes-companion-preview.js` not edited — it just forwards to the client, so the clamp sits at the single choke point. |
| 8 | `src/engine/scene-exit-layers.js:279`: `Math.max(1, Math.floor(resolveMaxBatchCommands(…) / 3))`. With cap 1–2 a 3-line batch exceeds the cap, `batchSend` rejects and the existing per-layer STOP/MIXER CLEAR fallback does the clear. |

## 3a. Verified — WO-830a

New tests (all mock- or temp-dir-based, no live state; the crash-class ones run the scenario in a child node process with an `uncaughtException` recorder):

- `tools/smoke/smoke-wo830a-ws-crash.test.js` (4 tests) — items 1–2, real http server + `ws` clients: `GET //` upgrade, 9 MiB frame on `/api/ws`, invalid-UTF-8 frame on `/api/video-feed`.
- `tools/smoke/smoke-wo830a-parsers.test.js` (16) — items 3, 6, 7, 8.
- `tools/smoke/smoke-wo830a-streams.test.js` (5) — items 4–5 (corrupt zip entry, `/dev/full` download), plus a valid-zip round trip.

Results: all 26 new tests pass on the fixed tree. Against the pre-fix tree (`git archive HEAD` copy, selected with `HIGHASCG_WO830A_ROOT`):
- items 1+2: child records `Invalid URL`, `Max payload size exceeded`, `Invalid WebSocket frame: invalid UTF-8 sequence` as uncaught exceptions, and no 400 is sent;
- item 3 (`nb_channels` 1e9, `/900000000/dBFS`), item 6 (self-referencing Symdef, 3 self-Symbols), item 7 (`screenIdx` 1e9, `colMax` 1e9): node dies with "JavaScript heap out of memory" (run with `--max-old-space-size=300`);
- item 6 GDTF A↔B reference cycle: test fails (unbounded parts);
- item 8 (cap 1 and 2): the process spins until killed by `timeout` (rc 124);
- item 4: extraction promise never settles (hang); item 5: the pre-fix loop shape against `/dev/full` ends in an uncaught `ENOSPC` (separate scratch repro).

Also run: the 52 existing smoke/test files that mention any touched module (393 tests, 0 fail), `eslint` on all changed files (0 new warnings; one pre-existing `broadcastLiveState` unused-var warning in ws-server.js), `check-max-file-lines` (nothing new over 500; ws-server.js is now exactly 500).

Open: actual-bytes cap in safe-unzip; new test files still need adding to the curated list `tools/ci/offline-test-files.js`.
