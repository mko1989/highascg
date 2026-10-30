# src/api (part 2) — sweep 29.10.2026 (batch 062)

Files: 48 · lines: 6953 · findings: 1 BUG-HIGH, 15 BUG, 10 DEAD, 18 RISK, 34 QUALITY

Context for the reader (not findings):
- Auth is one global gate, not per route: `router-dispatch.js:55-64` runs `checkHttpAuth` on every `/api/*` request, so no handler in this batch lacks "its own" auth. On this box `config/security.json:2` has `enforceAuth: false` and the server binds 0.0.0.0, so today every mutating route below is open to the LAN. Per-route gates exist only as the nuclear-password check (`routes-operator-dock.js`, `routes-network-tailscale.js`) and the loopback check (`routes-media-ingest-local.js`).
- AMCP escaping: `param()` / `chLayer()` (`src/caspar/amcp-utils.js`) fold CR/LF and quote strings. The transport (`amcp-client-transport.js _sendPrepare`, `tcp-client.js send`) does NOT strip CR/LF itself, so a route that interpolates a raw body value into an AMCP line is injectable (shown for routes-mixer.js and routes-pip-overlay.js). Raw AMCP (`/api/amcp/raw`, restart, kill) is exposed by design, so those are RISK, not an escalation.
- Router shadowing facts used below: `RouteRegistry.dispatch` returns the FIRST matching route's result even when the handler returns `null` (no fall-through to a later route); a `/*` pattern needs a trailing segment, so bare `/api/foo` POSTs reach their handler only through the legacy block in `router-dispatch.js:104-131`, which is gated on `ctx.amcp`.
- Earlier review `work/reviews/2026-08-03-src-api.md` items still open in this batch: #7 (companion connection-status query probe), #6 (config reset not password-gated), #10 (upload truncation), #11 (thumbnails/generate double parse).

## src/api/routes-companion-preview.js
- `BUG` src/api/routes-companion-preview.js:140-145 — `rowMin/rowMax/colMin/colMax` come straight from the body and are never clamped to `pickerGridSize` (1..16). `subscribePageSession` (src/companion/satellite-preview-client.js:174-179) builds one `coords` entry per cell. Failing case: `POST /api/companion/page-preview/subscribe {"page":1,"rowMax":1000000,"colMax":1000000}` (satelliteEnabled is true in config/companion.json) → ~1e12 loop iterations allocating objects → event loop pinned, then heap OOM → node process dies. Fix: clamp each bound to `0..size-1` (and `rowMin<=rowMax`) in the route.
- `QUALITY` src/api/routes-companion-preview.js:11-17,72-75 — `parseLocationParams` only rejects `page < 1`; negative row/column are accepted and forwarded to the Satellite subscribe call.
- `QUALITY` src/api/routes-companion-preview.js:185-195 — `test-press` answers HTTP 200 `{ok:false}` for both a Companion non-2xx and a network failure; a status code (502) would let callers branch without parsing the body.

