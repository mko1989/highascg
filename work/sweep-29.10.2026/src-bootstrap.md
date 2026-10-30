# src/bootstrap — sweep 29.10.2026 (batch 070)

Files: 23 · lines: 2319 · findings: 0 BUG-HIGH, 4 BUG, 1 DEAD, 4 RISK, 11 QUALITY

## src/bootstrap/args.js
- `QUALITY` src/bootstrap/args.js:8-24 — unknown flags and flags missing their value are silently ignored (`--port` as the last argv, or a typo such as `--no-caspr`). A typo of `--no-caspar` starts the process connected to the real on-air Caspar with no warning. Print a warning for unknown `--*` arguments.

## src/bootstrap/audio-capture-lifecycle.js
- `OK` (each restart builds a fresh engine, so no stale-handler respawn; `getAudioCaptureStatus` returns null after stop; only registered on `appCtx` when a source is enabled).

## src/bootstrap/caspar-amcp-watchdog.js
- `QUALITY` src/bootstrap/caspar-amcp-watchdog.js:48,64,162 — `evaluateAmcpWatchdogTick` takes a `pollMs` option, assigns it and then discards it with `void pollMs`. Remove the parameter. (The baseline list tools/ci/unwired-exports-baseline.json:285 still names `startCasparAmcpWatchdog` as unwired, but index.js:29/361 uses it; the baseline entry is stale.)
- Checked and fine: single `busy` flag plus self-scheduling timer, `stopped` honoured, kill path guarded by cooldown and `lastNoMainAt` (WO-754).

## src/bootstrap/caspar-info-ready.js
- `RISK` src/bootstrap/caspar-info-ready.js:14-46 — `setupAllRouting(appCtx)` is started fire-and-forget (:15) and `reconcileAfterInfoGather` -> `restagePersistedPreviewLooks` -> `warmLookDeckThumbnails` (:34-46) run in parallel with it rather than after it. The comment at :29-33 calls the restage "sequenced" but only the reconcile -> restage -> warm chain is. `restagePersistedPreviewLooks` (src/config/routing-setup.js:250) plays onto the PRV buses while routing setup may still be building those channels. AMCP ordering is only guaranteed per command, not across the two flows. No failing case reproduced; fix would be `await` of the routing promise before the restage step.

## src/bootstrap/compose-preview-lifecycle.js
- `QUALITY` src/bootstrap/compose-preview-lifecycle.js:39,50,78,83 — `void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)` has no `.catch` (only the start path at :32 has one). `stop…Internal` awaits `detachAllComposeFileConsumers`, which does AMCP; on `onCasparDisconnected` (:76-79, AMCP is down by definition) a rejection is an unhandled rejection that process-guards only logs generically. Add a `.catch` that logs `[compose-preview]`.

## src/bootstrap/config.js
- `OK`

## src/bootstrap/device-graph-boot-sync.js
- `OK`

## src/bootstrap/dotenv.js
- `OK` (does not strip inline `# comments`, which is acceptable for a documented minimal loader).

## src/bootstrap/fetch-server-info-config.js
- `QUALITY` src/bootstrap/fetch-server-info-config.js:51-56 — the 650 ms `dmxAfterInfoConfigTimer` is neither unref'd nor cleared by shutdown, so a SIGTERM inside that window runs `samplingManager.updateConfig` after `samplingManager.stop()` (src/bootstrap/shutdown.js:67-76). Expose a `dispose()` or unref it.

## src/bootstrap/gpu-drm-hotplug-watch.js
- `BUG` src/bootstrap/gpu-drm-hotplug-watch.js:58-61,82-99 — the documented 60 s idle TTL never stops the poll, so the 2 s `/sys/class/drm` poll runs forever after the first Device View request. `touchDeviceViewGpuWatch` (:82-86, called by every GET /api/device-view, snapshot and gpu-map-debug in src/api/routes-device-view.js:59-60) does `subscriberCount = Math.max(subscriberCount, 1)`, and nothing ever decrements that implicit subscriber. The tick only stops when `subscriberCount <= 0` (:58) and `unsubscribeDeviceViewGpuWatch` (:94) only decrements what `subscribe…` added. Also the WS handler (src/server/ws-server.js:366-375) calls unsubscribe only on an explicit `device_view_unsubscribe` message, not on socket close, so a closed tab leaks a subscriber the same way. Failing case: open Device View once (or `curl /api/device-view`), close it: `pollTimer` keeps running for the life of the process (cheap, but wrong; and it reads every connector status file every 2 s). Fix: track subscribers per ws and release on `close`; make `touch` only refresh `lastTouchAt` without touching the counter.

