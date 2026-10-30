# tools/smoke — sweep 29.10.2026 (batch 125)

Files: 64 · lines: 6881 · findings: 0 BUG-HIGH, 0 BUG, 24 DEAD, 7 RISK, 19 QUALITY

## tools/smoke/smoke-preview-mixer-nudge.test.js
- `QUALITY` tools/smoke/smoke-preview-mixer-nudge.test.js:195-203 — the `getResolvedFillForSceneLayer` stub (also 273-281) never reaches the code under test. `src/api/routes-preview-nudge.js:30` destructures the function at require time, and the test requires that module at line 11 before it patches the `scene-native-fill` export, so the real fill runs (`routes-preview-nudge.js:214`). The "Mock getResolvedFillForSceneLayer" comment is false. Fix: call through the module object in routes-preview-nudge.js, or re-require after patching.
- `QUALITY` tools/smoke/smoke-preview-mixer-nudge.test.js:144 — test 3 restores `persistence.set(KEY, prev)` with no try/finally; a failing assert leaves the staged look in place for later tests in the same process.
## tools/smoke/smoke-preview-push-import.test.js
- `OK`
## tools/smoke/smoke-preview-snapshot-restart.test.js
- `DEAD` tools/smoke/smoke-preview-snapshot-restart.test.js:1 — not referenced in tools/ci, package.json or .github (`rg -n smoke-preview-snapshot-restart tools/ci package.json .github` → none). Only the manual `test:ci:full` collects it.
- `QUALITY` tools/smoke/smoke-preview-snapshot-restart.test.js:38-43 — `contentUnchanged` is a local copy of the inline gate at `client/lib/scenes-preview-push-scene.js:294`, not an import. A change to the production gate cannot fail this file. Fix: export the gate from the client lib and import it.
## tools/smoke/smoke-private-volume-sync.js
- `RISK` tools/smoke/smoke-private-volume-sync.js:23 — `hostPrivateDir()` resolves to `REPO_ROOT/.private` (`src/system/private-volume-sync.js:13`), not a temp dir, so the test writes `smoke-test-<ts>` into the live repo. `.stignore:104` ignores only `/.private/api-token`, so that directory can sync to peers. The cleanup at line 33 is also skipped when an assertion fails. Fix: make the root overridable and point the test at a temp dir.
## tools/smoke/smoke-proc-stats.test.js
- `QUALITY` tools/smoke/smoke-proc-stats.test.js:96-119 — the three "CPU normalization" tests recompute `Math.round((x / cores) * 10) / 10` inline and never call production code. They cannot fail when the real normalization changes. Fix: test the production helper, or delete.
## tools/smoke/smoke-project-fps-network.test.js
- `OK`
## tools/smoke/smoke-project-hardware-config.test.js
- `OK`
## tools/smoke/smoke-project-hardware-mismatch-identity.test.js
- `OK`
## tools/smoke/smoke-project-hot-backup.test.js
- `OK`
## tools/smoke/smoke-project-load-activation.test.js
- `QUALITY` tools/smoke/smoke-project-load-activation.test.js:196 — `_liveSceneStateStub: null` is set on the ctx and read nowhere (the test passes `_liveSceneState` in the options object). Dead fixture property; delete.
## tools/smoke/smoke-project-media-gather.mjs
- `DEAD` tools/smoke/smoke-project-media-gather.mjs:1 — standalone script with no reference anywhere (`rg -n smoke-project-media-gather --glob '!work/**' .` → only itself) and not in tools/ci, package.json or .github. Not collected by any runner. The `__test` export it uses (`client/lib/project-media-gather.js:337`) is live; this harness is not.
## tools/smoke/smoke-project-media-root.test.js
- `OK`
## tools/smoke/smoke-project-pipeline-hardening.test.js
- `QUALITY` tools/smoke/smoke-project-pipeline-hardening.test.js:58-62 — the `after()` cleanup builds an unlink path by slicing `ent`, regex-replacing and concatenating it. That path is never the quarantine file, and the error is swallowed. The real cleanup is the loop at 64-68. Fix: delete the first branch.
- `QUALITY` tools/smoke/smoke-project-pipeline-hardening.test.js:161-172 — the tombstone fixture (`__wo106_tomb_*`) is removed only after its assertions pass; a failing assert leaks it. Fix: move the cleanup into a finally.
## tools/smoke/smoke-project-scenes.test.js
- `DEAD` tools/smoke/smoke-project-scenes.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
- `QUALITY` tools/smoke/smoke-project-scenes.test.js:136-155 — the backfill test calls `t.skip` when the active project has no look with layer content. CI has no active project, so the assertion never runs there and the skip is silent. Fix: use a fixture project in a temp projects dir.
- `QUALITY` tools/smoke/smoke-project-scenes.test.js:116-117 — `SCENE_DECK_SYNC_DEBOUNCE_MS >= 0` and `typeof flushDeckSyncPersist === 'function'` cannot fail for any realistic regression.
## tools/smoke/smoke-project-store.test.js
- `DEAD` tools/smoke/smoke-project-store.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-project-volume-sync.test.js
- `DEAD` tools/smoke/smoke-project-volume-sync.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
- `QUALITY` tools/smoke/smoke-project-volume-sync.test.js:46-52 — the "autosave pull targets one slug path only" test builds its path from the constant `'my_show'`, so `doesNotMatch(/other_show/)` cannot fail. It re-joins `AUTOSAVE_SUBDIR` and never calls the pull code.
## tools/smoke/smoke-release-package-bump.test.js
- `DEAD` tools/smoke/smoke-release-package-bump.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-replication-amcp-fanout.js
- `OK`
## tools/smoke/smoke-replication-caspar-output.js
- `QUALITY` tools/smoke/smoke-replication-caspar-output.js:60-61 — the test re-destructures `assessFollowerCasparOutputReadiness` (already imported at line 8). Harmless, but it misleads readers about which binding is under test. Delete the duplicate.
## tools/smoke/smoke-replication-chaos-ws.test.js
- `DEAD` tools/smoke/smoke-replication-chaos-ws.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
- `RISK` tools/smoke/smoke-replication-chaos-ws.test.js:112-138 — real-time waits (`waitFor` timeouts of 2–5 s, backoff 40/300 ms) with exact-count asserts (`peerWsReconnects === 10` at 137, `lastPeerLiveSeq === 11` at 138). A loaded host can fail it with no regression. No failing case shown.
## tools/smoke/smoke-replication-failover.js
- `RISK` tools/smoke/smoke-replication-failover.js:16 — `mockCtx` points the peer at `127.0.0.1:4200` with token `'tok'`. The first test (line 43) calls `promoteToLeader` without `skipYieldNotify`, and `src/replication/promote.js:41` then POSTs `/api/replication/leader-yield` to the live API on :4200. The route rejects a bad token with 401 (`src/api/routes-replication-post.js:213-215`), so no state change is expected, but the test still makes a request to the live box. Fix: pass `skipYieldNotify: true`, or point the peer at a port with no server.
- `QUALITY` tools/smoke/smoke-replication-failover.js:66-73 — "lower epoch leader yields" asserts `peerEpoch > localEpoch` on two local constants and never calls production code.
## tools/smoke/smoke-replication-follower-profile.js
- `OK`
## tools/smoke/smoke-replication-handshake.test.js
- `RISK` tools/smoke/smoke-replication-handshake.test.js:22 and :65 — `ensureDeviceIdentity()` uses `config/device-identity.json` unless `HIGHASCG_DEVICE_IDENTITY_PATH` is set (`src/system/device-identity.js:9-11`), and it writes a new identity when the file is missing. On a fresh checkout this test mints the live box's signing key. Fix: set `HIGHASCG_DEVICE_IDENTITY_PATH` to a temp path at the top of the file.
- `QUALITY` tools/smoke/smoke-replication-handshake.test.js:19-23 — `identityPath` is written inside a temp dir that nothing reads (the production call uses the real identity). The temp dir is never removed. Dead setup.
## tools/smoke/smoke-replication-livestate.js
- `QUALITY` tools/smoke/smoke-replication-livestate.js:23-29 and 66-67 — `persistence.get` is monkeypatched and restored with no try/finally, so a failing assert leaves the stub installed for the rest of the process.
## tools/smoke/smoke-replication-mirror-apply.js
- `OK`
## tools/smoke/smoke-replication-pair-token.test.js
- `OK`
## tools/smoke/smoke-replication-parity-gate.test.js
- `DEAD` tools/smoke/smoke-replication-parity-gate.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-replication-playhead-correction.test.js
- `DEAD` tools/smoke/smoke-replication-playhead-correction.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-replication-playhead-sync.js
- `OK`
## tools/smoke/smoke-replication-project-push-debounce.test.js
- `OK`
## tools/smoke/smoke-replication-project-receive.test.js
- `DEAD` tools/smoke/smoke-replication-project-receive.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
- `QUALITY` tools/smoke/smoke-replication-project-receive.test.js:11-74 — the header says it "mirrors receiveProjectFromPeer", but it calls only `config-classify` helpers. The real `receiveProjectFromPeer` (`src/replication/replicate-projects.js:113`) is never invoked, so a regression in that path is not caught.
## tools/smoke/smoke-replication-reconcile.js
- `QUALITY` tools/smoke/smoke-replication-reconcile.js:9-11 — `typeof === 'function'` checks only. They pass even if the functions throw when used.
## tools/smoke/smoke-replication-role.js
- `OK`
## tools/smoke/smoke-replication-scene-lookup.js
- `OK`
## tools/smoke/smoke-replication-show-authority.test.js
- `DEAD` tools/smoke/smoke-replication-show-authority.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-replication-showdata.js
- `OK`
## tools/smoke/smoke-replication-ssh-setup.test.js
- `RISK` tools/smoke/smoke-replication-ssh-setup.test.js:117-130 — runs the real forced-command wrapper (`tools/runtime/highascg-replication-ssh.sh`) with `HIGHASCG_REPO_ROOT=/home/casparcg/highascg` (line 122) and a valid `rsync --server … media/projects/demo/` command. The wrapper execs rsync with that relative destination in the spawn cwd, which is the repo root under npm, so the run can create `media/projects/demo/` in the live tree. Fix: use a temp repo root.
- `QUALITY` tools/smoke/smoke-replication-ssh-setup.test.js:129 — the only assertion is `doesNotMatch(stderr, /forbidden command|path not under|disallowed path/)`. It passes on any exit status, including the 2 s timeout at line 127, so it proves nothing about acceptance.
## tools/smoke/smoke-replication-sync-clock.js
- `OK`
## tools/smoke/smoke-replication-ui-notify.js
- `DEAD` tools/smoke/smoke-replication-ui-notify.js:1 — not referenced in tools/ci, package.json or .github, and not a `.test.js`, so no runner collects it.
## tools/smoke/smoke-route-self-loop-guard.test.js
- `DEAD` tools/smoke/smoke-route-self-loop-guard.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-scene-exit-orphans.test.js
- `DEAD` tools/smoke/smoke-scene-exit-orphans.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-scene-layer-rotation-amcp.test.js
- `DEAD` tools/smoke/smoke-scene-layer-rotation-amcp.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-scene-live-main-sync.test.js
- `DEAD` tools/smoke/smoke-scene-live-main-sync.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-scene-live-preview-register.test.js
- `QUALITY` tools/smoke/smoke-scene-live-preview-register.test.js:12-46 — `persistence.set(KEY, …)` is restored at line 46 with no try/finally, so a failing assert leaves the fake `liveScenesByProgramChannel` entry in place.
- `RISK` tools/smoke/smoke-scene-live-preview-register.test.js:13 — `persistence.set` writes the real state file unless the process runs under `node --test`. `src/utils/persistence.js:16-20` picks a temp file only when `NODE_TEST_CONTEXT` is set. Run directly (`node tools/smoke/…`), the fake scene goes to `.highascg-state.json`, and `liveScenesByProgramChannel` is an immediate-flush key (`persistence.js:35-36`). Run it only through `node --test`.
## tools/smoke/smoke-scene-native-fill-template.test.js
- `DEAD` tools/smoke/smoke-scene-native-fill-template.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-scene-relative-seek-in-point.test.js
- `OK`
## tools/smoke/smoke-scene-route-deps.js
- `OK`
## tools/smoke/smoke-scene-take-pgm-only.test.js
- `OK`
## tools/smoke/smoke-scene-take.js
- `DEAD` tools/smoke/smoke-scene-take.js:1 — not referenced in tools/ci, package.json or .github, and not a `.test.js`, so no runner collects it. The usage path in the header (`node tools/smoke-scene-take.js`, line 6) is stale.
- `RISK` tools/smoke/smoke-scene-take.js:17 and :57 — POSTs `/api/scene/take` with `forceCut: true` on channel 1 to the live API (127.0.0.1:4200), using a hard-coded scene id and clip (lines 39-54). Run on the box, it takes program live. Fix: delete it, or gate it behind an explicit opt-in env var.
## tools/smoke/smoke-scene-template-cg-crossfade.test.js
- `OK`
## tools/smoke/smoke-scene-template-cg-fadeout.test.js
- `OK`
## tools/smoke/smoke-scene-template-cg.test.js
- `DEAD` tools/smoke/smoke-scene-template-cg.test.js:1 — not referenced in tools/ci, package.json or .github (the `smoke-scene-template-cg` in the curated list is the `-crossfade`/`-fadeout` siblings). Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-scene-timeline-start.test.js
- `DEAD` tools/smoke/smoke-scene-timeline-start.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-scenes-compose-crop-drag.test.js
- `OK`
## tools/smoke/smoke-scenes-compose-edge-resize.test.js
- `OK`
## tools/smoke/smoke-screen-consumer-placement.test.js
- `OK`
## tools/smoke/smoke-screen-consumer-port-resolve.test.js
- `OK`
## tools/smoke/smoke-security-headers.test.js
- `OK`
## tools/smoke/smoke-server-update-retain.test.js
- `DEAD` tools/smoke/smoke-server-update-retain.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
- `QUALITY` tools/smoke/smoke-server-update-retain.test.js:35, 66, 105 — three `mkdtempSync` roots per run, none removed, so each run leaves `ha-drop-*` directories in the tmp dir. Fix: `rmSync` each in a finally.
## tools/smoke/smoke-settings-nuclear-password-dom.mjs
- `DEAD` tools/smoke/smoke-settings-nuclear-password-dom.mjs:1 — not in tools/ci, package.json or .github. Only `eslint.config.js` and `tools/ci/collect-offline-tests.js:27` (EXCLUDE_NAME) mention it, so the full gate excludes it as well. Needs headless Chrome.
## tools/smoke/smoke-settings-nuclear-password.test.js
- `OK`
## tools/smoke/smoke-shader-alpha-and-audio-binding.test.js
- `OK`
## tools/smoke/smoke-state-monitor-health-reconcile.test.js
- `DEAD` tools/smoke/smoke-state-monitor-health-reconcile.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
## tools/smoke/smoke-straight-alpha-keyer.test.js
- `DEAD` tools/smoke/smoke-straight-alpha-keyer.test.js:1 — not referenced in tools/ci, package.json or .github. Only the manual `test:ci:full` collects it.
