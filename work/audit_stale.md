# HighAsCG stale functions & dead-code audit

**Date:** 2026-06-25  
**Repo:** `/home/casparcg/highascg`  
**Companion:** [`audit_report.md`](audit_report.md) (500-line size audit)

---

## Executive summary

| Category | Count | Lines (approx.) | Risk if removed |
|----------|------:|----------------:|-----------------|
| **Sync-conflict / copy artefacts** | 43 files | ~9,800 | **None** — editor merge duplicates |
| **Explicit `@deprecated` symbols** | 16 markers | ~1,200 in legacy AMCP stack | Mixed — see §3 |
| **Orphan modules** (zero importers) | 11 client files | ~1,280 | Low — likely abandoned WO stubs |
| **Dead exports** (exported, never imported) | 8 confirmed | ~120 | Low |
| **Duplicate near-copies** | 3 pairs | ~750 | Medium — verify before delete |
| **Deprecated folders** (`scripts/deprecated`, `work/deprecated`) | 36 files | ~3,360 | None for production |
| **Optional-module stubs** (TODO-only) | 2 entries + 3 server registers | ~200 | N/A — intentional placeholders |

**Verdict:** The repo carries **~15k lines** of clearly stale or unreachable code, dominated by **sync-conflict artefacts** (~10k lines) and **deprecated tooling** (~3.4k lines). Production runtime paths are mostly clean; the worst hygiene issues are merge-conflict duplicates under `src/` and `template/`, plus a cluster of **WO-08 UI components** that were never wired into `app.js`.

**Quick wins (safe deletes):** all `*.sync-conflict-*` files, `lt-engine copy.js`, `config/casparcg copy.config`, and the orphaned `client/components/device-view-gpu-source-inherit.js` duplicate.

---

## Methodology

### Scanned

- **Backend:** `src/**/*.js`
- **Frontend:** `client/**/*.js`, `client/**/*.html`
- **Templates:** `template/**/*.js`
- **Tooling:** `tools/**/*.js`, `scripts/**/*.sh`
- **Work area:** `work/**` (excluding `work/references/` vendored clones)

### Techniques

1. **Ripgrep** for `@deprecated`, `TODO`, `sync-conflict`, `copy`, and symbol cross-references.
2. **Import-graph heuristics** — basename never appears in any `import` / `require` / dynamic `import()` (static analysis; does not follow HTML `<script type="module">` beyond Vite entry `client/app.js` and optional-module `entry.js` bundles).
3. **Manual verification** of each “dead” candidate — namespace imports (`import * as x`) and re-exports can hide usage; only high-confidence items are listed as removable.

### Excluded

| Excluded | Reason |
|----------|--------|
| `node_modules/`, `dist-web/`, `cef-cache/` | Dependencies / build output |
| `projects/`, `.highascg-state.json` | Runtime data |
| `work/references/` | Vendored third-party clones |
| `docs/wiki-site/` | Generated wiki bundle |

---

## 1. Sync-conflict & copy artefacts — delete immediately

**43 files, ~9,763 lines** (including 2× `package.sync-conflict-*.json` and project JSON conflicts).

These are Syncthing/editor merge duplicates. **None are referenced** by `index.js`, tests, or build scripts.

### Production JS duplicates (12 files, ~3,759 lines)

| Lines | File |
|------:|------|
| 459 | `src/api/router.sync-conflict-20260624-090423-ED7RF3B.js` |
| 393 | `src/engine/scene-take-lbg-amcp-pipeline.sync-conflict-20260624-090424-ED7RF3B.js` |
| 360 | `src/engine/scene-take-pgm-only.sync-conflict-20260624-090424-ED7RF3B.js` |
| 359 | `src/api/routes-lower-thirds.sync-conflict-20260624-090423-ED7RF3B.js` |
| 336 | `src/engine/scene-take-lbg.sync-conflict-20260624-090424-ED7RF3B.js` |
| 309 | `src/engine/scene-take-lbg-jobs.sync-conflict-20260624-090424-ED7RF3B.js` |
| 136 | `src/engine/scene-template-cg.sync-conflict-20260624-090424-ED7RF3B.js` |
| 97 | `src/engine/scene-route-deps.sync-conflict-20260624-090424-ED7RF3B.js` |
| 65 | `src/api/routes-cg.sync-conflict-20260624-090423-ED7RF3B.js` |
| 57 | `tools/smoke/smoke-scene-template-cg.test.sync-conflict-20260624-090310-ED7RF3B.js` |
| 37 | `tools/smoke/smoke-scene-route-deps.sync-conflict-20260624-090310-ED7RF3B.js` |
| 595 | `template/lower-thirds/lt-engine.sync-conflict-20260624-110510-S5R6E5O.js` |

### Template / config copies

