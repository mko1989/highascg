# Codebase review 2026-08-03 — config generation, apply lifecycle, system, bootstrap

Read-only review wave (7 reviewers over the full repo), owner-requested full codebase review (todos03.08.26).
Scope: src/config, src/bootstrap, src/system, src/server, module-registry.js, repo-paths.js, app-context.js, root index.js, plus the apply-chain dependencies (src/api/routes-caspar-config.js, src/utils/full-config-apply.js, caspar-restart.js, atomic-file-write.js).

Verification status: findings #1, #2, #3 independently re-verified in source by the coordinating
session (load-catch → defaults at config-manager.js:170-174 + per-file swallow at :277-287;
unconditional bootPrefer copy at exfat-sync-fs.js:66-71; in-place `copyFileSync` at :40-45).
Findings #2/#3/#7 are the code-level mechanism behind the WO-415 incident — fixes should be
planned together with that WO's hardening options.

Skipped: operator-* window/geometry managers, ws-server internals, replication service, generator leaf-builder math beyond the escaping/allocation sweep.

### 1. [HIGH] Config load error is swallowed, then the next save() persists defaults over the operator's config

`src/config/config-manager.js:170-174` (outer catch) and `:277-287` (modular per-file catch):

```js
} catch (e) {
    this.logger.error(`[Config] Failed to load ${this.configPath}: ...`)
    this.config = finalizeScreenDestinationsConfig({ ...defaults })
    return this.config
}
```
and in `_loadModular`:
```js
} catch (e) {
    this.logger.error(`[Config] Failed to load ${filename}: ${e.message}`)
}
```

A torn or unparsable `device_graph.json` (or any modular file) leaves that key at compiled defaults, the app boots normally (`isLoaded = true`, no degraded flag), and the **very next `save()` writes the defaults back over the corrupt-but-recoverable file** — `_saveModular` writes every key unconditionally. Failure scenario: power loss / partial stick sync tears one JSON → box boots with default device graph (generated XML loses every output → off air), operator touches any setting in the UI → the real config is permanently destroyed with no backup taken. This is a corruption *amplifier* squarely in the WO-415 shape: nothing quarantines a file that failed to parse before overwriting it.

### 2. [HIGH] Boot exFAT pull copies volume → project with no staleness guard at all

`src/system/exfat-sync-fs.js:66-71`:

```js
if (bootPreferExfat && hasA) {
    if (blockExfatToProject) return { copied: 0, skipped: 1 }
    if (dryRun) return { copied: 1, skipped: 0 }
    copyFilePreserveTimes(pathExfat, pathProject)
    return { copied: 1, skipped: 0 }
}
```

Every other branch in `syncOneFilePair` mtime-compares; the boot branch copies unconditionally — even when the project file is **newer** than the volume copy. All config pairs in the live map (`usb-modular-config`, `bridge-modular-config`, …) carry `bootPrefer: "exfat"`, and the boot CLI (`tools/runtime/exfat-sync-cli.js --boot`) runs before the app. There is no build-stamp, version, or mtime check anywhere on this path. Failure scenario: a stick that missed the last saves (unplugged during a save, written by another box, or carrying a torn file from an unclean yank — exFAT has no journaling) silently reverts or corrupts `config/*.json` at every boot. This is the concrete code-level answer to "what prevents a stale stick from overwriting live config": nothing. (WO-415 is the live incident.)

### 3. [HIGH] exFAT sync writes live config files non-atomically (in-place copy, no tmp+rename)

`src/system/exfat-sync-fs.js:40-45`:

```js
function copyFilePreserveTimes(src, dst) {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
    const st = fs.statSync(src)
    fs.utimesSync(dst, st.atime, st.mtime)
}
```

`copyFileSync` truncates and rewrites the destination in place. This is the only writer of `config/*.json` that bypasses the WO-161 tmp+rename discipline (`ConfigManager._atomicWrite`, `atomicWriteFile` both do it right). A crash, power cut, or stick unmount mid-copy leaves a truncated modular config file on the **live** side (volume→project direction at boot / mtime-win) — which then feeds directly into finding #1's defaults-wipe on the next save. Same hazard in the push direction: a yanked stick keeps a torn file that finding #2 pulls back over live config next boot.

### 4. [MED] No mutex on the full apply chain; `_fullApplyInProgress` is cleared by whichever apply finishes first

`src/api/routes-caspar-config.js:184` and `:204-206`:

```js
ctx._fullApplyInProgress = true
try { fullApply = await applyFullServerConfig(ctx, {...}) }
...
} finally { delete ctx._fullApplyInProgress }
```

Only the XML *write* is serialized (`casparXmlWriteChain`); `applyFullServerConfig` itself (nodm restart, xrandr, AMCP RESTART, kill scripts, systemd restart) is not. A double-clicked Apply (or UI apply racing device-view apply) runs two full restart sequences interleaved — two `killStuckCasparMainProcess` / `restartCasparViaSystemd` invocations fighting run.sh's relaunch, extending off-air time or leaving Caspar down with both waiters timed out. Worse, the boolean flag is shared: the first apply's `finally` deletes it while the second is mid-restart, which re-arms the AMCP watchdog (`caspar-amcp-watchdog.js:73` gates on this flag) and re-enables `emitChange` on saves during the still-running apply.

### 5. [MED] `server-update.js` download: unhandled stream errors crash the process; a stalled download wedges the update job forever