## src/api/routes-companion.js
- `RISK` src/api/routes-companion.js:16-19 — the whole query string is forwarded to `buildCompanionConnectionStatus`, which takes `host`, `port`, `satelliteHost`, `satellitePort` from it (companion-connection-status.js:11-21) and then opens an HTTP fetch / TCP connect to that target and returns connected/status/error. It is an open/closed-port oracle for anything the box can reach (review 2026-08-03 #7, still open). Intended for the Settings "test before saving" button; an allow-list (loopback + configured host) would remove the oracle without breaking it.

## src/api/routes-compose-preview.js
- `OK`

## src/api/routes-config.js
- `BUG` src/api/routes-config.js:18,38 — destructive gates use truthiness (`!b.apply`, `!b.reset`), unlike the rest of the API (`=== true`). Failing case: `POST /api/config/reset {"reset":"false"}` (or `"0"`) → string is truthy → `ctx.resetConfigToDefaults()` runs, i.e. a factory reset, and the reply says "System reset to factory defaults". Fix: `b.reset !== true` / `b.apply !== true` (the only caller, client/lib/default-project.js:144, sends boolean true).
- `DEAD` src/api/routes-config.js:16-34 `handleConfigApply` / route `POST /api/config/apply` (router.js:304) — `ctx.applyServerConfigAndRestart` is never defined anywhere. grep: `grep -rn applyServerConfigAndRestart src index.js` → only this file; `grep -rn "api/config/apply" client godot tools` → none (clients use /api/caspar-config/apply). Every call with `apply:true` returns 501.
- `QUALITY` src/api/routes-config.js:48-52 — the boolean returned by `ctx.resetConfigToDefaults()` (app-context.js: `() => boolean`) is ignored; a failed reset still answers `{ok:true,"System reset to factory defaults"}`.
- `RISK` src/api/routes-config.js:36-54 — factory reset has no nuclear-password gate (review 2026-08-03 #6). Left as RISK: memory notes say resets are an intended operator action.

## src/api/routes-contract.js
- `OK`

## src/api/routes-countdown.js
- `QUALITY` src/api/routes-countdown.js:246-271 — the advisory `commandRegistry` is updated (`lastCmd`, `cmdAt`, config) whether or not `emitCgUpdate/emitCgClear` succeeded (`res.ok`). When Caspar rejects the CG UPDATE the response is 502 but GET /api/countdown/list still reports `runtime.lastCmd: 'start'`, so panels tick a timer that never started. Record only when `res.ok`.
- `QUALITY` src/api/routes-countdown.js:83 — `templateHostLayer` is `parseInt` with no NaN check; `{"templateHostLayer":"x"}` reaches `CG ch-layer UPDATE NaN …` and comes back as a 502 from Caspar instead of a 400.
- `RISK` src/api/routes-countdown.js:60,250 — `commandRegistry` is an unbounded Map keyed by caller-supplied `channel:layer`; it only grows (cleared by restart). Tiny per entry, noted for completeness.

## src/api/routes-data-project-handlers.js
- `BUG` src/api/routes-data-project-handlers.js:333-363 — `/api/project/rename` never checks that the target slug is free. Failing case: projects `a` and `b` exist, `POST /api/project/rename {"fromSlug":"a","name":"B"}` → `toSlug = "b"`, `existing = a.json`, `persistProject(ctx, {...a, name:"B"})` → `writeProjectFile("b", …)` replaces b.json with a's content (rev bumped, no `validateIncomingProject`, no backup), then `a` is retired to trash. Project b is lost. The only caller, client/components/load-project-modal.js:396-403, checks only that the name changed. Fix: 409 when `readProjectFile(toSlug)` exists and `toSlug !== fromSlug`.
- `RISK` src/api/routes-data-project-handlers.js:341,361 — renaming a NON-active project (the only kind the load modal allows) goes through `persistProject`, which unconditionally ends with `setActiveSlug(persistence, slug)` and `persistence.set('web_project', stamped)` (src/engine/project-scenes.js:262-265). The server's active-slug pointer therefore flips to the renamed project while the deck / live scenes still run the old one, until the next client autosave flips it back; `GET /api/project` and a slug-less `/api/project/load` in that window serve the wrong project.
- `QUALITY` src/api/routes-data-project-handlers.js:124-130 — `outputId` is an arbitrary client string used as a key into the project's credential store with no length / charset limit.

## src/api/routes-data-project-read.js
- `QUALITY` src/api/routes-data-project-read.js:68,96 — `decodeURIComponent(m[1])` on the raw wildcard path throws `URIError` for a malformed escape; the router's catch (router-dispatch.js:97-100) turns it into 502. Failing case: `GET /api/project/file/%E0%A4%A` and `DELETE /api/project/%E0%A4%A` → 502, should be 400.

## src/api/routes-data-project-slug.js
- `OK`

## src/api/routes-data-project-sync.js
- `OK`

## src/api/routes-data.js
- `DEAD` src/api/routes-data.js:17-29,27-29 `handlePost` / `handleData` — answers 410 "AMCP DATA API removed" to every `POST /api/data/<x>`; registered at router.js:465 and again in the legacy block (router-dispatch.js:119). grep: `grep -rn "api/data/" client godot/client src tools --include=*.js --include=*.gd` → none; only docs/wiki mention it. A tombstone that can be deleted together with its two registrations.
- `DEAD` src/api/routes-data.js:39 re-export `loadProjectMerged` — every consumer requires it from `./routes-data-project-read` directly (routes-project-hardware.js:57,69, routes-project-assets.js:89); grep for `routesData.loadProjectMerged` / `require('./routes-data').loadProjectMerged` → none.

## src/api/routes-device-snapshot.js
- `BUG` src/api/routes-device-snapshot.js:125-128 — the "clone" is `{ ...cfg0 }` (shallow) where `cfg0 = ctx.configManager.get()` is the LIVE config object (config-manager.js:473 returns `this.config`), so `applySnapshotToConfigClone` (src/config/device-snapshot.js:157, `next.casparServer.screen_count = mainCount`) writes into the live `casparServer` object even for `dryRun:true`. Reproduced offline: `cfg0 = {casparServer:{screen_count:1}, …}`, apply a snapshot with empty `screenDestinations` → `cfg0.casparServer.screen_count` becomes 0. A dry-run preview therefore changes live in-memory config, and the next unrelated `configManager.save` persists it. Fix: `structuredClone(cfg0)` before applying.
- `QUALITY` src/api/routes-device-snapshot.js:26-64 — `saveFullConfigLikeSettings` re-lists settings keys by hand (same maintenance trap as the settings POST `newConfig`); a config key added later is silently kept from `cur` rather than from the snapshot.

## src/api/routes-device-view.js
- `BUG` src/api/routes-device-view.js:215,260,287 — `addExtraLiveSource` whose item has none of `value / ndiName / templateOrUrl / (browser_display + url)` falls through with `res === null`, and the handler answers 404 `{"error":"Not found"}`. Failing case: `POST /api/device-view {"addExtraLiveSource":{"label":"x"}}` → 404; should be 400 "source needs a value". Same fall-through for any body with no recognised key.
- `QUALITY` src/api/routes-device-view.js:262 — `removeExtraLiveSource` filters on `x.value !== j.removeExtraLiveSource.value`; a body of `true`/string gives `undefined`, so the call is a silent no-op that still persists and broadcasts. Entries added by `sourceId` only cannot be removed by id.
- `RISK` src/api/routes-device-view.js:272-279 — `mappingTemplates` is persisted to config as any array (no element type / count / size check).

## src/api/routes-dmx-monitor.js
- `OK`

## src/api/routes-exfat-sync.js
- `OK`

## src/api/routes-fixture-dmx.js
- `OK`

## src/api/routes-fixture-types.js
- `QUALITY` src/api/routes-fixture-types.js:58,71 — each `/model` and `/file` request goes through `store.member` which re-opens and re-indexes the whole GDTF zip (gdtf-store.js:131-136); a rig with many wheel images/meshes does that once per member. A small per-id cache of the opened archive would remove it. No bug found: ids are `[0-9a-f]{12}`, member lookup is by zip entry name (no filesystem path), mesh path is pattern-restricted.

## src/api/routes-ftb.js
- `QUALITY` src/api/routes-ftb.js:57-59 — the `!ctx.amcp → 503` branch is unreachable for `POST /api/ftb`: only `/api/ftb/*` is registered (router.js:462), so bare `/api/ftb` is served by the legacy block (router-dispatch.js:104,113), which is skipped when `ctx.amcp` is null. With Caspar down the client gets 404 "Not found" instead of 503. Same for `POST /api/led-test-card` and `POST /api/thumbnails/generate[-all]`.

## src/api/routes-gdtf-share.js
- `DEAD` src/api/routes-gdtf-share.js:31-37 `GET/POST /api/fixtures/share/account` — no UI calls them. grep: `grep -rn "share/account" client godot/client` → none; only tools/smoke/smoke-wo637-gdtf-share.test.js and docs. (The account is set by editing ~/.highascg/gdtf-share.json; `share/resolve` is used by Godot.) Keep only if an account form is planned.

## src/api/routes-host-live.js
- `RISK` src/api/routes-host-live.js:43-88 — one `handlePost` serves both `POST /api/host-live/migration` (requireCaspar false, router.js:281) and `POST /api/host-live/operator-fullscreen` (requireCaspar true, router.js:271) and ignores the path. `POST …/migration {"action":"x"}` runs the operator-fullscreen handler; `POST …/operator-fullscreen {"migrateHostLiveSources":true}` runs the config migration. With a body that matches neither, the handler returns `null` and the client gets 404.
- `QUALITY` src/api/routes-host-live.js:55-56 — `ctx.configManager.save(...)` returns false on write failure (config-manager.js `_saveNow`), but the result is ignored and `Object.assign(ctx.config, patch)` + `{ok:true}` follow. Compare `persistConfigPatch` in routes-device-view.js:23-30 which checks it.
- `DEAD` src/api/routes-host-live.js:17-30,43-72 `/api/host-live/migration` (GET + POST) — no caller. grep: `grep -rn "host-live/migration" client godot/client tools src --include=*.js --include=*.gd` → only router.js and this file (WO-88 doc mentions it). One-shot migration endpoint left over.

## src/api/routes-host-stats.js
- `QUALITY` src/api/routes-host-stats.js:167-185 — the GPU cache has no in-flight guard: when the 5 s TTL lapses every concurrent poller (web + Godot + Companion) spawns its own `nvidia-smi` before the first finishes. Store the pending promise.
- `QUALITY` src/api/routes-host-stats.js:194 — `_glCache.text &&` means an empty/failed GL INFO result is never cached, so with the opt-in flag on every poll re-sends `GL INFO` to Caspar.

## src/api/routes-ingest.js
- `BUG-HIGH` src/api/routes-ingest.js:360-383 — in the HTTP download, `fileStream = fs.createWriteStream(savePath)` gets its `'error'` listener only AFTER the whole read loop (lines 380-383). A write/open error during the loop (volume full, EACCES because the target exists read-only, EISDIR) emits `'error'` with no listener → `uncaughtException` → `process-guards.js:21-26` logs and `process.exit(1)`. Reproduced offline: `createWriteStream('/dev/full')` + `write()` with no listener → "Unhandled 'error' event … ENOSPC" and the process dies. Failing case: `POST /api/ingest/download {"url":"http://host/big.mov"}` while the media volume fills → the HighAsCG node server exits mid-download (Caspar keeps playing; API/UI/OSC bridge down until systemd restarts it). The upload path got this fix (lines 171-183); the download path did not. Fix: attach the error handler at creation and `pipeline()` the body stream.
- `BUG` src/api/routes-ingest.js:363-368 — `fileStream.write(buf)` ignores the return value and never waits for `'drain'`, so a download faster than the disk buffers the file in RAM, contradicting the header comment (line 2, "avoiding RAM buffering", "200GB+ files"). On failure (line 406-417) the stream is not closed and the partial file is left on disk.
- `BUG` src/api/routes-ingest.js:145-147,149-151 — the destination folder is taken from the multipart field `path`, but busboy emits parts in order and `targetSubdir` is read when the `file` event fires, so a `path` field sent AFTER the file is ignored and the file lands in the default ingest subdir. Callers that append the file first: client/components/publish-modal.js:216-217 (`formData.append('file', blob, relPath)` then `append('path', pathDir(relPath))`, so publish to a remote box flattens the folder structure) and client/components/scenes-editor-deck-ingest.js:19-21. client/components/sources-panel-ingest-logic.js:62-63 has the right order and a comment explaining why. Fix the two callers (or document the order contract in this file).
- `RISK` src/api/routes-ingest.js:204-214 — the 200 response is resolved on busboy `'finish'` (all parts parsed), not when the per-file write streams have flushed. A late write error (ENOSPC on the last buffered chunk) lands in `uploadErrors` after the response was already sent; likewise a failed `extractZipSafely` (line 195-197) is only logged. The client toast says "Uploaded N file(s)".
- `RISK` src/api/routes-ingest.js:48-61,336-343 — download progress lives in ONE `ctx._ingestDownloadState`; a second `POST /api/ingest/download` while one runs overwrites the status the first is reporting, and two downloads of the same file name write the same path concurrently. No "already running" 409 (compare routes-media-ingest-local.js:42).
- `RISK` src/api/routes-ingest.js:355 — `fetch(url)` for any `http(s)` URL from the server, including loopback/LAN targets (e.g. Caspar's own :8080-style pages, other tailnet hosts); the response body lands in the media library, which is downloadable. With auth off this is reachable by any LAN client.
- `QUALITY` src/api/routes-ingest.js:138 — `limits.fileSize` is set but no `file.on('limit')` handler, so an over-limit upload is silently truncated and reported as success (review 2026-08-03 #10; limit is 200 GB so academic today).
- `QUALITY` src/api/routes-ingest.js:320 — the saved name is `path.basename(new URL(url).pathname)` without `decodeURIComponent`, so `…/my%20clip.mp4` is stored literally as `my%20clip.mp4`.
- `QUALITY` src/api/routes-ingest.js:445-458 — content-type table maps .mkv/.mxf to `video/quicktime` and .tga to `image/png`, and `Accept-Ranges: bytes` is advertised while Range requests are not implemented (whole file streamed). Only consumer is publish-modal.js:211 (fetch + blob), where this is harmless.

## src/api/routes-led-test-card.js
- `DEAD` src/api/routes-led-test-card.js:41 + src/api/router.js:461 — `routes.post('/api/led-test-card/*', routesLedTestCard.handlePost)` can never run: router.js:167 already registers `POST /api/led-test-card/:op`, which matches every single-segment sub-path first, and this handler only accepts the exact path `/api/led-test-card` (line 41), which a `/*` pattern never matches (needs a trailing segment). The exact path works only through the legacy block (router-dispatch.js:111), so with Caspar down it answers 404, not the 503 coded at lines 42-44.
- `BUG` src/api/routes-led-test-card.js:50-56,195-201 — `channel` is `parseInt(b.channel)` with no check. Failing case: `POST /api/led-test-card {"enabled":true,"channel":"abc"}` → `NaN`; `chLayer` renders it as `CG NaN-999 CLEAR/ADD/PLAY/UPDATE`, Caspar rejects, and the caller gets 502 instead of 400 (also any channel that is not a program channel is accepted).

## src/api/routes-led-test-control.js
- `OK`

## src/api/routes-logs.js
- `QUALITY` src/api/routes-logs.js:88-97 — `POST /api/logs/clear` clears only the HighAsCG buffer; `target:"caspar"` (or any junk value) does nothing but answers `{ok:true, cleared:"caspar"}`.
- `QUALITY` src/api/routes-logs.js:19-45 — `tailFileLines` does `statSync/readSync` of up to 4 MB synchronously on the request path; fine at 600 lines, blocks the loop at the `maxBytes=4 MB` cap.

## src/api/routes-lower-third-roster.js
- `QUALITY` src/api/routes-lower-third-roster.js:24,31,34 — server code `import()`s a client file (`client/lib/lower-third-roster-import.js`) and relies on the global `File`; parse failures come back as HTTP 200 `{ok:false}` (documented client contract, so left as is). Body size is bounded upstream (http-body.js 10 MB default) and checked against `ROSTER_MAX_BYTES` before parsing.

## src/api/routes-lower-thirds.js
- `BUG` src/api/routes-lower-thirds.js:205-227 — the fonts upload can kill the process. (a) `const { filename } = info` is `undefined` for a part with an empty filename and `Content-Type: application/octet-stream` (what a browser sends for an empty file input; verified with busboy 1.6: the `file` event fires with no `filename`), so `path.basename(filename)` at line 214 throws TypeError inside a busboy event → `uncaughtException` → `process.exit(1)`. (b) `file.pipe(fs.createWriteStream(saveTo))` has no `'error'` listener, so ENOSPC, or a name of `..`/`.` (basename keeps it → target is a directory → EISDIR) crashes the same way. (c) no size limit or extension check on what lands in template/fonts. Failing case: a multipart POST to `/api/lower-thirds/fonts` with one part `Content-Disposition: form-data; name="file"; filename=""` + `Content-Type: application/octet-stream` (reproduced with busboy offline: `file` event, no filename). No in-repo caller (see DEAD below), reachable by any HTTP client.
- `BUG` src/api/routes-lower-thirds.js:386,404-405 — `next` clamps with `Math.min(activeStep + 1, st.data.length - 1)`; with an empty `data` list that is `-1`. Verified offline: first `POST /api/lower-thirds/next {}` → `{"ok":true,"activeStep":-1}`. Also `update` (line 306) stores `NaN` for a non-numeric `activeStep` (`{"activeStep":"abc"}` → JSON `null`).
- `BUG` src/api/routes-lower-thirds.js:231-235 — fonts delete takes the percent-encoded raw path (`p`), never decodes it, so a font named `My Font.ttf` (client would send `My%20Font.ttf`) is not found; the route still answers `{ok:true}` and leaves the file.
- `RISK` src/api/routes-lower-thirds.js:98,248 — `templateId` is checked with `fs.existsSync(path.join(STUDIO_LT_DIR, id + '.html'))` without rejecting `..`. Verified: `POST /api/lower-thirds/load {"templateId":"../lower-thirds/lt-classic-box"}` is accepted and stored; `resolveLtCasparPath` then sends `studio/../lower-thirds/lt-classic-box` to Caspar CG ADD. It also lets a caller probe for the existence of any `*.html` under template/.
- `QUALITY` src/api/routes-lower-thirds.js:262-276,309-322,345-352,361-368,378-385,394-403,412-418 — every CG ADD/UPDATE/PLAY/STOP/NEXT/REMOVE failure is caught, logged at warn, and the route still answers 200 `{ok:true}`. Verified: `play` with a throwing `cgPlay` → `200 {"ok":true}`. A Companion button (WO-169 API) shows success when Caspar refused the command. Return `ok:false` / 502 when the AMCP call failed.
- `QUALITY` src/api/routes-lower-thirds.js:133,140 — `logicalLayer` / `templateHostLayer` are `parseInt`ed with no NaN check (`{"logicalLayer":"x"}` makes the host layer `NaN` and every later CG line `ch-NaN`).
- `QUALITY` src/api/routes-lower-thirds.js:375-406 — `next` / `previous` do not broadcast `lower-third.state` while every other mutating route does, so a second client's `activeStep` goes stale.
- `QUALITY` src/api/routes-lower-thirds.js:187-190 — `GET /api/lower-thirds/fonts` creates the directory (a mutating side effect on a GET).
- `DEAD` src/api/routes-lower-thirds.js:187-195,205-239 fonts list / upload / delete — no caller. grep: `grep -rn "thirds/fonts" client godot/client src tools --include=*.js --include=*.gd` → only this file (docs and work/deprecated mention it). `next`/`previous` have no in-repo caller either (grep `thirds/next|thirds/previous` → this file only) but belong to the documented Companion-facing API, so not flagged dead.

## src/api/routes-media-hap.js
- `OK`

## src/api/routes-media-ingest-local.js
- `RISK` src/api/routes-media-ingest-local.js:19-22,41 — the "from this machine" test is only `remoteAddress === 127.0.0.1 / ::1`. src/api/box-local-request.js (same WO-811 family) documents why that is not enough: `ssh -L`, Caddy / Tailscale Serve, and pages rendered by Caspar's CEF all arrive from loopback; it adds proxy-header, Host-port and Origin rules and its header comment even names this file's `isLoopback` as the weak variant. `planLocalIngest` (src/media/local-ingest.js:69-77) accepts ANY absolute readable path, so a relayed caller can copy `/home/casparcg/highascg/.private/api-token` or `config/*.json` into the media library and fetch it back through `GET /api/local-media/…`. Use `checkBoxLocalRequest(req)`.

## src/api/routes-media-library.js
- `RISK` src/api/routes-media-library.js:35 — `renumber.pad` is `Number(rn.pad) || 0` with no upper bound and goes to `String(n).padStart(width,'0')` (media-multi-rename.js:44-45,66). `POST /api/media/rename/plan {"ids":["a/b_01.mp4"],"renumber":{"start":1,"step":1,"pad":900000000}}` allocates a ~900 MB string per id (RangeError "Invalid string length" at ~2^29-2^30) → memory spike / 502. Clamp `pad` to e.g. 0..12.

## src/api/routes-media-preview.js
- `OK`

## src/api/routes-media-versions.js
- `RISK` src/api/routes-media-versions.js:57,73-88 — the busboy `'close'` handler is `async` with no try/catch around `versions.installNewVersion` (its `stash(e, abs, now)` at media-versions.js:97 is outside its own try) and `afterChange`. If either throws (EACCES, EXDEV, disk full) the rejection is only logged by the unhandledRejection guard, `resolve(...)` is never called, and the HTTP request hangs until the client times out, with the staged `.incoming-*` file left behind. `fs.mkdirSync` at line 57 runs directly inside the busboy `'file'` event, so a throw there is an uncaughtException (process exit).
- `QUALITY` src/api/routes-media-versions.js:42 — uses `registry.getEntryByPath` without the `reconcileWithDisk` retry that `routes-media-library.js entryFor` does, so a file ingested seconds ago answers 404 "not in media library" on its first version upload.

## src/api/routes-media.js
- `DEAD` src/api/routes-media.js:64-70,73,81-88 — the plural / query forms of the thumbnail GET are unreachable: the only registration is `routes.get('/api/thumbnail/*')` (router.js:385), which needs `/api/thumbnail/<something>`. Live check on the box: `GET /api/thumbnails` → 404, `GET /api/thumbnail?filename=x` → 404. The `/api/thumbnails` list branch, the `thumbnail(?:s?)` regex alternative and the `query.filename|file` branch are dead. grep: `grep -rn "/api/thumbnails\b\|api/thumbnail?" client godot/client src tools` → only this file; only `/api/thumbnail/live/*` is used by clients.
- `BUG` src/api/routes-media.js:467-469 — `JSON.parse(body || '{}')` runs before the guarded `parseBody`, so a malformed JSON string body throws SyntaxError → 502 (should be 400). `b` is unused and the comment ("wait… let's require parseBody correctly") is leftover scaffolding (review 2026-08-03 #11, still there). Failing case: `POST /api/thumbnails/generate` with body `{` (Caspar connected).
- `BUG` src/api/routes-media.js:402 — `(b.id || b.filename || '').trim()` throws TypeError for a non-string id. Failing case: `POST /api/media/cinf {"id":5}` → 502 instead of 400.
- `QUALITY` src/api/routes-media.js:175-180 — `DELETE /api/local-media/:id` deletes the file but, unlike `handleMediaDelete` (lines 288-295, "WO-592: delete is final"), does not `forgetPaths` in the media-library registry, does not `removeAllVersions`, and does not do the settled rescan. It has no in-repo caller (grep `local-media` + delete in client/godot → none; clients use POST /api/media/delete), so it is a stale second delete path that leaves orphaned registry entries and version files.
- `RISK` src/api/routes-media.js:36,94-96,158,161 — `failedThumbs` is keyed by caller-supplied file names and entries are removed only on a later success; expired entries are never pruned, so probing with many bad names grows the Map for the process lifetime.
- `QUALITY` src/api/routes-media.js:205-212 — `ensureHqThumbs:true` awaits ffmpeg thumbnail generation for the whole library (`maxItems: ids.length`) inside the HTTP request; on a large library the request runs for minutes.

## src/api/routes-misc.js
- `DEAD` src/api/routes-misc.js:4-6 — `handlePost` always returns `null`. It is registered as `POST /api/misc/*` (router.js:480) and in the legacy chain (router-dispatch.js:129). grep: `grep -rn "api/misc" client godot/client src tools` → only router.js; `routes-misc` appears only in router.js / router-dispatch.js. Delete the file and both registrations.

## src/api/routes-mixer-inspector.js
- `RISK` src/api/routes-mixer-inspector.js:108,201-210 — each call re-reads the project from disk (`loadFullProject()`), mutates that copy, and arms a 1 s debounce timer whose closure holds only the LAST call's `project`. Two quick adjustments of different layers within 1 s persist only the second (the first change survives in the live deck but not on disk). The timer also calls `persistProject` (no `validateIncomingProject`, rev bumped) with a project up to 1 s old, so it can overwrite a web/Godot autosave that landed in between.
- `QUALITY` src/api/routes-mixer-inspector.js:72-73 — unknown `effectType` throws a plain Error, which `handleMixerSafe` maps to 502; it is a client error (400).

## src/api/routes-mixer-stretch.js
- `OK`

## src/api/routes-mixer.js
- `BUG` src/api/routes-mixer.js:216-227 — `GET /api/mixer/<cmd>` reuses the POST handler with a surrogate body, and several commands are actions, not queries. Verified offline (fake AMCP client, nothing sent): `GET /api/mixer/clear?channel=1&layer=10` → `MIXER 1-10 CLEAR` (resets the layer's opacity/fill/crop), `GET /api/mixer/commit?channel=1` → `MIXER 1 COMMIT`. A link prefetch, crawler or `<img src>` on a LAN page performs the mixer reset. Allow GET only for the query-capable commands, or drop `handleGet`.
- `BUG` src/api/routes-mixer.js:31-54 — for `opacity` and `fill`, `updateProjectStateFromSelection` runs whenever the UI selection context is `scene_layer`, even when the body names its own `channel`/`layer`. Failing case: operator has look layer A selected in the inspector; an automation posts `POST /api/mixer/opacity {"channel":1,"layer":20,"opacity":0}` for an unrelated layer → the SELECTED layer A's opacity is rewritten to 0 in the stored project, persisted and broadcast (`mixer_update` + `project_sync`), while the AMCP line goes to ch1-20. Only the body-less (Companion "adjust the selected layer") form should touch the project. Only `/api/mixer/effect` is called by the in-repo clients (client/lib/effect-apply-live.js:125).
- `RISK` src/api/routes-mixer.js:59-170 — numeric fields are interpolated raw into AMCP lines (`MIXER ${cl} OPACITY ${val} ${duration}` in amcp-mixer.js `_mixerDeferNumber`), and the route does not coerce them. Verified offline: `opacity:"1\r\nCLEAR 1"` → sent string `"MIXER 1-10 OPACITY 1\r\nCLEAR 1"`; `duration:"25\r\nCLEAR 1"` likewise (the transport does not strip CR/LF). Not an escalation (raw AMCP routes exist) but it breaks the CR/LF-folding invariant, and `opacity:"abc"` becomes a Caspar error → 502 rather than 400. Coerce with `Number()` + `Number.isFinite` in the route.
- `RISK` src/api/routes-mixer.js:56 — `channel == null` silently defaults to 1, so `POST /api/mixer/clear {}` sends `MIXER 1 CLEAR` (the whole channel 1) and `layer == null` makes opacity/fill channel-wide. Require `channel` for destructive commands.

## src/api/routes-modules.js
- `QUALITY` src/api/routes-modules.js:3 — header comment points to `web/lib/optional-modules.js`; the file is `client/lib/optional-modules.js` (no `web/` dir exists).

## src/api/routes-multiview.js
- `DEAD` src/api/routes-multiview.js:202-205,207 `handleGet` — unused: router.js:470 calls `handleMultiviewDebug` directly. grep: `grep -rn "routesMultiview.handleGet\|multiview.*\.handleGet" src tools` → none (smoke tests use only `handlePost` / `buildAudioFocusLines`).
- `QUALITY` src/api/routes-multiview.js:51-53,56 — the 25 s timeout timer is never cleared (a pending timer after every successful apply), and on timeout the 504 is returned while `applyMultiviewLayout` keeps running and may finish later, after which `ctx._multiviewLayouts` / persistence still hold the previous layout.

## src/api/routes-ndi.js
- `QUALITY` src/api/routes-ndi.js:27-63 — the same name-to-`ndi://machine/"source"` mapping is written out twice (array and string branches); the `!amcp → 503` at line 14 is unreachable because the route is `requireCaspar:true` (router.js:429).

## src/api/routes-network-tailscale.js
- `OK`

## src/api/routes-operator-dock.js
- `OK`

## src/api/routes-operator-gui.js
- `OK`

## src/api/routes-operator-screen.js
- `QUALITY` src/api/routes-operator-screen.js:125 — `cm.save(next)` returns false on a failed write but the result is ignored; `ctx.config` is updated and `{ok:true,name,port}` returned, so the pick is lost on the next restart with no error shown.

## src/api/routes-osc.js
- `QUALITY` src/api/routes-osc.js:47-60 — when `ctx.oscState` is missing, any unknown sub-path (`/api/osc/xyz`) answers 200 `{enabled:false,"OSC listener disabled"}`; with the listener on, the same path is 404. The "disabled" answer should be limited to the known OSC paths.

## src/api/routes-pgm-capture.js
- `OK`

## src/api/routes-pgm-layer.js
- `OK`

## src/api/routes-pip-overlay.js
- `RISK` src/api/routes-pip-overlay.js:48,76,110 — `channel` (default 1) and `layer` are taken raw from the body and never coerced; `buildPipOverlayAmcpLines/UpdateLines` build `cl = ${channel}-${oLayer}` from the raw value (engine/pip-overlay.js:85,189). Verified offline: `channel:"1\r\nKILL"` → first line `"CG 1\r\nKILL-260 ADD 0 \"pip_border\" …"`. Raw AMCP is exposed anyway, so this is hygiene; `buildPipOverlayRemoveLines` already does `parseInt(channel)` — do the same in the three handlers and 400 on NaN. Separately, `data.replace(/"/g,'\\"')` there escapes quotes but not backslashes, unlike `param()`.
- `QUALITY` src/api/routes-pip-overlay.js:83-97 — `handleUpdate` accepts any `overlay.type`: `buildPipOverlayUpdateLines` does not consult `TEMPLATE_MAP`, so `type:"nope"` still produces a CG UPDATE plus 5 MIXER lines for the overlay layer (verified offline) and answers `{ok:true}`, whereas `handleApply` returns 400 "Unknown overlay type" (line 58-60).