| Lines | File | Notes |
|------:|------|-------|
| 556 | `template/lower-thirds/lt-engine-from-client/lt-engine copy.js` | Manual duplicate; canonical is `template/lower-thirds/lt-engine.js` |
| 556 | `template/lower-thirds/lt-engine-from-client/lt-engine.sync-conflict-*.js` | Sync-conflict duplicate |
| — | `config/casparcg copy.config` | Stray editor copy |

### Entire `lt-engine-from-client/` folder

The folder `template/lower-thirds/lt-engine-from-client/` (455-line `lt-engine.js` + copies) is **not referenced** anywhere in the repo. CG Studio and export paths use `template/lower-thirds/lt-engine.js` only. Safe to remove the whole subdirectory after deleting sync-conflict siblings.

### Docs / work-order conflicts (31 files)

Markdown and JSON sync-conflicts under `docs/`, `work/`, `scripts/`, `tools/`, `README.sync-conflict-*`, `package.sync-conflict-*.json`, and `projects/*.sync-conflict-*.json`. Safe to delete; keep the non-conflict canonical filenames.

**Suggested command (review diff first):**

```bash
find . \( -name '*sync-conflict*' -o -name '* copy.*' \) \
  ! -path './node_modules/*' ! -path './work/references/*' -print
```

---

## 2. Orphan client modules — no importers found

These files export UI or lib helpers but **no other file imports them** (verified by basename search across `client/` and `src/`).

| Lines | File | Exports | Likely origin |
|------:|------|---------|---------------|
| 408 | `client/components/system-settings.js` | `mountSystemSettings` | System tab never mounted |
| 181 | `client/components/device-view-gpu-source-inherit.js` | GPU inherit helpers | **Duplicate** — live copy is `client/lib/device-view-gpu-source-inherit.js` |
| 142 | `client/components/pixel-mapping-browser.js` | `renderMappingBrowser` | Mapping UI never wired |
| 109 | `client/components/now-playing.js` | `mountNowPlaying` | WO-08 OSC widget stub |
| 85 | `client/components/device-view-destinations-drag.js` | drag handlers | Device View refactor leftover |
| 76 | `client/lib/scene-live-match.js` | PRV route diff helpers | Superseded by server `scene-transition.js`? |
| 73 | `client/components/output-status.js` | `mountOutputStatus` | WO-08 OSC widget stub |
| 72 | `client/components/profiler-display.js` | `mountProfilerDisplay` | WO-08 OSC widget stub |
| 62 | `client/components/vu-meter.js` | `createVuMeter` | WO-08 T2.1 — never integrated |
| 46 | `client/lib/live-audio-play.js` | `playLiveAudioOnChannel`, `stopLiveAudioOnChannel` | Superseded by server live-audio routes |
| 25 | `client/lib/playback-clock.js` | `cellElapsedMs`, `cellRemainingMs` | Playback matrix UI never hooked up |

**Total:** ~1,279 lines removable after confirming no dynamic `import()` by constructed path (none found).

**Note:** `client/components/system-settings-helpers.js` is only imported by the orphan `system-settings.js` — if the parent is removed, helpers become orphan too (~additional lines).

---

## 3. `@deprecated` markers — inventory & disposition

### 3.1 Keep for rollback / migration (do not delete yet)

| Symbol / file | Location | Why kept |
|---------------|----------|----------|
| `TcpClient`, `AmcpProtocol` | `src/caspar/tcp-client.js` (~160 lines), `src/caspar/amcp-protocol.js` (~288 lines) | Rollback via `HIGHASCG_AMCP_LEGACY_TRANSPORT=1`; tested by `smoke-amcp-legacy-transport.test.js` |
| `stopCasparForApplyStart` | `src/utils/caspar-restart.js` | Marked deprecated; exported but **never called** — candidate for removal after confirming nodm path |
| `MAX_BATCH_COMMANDS` const | `src/caspar/amcp-batch.js` | Deprecated alias of `resolveMaxBatchCommands`; still exported |

### 3.2 Compatibility shims — safe to thin, not delete abruptly

