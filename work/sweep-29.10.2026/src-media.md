# src/media — sweep 29.10.2026 (batch 083)

Files: 32 · lines: 6117 · findings: 2 BUG-HIGH, 16 BUG, 11 DEAD, 16 RISK, 26 QUALITY

Method notes: every file read in full. Two bugs below were reproduced offline against the real modules in a scratch dir
(media tree under the scratchpad; the live `media/` was never touched). Spawns in this area all use argv arrays
(`spawn`/`execFile`), no shell strings, so no shell-injection through quotes or spaces was found. Dead-export proof:
`grep -rlw` of each export name over `src tools client godot scripts index.js package.json` (excluding
`client/assets/map-data.json` and `tools/ci/unwired-exports-baseline.json`, which only list names).

## src/media/caspar-cls-id.js
- `BUG` src/media/caspar-cls-id.js:231 (`resolveClipForAmcpLoad` -> `resolveClipFromMediaDisk`, :172 -> `resolveMediaFileOnDisk`) — an upper-case Caspar CLS id resolves to the wrong file when another folder holds a file with the same stem. Failing case (reproduced): media has `a/intro.mp4` and `b/intro.mp4`; `resolveClipForAmcpLoad('B/INTRO', { config:{ local_media_path, projectScopedMedia:{enabled:false} } })` returns `A/INTRO`, so LOADBG/PLAY puts the other folder's clip on air. Root cause is the case-sensitive candidate probe plus the stem walk in local-media-paths.js (see that file). Fix: try a case-insensitive per-segment match inside the requested folder before any global stem fallback, and never fall back to a different directory.
- `QUALITY` src/media/caspar-cls-id.js:38 — `const path = normalizeCasparMediaPath(id)` shadows the `path` module inside `stripMediaFileExtension`. Harmless today, but the next edit that needs `path.*` there breaks. Rename the local.
- `DEAD` src/media/caspar-cls-id.js:239 `normalizeCasparMediaPath` export — used only inside this file. grep `-rlw normalizeCasparMediaPath` over src tools client godot scripts index.js -> nothing else. `stripMediaFileExtension` (line 33) is exported and used only by `tools/smoke/smoke-caspar-cls-id.test.js` (test-only, counts as live). Low value; drop the export of the first.

## src/media/cg-look-thumb-cache.js
- `QUALITY` src/media/cg-look-thumb-cache.js:13-16 — cache dir is `path.join(process.cwd(), 'data', 'cg-look-thumbs')`. If node is ever started from another cwd the cache silently splits (same pattern in live-thumbnail-cache-store.js:38, local-media-ffmpeg.js:138 and :193). Use `REPO_ROOT`.
- `QUALITY` src/media/cg-look-thumb-cache.js:47-60 (`hashCgThumbRequest`) — nothing ever evicts. The hash covers `cgData`, so every text edit of a lower-third makes a new PNG that is never deleted (api/routes-cg-thumb.js only reads/writes). Slow unbounded disk growth in `data/cg-look-thumbs`.
- `QUALITY` src/media/cg-look-thumb-cache.js:84-88 — `existsSync` then `statSync` is a TOCTOU; a concurrent delete turns it into a throw instead of `exists:false`.
- `DEAD` src/media/cg-look-thumb-cache.js `RENDER_PROFILE_VERSION`, `getCgThumbCacheDir` exports — only used inside this file. grep -rlw over src tools client godot scripts index.js -> no other file.

