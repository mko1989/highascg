# src/system (part 1) — sweep 29.10.2026 (batch 100)

Files: 30 · lines: 6635 · findings: 0 BUG-HIGH, 4 BUG, 20 DEAD, 18 RISK, 28 QUALITY

Method: every file read in full; exports cross-checked with `git grep -n -w` over client/ src/ godot/ tools/ scripts/ index.js
(tests under tools/smoke count as live) and `tools/ci/unwired-exports-baseline.json`; repros are scratch scripts with mocked
fs/child_process in `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/j48-*.js` (nothing touched system
state; the only live reads were `findmnt`, `/proc`, `nmcli`/`ip` listings and a dry-run of `runExfatSync`). Every `execFile`/`spawn` in these
files passes an argv array, so there is no shell-injection path; the sudo uses are listed under operator-snap-home.js and hardware-identity.js.

## src/system/boot-screen-assignment.js
- `BUG` src/system/boot-screen-assignment.js:369 (and :128-133, :201-211) — `resolve()` hands the picked/default jack to `picker.applyOperatorMonitorChoice(config, op.port)`, which throws for `port > MAX_OPERATOR_PORT (4)`, but `litPorts()` / `defaultOperator()` happily return ports 5+. Failing input: a box with 5 lit GPU jacks (DP-0..DP-4), operator clicks the 5th screen (`resolve(ctx, {name:'DP-4'})`), or nobody answers and `defaultOperator()` picks the first jack no PGM cable uses (= port 5 when jacks 1-4 carry cables). → `Error: operator monitor port out of range: 5`, thrown BEFORE `d.openGate(...)` (:406) and before `store.set`, so the gate file is never written: Caspar stays held until run.sh's 240 s backstop (and with `startup.mode: ask` there is no backstop at all), and the SERVER_FALLBACK timer (:458) only logs "fallback failed". Repro `j48-boot5b.js` (click DP-4 → THROWS, gate opened: 0; timeout default → port 5 → THROWS). Fix: filter `litPorts()` to slots 1..MAX_OPERATOR_PORT (the picker's own `listPickerOutputs` already drops them) or catch and fall back to the first in-range lit jack.
- `QUALITY` src/system/boot-screen-assignment.js:70 — `bootId()` gets the machine boot identity from `../bootstrap/startup-led-test-pattern` (getMachineBootIdentity): the boot-gate depends on the LED test-pattern module for a generic helper; a small shared util would be clearer.

## src/system/boot-stick.js
- `OK`

## src/system/browser-source-session.js
- `RISK` src/system/browser-source-session.js:187 — `spawn(bin, …)` has no `child.on('error')`. `resolveFirefoxBin()` only checks `statSync().isFile()`, so a non-executable or broken `/usr/bin/firefox` (EACCES/ENOEXEC) emits an async `'error'` event that nobody handles → uncaughtException → `process.exit(1)` (src/bootstrap/process-guards.js:21). pointer-confine.js:168 documents exactly this hazard for unclutter. Fix: `child.on('error', …)` that clears the session and returns `{ok:false}`.
- `RISK` src/system/browser-source-session.js:35 — profiles live in `<repo>/.browser-source-profiles/<id>` (a full Firefox profile: cache, cookies, places.sqlite). `git check-ignore -v .browser-source-profiles/x/prefs.js` → not ignored, and `.stignore` has no entry, so the first browser_display source makes an untracked dir that Syncthing then replicates to the peers (the shader-fight class of problem in CLAUDE.md). Fix: add `/.browser-source-profiles` to `.gitignore` and `.stignore` (mirror on the Mac) or move to `~/.highascg/`.
- `DEAD` src/system/browser-source-session.js:313,316 — `PROFILE_ROOT`, `stopBrowserSource` exports unused outside (listed in tools/ci/unwired-exports-baseline.json:538-539; `git grep -w stopBrowserSource` only hits this file and the baseline; `stopBrowserSource` is used internally).

## src/system/build-stamp.js
- `OK`

## src/system/cef-cdp-client.js
- `DEAD` src/system/cef-cdp-client.js:280-281 — `VK_CODE` and `vkCodeForKey()` are exported but nothing imports them (baseline:540-541; `git grep -n -w vkCodeForKey` → only the definition). The key→VK table (lines 162-215) therefore has no reader inside the module either (`vkCodeForKey` is only defined and exported); `connectCdp`/`createCefPage` are used elsewhere (8 / 5 hits).