| Symbol | Location | Usage |
|--------|----------|-------|
| `setGo2rtcApiPort(_port)` | `client/lib/webrtc-client.js` | **No-op**; still called from `stream-state.js` on config load |
| `runStartupHostIpSplashIfNeeded` | `src/bootstrap/startup-led-test-pattern.js` | Alias export → `runStartupLedTestPatternIfNeeded`; zero external callers |
| `parseXrandrDpHdmiOutputNames` | `src/utils/gpu-topology-xrandr.js` | Deprecated wrapper; exported but **zero external imports** |
| `getModetestProbe` | `src/utils/hardware-info.js` | Returns disabled stub; exported but **zero external imports** |
| `legacyBorderedWindowConsumer` | `client/lib/screen-consumer-defaults.js` | Used internally for migration seeding — **not dead** |
| `DASHBOARD_STORAGE_LEGACY` | `client/lib/program-output-state.js` | Exported; **zero imports** — inline `STORAGE_LEGACY` suffices |
| `CLIENT_OPTIONAL_MODULES` | `client/lib/optional-modules-client-manifest.js` | Exported; **zero imports** — registry used directly |
| `calcMixerFill`, `getContentResolution` re-export | `client/components/inspector-panel.js` | Deprecated re-export; callers import from `mixer-fill.js` instead |
| `isLiveAudioPgmInfrastructureLayer` | `src/config/live-audio-input.js` | Deprecated wrapper; exported but **zero external imports** — use `look-layer-ranges` |
| `overlayLayerSlot` (legacy high-band) | `client/lib/pip-overlay-registry.js` | Deprecated constant; verify no persisted configs reference slot |

### 3.3 Intentional empty / legacy config fields

| Item | Location | Notes |
|------|----------|-------|
| `mappingChannels = []` | `src/config/routing-map.js` | Always empty; still read by `src/audio/meter-null-consumer.js` — keep field, can drop `@deprecated` comment or document as structural |
| `rtmpServerUrl` migration | `src/config/rtmp-output.js` | Old config key support |
| Whole files deprecated at header | `src/caspar/amcp-protocol.js`, `tcp-client.js` | See §3.1 |

---

## 4. Dead exports — high-confidence removals

Symbols **exported** but with **no import/require references** outside their defining file:

| Symbol | File | Action |
|--------|------|--------|
| `listStaleGpuGraphConnectors` | `client/lib/device-view-gpu-port-list.js` | Delete function (~10 lines) — stale-graph logic lives inline in `device-view-gpu-layout-debug.js` |
| `isLiveAudioPgmInfrastructureLayer` | `src/config/live-audio-input.js` | Remove from `module.exports` |
| `parseXrandrDpHdmiOutputNames` | `src/utils/gpu-topology-xrandr.js` | Remove export (keep internal alias private or delete) |
| `getModetestProbe` | `src/utils/hardware-info.js` | Remove export; probe disabled at source |
| `CLIENT_OPTIONAL_MODULES` | `client/lib/optional-modules-client-manifest.js` | Remove export |
| `DASHBOARD_STORAGE_LEGACY` | `client/lib/program-output-state.js` | Remove export |
| `calcMixerFill`, `getContentResolution` | `client/components/inspector-panel.js` | Remove re-export block |
| `runStartupHostIpSplashIfNeeded` | `src/bootstrap/startup-led-test-pattern.js` | Remove alias from exports |
| `stopCasparForApplyStart` | `src/utils/caspar-restart.js` | Remove function + export (~30 lines) |

---

## 5. Duplicate / forked code

| Pair | Lines each | Relationship | Recommendation |
|------|------------|--------------|----------------|
| `client/lib/device-view-gpu-source-inherit.js` vs `client/components/device-view-gpu-source-inherit.js` | 178 vs 181 | Near-duplicate; **only `lib/` is imported** | Delete `components/` copy |
| `src/cg-studio/lt-param-registry.js` vs `client/tools/electron-launcher/cg-studio/lt-param-registry.js` | identical | Electron launcher mirrors server CG Studio | Consolidate to single module or generate at build time |
| `src/cg-studio/export-template.js` vs `client/tools/electron-launcher/cg-studio/export-template.js` | parallel | Same pattern | Document as intentional fork or share via `src/` |
| `template/lower-thirds/lt-engine.js` (578) vs `lt-engine-from-client/lt-engine.js` (455) | differ | Client export snapshot vs canonical | Remove `from-client/` tree if export pipeline no longer writes there |

---

## 6. Deprecated & experimental folders

### `scripts/deprecated/` (11 shell scripts)

NVIDIA 595 install/fix scripts, kernel pin, production-host restore. Documented in `scripts/deprecated/README.md`. **Not used** by `package.json` scripts.

### `work/deprecated/` (25 files, ~3,360 lines)

Legacy monolith release scripts, old AMCP testers (`amcp-tester.js`, `boot-orchestrator.js`), DMX smoke tools. Documented in `work/deprecated/README.md`.

### `work/audio_testing/` (17 JS files)

Standalone harness under `work/` — not part of production or `npm test`. Keep in `work/` or archive; not stale *in* production tree.

---

## 7. Optional modules — stubs (not dead, but incomplete)

| Module | Client entry | Server register | Status |
|--------|-------------|-----------------|--------|
| **autofollow** | `client/assets/modules/autofollow/entry.js` | `src/autofollow/register.js` | Skeleton; 2× TODO WO-31 Phase 5 |
| **tracking** | `client/assets/modules/tracking/entry.js` | `src/tracking/register.js` | Skeleton; 1× TODO WO-19 Phase 5 |
| **previs** | `client/assets/modules/previs/entry.js` | `src/previs/register.js` | **Active** — large component tree, dynamically loaded |

