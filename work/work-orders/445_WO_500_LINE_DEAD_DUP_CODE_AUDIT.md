# WO-445 — Full-project audit: 500-line violations, dead code, duplicate code

**Status: OPEN (investigation complete 06.08.26; no code changed)**

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

## 2. What was done

Investigation only. This WO written; row added to `work/OPEN_ISSUES.md`. No production code
touched. Suggested fix order: §1.0 items 1→3 (un-reds CI, smallest possible diffs), then the
dead-file deletions (§1.2, trivial, shrink the baseline), then the duplicate consolidations
(each its own WO, config generators last).

## 3. What was VERIFIED

- Gate outputs reproduced locally at HEAD `9d7e2b6` (= origin/main, nothing unpushed):
  `check-max-file-lines` exit 1 (1 violation, 507), `check-unwired-exports` exit 1 (1 new
  orphan, 689 baseline, 2 shrinkable), `npx eslint .` 1 error + 216 warnings.
- CI runs 31099794861 (WO-443) and 31100412950 (WO-444) both failed; `gh run view` shows
  the failing step is "File size limit (500 lines)" — consistent with the local repro.
- Every "dead" claim above was importer-checked with `rg` (map-data.json ignored — build
  artifact); the led-grid orphan status cross-checked against WO-411's own investigation.
- Duplicate ranges spot-checked by reading both sides of the top three groups.