## src/media/cg-look-thumb-render.js
- `BUG` src/media/cg-look-thumb-render.js:112-121 — `chromePromise` is cached forever, including a REJECTED promise and a Chrome that later died. Failing case: first CG thumb request while Chrome cannot start (binary missing, 15 s launch timeout) caches the rejection; installing Chrome afterwards never helps, every `/api/cg-thumb/render` fails until node restarts. Same if Chrome is OOM-killed later: the cached `httpPort` is dead and every `openPage` fetch gets ECONNREFUSED forever (the process `exit` handler in headless-chrome-cdp.js ignores exits after the DevTools line). Fix: clear `chromePromise` on rejection and on child exit; check liveness before reuse.
- `RISK` src/media/cg-look-thumb-render.js:372 — shader thumbs navigate to a hard-coded `http://127.0.0.1:4200/...`, ignoring the configured HTTP port (`HTTP_PORT` / `server.httpPort`). On a box with another port every shader thumb fails. The slug (line 366-369) is derived from the raw request string, not from the resolved `htmlPath`, so it is not constrained to the file that was actually validated; it only reaches the box's own server, so impact is low.
- `QUALITY` src/media/cg-look-thumb-render.js:373 — `file://${htmlPath}` is not percent-encoded (`#`, `?`, `%` in a template name break the URL). Use `pathToFileURL`.
- `RISK` src/media/cg-look-thumb-render.js:341-398 — no concurrency limit. Each distinct hash opens its own page in the single Chrome; a CG-only look with many layers fires N parallel SwiftShader/1080p renders on a box that is on air (shaders use CPU raster, see WO-344 comment). A small semaphore (1-2) is cheap.
- `QUALITY` src/media/cg-look-thumb-render.js:111-122 — the singleton Chrome is never closed (no shutdown hook, no idle timeout); it stays resident after the first thumb for the life of the node process.
- `DEAD` src/media/cg-look-thumb-render.js `deriveLtTemplateId`, `waitForCgThumbSettle`, `captureCgThumbPng` exports — used only inside this file. grep -rlw over src tools client godot scripts index.js -> none.

## src/media/cinf-parse.js
- `OK` (used by src/engine/scene-native-fill.js; fps/time-base handling is consistent with the CLS parser).

## src/media/hap-encode-args.js
- `OK` (pure helpers; argv array, no shell. `HAP_SUFFIX` export is used only by hap-encode-queue.js through `A.HAP_SUFFIX`, fine.)

## src/media/hap-encode-probe.js
- `OK` (30 s kill timer, spawn error handled, argv array. `parseProbeJson` export is used only by a smoke test.)