Backend registers (`src/autofollow/register.js`, `src/tracking/register.js`, `src/previs/register.js`) are loaded via `src/module-registry.js` when enabled — not stale, but autofollow/tracking are **placeholder implementations**.

---

## 8. Legacy AMCP transport stack

| File | Lines | Status |
|------|------:|--------|
| `src/caspar/tcp-client.js` | ~160 | Active when `HIGHASCG_AMCP_LEGACY_TRANSPORT=1` |
| `src/caspar/amcp-protocol.js` | ~288 | Paired with above |
| `src/caspar/amcp-connection-adapter.js` | — | **Default** path (`casparcg-connection@6`) |

**Do not delete** until legacy transport smoke is retired and rollback policy changes. Mark as **maintained dead code** with explicit env-gate.

---

## 9. TODO / FIXME markers in production code

Only **6 production files** contain open `TODO` comments (excluding docs and wiki bundle):

| File | Count | Topic |
|------|------:|-------|
| `src/autofollow/register.js` | 4 | WO-31 backend stub |
| `src/previs/register.js` | 3 | WO-17 follow-on |
| `src/tracking/register.js` | 3 | WO-19 backend stub |
| `client/assets/modules/autofollow/entry.js` | 2 | WO-31 Phase 5 UI |
| `client/assets/modules/tracking/entry.js` | 1 | WO-19 Phase 5 UI |
| `client/components/previs-pgm-3d.js` | 1 | WO-17 tasks |

No widespread `FIXME`/`HACK` debt in `src/` or `client/lib/`.

---

## 10. Prioritized cleanup plan

### P0 — zero risk (do now)

1. Delete all `*.sync-conflict-*` files (43 files, ~9.8k lines).
2. Delete `template/lower-thirds/lt-engine-from-client/` (entire folder).
3. Delete `config/casparcg copy.config`.
4. Delete orphan duplicate `client/components/device-view-gpu-source-inherit.js`.

### P1 — low risk (one PR)

1. Remove dead exports listed in §4.
2. Delete orphan WO-08 widgets: `vu-meter.js`, `now-playing.js`, `profiler-display.js`, `output-status.js` (or wire them if still planned).
3. Delete `live-audio-play.js`, `playback-clock.js`, `scene-live-match.js`, `pixel-mapping-browser.js`, `device-view-destinations-drag.js` if product confirms abandonment.
4. Add `*.sync-conflict-*` to `.gitignore` / pre-commit hook.

### P2 — medium risk (review + test)

1. Remove `client/components/system-settings.js` (+ helpers if unused elsewhere).
2. Consolidate `lt-param-registry.js` duplicates.
3. Remove `stopCasparForApplyStart` after auditing `full-config-apply.js` nodm canvas path.
4. Archive `work/deprecated/` to a branch or tarball outside main tree.

### P3 — policy (when AMCP migration closes)

1. Remove `tcp-client.js` + `amcp-protocol.js` and `HIGHASCG_AMCP_LEGACY_TRANSPORT` flag.
2. Drop `npm run test:highascg:legacy` and related docs.

---

## 11. What is *not* stale (common false positives)

| Item | Why it looks unused | Reality |
|------|---------------------|---------|
| `client/lib/transition-presets.js` | Only imported by `program-output-state.js` | Re-exported to `scenes-shared.js`, `timeline-transport.js` |
| `client/lib/audio-mixer-state.js` | Static export analysis misses usage | `import * as audioMixerState` in mixer panels |
| Previs component files | Not in static graph from `app.js` | Loaded via `/assets/modules/previs/entry.js` dynamic import |
| CG Studio editor splits | Orphan in static graph | Loaded via `cg-studio/entry.js` and Vite `manualChunks` |
| `src/caspar/amcp-types.js` | No direct require | JSDoc `@import` types for `amcp-basic.js`, `amcp-mixer.js` |
| `src/sampling/sampling-worker.js` | Not in main graph | Spawned by path from `dmx-sampling.js` |

---

## Architecture context

| Area | Stale-code risk |
|------|-----------------|
| `src/engine/` | Low — sync-conflict duplicates only |
| `src/caspar/` | Medium — legacy transport pair (~450 lines) |
| `client/components/` | **High** — WO-08 orphans + duplicate inherit file |
| `template/lower-thirds/` | **High** — `from-client/` tree + copies |
| `tools/smoke/` | Low — 2 sync-conflict test duplicates |
| `work/` | N/A — experimental/deprecated by design |

---

*Generated by automated import/reference audit and manual verification on the playout host.*
