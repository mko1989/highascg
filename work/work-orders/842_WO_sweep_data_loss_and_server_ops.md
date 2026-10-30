# WO-842 — Sweep: data loss, replication boot and server-side ops bugs

**Area:** network, devices-config
**Status: DONE (30.10, offline: 3 new smokes 26 tests + affected suites; nothing probed on the live box, nothing restarted)**
**Source:** code sweep 29.10 (`work/sweep-29.10.2026/REPORT.md` §4e, 4g–4l, §5 Replication + Ops scripts); owner 30.10
*"there are a lot of bugs to fix… continue what wasnt finished in the sweep"*.

Items: 4e replication boot reload no-op + leaderYield role not persisted; 4g project rename onto an existing slug
overwrites it; 4h deleting the last look never persists; 4i unparsable general.json not quarantined; 4j
atomic-file-write fixed `.tmp` name; 4k dev-push.sh remote cleanup deletes data/.private/projects; 4l non-standard
multiview emits `<video-mode>custom</video-mode>` with no custom mode. §5 Replication: timeline id traversal,
connectToLeader saves follower config before the leader answers, playhead export SEEK 2000 vs 1000 @25 fps. §5 Ops:
exFAT late-plug pipeline, DeckLink install "ok" on failed dpkg, flash-stick exFAT format failure as success, Caspar
supervisor crash-loop give-up never fires, tailscale-up `--hostname 0`, power button listener picks Sleep. §7e
`tools/sweep/sweep-util.js` request never settles; `tools/wiki/md-to-html.js` escaped code in link labels.


## 1. Investigation

Every item was re-read against the code (reproduced where marked). No earlier WO constrained these paths except
WO-311/329 (the `empty_over_nonempty` anti-wipe guard, which 4h must not break).

| Item | Real? | Evidence |
|---|---|---|
| 4e boot reload no-op | YES, reproduced by test | `replication-service.js` called `reloadReplicationFromConfig(ctx)` before `ctx._replication = runtime` / `setReplicationRuntime`; the reload starts with `getReplicationRuntime(ctx)` -> null -> `{ok:false, 'runtime not started'}`. `peerClient.start()` never ran at boot. |
| 4e leaderYield / demote role not persisted | YES | `promote.js` `leaderYield` saved epoch + `leaderAvailable:false` but left `role:'leader'`; `demoteToFollower` saved nothing. `reloadReplicationFromConfig` re-derives the role from config -> old leader is leader again, same epoch so peer-client never demotes it. Also `demoteToFollower` called `syncPeerCasparConnection` BEFORE `forceRole('follower')`, recreating the leader fan-out it meant to tear down. |
| 4g rename onto existing slug | YES | `routes-data-project-handlers.js` rename: no check that `toSlug` is free; `persistProject` writes `<toSlug>.json`. Reproduced by test (409 now). |
| 4h last look never persists | YES, but the sweep's suggested fix is incomplete | `applyDeckSyncToProject` treated `[]` as absent (`snapRaw.length`). Just using `Array.isArray` is NOT enough: `validateIncomingProject` then rejects `empty_over_nonempty` (WO-311/329 guard, also on `/api/project/autosave`), so the delete would still not persist. Today's half-state: the live deck is emptied (`applyLiveSceneDeckToCtx`) while the file keeps the look -> `buildSceneDeckForApi` falls back to the project and the look comes back, and after restart. |
| 4i general.json not quarantined | YES | `config-manager.js` `_loadModular`: the `general.json` catch only logged; every other modular file calls `_quarantineCorruptFile`. Next `save()` rewrote general.json from defaults (about 60 keys). |
| 4j fixed `.tmp` name | YES, reproduced | `Promise.allSettled([atomicWriteFile(f,A), atomicWriteFile(f,B)])` -> second rejects ENOENT. `ConfigManager._atomicWrite` and the monolithic save had the same fixed `.tmp`. |
| 4k dev-push cleanup | YES | `find … ! -name <short keep list> -exec rm -rf` removed `data/`, `.private/`, `projects/`, `log/`, `applied/` on the target. Worse: the tarball DID carry the source's `.private/` and `projects/`, which then overlaid the target's api-token / projects on extract. |
| 4l custom multiview mode | YES, reproduced | 1728x960 destination -> `<video-mode>custom</video-mode>` on the multiview channel, `<video-modes/>` empty, screen consumer 1920x1080. Cause: `config-generator-channel-plan.js` resolved `custom` via `getModeDimensions(mode, config, <caspar channel number>)` (reads `screen_<ch>_custom_*`), and `buildMultiviewChannel` wrote the RAW mode string. |
| §5 timeline id traversal | YES | `replicate-timelines.js` `path.join(TIMELINES_DIR, `${id}.json`)` with an unchecked body id (write and `deleted:true` unlink). |
| §5 connectToLeader | YES | pre-save of the follower config (intentional: leader pushes during pairing) was never rolled back on register failure / handshake failure. |
| §5 playhead export fps | YES | `exportLayersFromOsc` read `chan.framerate`, which OSC snapshots do not have (`format` = `1080p2500`) -> always 50. |
| Ops: exFAT late plug | YES | `highascg-exfat-arrive.sh` checked `mountpoint` right after `systemctl start --no-block`. |
| Ops: DeckLink "ok" on failed dpkg | YES | `decklink_install_vendor_pair` is called under `if`, which disables `set -e`; the retry `dpkg -i` failure fell through to `return 0`. |
| Ops: flash-stick rc | YES, reproduced against HEAD (`rc=0` with `mkfs.exfat` exiting 3) | `rc=$?` after the closing `fi`. |
| Ops: supervisor give-up | YES, reproduced against HEAD with a fake clock (61 crashes, never gives up) | state stamped at exit, then a sleep up to 120 s = the 120 s window. |
| Ops: tailscale `--hostname 0` | YES | `read -r HOSTNAME ACCEPT_ROUTES` on `print(hostname, accept)` collapses a blank hostname. |
| Ops: power button | YES | `evtest --query … KEY_POWER` = "is pressed now", rc 0 for any readable device. Live sysfs confirms the capability words: event0 `4000 0 0` (Sleep), event1 `8000 10000000000000 0` (bit 116). |
| 7e sweep-util | YES, reproduced | a response aborted mid-body fires on `res`, never `end`; the socket-idle `timeout` does not cover a drip-fed body. |
| 7e md-to-html | YES | code span turned into `<code>` first, then the link label was `escapeHtml`'d again. |

