# WO-445 — Full-project audit: 500-line violations, dead code, duplicate code

**Status: DONE (06.08.26 — CI un-red fixes + dead-file deletions implemented and verified; duplicate consolidations remain open as follow-ups, see §2b)**

Owner todo (todos06.08.26 line 11): *"i need a full project search, looking for files that are
exceeding 500 lines of code limit, as well as search for dead/duplicate code."*

## 1. Investigation

### 1.0 CI on main is RED right now — the audit's first finding

The last two pushes (`b4a49b6` WO-443, `9d7e2b6` WO-444) both failed CI at the **"File size
limit (500 lines)"** step (runs 31099794861, 31100412950). Everything behind that step is
masked (the WO-437→439 lesson): once the 500-line gate is green, **Unwired exports** fails
next, and behind that **ESLint** fails too. Three gates need fixing, in order:

1. **500-line gate** — `client/components/device-view-inspector-gpu-video-modeline.js` is
   **507 lines** and not exempt. Pushed over the limit by WO-442 (`4e68219`). Fix: split
   (see §1.3 — it shares 80 lines with its own `-apply.js` sibling, so dedupe = split).
2. **Unwired exports (WO-367 gate)** — `openSaveDeviceSnapshotModal` in
   `client/components/device-view-snapshot-modals.js` is referenced by NOTHING (new orphan,
   not in baseline; present since `185d200`). Wire it or delete it. Bonus: 2 baseline
   entries are no longer orphaned — `node tools/ci/check-unwired-exports.js --update`
   shrinks the baseline while at it.
3. **ESLint** — 1 **error**: `no-irregular-whitespace` at
   `tools/smoke/smoke-wo440-441-apply-force-inspector-fit.test.js:67` — a literal NBSP
   inside the assertion regex (the assertion is ABOUT the NBSP join, so the character is
   deliberate). Escape it as ` ` in the regex; do not weaken the assertion.
   Warnings are fine: 216 vs cap 218 (but see §1.2 — the cap is nearly exhausted).

### 1.1 Files over the 500-line limit

Method: ran the gate itself (`node tools/ci/check-max-file-lines.js --json`) plus an
independent `find`+`wc -l` sweep over ALL roots including ones the gate skips
(`test/`, `bin/`, repo root, `.sh` everywhere).

| Lines | File | Verdict |
|---|---|---|
| 507 | `client/components/device-view-inspector-gpu-video-modeline.js` | **gate-RED, must split** |
| 1059 | `client/components/map-explorer.js` | exempt (grandfathered, WO-163 Pages-only) |
| 800 | `client/styles/map-explorer.css` | exempt (same) |

Outside gate scope, over 500 but NOT production: `work/references/` and
`work/device-view-github-reference/` snapshot copies (1229, 801, 701, 592, 579, 576, 534×2).
`test/`, `bin/`, root `index.js`: all clean. No `.sh` anywhere over 500.

### 1.2 Dead code

- **`template/led-grid-test-core.js` (271) + `template/led-grid-test-patterns.js` (227)** —
  known orphans (an unwired split; WO-411 documented them and then *kept patching them in
  sync* with the live copies — twice). The live template loads `led_grid_test.js` +
  `led_grid_test-render.js` per `led_grid_test.html:333-334`. ~500 lines of dead template
  code with active double-maintenance cost. Either finish the split (repoint the HTML) or
  delete the pair; the current "orphan, kept in sync" state is the worst option.
- **`client/components/device-view-gpu-source-inherit.js` (183)** — imported by NOTHING;
  every live import resolves `client/lib/device-view-gpu-source-inherit.js` (the two differ
  by a handful of lines — drift has already started). The only smoke that pins this module
  (`smoke-wo437-mapping-dims-gl-sync.test.js:65`) reads the **lib** copy, so deleting the
  components copy is smoke-safe. Verify with `rg` before deleting (WO-367 gate covers the
  exports side already — this whole file is in the 689-entry baseline).
- **`openSaveDeviceSnapshotModal`** — see §1.0 item 2; the fourth instance of the WO-367
  failure class (after `6e53abe`, `9d2f6dd`, `185d200`).