## src/media/hap-encode-queue.js
- `RISK` src/media/hap-encode-queue.js:340-349 — a cancel that lands between the post-probe `cancelRequested` check and the spawn (the `await statfs` window) is not honoured: `this.running` is still null, so nothing is killed and the whole encode runs, then the result is discarded at line 369. Tiny window, but an encode is minutes of CPU on an on-air box. Re-check `item.cancelRequested` right before `_encode`.
- `QUALITY` src/media/hap-encode-queue.js:97-100 — `sweepStaleParts` is a synchronous walk of up to 20000 entries on first use (inside the first request's `_pump`). Bounded, fine, but it runs on the event loop.
- `OK` otherwise: part file + rename only after read-back verification, `nice -n 10`, ffmpeg path from config, progress throttled, finished jobs trimmed.

## src/media/headless-chrome-cdp.js
- `BUG` src/media/headless-chrome-cdp.js:188-200 — `stderrBuf += String(chunk)` keeps running for the whole life of Chrome after the DevTools line was found, and `stderrBuf.match(/DevTools listening.../)` re-scans the entire (ever growing) buffer on every chunk. Chrome logs GPU/GL warnings continually (SwiftShader shaders especially). Failing case: a node process that renders shader thumbs for days accumulates all of Chrome's stderr in memory and pays O(n) per chunk. Fix: stop appending (or cap to the last 2 KB) once `settled`.
- `BUG` src/media/headless-chrome-cdp.js:181-187 — once the launch promise has settled, the `exit` handler returns immediately (`if (settled) return`): no cleanup of `userDataDir`, no notification. Chrome crash/kill leaves `/tmp/highascg-headless-chrome-*` behind and the caller keeps a dead handle (see cg-look-thumb-render.js:112). `kill()` is also never called by the only server-side consumer.
- `QUALITY` src/media/headless-chrome-cdp.js:241-245 — `waitForLoad` returns silently at the deadline; `navigate` then proceeds on a half-loaded page instead of failing.
- `QUALITY` src/media/headless-chrome-cdp.js:236-246 — if `connectCdp` throws after `/json/new` succeeded, the target tab is leaked (never closed).

## src/media/live-thumbnail-cache-capture.js
- `BUG` src/media/live-thumbnail-cache-capture.js:200-206 — the PRINT result is matched by "newest PNG in the media root since t0-500ms", with no tie to the channel. `ctx.amcp.basic.print` does not return the file name, so this guess is the normal path. The lock (`_captureLocks`) is per channel, so two channels capturing at once (e.g. two DeckLink input look cards rendering together, via live-thumbnail-input-capture.js) race: both can pick the same newest PNG, so ch A's thumb shows ch B's picture, and the first job to finish deletes it (lines 233-243) so the other reports "PRINT produced no PNG". Fix: serialize captures globally (one PRINT in flight) or parse the real file name from the PRINT reply.
- `BUG` src/media/live-thumbnail-cache-capture.js:212 — `copyFile(srcAbs, dest)` writes straight over the live cache PNG. A concurrent `GET /api/thumbnail/live/:ch` (stat.size > 32) can read and serve a truncated PNG during the copy. Write to `dest + '.tmp'` and `rename`.
- `QUALITY` src/media/live-thumbnail-cache-capture.js:228 — meta JSON also written non-atomically.

## src/media/live-thumbnail-cache-handlers.js
- `BUG` src/media/live-thumbnail-cache-handlers.js:168-185 — custom thumbnail upload always stores an EMPTY file. src/server/http-server.js:310-312 reads the whole body (`readRequestBody`) for every non-multipart request before routing; the client posts `Content-Type: image/png` (client/components/sources-panel-live-render.js:226). By the time the handler runs `req` is already consumed, so `req.pipe(writeStream)` ends the stream at once with 0 bytes, `ch-N.png` is truncated to 0 bytes, a sha of the empty buffer is written to the meta and `{ ok:true }` is returned. Reproduced offline with the real `readRequestBody` + the same pipe code: output size 0, body length 5000 already read. Result: "Upload custom thumbnail" destroys the cached thumbnail instead of replacing it. Fix: have the route pass the already-read body (it is a utf8 string today, so the router needs a binary path) or exempt this path from body reading like `/api/ingest/upload`.
- `BUG` src/media/live-thumbnail-cache-handlers.js:85 — `GET ?refresh=1` / `?force=1` returns 404 when no PNG is cached. `lazy` is the constant `false` (line 30), so the `if (!lazy && (!stat || stat.size <= 32))` branch fires before the `if (force)` capture branch (line 96) is reachable. Forced refresh only works when a cache already exists. (No shipped client uses the GET force path - they POST `/capture` - so impact is low.)
- `RISK` src/media/live-thumbnail-cache-handlers.js:168-185 — upload has no size cap, no PNG magic check, and no `req` `error`/`aborted` handling: a client that aborts mid-upload never fires `finish`, so the promise hangs and the half-written file stays.
- `DEAD` src/media/live-thumbnail-cache-handlers.js:30 `lazy` — constant `false`; the `lazy` conditions (lines 85, 125) are dead branches. grep: only these uses.

## src/media/live-thumbnail-cache-store.js
- `OK` (`invalidateLiveThumbnailCache` used by capture module and routes; paths built from integer channel only.)

## src/media/live-thumbnail-cache.js
- `OK` (barrel; spread of three modules, no name clashes.)

## src/media/live-thumbnail-input-capture.js
- `DEAD` src/media/live-thumbnail-input-capture.js:157-159 `INPUT_CAPTURE_BACKOFF_BASE_MS`, `INPUT_CAPTURE_BACKOFF_MAX_MS`, `INPUT_CAPTURE_TIMEOUT_MS` exports — used only inside this file. grep -rlw over src tools client godot scripts index.js -> none. (`listInputCaptureChannels`, `isInputCaptureChannel`, `decideInputThumbnailCapture` are test-only via tools/smoke/smoke-decklink-input-look-thumb.test.js.)
- `OK` otherwise; failure path is backoff-gated and bounded by a 5 s race.

## src/media/local-ingest.js
- `RISK` src/media/local-ingest.js:130-134 — `ws.on('error', reject)` does not destroy `rs`, so a destination write error (disk full) leaves the source read stream and fd open until GC. `rs.on('error')` already destroys `ws`; mirror it.
- `QUALITY` src/media/local-ingest.js:122-141 — a crash mid-copy leaves `<name>.partial` in the media folder and nothing sweeps them (the HAP queue sweeps its own `.part`). They are invisible to the scanner but hold disk.
- `DEAD` src/media/local-ingest.js:172 `isInside`, `MAX_FILES` exports — used only inside this file. grep -rlw `isInside` / `MAX_FILES` over src tools client godot scripts index.js -> nothing else.

## src/media/local-media-api.js
- `BUG` src/media/local-media-api.js:92 and :134 — a literal `..` anywhere in the name is rejected, so a legit file such as `my..clip.mp4` can never be downloaded, probed or deleted via `/api/local-media/...` (400 "Invalid filename"/"Invalid id"). Traversal is already blocked by `resolveSafe`; reject path segments equal to `..` instead.
- `BUG-HIGH` src/media/local-media-api.js:133-155 (`unlinkMediaById`, same lookup also used by `moveMediaFile`/`copyMediaFile`) — operates on whatever `resolveMediaFileOnDisk` returns, which prefers the ACTIVE PROJECT's copy over the root-relative path asked for (see local-media-paths.js:149). Reproduced: media has `clip.mp4` and `projects/<active>/clip.mp4`; `unlinkMediaById(cfg, 'clip.mp4')` resolves to `projects/<active>/clip.mp4` and deletes the project's file, leaving the root one. The browser's ids are root-relative, so deleting/moving the root `clip.mp4` hits the project copy. Also, an id that does not exist exactly falls through to the global stem search and can delete a different file with the same stem. Fix: delete/move/copy must use an exact `resolveSafe(base, id)` lookup, never the playout-oriented fuzzy resolver.
- `QUALITY` src/media/local-media-api.js:72-76 — `writeWaveformCacheFile` is not wrapped: a full disk/readonly cache dir turns an otherwise successful waveform into a 502.
- `QUALITY` src/media/local-media-api.js:98-114 — the `file` download returns a stream for any existing file under the media tree including dotfiles; no Range support (large clips cannot seek).
- `DEAD` src/media/local-media-api.js:364 `normalizeTargetFolderId` export — used only inside this file. grep -rlw -> none. (`mediaParentId`, `isDescendantFolderPath` are test-only.)

## src/media/local-media-ffmpeg.js
- `RISK` src/media/local-media-ffmpeg.js:60-99 (`extractWaveform`) — decodes the whole audio track to memory and then pushes every sample into a JS array (`samples.push`, line 74). 8 kHz mono s16 is 16 KB/s, so a 3 h recording is ~170 MB of buffer plus ~86 M array elements (~700 MB). `GET /api/local-media/<long file>/waveform` can exhaust the node heap and take down the playout controller. Also there is no timeout (a hung network/USB read blocks the request forever) and no concurrency limit, so scrolling a big media list spawns many full-file decodes. Fix: compute RMS per bar while streaming stdout, add a kill timer, and limit parallel runs.
- `RISK` src/media/local-media-ffmpeg.js:14-55 (`probeMedia`) — no timeout either; an unreadable file on a stalled mount leaves the promise (and the request) pending forever. Also hard-codes `ffprobe` while the HAP path honours `streaming.ffmpeg_path`.
- `QUALITY` src/media/local-media-ffmpeg.js:201-345 — waveform and thumbnail caches are keyed on path+mtime+size and never pruned: every re-render/replace of a clip leaves its old waveform JSON and 960 px PNG behind forever. Only zero-byte thumbnails have a cleaner (below), and a crash during `writeThumbnailCacheFile` leaves `<key>.png.tmp` which that cleaner ignores (`.png` only).
- `DEAD` src/media/local-media-ffmpeg.js:347 `cleanupZeroByteThumbnails` — never called in production; the JSDoc says "Called on startup" but no caller exists. grep -rn over src tools index.js scripts -> only `test/api/routes-media-thumb.test.js` and `test/wo-184-smoke-tests.js` (not in the curated CI list). Wire it at boot or delete it. `THUMBNAIL_VERSION`, `readThumbnailCacheFile`, `writeThumbnailCacheFile` exports are used only inside this file (and `readThumbnailCacheFile` by the same two test files).
- `QUALITY` src/media/local-media-ffmpeg.js:309-318 — duplicated JSDoc paragraph (same text twice, straight vs curly quotes).

## src/media/local-media-paths.js
- `BUG-HIGH` src/media/local-media-paths.js:149 — `for (const cand of [...projectCandidates, ...candidates])`: the active project's folder is probed BEFORE the id as given. Reproduced with the box's real active slug (`mhp_harder`) against a scratch tree: `resolveMediaFileOnDisk({local_media_path}, 'clip.mp4')` returns `<root>/projects/mhp_harder/clip.mp4` although `<root>/clip.mp4` exists. Playout wants that preference; delete/move/copy/waveform/thumbnail callers of this resolver (local-media-api.js) do not, and delete acts on the wrong file (data loss). See local-media-api.js:133.
- `BUG` src/media/local-media-paths.js:176-183 — the last-resort `findFileByStemUnderDir` walk returns the first file anywhere under the media root whose stem equals the id's last segment, in readdir order, ignoring the folder part of the id. Reproduced: tree `a/intro.mp4`, `b/intro.mp4`; `resolveMediaFileOnDisk(cfg, 'B/INTRO')` returns `a/intro.mp4` (on Linux `B/INTRO.mp4` does not exist, case-sensitive). Because Caspar CLS ids are upper-case, `resolveClipForAmcpLoad` (caspar-cls-id.js) then emits `A/INTRO` for LOADBG. Fix: restrict the stem fallback to the requested directory (case-insensitive segment match), return null otherwise.
- `RISK` src/media/local-media-paths.js:141-144 — `bases` always adds `getMediaIngestBasePath({ local_media_path: '' })` (hard-coded `/home/casparcg/highascg/media`) in addition to the configured path. With `local_media_path` pointing at a stick/other volume, an id that is missing there still resolves, and can be deleted/moved, in the internal default tree.
- `RISK` src/media/local-media-paths.js:107-181 — per call this does up to ~3 bases x ~6 variants x 25 extensions of `existsSync`/`statSync` and, on a miss, a synchronous walk of up to 8000 directory entries. It runs on the event loop and sits on the LOADBG path (`resolveClipForAmcpLoad`) and in `routes-media`, so a clip that does not exist locally (route/live ids are filtered, but typos/remote files are not) costs tens of ms per call.
- `QUALITY` src/media/local-media-paths.js:44 — `resolveSafe` strips every `..` substring (`a..b` becomes `ab`), silently resolving a different name instead of failing.
- `QUALITY` src/media/local-media-paths.js:186 — `scanMediaRecursiveForBrowser` caps at 2500 entries with no truncation flag. api/media-catalog.js:39 merges it with the CLS list, so only disk-only files beyond 2500 vanish silently from the browser; `project-media-root.js:345` passes 20000.

## src/media/local-media.js
- `OK` (re-export barrel; every re-export has a consumer.)

## src/media/media-duration.js
- `OK`

## src/media/media-exists.js
- `BUG` src/media/media-exists.js:14 — `NON_MEDIA_RE` matches `decklink|live|color` as bare PREFIXES (no delimiter). A plain clip whose name starts with those words (`colorbars.mp4`, `live_event.mov`, `livestream_intro.mp4`) is judged "not a media value", so `clipMissing` returns `null` and the missing-media warning never shows even when the file is absent. Anchor on `live:`/`color:`/`decklink` plus a delimiter or on the exact source types. (Comment says this is a server copy of client/lib/media-exists.js, so the client copy has the same prefix defect, client/lib/media-exists.js:19.)

## src/media/media-library-registry.js
- `BUG` src/media/media-library-registry.js:121 — a vanished entry is re-linked to ANY new file with the same (dev, ino), with no size/mtime sanity check. ext4 reuses inode numbers right after a delete, so: delete clip A outside the UI (or via a path that does not call `forgetPaths`), upload clip B which receives A's inode, wait for the next rescan -> `reconcileRegistry` reports `relinked A -> B`, and media-links.js:`scheduleMediaReconcile` then rewrites every look/timeline reference from A to B across all projects. Require a size or mtime agreement (or a stronger fingerprint) before trusting a bare inode match.
- `QUALITY` src/media/media-library-registry.js:59-62, :150-170 — `getEntryByPath` is a linear scan that re-normalizes every entry's path on every call; `recordRenames`/`forgetPaths` call it per file, so deleting a 1000-file folder in a 20000-entry registry is ~20 M string normalizations, synchronously.
- `QUALITY` src/media/media-library-registry.js:137 — entries that went `missingSince` are never purged unless `forgetPaths` is called, so files deleted outside the UI stay in `registry.json` forever.
- `QUALITY` src/media/media-library-registry.js:20 — requires `../bootstrap/sandbox` from the media layer (layering).

## src/media/media-links.js
- `BUG` src/media/media-links.js:124 — `renameMediaFiles` rejects a batch when a destination already exists on disk even if that destination is itself a source in the same batch. The planner (media-multi-rename.js:76) deliberately excludes selected files from conflicts, so a renumber that shifts names (`03_x`->`04_x`, `04_x`->`05_x`) passes the planner and then fails the whole batch with 409 "already exists". Fix: order the renames (or use temp names) when the destination is a source in the batch.
- `RISK` src/media/media-links.js:148-150 — after the files are renamed on disk and `registry.recordRenames` has saved, `applyRenamesToProjects` is not guarded. If it throws (project write, `persistProject`), the response is a 500 although the files are already renamed and the registry updated: references are left pointing at the old names with no retry. The next `scheduleMediaReconcile` will not repair it (registry already has the new path).
- `QUALITY` src/media/media-links.js:119 — `from.includes('..')` rejects names containing `..` (same pattern as local-media-api.js).
- `QUALITY` src/media/media-links.js:62-63, :90-100 — non-active projects are rewritten on disk with a read-modify-write and no lock; a concurrent save of that project from another path would be overwritten.

## src/media/media-multi-rename.js
- `OK`

## src/media/media-reference-rewrite.js
- `QUALITY` src/media/media-reference-rewrite.js:79-82 — an extension-less (CLS) ref matches by `toCasparClsMediaId`, which strips the extension from BOTH sides, so renaming `clip.mov` also rewrites a ref meant for `clip.mp4` when both exist (the header comment promises otherwise). Edge case; Caspar would pick one of them anyway.
- `OK` otherwise (pure, deep-copies the project).

## src/media/media-versions.js
- `RISK` src/media/media-versions.js:114-137 (`restoreVersion`) — no rollback on failure, unlike `installNewVersion`. If the last `moveFile(tmp, t.abs)` throws after `stash(e, abs)` has already moved the current file into the versions dir, the media path is left empty, the chosen version sits in `.restoring-<file>` and the registry in memory already lists the new stash while disk and registry on file disagree.
- `QUALITY` src/media/media-versions.js:22 — `DEFAULT_ROOT` is under the repo `data/`, while the registry (media-library-registry.js:20) moves under `process.cwd()` for a sandbox instance (WO-719). A sandbox instance would write version files into the live repo's `data/media-versions`.

## src/media/project-media-gather.js
- `RISK` src/media/project-media-gather.js:75-90 — files are moved one by one with `moveMediaFile`, and `followMediaMoves` (project reference rewrite) runs only after the loop. A node crash/restart in between leaves moved files with every look/timeline still pointing at the old paths. The registry reconcile (inode match) would repair this on the next scan, but only if it runs.
- `OK` otherwise.

## src/media/project-media-location.js
- `OK`

## src/media/project-media-root.js
- `DEAD` src/media/project-media-root.js `PROJECTS_NAMESPACE` export — used only inside this file. grep -rlw over src tools client godot scripts index.js -> none.
- `QUALITY` src/media/project-media-root.js:233-236 — `getProjectMediaResolveCandidates` uses a case-sensitive `startsWith(prefix)` while `normalizeMediaIdForProject` is case-insensitive; an upper-case CLS id `PROJECTS/<SLUG>/x` is therefore prefixed again (`projects/<slug>/PROJECTS/<SLUG>/x`) in the candidate list. Harmless (the id is then found by the plain candidate) but wasted probes.
- `OK` otherwise.

## src/media/usb-automount.js
- `RISK` src/media/usb-automount.js:132 — the device is "claimed" with `nextRetryAt: Infinity` before `await mount(...)`. If `mount` ever rejects (the shipped `mountUsbBlockDevice` catches, but the injectable one and `listRemovableBlockDevices` inside it can throw), the outer `catch {}` swallows it and the claim is never released: the device is skipped until it is unplugged. Wrap the mount in try/finally.
- `RISK` src/media/usb-automount.js:110-111 — every 3 s it spawns `lsblk` twice (candidates + mounted) and the hotplug watcher in usb-drives.js spawns another every 2 s: about 1.5 `lsblk` processes per second for the life of the server. Share one lsblk result per tick.

## src/media/usb-drives-copy.js
- `BUG` src/media/usb-drives-copy.js:57-66 — `renameSync(tmp, dest)` publishes the file BEFORE the optional hash verification. On "Verify failed" the corrupt file stays at `dest` (and, with the default overwrite policy, has already replaced a good file of the same name). Verify the `.partial`, then rename.
- `BUG` src/media/usb-drives-copy.js:69 — `drive.readOnly` makes import refuse the source drive (`'Invalid drive'`). Reading from a write-protected stick/SD or an exFAT mounted `ro` is exactly the normal import case; the flag only matters for writing to a drive.
- `BUG` src/media/usb-drives-copy.js:56 — `isCancelled()` is checked only after a whole file has been copied; cancelling during a multi-GB file does nothing until it finishes (local-ingest.js checks per chunk). The `.partial` is also left behind on any read/write error (`rs.on('error', reject)` does not destroy `ws`).
- `RISK` src/media/usb-drives-copy.js:8-13 — `resolveUnderMount` is lexical; a symlinked directory on an ext4/btrfs stick is followed by `lstatSync(full)` for intermediate components, so `items` naming `link/secret` read outside the mount. `listDirectory` hides symlinks from the UI, but the API takes raw `items`. Requires a hostile stick plus API access.

## src/media/usb-drives-discovery.js
- `RISK` src/media/usb-drives-discovery.js:34-35, :61-70 — a partition qualifies as a mount candidate if it is unmounted, has no children and any non-empty `fstype`. `hotplug=1` is also reported for internal hot-swap SATA ports, and `swap`, `LVM2_member`, `crypto_LUKS` etc. carry an `fstype`, so such partitions are retried every 30 s up to 5 min forever (log noise) and an unmounted internal data partition on a hot-plug port would be auto-mounted. Filter to mountable filesystem types.
- `DEAD` src/media/usb-drives-discovery.js `isRemovableBlockNode` export — used only inside this file. grep -rlw -> none.

## src/media/usb-drives.js
- `DEAD` src/media/usb-drives.js:19 `decodeDriveId` export — used only inside this file. grep -rlw over src tools client godot scripts index.js -> none.
- `QUALITY` src/media/usb-drives.js:98-99 — the hotplug watcher's first tick fires `usb:attached` for every already-mounted drive at startup (`lastSig` starts empty).
- `OK` otherwise (device path validated against `^/dev/[a-z0-9]+$` and the lsblk candidate list; argv arrays throughout).
