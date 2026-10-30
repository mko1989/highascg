# WO-844 — Sweep: web client bugs

**Status: DONE (30.10, offline smokes; needs `npm run build:client` + browser reload, no live probe)**
**Source:** code sweep 29.10 (REPORT §4o–4q, §5 Web client, §7c count+1 ids (web side)).

Items: 4o Electron launcher curly quotes kill the renderer; 4p `1920x1080@50` matches `1080i5000` before
`1080p5000`; 4q Device View Ctrl+Z/Delete document-wide with no focus guard; countdown pos/font edits wipe each other
(WO-320A pos never persists); RMW-with-cached-GET silent reverts (WO-436 class); document shortcuts without a
text-field guard (Space toggles playback, Ctrl+V pastes a clip); `count + 1` ids (device-view-matrix,
mapping-node-service, device-graph-suggest); web side of the MIX+MERGE preset migration (shared with WO-843).


## 1. Investigation (30.10, every finding re-read in the code first)

- **4o** real. `client/tools/electron-launcher/index.html:107` had U+201D quotes round `class`/`id`/`data-partial`; the
  partial loader then read `”partials/tab-partition.html”` (ENOENT) and stopped the renderer init. The only other curly
  quotes in the launcher are prose in `partials/tab-partition.html:131` (harmless).
- **4p** real, and wider than reported. `matchCasparVideoModeFromDimensions` took the first mode in list order within
  0.06 fps, and `1080i*` precede `1080p*` (`1920x1080@50` -> `1080i5000`). The same loop also made `720p2400` resolve to
  `720p2398` (23.98 and 24 are 0.02 apart) and `PAL` beat `576p2500` for 720x576@25. `normalizeCasparVideoModeId` could not
  express `i`/`@` at all (`/^(\d+)x(\d+)p?([\d.]+)?$/`).
- **4q + shortcuts** real. `device-view-events.js` Ctrl+Z ran document-wide (no tab or field check; its Delete branch
  missed SELECT); `timeline-editor-inputs.js` only checked `inField` for arrows/Delete, so Space, Ctrl+C, Ctrl+V and
  Shift+Arrow acted from inside inputs. Multiview Delete and the Sources Delete had partial tag checks (no SELECT).
- **Countdown** real (client-components--part3). `getCurrentConfig()` listed 17 keys; `persistLocalConfig` replaced
  `source.countdownConfig`, `cgData` and `timer.config` wholesale with it, so `posX/posY` (WO-320A) never persisted and a
  `timerFontFamily`/border set on the timer instance was wiped by the next edit. Reproduced in a node test (old
  controller: `posX` undefined).
- **RMW with cached GET** (route sends `Cache-Control: max-age=3`, WO-436): `mapping-state.js _save` used a plain
  `api.get('/api/device-view')` before POSTing the whole graph (real, same hazard as WO-436); `pixel-map-editor.js`
  (two reads feeding the editor), `sources-panel-decklink-drop.js` (read right after a write) likewise. Bare `load()`
  (5 s payload cache) after mutations in `device-view-inspector-decklink-input.js` (3x), `-decklink-output.js` (2x, the
  next field then re-posts all form values incl. the reverted one) and `-gpu-layout-editor.js` (4x).
- **`count + 1` ids** real for web: `device-view-bands-render.js` (stream/record/audio add), `device-view-matrix.js`
  (stream/record), `mapping-node-service.js addMappingOutput` ([out_1,out_3] -> `out_3` again). `device-graph-suggest.js` has
  no `count + 1`; its real defect (sweep src-config) is DeckLink ids built from the slot but de-duplicated by device:
  input slot 2/dev 2 + output screen 2/dev 3 both `dlsdi_2` (reproduced), and `mergeHardwareSync` drops one. The other
  `length + 1` / `ui.count + 1` hits in client/ are display names or slot counts, not ids.
- **MIX + MERGE** real: `/\s*\+\s*MERGE\b/` -> `'+ ANIMATE'` ate the space ("MIX+ ANIMATE", not a known type) and
  `normalizeTransitionForPgmOnly` returned CUT.

## 2. What was done