## src/bootstrap/gpu-topology-factory-reset.js
- `OK`

## src/bootstrap/led-test-layer-999.js
- `RISK` src/bootstrap/led-test-layer-999.js:59-78 — the "provably empty" cache `_ledTest999KnownClear` is only dropped by `markLedTestLayerPainted`, which the startup card calls (startup-led-test-pattern.js:244,425) but the manual card route does not (src/api/routes-led-test-card.js paints at :214 and never calls it). Sequence: a multiview apply caches ch 1 and ch 2 as clear; the operator puts the manual test card on both; they switch ch 1 off with `masterOff:true` (route :62 sets `_ledTestPatternActive=false`); the next multiview apply (src/engine/multiview-apply.js:172-188) skips ch 2 because it is in the cache, so the card on ch 2 stays on air. Fix: call `markLedTestLayerPainted(ctx)` from the route when it paints.

## src/bootstrap/modules.js
- `QUALITY` src/bootstrap/modules.js:20-26 — both branches of the `existsSync(three.module.js)` check assign `out['/vendor/three/'] = threeRoot`; only the warning differs, so a missing `three` still mounts a prefix that 404s. The two empty `catch {}` blocks hide `fs` errors. Mount only when present.

## src/bootstrap/os-layout-watchdog.js
- `BUG` src/bootstrap/os-layout-watchdog.js:39-96 — the 1.5 s `setInterval` (:95) fires `tick` without an in-flight guard, but `tick` awaits `applyX11Layout` (:75), which is async with retries and sleeps (src/utils/os-config-xrandr-apply.js:47,315). Failing case: layout drifted at boot, tick N starts a re-apply that takes more than 1.5 s; tick N+1 runs `checkXrandrLayout` against the half-applied screen, sees mismatches and starts a second `applyX11Layout` concurrently, so two xrandr sequences interleave on the live display. `attempts` also increments per overlapping tick, so `maxAttempts` (12) is burnt in about 18 s and the final "Layout still wrong" warning can fire although the first apply succeeds. Fix: a `busy` flag (as caspar-amcp-watchdog.js does) or a self-scheduling timeout.
- `QUALITY` src/bootstrap/os-layout-watchdog.js:25-27 — the `HIGHASCG_HEADLESS` branch has an empty body; the comment says "still skip unless forced" but nothing is skipped, so headless nodes poll 12 times and log a warning. Either `return null` there or delete the branch and the `_FORCE` env mention.

## src/bootstrap/osc-lifecycle.js
- `OK` (`startOscPlaybackInfoSupplement` clears its previous timer first, src/utils/periodic-sync.js:222, so repeated restarts do not stack timers).

## src/bootstrap/process-guards.js
- `OK`

## src/bootstrap/safe-mode.js
- `BUG` src/bootstrap/safe-mode.js:20-28 (called from index.js:429) — Safe Mode starts its own HTTP server on the same `config.server.httpPort`, but the fallback is entered from the catch around everything in `main()`, including code that runs after the main `startHttpServer` (index.js:301). Failing case: any throw after index.js:301 (for example `startReplicationService` or `attachVideoFeed`) leaves the first server listening; safe mode's `listen` then emits EADDRINUSE on a server with no `'error'` listener (src/server/http-server.js has none; `listen` at :379), which is an uncaught exception, so process-guards runs `process.exit(1)` and systemd restarts into the same crash. The advertised recovery UI never appears for failures in that window. Fix: close the already-bound server first (or pass it in), and add an `'error'` handler.
- `QUALITY` src/bootstrap/safe-mode.js:29-36 — the SIGINT/SIGTERM handler has no failsafe timer (shutdown.js has 8 s + 2 s); if `stopHttpServer` waits on a keep-alive connection the process never exits on SIGTERM until systemd's SIGKILL.

## src/bootstrap/sandbox.js
- `OK`

