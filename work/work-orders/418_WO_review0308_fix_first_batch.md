# WO-418 — Review 2026-08-03 "fix first" rows 1–5: traversal, AMCP injection, crash-on-error, silent take failure, inverted health flag

**Status: DONE (2026-08-04 — all five implemented; smoke 3/3 + repointed WO-401 smoke; suite 1806/2, the 2 reds are the WO-415 config drift. Server restart required to take effect — pending owner (or next Apply/deploy restart))**

Owner: "anything still open? if yes do those" → the review wave's own recommendation
(`work/reviews/2026-08-03-SUMMARY.md`): "one WO per numbered row, fixing 1–5 before the next
show". Batched here (WO-408 precedent). All findings were verified by the review; row 1 was
proven LIVE (unauthenticated GET returned `config/general.json` through the project route).

## Investigation

All five re-verified in source before fixing; nothing had drifted since the review:

1. **Traversal** — `projectFilePath()` did a bare `path.join(PROJECTS_DIR, slug + '.json')`;
   the HTTP layer never URL-decodes before routing, so `..%2f` survived `[^/]+` route regexes
   and `decodeURIComponent` re-created the separator. Same bare join in `autosaveFilePath`,
   `retireProjectSlug` (trash move = rename primitive), `wasProjectSlugRetired`. The write
   primitive: `POST /api/project/load {"slug":"../config/general"}` would persist the slug and
   every autosave then rewrites `config/general.json`.
2. **AMCP CR/LF** — `param()` escaped `\` and `"` only; AMCP is line-delimited so quoting can
   never contain a CR/LF (`veryfast\r\nKILL` = two commands). `encoderPreset` reached the ADD
   line raw through BOTH args builders (`recordFfmpegArgs`, `buildStreamingRtmpFfmpegArgs`) —
   fixing `param()` alone would NOT have covered it. The RTMP URL goes through `param()`.
3. **Crash-on-error** — 5 sites (ingest upload write stream + busboy file stream;
   ffmpeg spawns in live-audio-bridge, v4l2-input-bridge, gui-stream-ingest remux; `lsblk` in
   usb-drives-discovery, spawned every 3 s by the WO-413 poller) had no `'error'` handler;
   `process-guards.js` turns any of them into `process.exit(1)` mid-show.
4. **Take Phase B** — the entire PLAY/crossfade/COMMIT block ended in `catch (_) {}`; on
   failure `fadeClockRef.start` stays null → teardown waits 0 → instant STOP of the outgoing
   look → black, with zero diagnostics.
5. **Inverted healthy** — `osc-state.js` wrapped the negation around the GOOD condition, so
   `profiler_ch{N}_healthy` read `false` while meeting frame budget and `true` while dropping
   frames; `smoke-wo401-perf-first-wave.test.js` pinned the inversion.

## What was done

1. `src/engine/project-store.js` — new exported `isSafeProjectSlug()` (no separators/NUL, no
   leading dot, no `..`, ≤160 chars, plus resolve-containment); `projectFilePath`/`autosaveFilePath`
   throw on unsafe slugs, `readProjectFile`/`readAutosaveFile`/`writeAutosaveFile` return
   null/no-op, `retireProjectSlug`/`wasProjectSlugRetired` return false, and `setActiveSlug`
   REFUSES to persist an unsafe slug (kills the autosave write primitive). Syncthing
   `.sync-conflict-…` names (dots/uppercase) remain legal — tested.
2. `src/caspar/amcp-utils.js` — `stripAmcpLineBreaks()` folds CR/LF to a space inside
   `param()`, `audioFilterParam()`, `clipParamForPlay()`. Preset whitelist
   (`/^[a-z0-9_-]{1,32}$/`, fallback to default) in `routes-streaming-channel-shared.js`
   `recordFfmpegArgs` and `streaming-channel-ffmpeg.js` `buildStreamingRtmpFfmpegArgs`.
   NO adapter-level backstop: `amcp-connection-adapter.send()` legitimately carries multi-line
   BEGIN…COMMIT batch payloads — a blanket strip there would break batches.
3. `'error'` handlers at all 5 sites, house pattern (browser-capture-bridge): record
   `lastError` + warn. Ingest additionally unpipes, destroys the stream, unlinks the partial
   file, keeps draining busboy (no hung request), and the response reports per-file failures
   (500 with `count` of survivors).
4. `scene-take-lbg-amcp-pipeline.js` — Phase-B catch now logs at error level with channel,
   job/crossfade counts and whether the fade clock started. Deliberately log-only: changing
   teardown timing on the take path is a live-behavior change that needs its own rehearsed WO
   (the review's deeper items — batch double-execution engine §3 — stay open).
5. `osc/osc-state.js` — `healthy = !measurable || actual <= expected * 1.05`; unmeasurable
   still defaults healthy (matches `_emptyChannel`'s `healthy: true`). WO-401 smoke repointed:
   in-budget first message = no flip (was asserting the inversion's spurious flip), overrun
   flips false + dirties, recovery flips back.

New `tools/smoke/smoke-wo418-review-fixes.test.js` (curated list): functional traversal matrix
(bad slugs refused across every entry point, legit + sync-conflict slugs pass, setActiveSlug
refusal), CR/LF folding through all three escapers and both args builders (bad preset falls
back, `slow` passes), plus source pins for the 5 error handlers, the Phase-B log, and the
corrected healthy expression.

## What was VERIFIED

- Suite 1806 pass / 2 fail — the 2 are `smoke-wo237-monitor-channel-cheapest-mode` reading the
  box's still-clobbered `config/` (WO-415, recovery pending owner); they were red before this WO.
- New smoke 3/3; repointed WO-401 smoke green; 500-line check clean.
- **NOT verified live** (needs server restart to load the new code): the traversal 404 probe
  (`GET /api/project/file/..%2fconfig%2fgeneral` should now return not-found) and a
  record-start with a hostile preset. Both are safe read-only/no-op probes to run post-restart.
- Rows 6–10 of the review summary remain OPEN (autosave latches, dead USB import API,
  exFAT staleness/atomicity — the latter tied to WO-415 hardening options, logs-modal leak),
  as do the auth-off exposure note and engine §3 (batch double-execution).

## Incidental (recorded for WO-415)

While running the suite: `node_modules` was pruned to prod-only AGAIN overnight (suite died on
missing `acorn`; `npm install` restored it, 2026-08-04 ~09:50). Mechanism identified:
`scripts/exfat/highascg-apply-server-drop.sh:211` runs `npm ci --omit=dev` when a package-lock
is in the drop; `highascg-exfat-server-update.service` re-fired at 17:01 (stick still
inserted), journal hostname briefly `highascg-nvidia-595` (the WO-415 identity anomaly again).