`src/system/server-update.js:213-227`:

```js
https.get(fetchUrl, { timeout: 120000 }, (res) => {
    ...
    res.pipe(file)
    file.on('finish', () => file.close(resolve))
}).on('error', reject)
```

Two defects: (a) neither `res` nor `file` has an `'error'` listener — a TCP reset mid-download or ENOSPC on `/var/cache` emits `'error'` on a stream with no handler → `uncaughtException` → `process-guards.js` calls `process.exit(1)`, killing HighAsCG on a live box. (b) The `timeout` option arms the socket idle timer but no `'timeout'` handler destroys the request, so a stalled (not errored) download never settles the promise; the module-global `applyJob` stays `done: false` and `startApplyJob` throws `'Update already in progress'` (line 261-263) until the process is restarted.

### 6. [MED] Save-dedupe cache is poisoned by `emitChange: false` saves — a following identical save silently drops its `change` event

`src/config/config-manager.js:220-232`:

```js
if (dedupeMs > 0 && payloadJson === this._lastConfigChangeJson && now - this._lastConfigChangeAt < dedupeMs) {
    return true
}
this._lastConfigChangeJson = payloadJson
this._lastConfigChangeAt = now
if (opts.emitChange !== false) { this.emit('change', this.config) ... }
```

The dedupe cache is written *before* the `emitChange` check, so a suppressed-emit save (used throughout the full-apply path, migrations, WO-412 flag persist) records the payload without ever emitting. An identical `save()` with `emitChange: true` inside the 300 ms window then returns at the dedupe gate — the change event that was *never delivered* is now deduped away: no subsystem recycle, no `syncRuntimeConfigFromManager`, no exfat push. The dedupe should only suppress payloads whose `change` was actually emitted.

### 7. [MED] `pushProjectConfigToExfat` runs un-debounced on every save, copies every file unconditionally, with sync fs on the event loop

`src/system/exfat-sync-on-save.js:26`:

```js
void pushProjectConfigToExfat({ log: logFn }).catch(() => {})
```

This immediate push sits *outside* the debounce (only `runExfatSync` is debounced/`inFlight`-guarded). Every `ConfigManager.save()` — and saves happen in bursts during applies — walks all pushOnSave pairs and `copyFileSync`s **every** file regardless of mtime (`exfat-sync.js:111,132` — no comparison in the push path). `statSync`/`copyFileSync` against a slow or half-dying exFAT stick block the Node event loop mid-show (WS, OSC, timeline all stall), and the bare `.catch(() => {})` swallows every failure, so a stick that stopped accepting writes is invisible until the stale-stick boot pull (#2) bites.

### 8. [LOW] Runtime `factoryReset()` deletes `config/exfat-sync.json` despite the manifest declaring it preserved

`src/config/config-manager.js:413-416`:

```js
const files = fs.readdirSync(this.configPath)
for (const f of files) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(this.configPath, f))
}
```

`factory-defaults-manifest.js:26` says `PRESERVE_JSON = new Set(['casparcg.config.iso', 'exfat-sync.json'])` ("never wiped by factory reset"), but only the ISO tooling consults it — the runtime Nuclear-tab reset unlinks every `.json` indiscriminately, including the sync map. Mitigated on this box because `/etc/highascg/exfat-sync.json` exists (earlier candidate in `mapCandidatePaths`), but any box relying on the repo-default map location loses all durable-config sync silently ("no map") after a factory reset.

### 9. [LOW] `_saveModular` never deletes stale per-key files — removed keys resurrect on next load

`src/config/config-manager.js:312-319`: keys with `config[key] !== undefined` are written; a key deleted from the in-memory config is simply not written, but its old `<key>.json` remains on disk and `_loadModular` re-merges it at the next boot. A deliberately removed section (e.g. clearing `tandemTopology` or a retired modular key) comes back from the dead after restart, and the exfat push (#7) then propagates the zombie to bridge/stick.

### 10. [LOW] Boot logs the entire effective config as JSON into the client-visible log buffer

`index.js:101`:

```js
logger.info('Config: ' + JSON.stringify(config, null, 2))
```

This lands in `logBuffer`, which is broadcast to every WS client as `log_line` (index.js:317-327) and served by the logs API — including `rtmp.destinations` stream keys, the `security` section (`apiToken` when persisted in config), and the nuclear-password scrypt hash. Any UI client can read broadcast credentials from the log pane.

---

**Overall health:** The apply chain proper is in good shape — the WO-161 atomic-write work is real and consistently applied (`ConfigManager._atomicWrite`, `atomicWriteFile` for the XML, tmp+`sudo install` for apply-layout.sh), the XML generator escapes user strings everywhere checked (RTMP args, ALSA device names, NDI names, labels), the placeholder-channel mechanism prevents channel-index misalignment, and process management (`caspar-restart.js`, AMCP watchdog) uses `execFile` with array args, timeouts, and settle-polls throughout. The systemic weakness is concentrated in the **config durability layer**: load-time error handling that converts recoverable corruption into permanent default-wipes (#1), and the exFAT sync subsystem, which is the one writer in the tree that ignores both the atomic-write discipline and any staleness guard (#2, #3, #7) — together these three form a complete, plausible mechanism for exactly the kind of config clobbering WO-415 describes, and they are where hardening effort should go first.