## src/bootstrap/shutdown.js
- `QUALITY` src/bootstrap/shutdown.js:12-127 — several things started in index.js are not stopped here: `_loopRestartWatchdog`, `_videoFeed`, `_stopSimOscFeeder`, the `streamingReloadTimer` (streaming-lifecycle.js:70) and the two `Promise.race` timeouts (:61,:71, never cleared). All are unref'd or finish within the 8 s failsafe, so nothing leaks past exit; but the list is easy to drift from index.js. Also note `process-guards` exits on uncaughtException without running this handler, so ffmpeg bridges (live-audio, v4l2, browser capture) are only reaped by the systemd cgroup kill, not by `stopAll…Bridges()`.

## src/bootstrap/startup-led-test-pattern.js
- `BUG` src/bootstrap/startup-led-test-pattern.js:290-294 — `tryClearStartupLedTestForWebUi` is the owner-chosen no-op (WO-504), but it still sets `appCtx._ledTestLayer999ClearedAfterWebUi = true`, and index.js:377 calls it unconditionally 1.5 s after every Caspar connect (`setTimeout(() => void tryClearStartupLedTestForWebUi(appCtx), 1500)`), whether or not any Web UI client exists. So the flag says "cleared" while the card is still on air. Consequences: (1) the CEF catch-up replays scheduled at 4 s/10 s (:270-281; 1.5 s/4 s in fast mode) check the flag at :276 and are always skipped, so the "re-run the full sequence because CEF may still be spinning up" logic is dead in practice; (2) `refreshStartupLedTestIps` returns `splash_cleared` (:338-340) so the IP refresh after a network reset (src/api/system-hardware-network.js:193-194) can never update the splash; (3) the log at :256-260 says "was applied then cleared" when nothing was cleared. Fix: keep the no-op but do not set the flag (or rename it to "web UI seen" and stop using it as "cleared").
- `RISK` src/bootstrap/startup-led-test-pattern.js:322,397 — the CG data is escaped with `json.replace(/"/g, '\\"')` only. `JSON.stringify` output contains `\"`, `\\` and `\uXXXX` whenever a string has a quote or backslash; escaping just the quotes turns `\"` into `\\"` which AMCP reads as an escaped backslash followed by a closing quote. Current fields (resolution label, GPU connector label, IPs) are unlikely to hold such characters, so there is no failing input today; the central escaper is `param()` in src/caspar/amcp-utils.js:17-21 (backslash first, CR/LF folded). Same pattern in src/engine/pip-overlay.js and global-border.js.
- `QUALITY` src/bootstrap/startup-led-test-pattern.js:308-327 vs :383-411 — the per-channel payload build is duplicated (`buildStartupLedTestUpdateCommands` / `buildStartupLedTestFlatCommands`); extract the shared payload/escape step.

## src/bootstrap/streaming-lifecycle.js
- `DEAD` src/bootstrap/streaming-lifecycle.js:82-84 getter `streamingTargets` — never read. grep: `grep -rn "streamingTargets" src tools index.js client` → only the definition. (`stalePreviewTargets` is rebuilt inside `cleanupStalePreviewConsumers`, so the exposed array would also be stale.)
- `QUALITY` src/bootstrap/streaming-lifecycle.js:62-72 — `streamingReloadTimer` is not unref'd or cleared on shutdown (400 ms; harmless).

## src/bootstrap/system-inventory-file.js
- `RISK` src/bootstrap/system-inventory-file.js:15,141-142 — the default output path is `/tmp/highascg-system-inventory.json`, written with `fs.writeFileSync` (follows symlinks, default 0644). It carries hostname, hardware id, MAC and IPv4 addresses. On a shared host another local user could pre-create that path as a symlink to a file the node user can write, or just read the file. It is a single-owner box, so low risk; use a path under the repo's runtime dir (or `os.tmpdir()` + `wx`/`0600`). `DEFAULT_PATH` and `resolveOutputPath` are exported but only used here (CI baseline lists them).

## src/bootstrap/v4l2-bridge-lifecycle.js
- `QUALITY` src/bootstrap/v4l2-bridge-lifecycle.js:12,18,22,24,29 — all five `void bridge.start/stopV4l2Bridge(appCtx)` calls drop their promise without `.catch`; a rejection becomes an unhandled rejection with no `[v4l2-bridge]` context in the log.