## 2. What was done

- `src/replication/replication-service.js`: `ctx._replication` + `setReplicationRuntime` now set BEFORE the boot reload (4e).
- `src/replication/promote.js`: `persistReplication()` helper; `leaderYield` persists `role:'follower'`; `demoteToFollower` persists
  `role:'follower'` and adopts `max(local, peer)` epoch (so a later promote mints an epoch above the peer's) and tears the
  fan-out down after the role change (4e).
- `src/replication/connect-pair.js`: `connectToLeader` snapshots the previous slice and role; `rollbackPreSave()` on register failure and
  handshake failure (config, forced role, reload).
- `src/replication/replicate-timelines.js`: ids must match `^[A-Za-z0-9_-]{1,128}$` (the engine's ids are `tl` + base36).
- `src/replication/playhead-export.js`: `oscChannelFps()` from `format` (interlaced names the field rate -> /200).
- `src/api/routes-data-project-handlers.js`: rename answers 409 when the target slug exists (or the name gives no slug).
- `src/engine/project-scenes.js` (4h): `[]` is an empty deck, and the deck-sync guard is `validateIncomingProject(..., {allowReplace: data.allowEmpty === true})`.
  The anti-wipe guard stays: a bare empty deck is now refused WHOLE (warn line, live deck not emptied), so disk and live
  state agree. An explicit `allowEmpty: true` on the `scene_deck_sync` payload persists the deletion.
  **Needs a client change (out of scope): `client/lib/app-scene-deck.js` `buildSceneDeckPayload` and
  `godot/client/core/project_sync.gd` `build_deck_payload` must send `allowEmpty: true` when the user deleted the last look.**
  Not done server-side only because "empty deck from a synced client" cannot be told from a New-Project / stale-tab reset.
- `src/config/config-manager.js`: general.json parse failure -> `_quarantineCorruptFile` (renamed `general.json.corrupt-<ts>`, logged as error);
  `_atomicWrite` and the monolithic save use `atomicWriteFileSync`.
- `src/utils/atomic-file-write.js`: `uniqueTmpPath()` (pid + random), `atomicWriteFileSync()`; API unchanged.
- `scripts/deploy/dev-push.sh`: the remote cleanup removes only the top-level names that are IN the tarball (derived with `tar tzf`, validated
  charset), never one of a PROTECTED list (config data .private projects applied log media _media bin lib cef-cache node_modules .env …);
  `./.private ./projects ./applied` are excluded from the tarball; `DEPLOY_PATH` must be absolute and 2+ levels deep.
- `src/config/config-generator-multiview-mode.js` (new) `multiviewModeDimensions(config, n)`: per-output mode and `multiview_<n>_custom_*`
  / `multiview_custom_*` through the one `getModeDimensions` rule (aliases, WO-484 standard-equivalent, minted `WxH` id);
  used by `config-generator-channel-plan.js` (plan + `pushCustomMode` registration) and `config-generator-consumer-attach.js`
  (`<video-mode>` is `dims.modeId`, `mvStd = !dims.isCustom`, which also fixes the alias-as-custom quality note).
- `scripts/exfat/highascg-exfat-arrive.sh`: polls `mountpoint` up to 15 s (env `HIGHASCG_EXFAT_ARRIVE_MOUNT_WAIT_SEC`); `HIGHASCG_EXFAT_MP` / `HIGHASCG_EXFAT_LABEL_NODE` overrides for tests.
- `scripts/lib/decklink-install-lib.sh`: single `dpkg -i` array, explicit `return 1` (and tmp-dir cleanup) when the retry fails.
- `tools/eggs/live-usb/flash-stick-common.sh`: `rc=$?` captured in the `else`.
- `tools/runtime/casparcg-supervisor-lib.sh`: state re-stamped after the back-off sleep (gap = how long Caspar ran).
- `tools/runtime/highascg-tailscale-up.sh`: python prints one value per line, read with `mapfile`.
- `tools/runtime/highascg-power-button-listen.sh`: `_event_has_key_power` tests the sysfs capability bit of `KEY_CODE` (`HIGHASCG_INPUT_SYSFS` override for tests).
- `tools/sweep/sweep-util.js`: `request()` settles once; `res` error/aborted/close-before-complete and a hard overall deadline.
- `tools/wiki/md-to-html.js`: code spans lifted out first and restored last (label no longer double-escaped; `*` inside code no longer becomes `<em>`).

Not done / for the coordinator:
- Installed copies of the runtime scripts (`/usr/local/lib/highascg/highascg-tailscale-up.sh`, power-button listener, supervisor lib via run.sh,
  exfat-arrive, decklink lib) are refreshed by their installers / the next update; nothing was copied by hand.
- `src/system/sweep-after-update.js` spawns the sweep with no timeout (second half of the 7e finding): add `timeout` to the `spawn` options (out of scope).
- `src/config/decklink-output-resolve-feed.js:22` `feedFromMultiviewConfig` has the same custom-lookup bug (`getModeDimensions(mode, config, 1)`): use `multiviewModeDimensions` (out of scope).
- `build-caspar-generator-config-screens.js:133` multiview destination alias (`720p60`) is not normalized (separate sweep item, not in WO-842).
- `docs/wiki-site` is stale (83 vs 91 pages); `node tools/wiki/build-wiki.js` regenerates it (not run: tracked output outside scope).
- Skipped as outside the WO list: `highascg-exfat-arrive.sh` `rm -rf $EXFAT_MP/sim` on any HIGHASCGEXF stick, `install.sh` 26.04 package names, `diagnose-screen-consumers.sh`.

## 3. Verified

Offline only (no restart, no AMCP, no live API write, no live config/projects touched; all fixtures in temp dirs, scripts run against stubs).
- New: `tools/smoke/smoke-wo842-replication.test.js` (6), `tools/smoke/smoke-wo842-data-and-config.test.js` (6), `tools/smoke/smoke-wo842-ops-scripts.test.js` (9) - 21 tests, all pass.
- Fails on the old code (checked): supervisor (HEAD lib: 61 crashes, no give-up), flash-stick (HEAD: `rc=0` after failed mkfs); sweep-util hang, custom multiview XML,
  and the atomic-write ENOENT were reproduced with scratch scripts before the fix. The replication / rename / quarantine / dev-push / arrive / tailscale / power-button
  tests were written against the new code only (the old behaviour is described by the reading above), not run against HEAD.
- Regression: replication smokes, `smoke-config-generator-routing*`, `smoke-config-lifecycle-wo161`, `smoke-wiki`, `smoke-wo400-*`, `smoke-wo805-*`, deck-sync / project-scenes / wo329 / wo311 / wo824
  suites: 231 of 235 pass; the 4 failures are in `smoke-decklink-output-resolve.js` (2160p `<pixel-format>yuv</pixel-format>` missing) and
  reproduce on `buildDecklinkKeyFillConsumersXml` alone, a file this WO did not touch.
- `bash -n` on all edited shell, `sh -n` on the supervisor lib, eslint clean on every edited file (only pre-existing unused-import warnings), `check-max-file-lines` 0 over.
- Owner-QA / box: none done. After deploy: watch `[replication]` journal lines after a restart on a paired box (peer client should now start at boot).