## src/system/device-identity.js
- `RISK` src/system/device-identity.js:37-49 — the ed25519 PRIVATE key is written with `fs.writeFileSync(path, json, 'utf8')` (default mode, umask 0002 → `-rw-rw-r--`; `ls -l config/device-identity.json` on this box shows 0664) and non-atomically. Secrets elsewhere (private-secrets-export.js) use `mode: 0o600`. Fix: `{ mode: 0o600 }` + tmp+rename.
- `RISK` src/system/device-identity.js:19-30,62-77 — `readDeviceIdentityFile()` returns null on any parse error/short read, and `ensureDeviceIdentity()` then silently generates a NEW keypair and overwrites the file. A torn write (power loss during the non-atomic write above) or a half-synced file therefore replaces the node's cluster identity without a log line, and every peer that pinned the old public key (routes-cluster.js sign/verify) rejects this node. Fix: on a present-but-unparseable file, log loudly and keep a `.corrupt-<ts>` copy before regenerating.
- `DEAD` src/system/device-identity.js:114-115 — `readDeviceIdentityFile` export unused outside (baseline:542; `DEVICE_IDENTITY_PATH` is used by smoke-wo723-duties-from-config.test.js:277).

## src/system/exfat-sync-fs.js
- `BUG` src/system/exfat-sync-fs.js:97-108 (same logic in private-volume-sync.js:70-76) — the mtime comparison assumes both volumes keep the source mtime exactly, but exFAT stores mtime with 10 ms resolution while ext4 keeps ns. After `copyFilePreserveTimes(project → exfat)` the stick copy is up to 10 ms OLDER, so the next pass sees `mtB > mtA` and copies project → exfat again, on every pass, forever. Measured on this box (`bridge/configs` vs `highascg/config`, e.g. caspar.json 1793301716890 vs 1793301716895.9895; 21 of 29 files differ by <10 ms in the project's favour) and a read-only dry run `runExfatSync({dryRun:true})` reports `copied=30 skipped=1211` with nothing edited (`j48-sync.js`). Effect: every config save (config-manager.js:262 → exfat-sync-on-save.js) rewrites ~30 files on the bridge disk via tmp+rename (write wear, sync fs calls blocking the loop), and the "copied" counts the Settings panel shows are meaningless. No WO covers it (`rg -il granular work/work-orders` → nothing relevant). Fix: treat |Δmtime| < ~25 ms (FAT/exFAT: 2 s to be safe) as equal and fall through to the size check.
- `QUALITY` src/system/exfat-sync-fs.js:45 — the crash-safety tmp is `<dst>.tmp-<pid>` inside the synced tree; a crash/stick yank leaves `X.json.tmp-123`, which the next `walkRelativeFiles` treats as a normal file and replicates to the other side. Exclude `*.tmp-*` in `walkRelativeFiles`, or sweep them.
- `QUALITY` src/system/exfat-sync-fs.js:12-35 — `walkRelativeFiles` follows symlinks (`statSync`) with no cycle guard; a link to a parent dir inside config/ or projects/ recurses until ENAMETOOLONG/stack depth.
- `QUALITY` src/system/exfat-sync-fs.js:132 — `syncPairBootPreferExfat` takes `syncOneFilePairFn` as a parameter though the only caller passes the same-module `syncOneFilePair`; the DI adds nothing.

## src/system/exfat-sync-map.js
- `RISK` src/system/exfat-sync-map.js:55-56 — `path.resolve(String(v.mount||'').trim() || DEFAULT_VOLUMES[key]?.mount || '')`: `path.resolve('')` is the process cwd, so the `if (!mount) continue` guard can never fire. A map volume with a custom key and no `mount` silently becomes "cwd" (the repo root) and `mount.mounted` then reports the repo's filesystem. Fix: test the string before resolving.
- `RISK` src/system/exfat-sync-map.js:10,209-214 — `assertSafeProjectPath` hard-codes `/home/casparcg/highascg`; any other checkout location (the sandbox uses another root, dev checkouts) makes every pair error "Refusing sync", and relative `project` entries are resolved against `process.cwd()` rather than REPO_ROOT.
- `QUALITY` src/system/exfat-sync-map.js:46 — `const version = Number(raw.version) || 1` is assigned and never used in `normalizeVolumes`.
- `QUALITY` src/system/exfat-sync-map.js:147-160 — `sortPairsForSync(pairs, boot)`: both branches return `sorted`, the `boot` parameter does nothing (callers pass it, exfat-sync.js:295).
- `QUALITY` src/system/exfat-sync-map.js:9 — JSDoc `@type {readonly string[]}` on a plain string constant.
- `DEAD` src/system/exfat-sync-map.js:229-230 — `DEFAULT_PROJECT_ROOT_PREFIX`, `DEFAULT_VOLUMES` exports unused outside (baseline:543-544; internal use only).

## src/system/exfat-sync-on-save.js
- `RISK` src/system/exfat-sync-on-save.js:27 — the header says "Debounced push", but `pushProjectConfigToExfat` runs immediately on EVERY config `change` event (config-manager.js:262), only the follow-up `runExfatSync` is debounced (2 s). It copies every file of every pushOnSave pair unconditionally (exfat-sync.js:134-152 has no mtime check), synchronously, on each save; with the mtime finding above the bidirectional pass adds ~30 more. A save burst (looks/scene edits write config) thus hammers the bridge disk. Fix: put the push behind the same debounce and skip unchanged files.
- `QUALITY` src/system/exfat-sync-on-save.js:32 — when the timer fires while `inFlight`, the run is dropped without rescheduling, so the last save of a burst can be left unsynced until the next save.

## src/system/exfat-sync-status.js
- `BUG` src/system/exfat-sync-status.js:94,168-172 — `usbMount = volumes.usb || await getExfatMountStatus(...)`; `volumes.usb` is the VIEW object built by `buildVolumeViews` (fields `mounted`, `mountSource`, `mountFstype`), but the return value reads `usbMount.source`, `.fstype`, `.target`, `.inheritsFromFilesystem` — all undefined. `normalizeVolumes` always creates `usb`, so the fallback is never taken. Failing case: stick mounted → `GET /api/system/exfat-sync` returns top-level `mounted: true` with `mountSource/mountFstype/mountTarget` undefined, and client/components/settings-modal-mount-hardware.js:48 renders `mounted: ? (?)`. Repro `j48-dash.js` (usb view has `mountSource` but top-level `mountSource: undefined`). Fix: read `usbMount.mountSource/mountFstype` (and `volumeMount`), or always call `getExfatMountStatus`.
- `QUALITY` src/system/exfat-sync-status.js:56-60,81 — for an unmounted target `getExfatMountStatus` still returns the PARENT filesystem's `source`/`fstype` (`inheritsFromFilesystem` is set separately), and `buildVolumeViews` copies them into `mountSource`/`mountFstype` regardless of `mounted`: this box shows `usb: { mounted:false, mountSource:'/dev/nvme0n1p2', mountFstype:'ext4' }`.
- `DEAD` src/system/exfat-sync-status.js:189 — `buildPairView` export unused outside (baseline:545).

## src/system/exfat-sync.js
- `DEAD` src/system/exfat-sync.js:333,342 — `DEFAULT_EXFAT_ROOT`, `clearMountCache` exports unused (baseline:546-547).
- `DEAD` src/system/exfat-sync.js:56-58 — the `map.version < 2` branch of `pairPushOnSave` is unreachable: `validateMap` always returns `version >= 2` (exfat-sync-map.js:131), and the default-map fallback is also 2.
- `QUALITY` src/system/exfat-sync.js:49-53 — a stray JSDoc block (`@param pair`, `@param map`) sits above the one-line comment for `pairPushOnSave` and describes nothing.
- `QUALITY` src/system/exfat-sync.js:35-47 — `mountCache` is module-global and cleared only at the start of `pushProjectConfigToExfat`/`runExfatSync`; two overlapping runs (post-save push + debounced sync, which `exfat-sync-on-save.js` starts a few ms apart) share and clear each other's cache.

## src/system/hardware-identity.js
- `RISK` src/system/hardware-identity.js:239 — non-root path tries `sudo -n hostnamectl set-hostname`, which the comment at :220-228 itself says is NOT in the NOPASSWD allowlist (scripts/setup/12-passwordless-sudo.sh:36-62 grants only `highascg-apply-hardware-hostname.sh`). It can never succeed and logs a sudo auth failure in the journal on every run. Drop it.
- `RISK` src/system/hardware-identity.js:119-139,229-245 — `hostname` from `config/hardware-identity.json` is used unvalidated as an argv element (`hostnamectl set-hostname <hostname>`, `hostname <hostname>`, `/etc/hostname`). No shell involved, but a value starting with `-` is parsed as an option. Validate against `/^[a-z0-9][a-z0-9-]{0,62}$/`.
- `QUALITY` src/system/hardware-identity.js:275-276 — `isLegacyHighascgHostname(current) || current !== identity.hostname`: the first operand is implied by the second whenever the identity hostname is `highascgNNNN`.
- `QUALITY` src/system/hardware-identity.js:70-76 — third fallback `interfaces.find((i) => !i.internal && isUsableMac(i.mac))` can never match a NIC without an IPv4 address because `listEthernetInterfaces()` initialises `internal = true` (network-inventory.js:23); see that file.
- `DEAD` src/system/hardware-identity.js:312-322 — `LEGACY_HOSTNAME_RE`, `deriveHardwareIdFromMachineId`, `getPrimaryEthernetMac`, `readHardwareIdentityFile`, `writeHardwareIdentityFile` exports unused outside (baseline:548-551; `git grep -w LEGACY_HOSTNAME_RE` → only a client comment).

## src/system/host-cpu-usage.js
- `OK`

## src/system/licenses-path.js
- `DEAD` src/system/licenses-path.js:33 — `SYSTEM_LICENSES` export has no external reader (`git grep -n -w SYSTEM_LICENSES` → this file only; not in the baseline). Trivial.

## src/system/network-interfaces.js
- `RISK` src/system/network-interfaces.js:29-35,135-172 — `run()` is `execFileSync` (timeout 5 s). `listNetworkInterfaces()` makes 3 + N sync calls and `buildWifiStatus` 2 more; with NetworkManager stopped/hung that is a 5 s event-loop stall per call on a playout server (OSC/AMCP handlers share the loop). Measured 40 ms when healthy. Fix: async `execFile` with `Promise.all`.

## src/system/network-inventory.js
- `QUALITY` src/system/network-inventory.js:23-30 — `internal` starts `true` and is only overwritten by an IPv4 entry, so an Ethernet NIC that has a MAC but no IPv4 yet (cable in, DHCP pending; IPv6-only) is reported `internal: true`. Repro `j48-net.js`: `enp3s0 address=null internal=true`. Consumers `!i.internal` (hardware-identity.js:75, :178 here) then skip exactly the NICs the "no address" fallbacks are meant for.
- `RISK` src/system/network-inventory.js:62-101 — `readNmcliMode` runs up to 3 sequential `execFileSync` (5 s each) from `buildNetworkStatus` (API request path).
- `QUALITY` src/system/network-inventory.js:49 — `readOperstate` re-requires `fs` inside the function, shadowing the module-level `fs`.
- `DEAD` src/system/network-inventory.js:199-202 — `readNmcliMode`, `hashFileSync` exports unused outside (baseline:552-553; both used internally).

## src/system/operator-dock.js
- `DEAD` src/system/operator-dock.js:203 — `classifyHelperWindows` is exported but only called inside this file (`git grep -n -w classifyHelperWindows` → operator-dock.js:50,113,139,203; not in baseline).
- `QUALITY` src/system/operator-dock.js:175-201 — `searchWindowsByName`/`activateWindow` import `displaySessionEnv` from `../utils/x-display-session-runtime-env`, while the sibling files import it from `x-display-session`, `x-display-session-runtime` and `x-display-session-runtime-env` (3 spellings of one helper across src/system: browser-source-session.js:31, operator-monitor-picker.js:37, pointer-confine.js:27).

## src/system/operator-gui-atlas.js
- `OK` — shelf packer fuzzed (3000 random item sets, `j48-atlas.js`): no overlap, no out-of-bounds, no unpackable result.

## src/system/operator-gui-channel-geometry.js
- `DEAD` src/system/operator-gui-channel-geometry.js:91-103,116-123 — `resolveOperatorGuiMonitorRect()` and `fractionRectToMonitorPx()` (the shape-helper feed removed by WO-646) have no caller: `git grep -n -w resolveOperatorGuiMonitorRect` → only a comment at src/config/config-generator-operator-gui.js:12 plus the re-exports; `git grep -n -w fractionRectToMonitorPx` → definition + re-exports only. Their imports `resolveOperatorGuiPort` (:14) and `resolveLayoutRectForOperatorPort` (:15) are then used only by the dead function.
- `DEAD` src/system/operator-gui-channel-geometry.js:322-323 — `fitAspectRectPx`, `computeAspectFitCellRect` are exported (and re-exported by operator-gui-channel.js:468-469) but only used inside the geometry module (`git grep -n -w` outside the two files → none).
- `QUALITY` src/system/operator-gui-channel-geometry.js:143 — comment cites `cef-interactive-forward.js:72-83`; that file no longer exists in src/ (stale reference).

## src/system/operator-gui-channel.js
- `RISK` src/system/operator-gui-channel.js:203-216 — `prevMax` defaults to `newMax` when `lastMaxLayerByChannel` has no entry (always true on the first apply after a node start; `ensureOperatorGuiChannel` also deletes it at :380). Caspar survives a node restart with its route layers 10..N still live, so a first apply with fewer cells than before the restart (project-load compose layout, or `clearOperatorGuiLayout` → `[]` from a client DELETE) never STOPs/CLEARs the stale upper layers. The file's own comment (:127) promises an `[]` apply "clears stale route layers"; with no `lastMax` it clears nothing. Fix: when unknown, sweep ROUTE_LAYER_START..ROUTE_LAYER_MAX once.
- `QUALITY` src/system/operator-gui-channel.js:317-323 — the JSDoc for `clearOperatorGuiLayout` is orphaned: it sits above the WO-319 comment for `getPersistedOperatorGuiLayout`, and `clearOperatorGuiLayout` (:342) has none.
- `DEAD` src/system/operator-gui-channel.js:456,458,460,463,464,468,469 — these exports are never read through this module: re-exports `ROUTE_LAYER_START`, `operatorGuiDestination` (atlas and video-surfaces import it from the geometry module), `resolveOperatorGuiMonitorRect`, `fractionRectToMonitorPx`, `fitAspectRectPx`, `computeAspectFitCellRect`, plus the own constant `APPLY_DEBOUNCE_MS` (baseline:554). grep: `git grep -n -w <name>` outside the two operator-gui-channel*.js files → no importer (the multi-line test destructurings in tools/smoke/smoke-wo243-*.test.js do not contain them).

## src/system/operator-gui-compose-persist.js
- `QUALITY` src/system/operator-gui-compose-persist.js:32 — `void persistProject(...)`: `persistProject` is synchronous (src/engine/project-scenes.js:229), the `void` suggests an async call and the surrounding try/catch is what actually handles failures. Harmless.

## src/system/operator-gui-media-layer.js
- `OK`

## src/system/operator-gui-source-cells.js
- `OK`

## src/system/operator-monitor-picker.js
- `RISK` src/system/operator-monitor-picker.js:383-388 — `child.stdin.write(...)` is inside try/catch, but a broken pipe is emitted as an async `'error'` on `child.stdin` (no listener) → uncaughtException → process exit if the python helper dies before reading (missing python3-xlib exits at import). Add `child.stdin.on('error', …)`.
- `QUALITY` src/system/operator-monitor-picker.js:408 — `log(verdict.run ? 'info' : 'info', …)`.
- `DEAD` src/system/operator-monitor-picker.js:456,467 — `PICKER_SCRIPT`, `promptForOutputViaX` exports unused outside (baseline:555-556).

## src/system/operator-snap-home.js
- `RISK` src/system/operator-snap-home.js:44-47 (+ scripts/setup/12-passwordless-sudo.sh:53, tools/runtime/highascg-operator-snap-home.sh) — sudoers grants `NOPASSWD: /usr/local/lib/highascg/highascg-operator-snap-home.sh` WITHOUT an argument pattern, which in sudoers means any arguments. The helper takes `$1` as `USER_HOME`, `chown -R <owner of $1>` on `$1/snap` when that dir is not owned by that user, and follows symlinks. Anyone running as casparcg (e.g. via an API RCE) can `mkdir /tmp/h; ln -s /etc /tmp/h/snap; sudo …snap-home.sh /tmp/h` and get `/etc` chowned to themselves. Not run (it would change system state); reasoned from the script. Fix: ignore `$1` (use the invoking user's home from `$SUDO_USER`) and refuse symlinks; or sudoers `… highascg-operator-snap-home.sh /home/casparcg`.
- `QUALITY` src/system/operator-snap-home.js:12 — second helper path `tools/runtime/…sh` is not an allowlisted sudo target, so it can never succeed under `sudo -n`.
- `DEAD` src/system/operator-snap-home.js:69 — `isSnapHomeWritable` export unused outside (baseline:557).

## src/system/pointer-confine.js
- `RISK` src/system/pointer-confine.js:237,298 — `confineProc = spawn('python3', …)` has no `'error'` listener (unclutter at :163-170 has one, with a comment explaining why). A missing/unexecutable python3 is an uncaughtException → exit(1) from the 8 s watchdog path.
- `RISK` src/system/pointer-confine.js:395-412 — `void startPointerConfine(...).then(...)` has no `.catch`; if `calculateLayoutPositions` throws (xrandr failure), `startInFlight` stays `true` forever and `resyncPointerConfineIfNeeded` (:441) returns false for the rest of the process life, so confine is never re-synced after a config change.
- `QUALITY` src/system/pointer-confine.js:294 — `tryPythonXgrabConfine(config, rect, env, log, opts, layout)`: `config`, `opts`, `layout` unused.
- `DEAD` src/system/pointer-confine.js:448 — `UNCLUTTER_IDLE_SEC` export unused outside (baseline:558).

## src/system/private-secrets-export.js
- `RISK` src/system/private-secrets-export.js:23-29 — the config.xml fallback of `readSyncthingDeviceId` can never work: Syncthing's config uses `<device id="…">` (`grep -c 'deviceID=' ~/.config/syncthing/config.xml` → 0, `grep -c '<device id=' …` → 10) and the path `~/.local/state/syncthing/config.xml` does not exist on this box (config is under `~/.config/syncthing`). Only the `syncthing --device-id` path works (it does, v1.29.5). If that binary is missing/slow the pairing export silently omits the id.
- `RISK` src/system/private-secrets-export.js:13,64,69 — three `execFileSync` calls (5 s + 4 s + 4 s timeouts) run on the event loop each time `exportSecretsToPrivateDir` is called (routes-replication-post.js:195, runPrivateVolumeSync).
- `QUALITY` src/system/private-secrets-export.js — name says "secrets" but nothing secret is exported (a public Syncthing device id, pairing manifest, Tailscale IP); README.txt:124 tells the owner the stick is "physical secret storage". Name/README overstate.
- `DEAD` src/system/private-secrets-export.js:133 — `buildReplicationPairingManifest` export unused outside (baseline:559).

## src/system/private-volume-sync.js
- `BUG` src/system/private-volume-sync.js:70-76 — same exFAT 10 ms mtime truncation as exfat-sync-fs.js: `mA === mB` is the only "unchanged" test, so after a host→stick copy the files differ by <10 ms and every `syncPrivateTree` pass copies again (`copied` is never 0). Fix together with exfat-sync-fs.
- `QUALITY` src/system/private-volume-sync.js:12 — redefines `REPO_ROOT` (`path.resolve(__dirname,'../..')`) although `../repo-paths` exists and every sibling uses it; the export `REPO_ROOT` (:264) then shadows it in any destructuring consumer.
- `QUALITY` src/system/private-volume-sync.js:84-90 — `syncPrivateTree` accepts `opts.boot` (doc :82) but never reads it; `assertUnderRoot(PRIVATE_HOST_ROOT, hostDir)` guards only this function, not `exportSecretsToPrivateDir` or the `pushOnly` branch (:188-195), and `sanitizeMachineId` (config/machine-identity.js:35) allows `..`.
- `DEAD` src/system/private-volume-sync.js:265-266 — `PRIVATE_HOST_ROOT`, `PRIVATE_VOLUME_DIR` exports unused outside (baseline:560-561).

## src/system/proc-stats.js
- `QUALITY` src/system/proc-stats.js:239-240 — `_lastSample` Map keyed by pid is never pruned (one entry per pid ever polled; Caspar restarts add one each). Negligible but unbounded.
- `QUALITY` src/system/proc-stats.js:196-212 — `MainPID` of casparcg-server.service is run.sh, so `isCasparBinaryProcess(mainPid)` is always false and every 5 s TTL expiry does a full `/proc` scan (reads `comm` of every pid). Walking children of MainPID would be cheaper.
- `DEAD` src/system/proc-stats.js:294,299-300,302 — `CASPAR_UNIT`, `readProcSampleSync`, `discoverCasparPid`, `_resetCachesForTest` exports unused outside (baseline:562-565).

## src/system/screen-consumer-placement.js
- `QUALITY` src/system/screen-consumer-placement.js:76 — the sandbox early return is `{ placed: 0, missing: 0, skipped: 'sandbox' }` while the documented/real result is `{ moved, alreadyCorrect, missing }`; no caller reads `placed`, so harmless today, but a caller reading `res.moved` gets `undefined`.