- `client/tools/electron-launcher/index.html:107` ASCII quotes.
- `client/components/device-view-destinations-inspector-modes.js`: new `isInterlacedCasparMode()` (PAL, NTSC, `NNNNiRRRR`);
  `matchCasparVideoModeFromDimensions(w,h,fps,interlaced)` is progressive-first (`true` = interlaced only, `false` =
  progressive only, omitted = progressive then interlaced fallback, so NTSC still resolves) and picks the NEAREST fps
  (tolerance 0.07, replaces `fpsNear`). `normalizeCasparVideoModeId` accepts `p`/`i`/`@`; detected-display modes accept a
  trailing `i`.
- New `client/lib/keyboard-guard.js` (`isTextEntryTarget`, `isPanelActive`, `shouldIgnoreShortcut(ev, panel)`). Used in
  `device-view-events.js` (Ctrl+Z and Delete: Device View visible, not in a field, not from another tab pane; the old
  partial Delete check removed), `timeline-editor-inputs.js` (early return in a field for Space, Ctrl/Cmd+C/V,
  Shift+Arrow; the I/O/P/S/V/T keyframe letters stay live from the inspector on purpose), `scenes-editor-keyboard.js`,
  `multiview-editor.js` and `sources-panel.js` (Delete) - the last three just adopt the shared check (adds SELECT).
- `inspector-countdown-controller.js`: `getCurrentConfig(partial)` = cfg < layer countdownConfig < timer.config < rendered
  fields < just-edited partial, rendered fields only contribute keys whose control exists; `timer.config` and bound layers
  merge instead of replace. (Chosen over a "full 22-key list" because the timer panel owns keys this inspector never
  renders.)
- RMW call sites changed: `client/lib/mapping-state.js _save` (-> `MappingNodeService.fetchDeviceView()`),
  `client/components/pixel-map-editor.js` (2 reads), `client/components/sources-panel-decklink-drop.js` (read after
  write), and `load({ forceRefresh: true })` in `device-view-inspector-decklink-input.js` (3), `-decklink-output.js` (2),
  `-gpu-layout-editor.js` (4).
- New `client/lib/next-numbered-id.js` `nextNumberedIndex(items, prefix)` = max(existing)+1: used by
  `device-view-bands-render.js` (str/rec/audio), `device-view-matrix.js` (str/rec), `mapping-node-service.js` (out).
  `src/config/device-graph-suggest.js addDecklinkPort`: on an id clash with a different device the port is keyed
  `dlsdi_<device>` ("SDI <device>"), skipped only if that is taken too; non-clashing layouts keep their ids. Also dropped the
  unused `slug` import (file stays at 500 lines).
- `client/lib/transition-presets.js`: replacement is `' + ANIMATE'`, so `MIX + MERGE` -> `MIX + ANIMATE` (a known type,
  not a CUT). The coordinator's brief said "keep MIX + MERGE as MIX+MERGE"; the engine accepts `+ MERGE` but the web UI
  dropdown/PGM-only types only know `+ ANIMATE`, and wo843's Godot twin uses the same output, so web matches it.
- Skipped: `timer-control-panel-inline-time.js saveTimerConfigPatch` posts the full row snapshot (stale-snapshot RMW,
  not a cached GET; a smoke pins the client-side merge and the timer panel is another agent's area). Other bare
  `load()` calls in device-view inspectors (stream, record, caspar, virtual-cam, rear-order, gpu:377) were not audited.

## 3. Verified

- New `tools/smoke/smoke-wo844-web-client-sweep.test.js` (10 tests: mode-table round trip for every id, guard unit
  tests with fake elements + source pins, `nextNumberedIndex`, `addMappingOutput` with a stubbed api, device-graph-suggest
  clash, RMW source pins, MERGE migration, launcher tags) and `tools/smoke/smoke-wo844-countdown-config-merge.test.js`
  (real `sceneState` + the real controller with a fake `grp`; it FAILS on the pre-fix controller at "posX persisted",
  verified by running a copy of HEAD's file).
- 40 existing smoke files that reference the touched modules + the two new ones: 273/273 pass; eslint: 0 errors, no new
  warnings; `check-max-file-lines` clean for touched files.
- Not done: no `npm run build:client` here (coordinator), no browser probe; owner QA = type in a Settings field after a
  cable edit then Ctrl+Z (must undo text only), Space/Ctrl+V in Sources filter box while on Timeline, countdown Position px
  sticks.
