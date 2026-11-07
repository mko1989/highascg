# WO-995 — Sanitization sweep: delete dead and deprecated code (Electron launcher, kiosk leftovers, never-called exports)
**Area:** process, testing-ci
**Status: DONE (07.11.26, removals checked by whole-repo reference search plus AST checks; curated suite 5522 pass / 0 fail, Godot 26145 pass / 0 fail, all gates clean; owner-call items listed below were left in place)**

Owner, 07.11: *"Want you to run a sanitization sweep. Looking for dead and deprecated code. Like the electron launcher etc."*

## Investigation

Survey data is in the session scratchpad (`sweep/`). Every item was checked by `git grep -w` over the whole repo,
including `godot/`, `client/`, `tools/` and `scripts/`, before it was removed. Items that only showed up in `work/` or in
the generated wiki bundle counted as unreferenced.

- **`client/tools/`** (72 files) held tooling for the retired desktop path. Nothing outside the tree called it except
  three npm scripts (`launcher`, `portable:sim`, `portable:sim:check`), the `electron` devDependency, eslint ignore globs
  and one smoke test.
  - Electron launcher (highascg-client packaging).
  - Stick Studio and the macOS/Windows stick scripts. Sticks have been Ventoy-only since 01.11.
  - The exFAT simulation launcher (WO-50).
  - The operator-desktop and portable-desktop shells, and the launcher release scripts.
- **Kiosk leftovers in `src/`.** WO-646 deleted the kiosk, but these survived it:
  - `promoteGuiWindowsAboveKiosk` / `resolveWindowAbovePromoter` (WO-283) and their `highascg-window-above.py`
    helper;
  - `resolveHelperWindowRect` / `listProgramConsumerRects` (helper-window placement);
  - `GET /api/system/apps` (the kiosk taskbar menu; `listAppsForMenu` itself is still used by operator-dock);
  - `routes-system-licenses.js` and `licenses-path.js`, which no router registered.
- **Godot, unreachable code:**
  - The Shader FX dialog with its params/model scripts. Nothing instantiates the dialog.
  - `previs_uv_mapper.gd`, used only by its own test.
  - `shm_texture.format_supported()`.
- **`tools/test-live/manual/`** (14 hand-run AMCP spikes from 2025) and `tools/map/timing-test.js` were in no runner,
  doc or script.
- **Dead settings keys:**
  - `operatorTools.multiHelperTaskbar` gated the kiosk taskbar. Since WO-646 it was only round-tripped by
    `settings-post.js`.
  - `ui.legacyJsPixelmap` gated the JS sampling engine that WO-831 deleted (`src/sampling/`). The pixel-map docs still
    told operators to re-enable that engine with the flag. `WALKTHROUGH_PIXELMAP_FIXTURES.md` described only that
    engine.
- **Never-called exports.** The unwired-exports baseline listed 690 entries; 71 of them had no reference anywhere in
  the repo. An AST pass over each (acorn: export form, top-level declaration, in-file references, `this.` calls)
  split them:
  - **62 fully dead**, with no in-file use either: the compose-preview activity/cache/dirty helpers, caspar-restart
    wrappers, NDI prepare/validate, `persistence.bindAmcp`/`hydrateFromAmcp`, `corsHeaders`, `routeToLayer`,
    `runTimelineOnlyTake`, `fadePhysicalLayersIn/Out`, and more. The full list is in commit ad0b8aef.
  - **9 kept** (false positives for the survey):
    - `PRIVATE_IDENTITY_DIR` and `PROJECTS_TRASH_DIR`, which `verify-iso-squashfs-excludes.sh` reads through
      `manifest_const`;
    - `_clearLayerMixerSchedule`, which smoke-983 calls;
    - four mixin methods called through `this.` (`_screenChannelSet`, `_fireLightFlag`, `_lightService`, `_holdEnd`);
    - two aliases whose inner functions are still used (only the alias keys were dropped).
- **eslint `no-unused-vars` in `src/`:** 60 warnings, of which about 30 were real.
  - Unused imports and never-called locals (`casparOutputNames`, `setCellPosition`, `barrierLogShowsActive`).
  - `routing-map.js:199`: a local `inputsEnabled` that the returned map recomputes from `effectiveDecklinkInputCount`
    at line 382. `map.inputsEnabled` is read by three modules, so this was checked closely; the local was a stale copy.
- **Stale text.** Docs still pointed at the deleted `client/tools/`:
  - README, ARCHITECTURE, DEV_RELEASE_GITHUB, MODULES, EXFAT_SERVER_UPDATE, the cg-studio README, BUILD_AND_FLASH and
    others;
  - an `index.js` startup log hint.

  Script comments named moved or deleted paths (install-phase4/5, `tools/live-usb/…`, `scripts/archive-common.sh`,
  `routes-system-browser.js`, `tools/http-smoke.js`, `work/run-eggs-*.sh`).
