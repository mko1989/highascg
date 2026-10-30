# WO-831 — Dead code removal (sweep §6)

**Status: OPEN (30.10)**
**Source:** REPORT §6 and the per-batch DEAD findings. Owner 30.10: *"delete anything dead."*
**Related:** WO-807 (deprecated `src/sampling`), WO-495, WO-273.

Each row of §6 is re-proven dead by grep (client, src, godot, tools, scripts, CI, string-concat requires, npm scripts)
before deletion, and the offline suite runs after each row. Smoke-pinned text is live unless the pin only guards the dead
file itself, in which case the smoke goes too.

## 1. Investigation

See REPORT §6.

## 2. What was done (30.10, agent wo831; one unit per row, nothing committed by the agent)

Method per row: re-proved dead with `grep -rnI` over client/, src/, godot/, tools/, scripts/, test/, index.js, package.json,
.github, vite configs, HTML and string-concat/dynamic-import forms (CSS class names were checked by *substring* against a
corpus of every non-CSS source, plus a manual look for `\`prefix-${x}\`` builders - which kept `device-view__destination--mode-*`
alive). Where a live smoke read the dead file, only the dead-file assertions were removed (nothing weakened for live code).

| # | Row | Deleted / edited | Proof it was dead |
|---|-----|------------------|-------------------|
| 1 | `src/sampling/` (5 files) | rm `src/sampling/`; rm smokes `smoke-wo179-fixture-transform`, `smoke-wo179-region-average` (neither was in a curated list); wiring removed from `src/bootstrap/shutdown.js`, `src/utils/periodic-sync.js`, `src/bootstrap/fetch-server-info-config.js` (+ unused `config` arg), `src/app-context.js`; comment fixes in `src/audio/meter-null-consumer.js`; `smoke-consumer-index-collisions` and `smoke-meter-null-consumer` stopped requiring `dmx-sampling-ingress` (slot 721 dropped from the list). `config.dmx` itself stays: the Art-Net/sACN lighting INPUT receivers read it. | `grep -rn "src/sampling\|dmx-sampling\|SamplingManager\|samplingManager" src client tools index.js` = index.js only (see section 3, open item) + the two smokes above. Sampling flag `legacyJsPixelmap:false`, `config/dmx.json enabled:false` (WO-807). |
| 2 | `client/tools/to-server/` (19 files) | rm dir; `eslint.config.js` glob entry removed | only referenced by itself, `eslint.config.js:133` and a `to-server:*` npm script that no longer exists in package.json |
| 3 | `src/engine/scene-take-pgm-only.js` | rm file + `smoke-scene-take-pgm-only.test.js`; dead-file assertions removed from `smoke-wo160b-pgm-only-lbg` (legacy header + export tests became "file is gone"), `smoke-wo322-shader-look-band-routing`, `smoke-wo537-look-timeline-starts-where-asked`, `smoke-wo590-template-cg-host-fill`, `smoke-wo545-opacity-exit-hold`, `smoke-live-input-audio-policy` | `grep "scene-take-pgm-only"` outside smokes = comments only (timeline-engine, scene-take-lbg, scene-transition, routes-audio, client/lib/scene-route-preview-remap; left alone). No `require` in src (WO-160b dropped the delegation). |
| 4 | client dead modules | rm `client/components/{pixel-mapping-browser,sync-modal,publish-modal,preview-panel-math,inspector-panel-routing}.js`, `client/lib/{device-view-refresh,replication-status-banner}.js` (the last two live in lib/, not components/), `smoke-device-view-refresh.test.js` (tested only that file; not curated). `device-view-bands-render.js` is NOT dead as a file (`device-view-render.js` imports `renderBands`): removed only the 4 dead band renderers + `addPortNodeDot` (-290 lines), 3 now-unused imports, `export` of `appendSegment`. Cascade (the WO-367 unwired-exports gate would have gone red): rm `client/lib/connection-profiles.js` (only the banner imported it), removed `setApiOriginOverride` (api-origin.js), `settingsPatchAffectsCasparRestart` (caspar-restart-dirty-policy.js), `computeActiveShowRevision` export. | each export `grep -rn` = definition + `tools/ci/unwired-exports-baseline.json` only |
| 5 | dead CSS | `03d-mapping-editor.css` (321 -> 17 lines; kept the live `.pixel-map-editor .mv-toolbar` and the `.device-view__mapping-node` base rule - see risks), `07b2` (9 `__...` blocks), `09a2` (13 classes), `09b2` (6), `09b3` (7), `09b` forwarder file deleted, `02c3` (`.streaming-panel*`, `.sources-usb-hint`), `03a` (sync/publish/status-badge/`header-btn--sync/--publish`), `03b` (publish-modal progress), `08c3` (`.replication-status-banner*`, its producer is row 4), `launcher-04` (dashboard/checklist/shortcut/splash/btn-group/check-box) | every class substring-grepped: 0 hits outside CSS (`FORCE` used only for `status-badge` - the hit was `audio-mixer-view__status-badge`, `replication-status-banner` - godot comment, `check-box` - a querySelector inside the dead launcher `#check-usb` branch). Left alone on purpose: `device-view__channel-chip(--active)` (still referenced by dead JS in device-view-destinations-ui.js). |
| 6 | `src/streaming/caspar-restart-dirty-policy.js`, `src/replication/show-revision-reconcile.js`, Syncthing REST helpers | rm both files; client copy header comment fixed; `syncthing-client.js` now exports only `getLocalSyncthingDeviceId` (dead `getSyncthingConfig/saveSyncthingConfig/scanFolder/ensureRemoteDevice/ensureSharedFolder` removed), `syncthing-media-status.js` only `readSyncthingApiKey` (dead `fetchSyncthingFolderStatus/getMediaSyncStatus` + `SYNCTHING_API`) | no `require` of the src twin (smoke-wo172 reads the client copy); reconcile exports only in the baseline; helper names only in their own file + baseline + `map-data.json` |
| 7 | scripts | rm `scripts/deprecated/{4 fix-* forwarders, highascg-exfat-server-update.sh, pin-kernel-6.8.0-117.sh, restore-production-host.sh, lib/, unused/}`, `scripts/deprecated/nvidia/*` except `install-nvidia-gsp-rpc-workaround.sh`, `scripts/exfat/install-exfat-units-{bridge,enable,exfat}.sh`; README edits in `scripts/README.md` and `scripts/deprecated/README.md` | per-file verdicts in `scripts-deprecated.md` / `scripts-exfat.md`; re-grep: no caller outside the deleted set. KEPT: `deprecated/legacy/` (`scripts/install.sh` forwards there; docs still tell the operator to run it) and the gsp workaround (called by `scripts/fix/fix-host-boot-display-hang.sh:112`). `smoke-eggs-exclude-lists` only needs `scripts/deprecated` to exist - it does. |
| 7b | `scripts/fix/*` | NOT deleted: they are documented operator recovery tools (`docs/BOOT_EMERGENCY_RECOVERY.md`), just broken by a stale path. Fixed `scripts/fix-boot-emergency-recovery.sh` -> `scripts/fix/...` (3 call sites + 4 usage strings + the doc) | `bash -n` ok on all four |
| 8 | unreachable routes | rm `routes-misc.js`, `routes-system-staged.js`; removed `POST /api/misc/*`, `POST /api/data/*` (+ `handlePost/handleData` 410 tombstone in `routes-data.js`), `POST /api/config/apply` (+ `handleConfigApply`; `/api/config/reset` stays), `POST /api/led-test-card/*` (shadowed by `/:op`; unused import dropped), `GET/POST /api/system/staged*` (the `caspar-arm` handler never matched them); README/wiki/`tools/runtime/README.md` mentions removed; `smoke-wo629` pin repointed ("wildcard stays gone"); `docs/wiki/api/contract/{http,ws}.md` regenerated (also picks up other agents' new routes) | the LED bare path `POST /api/led-test-card` still works through router-dispatch's legacy chain. `routes-system-licenses.js` untouched. |

Not done on purpose (owner-call or other agent's files): `tools/eggs/unused/`, the WO-273 replication tools, the WO-218
SWAP/equality-skip branches in `src/engine/scene-take-lbg-*`, Godot test-only model functions (list in the report).

## 3. Verified

- `node --test` on every smoke that mentions a touched name (about 45 files incl. wo160b, wo322, wo537, wo545, wo590, live-input-audio-policy,
  consumer-index-collisions, meter-null-consumer, wo172, wo629, wo598-api-contract, wiki, api-origin, periodic-sync, shutdown, fresh-box-clean-device-view,
  wo440-441, wo287-289): all pass. One failure outside this WO: `smoke-wo379-shader-store-and-stack-clear` pins `routes-shader-stack.js`
  text that another agent is editing.
- Router/route modules load in a scratch script (`router.js`, `router-dispatch.js`, `routes-data.js`, `routes-config.js`, shutdown, periodic-sync,
  fetch-server-info-config, app-context, connect-pair, routes-replication-get): no ReferenceError, route registration runs.
- `node tools/ci/check-max-file-lines.js`: only `client/lib/math-input.js` (503 lines, not touched here).
- `node tools/ci/check-unwired-exports.js`: my deletions create no new orphan exports; 4 remaining are other agents' edits (`sanitizeEffectParams`, `stripAmcpLineBreaks`, `isValidModuleName`, `isValidPluginId`). 30 baseline entries are now stale: run `--update`.
- CSS: brace balance checked for every stylesheet; no empty `@media` left.
- **OPEN: `index.js` still requires `./src/sampling/dmx-sampling`** (off-limits to this agent), so `node index.js` and `check-require-integrity` fail until the
  coordinator removes `index.js` line 20 (`const { SamplingManager } = ...`), the `; appCtx.samplingManager = new SamplingManager(appCtx)` tail of line 212, and the two
  `if (appCtx.samplingManager) ...updateConfig(config.dmx)...` lines (258, 382). The running node process is unaffected until its next restart. Do not restart before applying it.
- Not run: `npm run build:client` / a kiosk reload (would swap the live dist-web); the client deletions are import-free (no importers), so the build graph is unchanged.
