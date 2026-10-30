# src/utils part 1 — sweep 29.10.2026 (batch 103)

Files: 42 · lines: 6972 · findings: 0 BUG-HIGH, 8 BUG, 28 DEAD, 15 RISK, 33 QUALITY

Method: every file read in full. Repros were run with `node -e` against the real modules (fs/child_process mocked or the
scratchpad used; nothing under config/, projects/ or the API was touched). Dead-code proof used `grep -rnwI` over
client/ src/ godot/ tools/ scripts/ index.js test/ plus `tools/ci/unwired-exports-baseline.json` (entries marked "baseline"
are already known to the CI gate). "export-only" = the function is used inside its own file but nothing imports it.
Scripts: scratchpad `j50-exports.js`, `j50-exports2.js` (export census).

## src/utils/async-serial-queue.js
- `OK` (module-global tail promise is the intended single queue; `_resetSerializedQueueForTests` is used by tools/smoke/smoke-live-scene-state.test.js.)

## src/utils/atomic-file-write.js
- `BUG` src/utils/atomic-file-write.js:26 — the temp name is the fixed `${filePath}.tmp`, so two overlapping writes to the same target share one temp file. Failing case (run): `Promise.allSettled([atomicWriteFile(f,'A'x1e6), atomicWriteFile(f,'B'x1e6)])` → `['fulfilled','rejected:ENOENT']`: the second caller's rename finds the file already renamed away and its write is lost with an ENOENT; with chunked writes both streams truncate/write the same inode, so the renamed file can hold interleaved bytes (the torn-file case this helper exists to prevent). The Caspar config is written by two routes (src/api/routes-caspar-config.js:148 and src/api/routes-project.js:202), so a double-click on Apply plus a project save can overlap. Fix: unique temp name (`${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`), or serialise per target path with `runSerialized`.
- `QUALITY` src/utils/atomic-file-write.js:28-29 — no `fsync` of the temp file before `rename`, so a power cut right after the rename can still leave a zero-length target on some filesystems. Low value to fix on ext4 (auto_da_alloc) but the header claims "can never leave a truncated file".

## src/utils/boot-xrandr-snapshot.js
- `RISK` src/utils/boot-xrandr-snapshot.js:51-54 — the 24 h age gate only applies when `boot-xrandr-meta.json` exists and parses. Missing/corrupt meta → `capturedAt` NaN → the snapshot is served at any age. It is the fallback for `getDisplaysXrandrDetailed` (hardware-info-xrandr.js:285) and topology discovery, so an old snapshot can silently describe a different monitor set. Fix: fall back to the query file's mtime when meta is unusable.
- `DEAD` src/utils/boot-xrandr-snapshot.js:62,64 `DEFAULT_MAX_AGE_MS`, `resolveBootXrandrMetaPath` — export-only (baseline). grep: `grep -rnw resolveBootXrandrMetaPath src tools client` → definition + internal call only.

## src/utils/buffered-logger.js
- `DEAD` src/utils/buffered-logger.js:21,25 `system`, `amcp` pre-built loggers — never taken from the module. grep: every `require('…/buffered-logger')` (os-config.js, os-config-persist.js, os-config-xrandr-apply.js, routes-streaming-channel-log.js, ndi-resolve.js, caspar-ffmpeg-setup.js, index.js) destructures only `osDisplay`, `streaming` or `config`.
- `DEAD` src/utils/buffered-logger.js:20 `createBufferedLogger` export — export-only (baseline).

## src/utils/caspar-amcp-wait.js
- `QUALITY` src/utils/caspar-amcp-wait.js:113,135 — when the port is up, one loop iteration sleeps twice (`sleepUntilConnected(min(pollMs,800))` and then `sleepUntilConnected(pollMs)` at the bottom), so the effective poll is 2×`pollMs` and `portStablePolls` counts iterations that are twice as long as the WO-805 comment implies. Harmless (it wakes the moment the client connects) but the "150 ms poll" is really 300 ms while the port is listening.
- `QUALITY` src/utils/caspar-amcp-wait.js:124 — lazy `require('./caspar-restart')` inside the loop closes a circular dependency (caspar-restart requires this file). Pass `isCasparMainProcessRunning` in via opts instead.