- **smoke-wo47-manifest** (not in curated CI) was already failing before the sweep. It required `dist-web` in the eggs
  embed-server exclude list, but 250f3445 took it out on purpose ("dist-web/ is baked on ISO").

## What was done

One commit per verified unit:

| commit | unit |
|---|---|
| 904c970d | delete `client/tools/`. package.json: drop the 3 scripts, `electron` and the notes sentence (lock −128 lines). Clean eslint config, dom-escape gate, smoke-wo844 (test 4o), smoke-wo47 |
| c0f7f79e | Godot: delete the Shader FX dialog/params/model plus test, `previs_uv_mapper.gd` plus test, `shm_texture.format_supported()` |
| f1396583 | src: kiosk window promotion plus python helper, helper-window rect helpers, `GET /api/system/apps`, licenses route and path module; API contract doc regenerated (548 routes) |
| 18041e47 | delete `tools/test-live/manual/` and `tools/map/timing-test.js` |
| 6e13b016 | drop `multiHelperTaskbar` and `legacyJsPixelmap` from defaults-core and settings-post; ARTNET_PIXEL_MAPPING marks the JS engine REMOVED (kept as history); delete WALKTHROUGH_PIXELMAP_FIXTURES; smokes wo382/wo242/wo807 repointed (they now assert the keys are gone); wiki rebuilt |
| ad0b8aef | 62 dead exports plus the 9 imports/helpers they orphaned, 46 files, −1046 lines; unwired-exports baseline 690 → 618 |
| 23c06464 | docs no longer point at `client/tools/`; smoke-wo47 now asserts the embed fragment does NOT exclude `dist-web` |
| 53e9b15f | 23 unused imports in 20 files plus dead locals/functions; src eslint warnings 60 → 28 |
| 382ae8c5 | stale paths in script comments and usage lines |

WO-50 (exFAT simulation launchers) moved to `deprecated/`, with this WO as successor.

**Deliberately kept:**
- The 28 remaining lint warnings. They are unused parameters, rest-omit destructures (`const { direct, ...rest }`),
  catch bindings and parse-for-validation lines.
- `src/engine/look-air-compose-channel.js` and `scene-look-kind.js`. Only smokes use them, but they are the declared
  testable mirrors of `client/lib` ("keep in sync").
- The key copies in the Godot goldens, demo data and live `config/` (live state, never hand-edited).
- `docs/PLAN_SERVER_CLIENT_SPLIT.md`, a historical WO-51 plan.
- The `client/tools` lines in the eggs exclude list (harmless).

**Owner call (found, not removed):**
- **Admin routes with no in-repo caller** (curl/ops use is possible): `/api/streaming/*`, `ltc/config`, the
  gpu-nvidia/xrandr apply routes, `host-live/migration`, `POST /api/system/pointer-confine`.
- **`screen_N_vsync` keys.** Removing them needs a coordinated Godot change.
- **The stick-flash cluster in `tools/eggs/live-usb`** (Ventoy made it legacy). Six smokes pin it (wo870, wo413, wo434,
  wo842, eggs-produce-build-stamp, wo832), so it needs its own WO.
- **Setup scripts that look dead:** `tools/startup/place-screen-consumers.sh`,
  `scripts/setup/highascg-nvidia-persistence.service`, `tools/eggs/companion/dev-mode.sh`,
  `discover-recovery-sources.sh`.
- **`confine-cursor.py`** (the xgrab path; `tryPythonXgrabConfine` is still wired as a fallback). The operator-Firefox
  helpers are still live through the gui-launch "firefox" action.
- **Server broadcasts nobody consumes:** `record_stopped`, `playback.reconcile`, `ltc.status`, `caspar-apply-pending`.
- **Test-only Godot helper functions.**
- **Follow-up:** the `shm_texture.free_gpu` leak.

## What was VERIFIED

- **After each unit:** the smokes that grep the touched names or files were run, every touched module loaded with
  `require`, and eslint was clean on the touched files.
  - Unit 3: 192 smokes.
  - Unit 5: 46 tests.
  - Docs units: 200 plus 79 tests, and the wiki smokes.
- **Full curated suite** (`run-offline-tests.js`), after the export removal and again after the lint unit: 5530 tests,
  **5522 pass, 0 fail**, 8 todo-marked (WO-983's known late-entry tests).
- **Godot:** `run-client.sh --check` boots with no script errors; `--test` gives **26145 passed, 0 failed**.
- **Gates:** max-file-lines (0 over 500), prettier, unwired-exports (no new orphans; 618 in baseline) and
  `check-wos` are clean. `check-require-integrity` flags only the box's untracked Syncthing `*.sync-conflict-*`
  project files, as before.
- **smoke-wo47-manifest** passes again.
- **Totals:** 216 files changed, 95 insertions, about 9050 deletions (excluding `config/`).
- **Not live-probed:** nothing removed was on a running path. Every removed route, export and key had no caller, so
  there is no box behaviour to check beyond the node restart that the next deploy brings.

Rollback: revert the unit's commit.