- **Orphan-export baseline**: 689 entries (ratchet, not a cleanup order — WO-367's rule).
- **eslint `no-unused-vars`**: 132 warnings across 98 files. Worst: 7 in
  `tools/smoke/smoke-wo218-bank-drift.test.js`, 6 in `tools/ci/check-script-paths.js`, 4 in
  `src/system/pointer-confine.js`. Total warnings sit at 216 of the 218 cap — two more and
  lint goes red on warnings alone; a triage pass (lint pass 6) would buy headroom.

### 1.3 Duplicate code (live on both sides unless noted)

Method: normalized sliding-window scan (12+ significant lines, comments/blanks/lone-braces
stripped) over `client/components`, `client/lib`, `src`, `tools`, `scripts`, `template` —
1617 files, 129 duplicate groups. Top groups, verified by hand:

**Actionable — same service, no module-system excuse:**
- **GPU modeline inspector family** (all client ESM, same directory):
  `device-view-inspector-gpu-modeline-apply.js` ↔ `-gpu-video-modeline-preview.js` (~85
  lines) and `-apply.js` ↔ `-gpu-video-modeline.js` (~80 lines, `389-468` ↔ `152-230`).
  Extracting the shared block into a helper fixes the duplication AND brings the 507-line
  gate-breaker under 500 — one change closes both.
- **Caspar config generators**: `src/config/build-caspar-config-{audio,routing,decklink}.js`
  ↔ `build-caspar-generator-config-{audio,screens,decklink}.js` — ~82+80+62 ≈ 220 lines of
  near-identical XML assembly, all CJS in the same tree. Highest-risk consolidation (config
  output is load-bearing); needs its own WO with before/after XML diff as verification.
- **`device-view-inspector-gpu-modeline-os.js` ↔ `-gpu-video-modeline-os-settings.js`** (~77).
- **Art-Net ↔ sACN receivers** (`src/artnet/`, ~63 lines): socket lifecycle, universe
  bookkeeping. A shared receiver base would also keep future fixes from landing in one only.
- **Audio mixer console ↔ panel** (`audio-mixer-console-{input-groups,live-inputs,masters}`
  ↔ `audio-mixer-panel-*`, ~100 lines total): both UIs are wired (console via
  `audio-mixer-view.js`, panel via `app.js`) — real duplication, not dead code.
- **`src/utils/which.js` reimplemented inside `x-display-session-runtime-env.js`** (~47).
- **Templates**: `multiview_master.js` ↔ `multiview_overlay.js` (~84);
  `lower-thirds/lt-engine.js` ↔ `lt-engine-styles.js` (~44). Templates run standalone in
  CEF without a bundler, so sharing needs a `<script>`-include, not an import — judge
  case-by-case.

**Intentional, documented — leave alone (or consolidate only with a WO):**
- `client/lib/scene-live-main-sync.js` ↔ `src/engine/scene-live-main-sync.js` — headers on
  BOTH sides say "Keep in sync (WO-63)"; ESM/CJS twin.
- Same twin pattern (client ESM ↔ server CJS): `mixer-fill.js` ↔ `scene-native-fill.js`
  (~45), `pip-overlay-amcp.js` ↔ `pip-overlay-utils.js` (~48),
  `device-view-destinations-inspector-modes.js` ↔ `src/config/config-modes.js` (~39).
- Smoke-test internal repetition (`smoke-wo224-playlist-wrap` 62, `smoke-wo244` 43+31, …) —
  copy-paste fixture setup inside single test files; low value, low risk, lowest priority.

## 2. What was done (owner "go", same day)

Correction to §1.3 discovered while fixing: `device-view-inspector-gpu-modeline-apply.js`
and `-os.js` — the other half of the top three duplicate groups — were themselves DEAD
(imported by nothing / only by each other; an abandoned parallel split of the WO-140
family). So the biggest "dedupe" was a deletion, not an extraction.

1. **500-line gate** — moved the input event-wiring block (old lines 389-439) out of
   `device-view-inspector-gpu-video-modeline.js` into a new `wireModelineInputEvents`
   export in the live `-preview.js` sibling: 507 → 475 lines. Behavior-preserving: same
   listener order, including the initial `syncTimingRowVisibility()` call position. The
   WO-441/442/edid smokes pin only regions that stayed put.
2. **WO-367 gate / WO-49** — wired `openSaveDeviceSnapshotModal`: new icon button
   (down-arrow-into-tray, DOM-built to avoid the WO-103 innerHTML lint) in the Devices
   header next to the config-editor icon; handler in `attachDeviceViewEvents` passes
   `refs.rearPanel` for the PNG capture and `setStatus` for feedback. This was WO-49's
   designated primary entry point; the load half was already live in
   `project-hardware-reconcile-modal.js`.
3. **ESLint** — the NBSP inside the WO-441 smoke's regex literal is now ` `
   (matches the identical character; `no-irregular-whitespace` skips strings but not
   regexes, which is why the production line never errored).
4. **Dead files deleted** (1,034 lines): `template/led-grid-test-{core,patterns}.js`,
   `client/components/device-view-gpu-source-inherit.js`,
   `client/components/device-view-inspector-gpu-modeline-{apply,os}.js`.
   Baseline `--update`: 690 → 688. Note: `screenConsumerCasparPatch` ENTERED the baseline
   in the same rewrite — the deleted stale gpu-source-inherit copy (with its broken
   `./screen-consumer-defaults.js` import) was its only external mention; the function is
   used inside its own module, i.e. the same module-local class the baseline exists for.

### 2b. Still open (each needs its own WO before touching)

- Caspar config generators dedupe (~220 lines, load-bearing XML — verify with before/after
  XML diff), audio mixer console↔panel (~100), artnet↔sacn (~63), `which.js` reimpl (~47),
  template pairs (multiview ~84, lower-thirds ~44 — CEF, no bundler).
- Lint pass 6 for `no-unused-vars` headroom (216 warnings vs 218 cap).
- 11 Syncthing `*.sync-conflict-*` files under `projects/` (June 24-28) fail
  `verify:repo-integrity` LOCALLY (untracked, so CI never sees them). Owner call:
  delete the conflict copies after checking none holds wanted edits.

## 3. What was VERIFIED (post-fix)

- All CI-order gates green locally at the final commit: max-file-lines 0 violations;
  unwired-exports no new orphans (688 baseline); eslint 0 errors / 216 warnings (cap 218);
  prettier CI-scope clean; offline suite **1867 tests: 1865 pass / 0 fail / 2 skip**
  (same counts as WO-444's green run). Repo-integrity fails locally ONLY on the
  pre-existing untracked sync-conflict files above. Boot check left to CI (a second
  `node index.js` on the live box could steal UDP/OSC binds).
- `npm run build:client` OK; `device-view__save-snapshot-btn` present in the built
  device-view chunk; `gpu-modeline-apply` absent from `dist-web/`. Kiosk reloaded
  (XTEST F5). Owner QA: the new ⭳ button in Devices header → "Save device snapshot"
  modal downloads the JSON.
- Vite build doubles as an import-graph check: none of the five deleted files was
  reachable (build succeeded with them gone).

## 3-orig. What was VERIFIED (audit phase)

- Gate outputs reproduced locally at HEAD `9d7e2b6` (= origin/main, nothing unpushed):
  `check-max-file-lines` exit 1 (1 violation, 507), `check-unwired-exports` exit 1 (1 new
  orphan, 689 baseline, 2 shrinkable), `npx eslint .` 1 error + 216 warnings.
- CI runs 31099794861 (WO-443) and 31100412950 (WO-444) both failed; `gh run view` shows
  the failing step is "File size limit (500 lines)" — consistent with the local repro.
- Every "dead" claim above was importer-checked with `rg` (map-data.json ignored — build
  artifact); the led-grid orphan status cross-checked against WO-411's own investigation.
- Duplicate ranges spot-checked by reading both sides of the top three groups.