## src/utils/caspar-gl-sync-env.js
- `RISK` src/utils/caspar-gl-sync-env.js:110 — the connector name is written unquoted into a file that run.sh sources (`. ~/.config/highascg/caspar-env`, run.sh:35). `resolveGlSyncDisplay` returns `casparServer.caspar_gl_sync_display` verbatim ("anything else = connector name verbatim", line 16) with no validation anywhere (`grep -rn caspar_gl_sync_display src` → only this file). Run: `resolveGlSyncDisplay({casparServer:{caspar_gl_sync_display:'DP-0; touch /tmp/pwn'}})` → `"DP-0; touch /tmp/pwn"`, i.e. `CASPAR_GL_SYNC_DISPLAY=DP-0; touch /tmp/pwn` is sourced at the next Caspar launch; a space or newline alone breaks the file. Config is owner-controlled, so RISK not BUG. Fix: accept only `/^[A-Za-z0-9._-]+$/` (the same test os-config-xrandr-apply.js:119 applies to heads) and single-quote the value.
- `QUALITY` src/utils/caspar-gl-sync-env.js:112 — `writeFileSync` straight onto the sourced file; run.sh can read a half-written file if a launch races an Apply. Use `atomicWriteFile`-style temp+rename.

## src/utils/caspar-restart.js
- `DEAD` src/utils/caspar-restart.js:167-254 `sendRestartAndWaitForCaspar` (+ its private helpers `resolveDisconnectWaitMs` :133 and `resolveReconnectWaitMs` :140, ~110 lines and the `HIGHASCG_CASPAR_RESTART_DISCONNECT_WAIT_MS` / `…RECONNECT_WAIT_MS` env knobs) — grep: `grep -rnwI sendRestartAndWaitForCaspar . --exclude-dir=node_modules --exclude-dir=work` → definition, export, baseline entry only. The live path is `reloadCasparAfterConfigWrite`.
- `DEAD` src/utils/caspar-restart.js:381-383 `finishCasparAfterApply` (pure wrapper) and :393 `waitForAmcpTcp` (alias of `waitForAmcpReady`) — zero importers (baseline).
- `RISK` src/utils/caspar-restart.js:42 — `isCasparMainProcessRunning` greps `pgrep -af <configPath>` lines for `/casparcg/i`, but `configPath` itself (`/home/casparcg/…/casparcg.config`) always contains "casparcg", so the test is always true for any non-`--type=` process whose command line mentions the config path (an editor, `less`, `rsync`, `xmllint` on that file). Failing case: `nano casparcg.config` open in a terminal → Apply sees "caspar still up" forever, runs the kill script every time and logs "still up after fast kill". Fix: match the binary basename against `argv[0]` (`/(^|\/)casparcg(-server)?(\s|$)/`) instead of the whole line.
- `QUALITY` src/utils/caspar-restart.js:293 — fixed world-writable marker `/tmp/caspar-operator-restart` (predictable path; any local user can pre-create/replace it to skip run.sh's damping) and a redundant inline `require('fs')` although `fs` is imported at line 3.

## src/utils/decklink-enum.js
- `DEAD` src/utils/decklink-enum.js:17-32 `parseDecklinkDevicesFromFfmpegText` — zero importers (baseline); `probeDecklinkFromFfmpeg` (:235-244) re-implements the same loop inline. Delete the function or call it from there.
- `RISK` src/utils/decklink-enum.js:120-122,158 — `probeDecklinkDriverHealth` runs `journalctl` (2 s timeout) via `execFileSync` and, as fallback, reads all of `/var/log/kern.log` / `/var/log/syslog` with `readFileSync(...).slice(-256K)` (whole file loaded); `probeDecklinkFromOs` adds `lspci` (1.5 s). They are called from the async `probeDecklinkHardware` (:269), so the "async" probe blocks the event loop for up to ~3.5 s on a cold box (WO-805 measured lspci 1516 ms cold). Use `execFile` async and a tail read of the log files.
- `QUALITY` src/utils/decklink-enum.js:11 — `DEFAULT_LOG_DIR = '/home/casparcg/highascg/log'` hard-coded instead of `REPO_ROOT/log`; :378-379 `=== true` branch of `key-only` is unreachable (xml2js only yields strings).

## src/utils/desktop-app-catalog-parse.js
- `BUG` src/utils/desktop-app-catalog-parse.js:163,171-190 — `splitExec` removes the field codes `%i`/`%c`/`%k`, but per the Desktop Entry spec `%i` expands to the two arguments `--icon <Icon>` and `%c` to a translated name. Stripping only the code leaves a dangling flag. Run: `splitExec('foo --icon %i --caption "%c" %U')` → `['foo','--icon','--caption']`. Launching such an entry (`resolveAppLaunch`) hands `--icon` with no value to the program, which errors or swallows the next argument. Fix: drop the preceding `--icon`/`--caption` argument when its value was an elided code, or substitute the entry's real Icon/Name.
- `RISK` src/utils/desktop-app-catalog-parse.js:22-27,43-50 — the header's security model says the allow-list is "exactly what root installed on this box", but `APP_DIRS` also contains `~/.local/share/applications` and `~/.local/share/flatpak/…`, which are writable by the casparcg user (and anything running as it, e.g. a CEF template or the node process). A `.desktop` dropped there becomes a launchable catalog entry with an arbitrary `Exec`, highest precedence (it shadows system entries by ID). The nuclear-password gate on the route still applies, so this is a trust-boundary comment mismatch rather than an open hole. Either drop the two user dirs or fix the comment.
- `DEAD` src/utils/desktop-app-catalog-parse.js:304 `stripFieldCodes` export — test-only (tools/smoke/smoke-wo387-desktop-app-catalog.test.js); used internally by `splitExec`.

## src/utils/desktop-app-catalog.js
- `QUALITY` src/utils/desktop-app-catalog.js:268 — `...parse` re-exports the whole parse module (APP_DIRS, TERMINAL_BINARIES, appAction, …) which nothing imports through this file (`APP_DIRS`, `TERMINAL_BINARIES`, `appAction` have no other importer than the parse module itself); `terminalSupportsClass` and `scanDesktopApps` are test-only exports. No functional issue found; the module is otherwise consistent (launch re-resolves `argv[0]`, allow-list by installed ID, TTL cache invalidated from src/api/system-hardware-gui.js).

## src/utils/display-stable-wait.js
- `BUG` src/utils/display-stable-wait.js:30-38 — `waitForDisplayStable` polls `getDisplaysXrandrDetailed()`, which since WO-397/391c is cached for 60 s on success and 30 s on failure and falls back to the 24 h boot snapshot when X is down (hardware-info-xrandr.js:271-289). The poll therefore never sees X. Run (execSync mocked: first call returns one connected DP-0, then throws "X down"): `waitForDisplayStable({settleMs:300,pollMs:50})` → `{ ok: true, displays: 1 }` after 302 ms with exactly 1 xrandr call; with X permanently down and only a boot snapshot on disk → `{ ok: true, displays: 1 }` as well. Caller: full-config-apply.js:207 right after `restartDisplayManager()` (nodm restart, canvas expansion), which never invalidates the cache, so "Display stable" is reported before X has restarted and the live xrandr (step 4) can hit a half-started X. Fix: `invalidateXrandrCache()` before each poll (or add an uncached `getDisplaysXrandrDetailed({fresh:true})`).
- `QUALITY` src/utils/display-stable-wait.js:32-38 — "stable for settleMs" only tests `count > 0`; a change in the number of heads (1 of 3 outputs up) does not restart the settle timer, contradicting the JSDoc. Track the last count and reset `firstSeenAt` when it changes.

## src/utils/edid-parse.js
- `BUG` src/utils/edid-parse.js:23,45 — the 32-bit serial is built with `<< 24`, which is signed in JS. Run: serial bytes `00 00 00 80` → `"-2147483648"`, `ff ff ff ff` → `"-1"`. Any monitor whose serial has the top bit set shows a negative serial in the Device View / EDID match. Fix: `(… ) >>> 0`.
- `QUALITY` src/utils/edid-parse.js:90-102 — `parseDetailedTiming` ignores the interlace flag (byte off+17 bit 7), so a 1080i descriptor is reported as `1920x540@…` with half the vertical size; the header check (:19) tests bytes 0,1,7 only (not 2-6) and the checksum is not verified.
- `DEAD` src/utils/edid-parse.js:107 `bufferFromHex` export — export-only (baseline).

## src/utils/full-config-apply.js
- `BUG` src/utils/full-config-apply.js:249-261 — with `skipCasparRestart: true` the function returns before the NVIDIA step (:286-317), but WO-805 moved the NVIDIA Force Composition / SyncToVBlank run out of `applyOperatorDisplaySession` (`skipNvidia: true` at :221 and :236) so it is now the ONLY NVIDIA run and it sits after the restart block. Failing input: `POST` the Caspar apply route with `{"skipCasparRestart":true}` (or `skipDisplayRestart:true`, routes-caspar-config.js:321-328) → live xrandr is applied (which the WO says can reset MetaMode), the NVIDIA policy is never re-applied, and `out.nvidiaDisplay` stays `{applied:false}`. Pre-WO-805 the policy ran inside the display session on this path. No Godot/web client in the repo sends the flag (grep godot client tools → none), so it is an API-only path. Fix: run the deferred NVIDIA block before the early return, or move it above the `skipCasparRestart` check.
- `QUALITY` src/utils/full-config-apply.js:201 — `restartDisplayManager()` is `execFileSync('sudo','-n','systemctl','restart','nodm')` (os-config.js:22), blocking the event loop for the whole nodm restart inside an async Apply (AMCP, WS and every route stall for seconds). Also the cache is not invalidated afterwards (see the display-stable-wait.js finding).
- `QUALITY` src/utils/full-config-apply.js:293-316 — fire-and-forget NVIDIA task: `void (async()…)().catch(...)` wraps an async function whose body already try/catches everything, so the outer `.catch` is dead; result is never reflected in `out` (`ok: null`).

## src/utils/gpu-connector-label.js
- `DEAD` src/utils/gpu-connector-label.js:69 `formatGpuConnectorLabel` export — export-only (baseline); only `resolveGpuConnectorLabelForChannel` is imported.

## src/utils/gpu-display-alias.js
- `QUALITY` src/utils/gpu-display-alias.js:12,63 — `/^(E-?DP|EDP)/` is redundant (`E-?DP` already matches `EDP`), and `drmName || topologyRow?.dpA` can never take the second branch (an empty `drmName` returns at line 48).

## src/utils/gpu-edid-probe.js
- `BUG` src/utils/gpu-edid-probe.js:52 — the sysfs connector regex `^card(\d+)-(DP|HDMI|DVI|VGA|eDP)-(\d+)$` cannot match the kernel's real names for HDMI and DVI (`card0-HDMI-A-1`, `card0-DVI-D-1`, `-DVI-I-`): after `HDMI` it needs `-<digits>` but sees `-A-`. Run: `card0-DP-1 true`, `card0-eDP-1 true`, `card0-HDMI-A-1 false`, `card0-DVI-D-1 false`, `card1-HDMI-A-2 false`. So HDMI/DVI connectors never get a sysfs EDID entry or a `drmCard` (:128-131 then falls to `defaultCard` = the first card, wrong on a multi-GPU box), and the sysfs source (:145-157) only works for DP. EDID still comes from xrandr-verbose/modetest, hence a degraded-not-broken symptom. Fix: `(DP|HDMI-A|HDMI-B|DVI-[DIA]|DVI|VGA|eDP)-(\d+)`.
- `RISK` src/utils/gpu-edid-probe.js:94-96,190 — `catalogCache` (3 s TTL) is keyed on nothing. The async inventory (hardware-info.js:133-140, :201-208) passes a freshly fetched `xrandrVerboseRaw`, but a catalog built moments earlier (e.g. by the sync `getDisplayDetails()` from a different caller, possibly with the 250 ms budget exhausted and no EDIDs) is returned instead. Include `xrandrVerboseRaw`'s hash in the cache key or bypass the cache when it is supplied.
- `QUALITY` src/utils/gpu-edid-probe.js:25,40-43 — `parseCache` is an unbounded module Map keyed by 256-char hex (grows with every distinct monitor ever seen; tiny, but never cleared); `guessDrmCardFromSysfs`'s third parameter `_byEdidKey` is unused.
- `DEAD` src/utils/gpu-edid-probe.js:227 `emptyEdidShape` export — export-only (baseline).

## src/utils/gpu-modetest.js
- `BUG` src/utils/gpu-modetest.js:410-412 — `probeModetestConnectors(opts)` ignores `opts.timeoutMs`: it calls `runModetestConnectorsRaw({ driverModule: opts.driverModule })`, which defaults to a 10 s `execFileSync`. gpu-edid-probe.js:161-164 passes `timeoutMs: Math.min(timeLeft(), 8000)` precisely to honour its 250 ms budget (`EDID_PROBE_BUDGET_MS`), so the budget is silently dropped: a slow/hung `modetest -c` blocks the whole server up to 10 s per catalog rebuild (every 3 s while hardware-info callers poll). The "non-blocking" `*Async` inventory functions (hardware-info.js:133,201) also hit this synchronous path through `probeGpuEdidCatalog`. Fix: forward `timeoutMs: opts.timeoutMs`.
- `DEAD` src/utils/gpu-modetest.js:378-404 `modetestModesToDisplayModes` — zero callers (baseline). grep: `grep -rnw modetestModesToDisplayModes . --exclude-dir=node_modules --exclude-dir=work` → definition, export, baseline.
- `DEAD` src/utils/gpu-modetest.js:428,429,435 `runModetestConnectorsRaw`, `parseModetestDrmCard`, `inferConnectorType` — export-only (baseline).
- `QUALITY` src/utils/gpu-modetest.js:6-20 — `normalizePortName` is a byte-for-byte copy of gpu-topology-xrandr.js:10-24 (run over 9 sample names: 0 differences), both exported; three further modules import one or the other. Re-export one from the other.
- `QUALITY` src/utils/gpu-modetest.js:348,350 — `if (conn.xrandrName) continue` at :348 is dead (already excluded at :332) and the `require('./gpu-display-alias')` sits inside the loop; the lazy require is there because gpu-display-alias → gpu-topology-xrandr → hardware-info → (lazy) gpu-edid-probe → gpu-modetest forms a cycle. Also `matchModetestToXrandr` mutates its input connectors (`conn.xrandrName`, `conn.matchMethod`) while the JSDoc only promises a Map.

## src/utils/gpu-physical-map.js
- `QUALITY` src/utils/gpu-physical-map.js:54,75 — `discoverGpuPhysicalTopology({config})` runs twice per `buildGpuPhysicalMap` call when no saved topology exists (once inside `resolvePhysicalTopology`, once at :75). Each run re-fetches xrandr and, on the DRM path, rebuilds the whole connector inventory (EDID/modetest). Pass the first result through.
- `RISK` src/utils/gpu-physical-map.js:156 — the B-lane lookup uses `{...t, drmName: t.drmNameB || t.drmName}`, so when a row has no `drmNameB` the DRM-name branch of `lookupDisplay` (:106-110) resolves lane B to lane A's display; the connector lookup for B (:160) deliberately uses `''` instead. Inconsistent; at best it yields `bDisplay === aDisplay` (harmless because `aDisplay` wins), at worst B claims A's display when A is already `used`.
- `DEAD` src/utils/gpu-physical-map.js:282 `resolvePhysicalTopology` export — export-only (baseline).

## src/utils/gpu-topology-drm-merge.js
- `QUALITY` src/utils/gpu-topology-drm-merge.js:118 — xrandr-sourced discovery hard-codes `cards: ['card0']` regardless of the actual DRM card.
- `QUALITY` src/utils/gpu-topology-drm-merge.js:121 — `discoverGpuPhysicalTopologyFromDrm(opts)` receives the caller's original `opts`, not the `xrandrRaw` this function just resolved (live → boot snapshot), so the DRM branch re-derives pairing with an empty xrandr view. Currently equivalent (the DRM branch is only reached when xrandr yielded no outputs) but it is a trap for the next change. Line 97 also re-requires `./hardware-info` although `getGpuConnectorInventory` is imported from it at line 3.
- `DEAD` src/utils/gpu-topology-drm-merge.js:132 `discoverGpuPhysicalTopologyFromDrm` export — export-only (baseline).

## src/utils/gpu-topology-drm-parse.js
- `DEAD` src/utils/gpu-topology-drm-parse.js:23-42 `pickPrimaryDrmCard` — zero callers anywhere (baseline). grep: definition + export only. `cardSortKey` (:11) is export-only (baseline).

## src/utils/gpu-topology-drm-rows.js
- `QUALITY` src/utils/gpu-topology-drm-rows.js:111-171 — the DP (111-140) and eDP (142-171) adjacent-pairing blocks are the same algorithm differing only in prefix/regex; fold into one helper parameterised by `isSimple…`/`adjacent…Pair`. Logic itself reads correct (`n % 2 === 1` pairs odd+next, even stays single).

## src/utils/gpu-topology-drm.js
- `OK` (barrel of parse/rows/merge; consumed via `discoverGpuPhysicalTopology`/`cardFromDrmName` in gpu-physical-map.js.)

## src/utils/gpu-topology-reconcile.js
- `DEAD` src/utils/gpu-topology-reconcile.js:131,134 `connectedLiveRandrNames`, `topologyRowsEqual` re-export — no importer takes them from this module (gpu-physical-map.js:9-13 and tools/smoke/smoke-gpu-topology-ssot.test.js:11-14 import other names; the smokes that use `topologyRowsEqual` import it from gpu-topology-xrandr).

## src/utils/gpu-topology-xrandr.js
- `DEAD` src/utils/gpu-topology-xrandr.js:87-98,263 `parseXrandrAllOutputs` — zero importers; hardware-info.js:74-86 carries an identical private copy that it actually uses. grep: `grep -rnw parseXrandrAllOutputs src tools` → these two definitions + hardware-info's call. Delete one (hardware-info should import this one).
- `DEAD` src/utils/gpu-topology-xrandr.js:265 `discoverGpuPhysicalTopologyFromXrandrFlat` export — export-only (baseline).
- `QUALITY` src/utils/gpu-topology-xrandr.js:220-237 — `ensureGpuPhysicalTopologyFromXrandr` mutates `config.gpuPhysicalTopology` in place (:239) before the save result is known, and the `suggested` key exists on only one return path; callers cannot rely on the result shape.

## src/utils/handlers.js
- `QUALITY` src/utils/handlers.js:9-21,46-63 — Companion leftovers: `variables`, `setVariableValues`, `init_actions`, `CHOICES_TEMPLATES` getter probing; nothing in HighAsCG's ctx defines them (periodic-sync.js:287,293 and query-cycle.js:170-238 pass the app `self`). `handleTLS`'s else-branch (no `state.updateFromTLS`) is therefore a dead fallback.
- `QUALITY` src/utils/handlers.js:38-40 — `parseTlsLines` doubles every backslash in `id` and `label` (`file.replace(/\\/g,'\\\\')`, a Companion AMCP-quoting artefact) and `file !== null` is always true. State-manager.js:270 uses these ids as media/template keys, so a TLS id containing `\` would be stored doubled. Caspar on Linux lists `/` separators, so no observed failure.

## src/utils/hardware-info-xrandr.js
- `QUALITY` src/utils/hardware-info-xrandr.js:30-47 — the JSDoc for `parseXrandrQueryRaw` (30-41) sits above `getXAuthority`, which is why the generated docs describe the wrong function; the module logs failures with `console.error` instead of the buffered logger used elsewhere in the OS-display code.
- `RISK` src/utils/hardware-info-xrandr.js:59,273 — the sync probes are `execSync` with a 3 s timeout (documented), but with the 30 s failure backoff the box can still freeze for 3 s every 30 s while X is wedged, and `getDisplaysXrandrDetailed()` (sync) is called from `waitForDisplayStable`, `getGpuConnectorInventory`, layout planning, etc. Known/accepted per WO-391c; listed for completeness.
- `DEAD` src/utils/hardware-info-xrandr.js:333,335 `XRANDR_TIMEOUT_MS`, `XRANDR_FAILURE_BACKOFF_MS` — test-only exports (tools/smoke/smoke-wo391c-xrandr-cache-backoff.test.js, smoke-hardware-info-xrandr-timeout.test.js).

## src/utils/hardware-info.js
- `DEAD` src/utils/hardware-info.js:61-72,214-221 `getDisplaysXrandr`, `getConnectedDisplayNames` — zero callers outside this file, and the former is only used by the latter (both in the baseline). grep: `grep -rnw getConnectedDisplayNames src client tools godot` → definition + export.
- `QUALITY` src/utils/hardware-info.js:74-86 — private `parseXrandrAllOutputs` duplicates gpu-topology-xrandr.js:87-98 (see that file); `isGpuConnectorPseudoName` (:19) is duplicated again by operator-monitor-resolve.js:18 with slightly different rules (the latter also rejects `gpuN`).
- `QUALITY` src/utils/hardware-info.js:88-90 — orphan JSDoc ("GPU connector list from live xrandr…") sits directly above the `buildGpuConnectorInventoryFrom` doc block, documenting nothing.
- `RISK` src/utils/hardware-info.js:133-141,201-209 — the `*Async` inventory functions are advertised as non-blocking (WO-309) but call the synchronous `probeGpuEdidCatalog`, which can run `readdirSync` over /sys/class/drm and `modetest -c` via `execFileSync` (see the gpu-modetest.js and gpu-edid-probe.js findings), so GET /api/device-view can still stall the loop.

## src/utils/known-gpu-topology.js
- `DEAD` src/utils/known-gpu-topology.js:73,74,75 `GENERIC_GPU_KEY`, `loadKnownGpus`, `inlineGenericFallback` — export-only (baseline); `resolveSocketCountForGpu` (:77) is test-only (tools/smoke/smoke-gpu-topology-ssot.test.js:7,34).
- `QUALITY` src/utils/known-gpu-topology.js:23,53 — a missing/unreadable `data/known-gpus.json` is cached as `{}` for the process lifetime (no retry), and the fuzzy match `lower.includes(kl) || kl.includes(lower)` returns the first key in file order, so a short or generic model string (e.g. "RTX") picks whichever entry comes first. Current data (4 keys) has no collision (checked).

## src/utils/lan-ipv4.js
- `OK`

## src/utils/log-buffer.js
- `DEAD` src/utils/log-buffer.js:20-23,91 `setMaxLines` — never called (baseline), so `_maxLines` is permanently 4000 and the documented configurability does not exist. grep: `grep -rnw setMaxLines src index.js tools client` → definition + export.
- `QUALITY` src/utils/log-buffer.js:20-23 — `setMaxLines(n)` with an out-of-range value (<100 or >50000) silently resets to the default instead of clamping, and shrinking does not trim existing lines until the next append.

## src/utils/log-record.js
- `QUALITY` src/utils/log-record.js:4,22 — `LogCategory` typedef declared twice; :107-111 `formatRecordLine` duplicates logger.js:11-15 `formatLine` (this one normalises the level, the other does not) and is export-only (baseline); `normalizeLogRecord(null|undefined)` throws a TypeError at `partial.level` (:119) although `appendHighasLine` is fed from many call sites.

## src/utils/logger.js
- `QUALITY` src/utils/logger.js:38-41,54 — if `onLine` throws, the console line is never printed and the exception propagates to the log caller (the buffered path is guarded in `appendHighasLine`, a custom `onLine` is not); line 54 re-requires `formatTimestampCasparStyle` that is already imported on line 3.

## src/utils/mapping-gpu-os-layout.js
- `BUG` src/utils/mapping-gpu-os-layout.js:89-93 — `computePixelMappingCanvasUnion` sizes an output only from `STANDARD_VIDEO_MODES` (falling back to 1920×1080@50), while its sibling `resolveOutputPixelSize` (:8-34, used by `buildMappingGpuLayoutArtifacts` and pixel-mapping-config.js:73) honours custom width/height and `WxH` mode ids; the doc comment (:73-74) claims "same rules". Run: output `{id:'a', mode:'custom', width:3000, height:500}` with no mapping → `computePixelMappingCanvasUnion` = `{width:1920,height:1080,fps:50}` but `resolveOutputPixelSize` = `{width:3000,height:500,fps:50}`. With `osXrandrHeadMode:'canvas'` (:193, :201) the xrandr head mode for every GPU head of that node becomes 1920x1080 instead of the real canvas. Fix: use `resolveOutputPixelSize(outDef)` for `w/h/f` at :89-93.
- `DEAD` src/utils/mapping-gpu-os-layout.js:22-23 — unreachable branch: `STANDARD_VIDEO_MODES[modeId]` was already tested and returned at :13-14.
- `RISK` src/utils/mapping-gpu-os-layout.js:94 — `mappings.find((m) => String(m.outputId) …)` throws on a null entry in `settings.mappings`, whereas :183 uses `m?.outputId`.
- `DEAD` src/utils/mapping-gpu-os-layout.js:246 `resolveOutputDefForMapOutConnector` export — export-only (baseline); `computePixelMappingCanvasUnion` export is test-only (tools/smoke/smoke-mapping-gpu-os-layout.js).

## src/utils/media-browser-dedupe.js
- `QUALITY` src/utils/media-browser-dedupe.js:90-93 — the JSDoc `@param {object[]} rows` is attached to `basenameHasExtension(id)`; `dedupeMediaList` (:133-135) silently drops any row whose canonical key is empty (an id that is only an extension such as `.mp4`, or ends in `/`) and a `null` row throws; `media.length < 2` returns the input array itself while longer lists return copies (inconsistent aliasing). `MEDIA_FILE_EXT` is byte-identical to client/lib/mixer-fill.js:111 (checked), as the comment requires.

## src/utils/media-catalog-broadcast.js
- `OK`

## src/utils/media-snapshot-cinf.js
- `OK` (`getCinfEnrichCap` is internal-only but trivially so; `ctx` is assumed non-null when a cap is set — all callers pass the app context.)

## src/utils/modeline-timings.js
- `RISK` src/utils/modeline-timings.js:33-48 — `runTimingGenerator` normalises only `gtf`/`cvt_r`/`cvt`, while `normalizeTimingKind` (:107-112) also accepts `reduced`/`cvt_rb` as `cvt_r`. `buildModelinePreview('reduced',…)` therefore runs plain `cvt` (full blanking) yet returns `kind:'cvt_r'` (:152). The only caller (routes-settings.js:26) normalises first, so it is latent. Also `execFileSync` has no `timeout` (a hung `cvt` blocks the server) — the route validates w/h/rate so no flag injection.
- `DEAD` src/utils/modeline-timings.js:164-165 `breakdownCvtStyleTimings`, `classifyPixelClockBandwidth` exports — test-only (tools/smoke/smoke-modeline-timings.js); used internally by `buildModelinePreview`.

## src/utils/nuclear-password.js
- `RISK` src/utils/nuclear-password.js:29-39 — `verifyNuclearPassword` fails open on a malformed stored hash. The expected key length is taken from the stored value, so an empty/undecodable hash body yields a 0-byte key and `timingSafeEqual` of two empty buffers is `true`. Run: `verifyNuclearPassword('anything','scrypt$abcd$')` → `true`; `'scrypt$abcd$zz'` → `true` (valid hashes behave: correct → true, wrong → false). A truncated config write or a hand-edit that leaves `nuclearPasswordHash: "scrypt$<salt>$"` makes the gate accept every password; `mergeUiNuclearPasswordSettings` (:103-104) also stores an incoming hash string as-is when there is no previous hash. Fix: require `expected.length === 32` (and `salt.length >= 16`) before comparing.
- `DEAD` src/utils/nuclear-password.js:115,116,118 `REDACTED_PLACEHOLDER`, `isNuclearPasswordHash`, `verifyNuclearPassword` — export-only (baseline); `hashNuclearPassword` is used outside tests only via the same file's merge/migrate.

## src/utils/nvidia-display-policy.js
- `DEAD` src/utils/nvidia-display-policy.js:75 `APPLY_SCRIPT_CANDIDATES` export — export-only (baseline). Otherwise OK: the shell fragment single-quote-escapes the script path correctly and `applyNvidiaDisplayPolicy` has a timeout.

## src/utils/operator-monitor-resolve.js
- `RISK` src/utils/operator-monitor-resolve.js:104-121 — "exactly one connected port → that is the operator monitor" counts only physical-map rows with `slotOrder` 0..3. Connected displays that fall into `gpu_unmapped_*` rows (slotOrder 100+) or into a 5th+ jack are ignored, so one mapped + two unmapped connected monitors still resolve to `auto-single`. Count `entry.unmapped` rows (or all connected displays) in the "multiple" test.
- `QUALITY` src/utils/operator-monitor-resolve.js:18-25 — pseudo-connector predicate duplicated from hardware-info.js:19 with different rules.

## src/utils/os-config-persist.js
- `RISK` src/utils/os-config-persist.js:59-64,124-129 — the system-wide persist writes the script to the predictable `os.tmpdir()/highascg-apply-layout-<pid>.sh` and then `sudo -n install`s it to `/etc/highascg/apply-layout.sh`, which is executed from Xsession.d at every login. `writeFileSync` follows a pre-planted symlink and does not recreate an existing file, so a local user who owns/pre-creates that path (pid is guessable) can swap the content between the write and the root `install`. Fix: `fs.mkdtempSync` a 0700 directory, or pipe via `sudo tee`.
- `QUALITY` src/utils/os-config-persist.js:51,120 — `apply-layout.sh` (sourced at login) is written non-atomically; a crash mid-write leaves a truncated login script. `atomicWriteFile` exists. When `sudo` is unavailable the `execFileSync` at :61 throws and the temp file at :59 is never unlinked (one stale file per pid). :116 writes `export XAUTHORITY=${xauth}` unquoted (a path with spaces breaks the script).
- `DEAD` src/utils/os-config-persist.js:145 `writeCustomModesApplyMeta` export — export-only (baseline).

## src/utils/os-config-xrandr-apply.js
- `RISK` src/utils/os-config-xrandr-apply.js:241-245,296 — the `xrandr --query` and the layout-apply `xrandr …` run through `execFileAsync` with no `timeout`, unlike every probe in hardware-info-xrandr.js (3 s, with a documented hung-X incident). A wedged X server makes the Apply request (and `applyX11Layout` from the layout watchdog, boot-screen-assignment and settings-os) hang forever; the 3×600 ms retry loop only covers fast failures.
- `QUALITY` src/utils/os-config-xrandr-apply.js:322,374 — `verifyXrandrMatchesLayout` is computed twice per live apply (inside the `applied` branch and again for the return value), the second pass re-reading xrandr; reuse the first result. :152 `avail && allowCreate` — `avail` is always truthy. :50 the sandbox early return `{ok:false, skipped}` lacks the `applied/persisted/xrandrCommand` keys that settings-os.js:178 and the watchdogs read (works because they test truthiness).
