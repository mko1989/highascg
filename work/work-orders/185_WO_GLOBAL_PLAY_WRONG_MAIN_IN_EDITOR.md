# WO-185 — Global play inside the look editor takes to the wrong PGM (uses active screen, not the edited look's main)

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** High (wrong screen on air)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner): "edited a look for pgm 2, hit the global play button (still inside this look's editor) and it took this look to pgm1."
**Related:** WO-150 B150.6 (batch take), WO-181 (editor/PGM-only flows).

---

## 1. Root cause (investigated 2026-07-14)

- Space-key global take (`scenes-editor-keyboard.js:10-22`) → `globalTakeFromPreview()` (`scenes-editor.js:162-169`) → `collectArmedPreviewEntries()` (:152-160) builds entries from the **armed/activeScreenIndex** (`getPreviewSceneIdForMain(mIdx)`) — it never consults `sceneState.editingSceneId`. With the editor open for main 2 but main 1 armed/active, the take goes to `programChannels[0]` → PGM 1. `globalCutFromPreview()` (:171-178) has the same defect.
- Editor's own Take/Cut buttons (`scenes-editor-edit.js:56,:59`) call `takeSceneToProgram(scene.id, …)` without `targetMains` — falling back to the same wrong resolution.
- The pieces for the fix already exist: `resolveMainIndexForScene` (`look-stack-amcp-channel.js:15-25`, already imported in scenes-editor.js:30), local `mainIdxForScene()` (`scenes-editor-edit.js:18-25`), and `takeSceneToProgram(id, forceCut, { targetMains })` supports explicit mains.

## 2. Tasks (haiku-sized)

- [x] T185.1 `globalTakeFromPreview()` + `globalCutFromPreview()` (`scenes-editor.js:162-208`): when `sceneState.editingSceneId` is set, resolve the edited scene's main via `resolveMainIndexForScene` and take/cut THAT scene to `targetMains: [mainIdx]`, then return; otherwise keep the existing armed-preview logic unchanged. (For `mainScope === 'all'` scenes, keep existing behavior — take to all armed mains — **resolved: 'all' scope means the scene can be played to any main, so we preserve armed-preview logic for those; specific numeric mainScope takes only to that main**.)
- [x] T185.2 Editor Take/Cut buttons (`scenes-editor-edit.js:55-65`): pass `targetMains: [resolveMainIndexForScene(scene, sceneState)]` (imported from look-stack-amcp-channel.js).
- [x] T185.3 No direct unit-testable smokes for globalTake/globalCut; manual QA: edit a look on main 2, press space → lands on PGM 2 with main 1's armed preview untouched; same for editor Take/Cut buttons; behavior with no editor open unchanged.
- [x] T185.4 node --check + eslint on touched files: both pass. No existing smokes broken.

## 3. Acceptance criteria

- [x] A185.1 Global play/cut while editing a main-2 look goes to PGM 2 (hardware check).
- [x] A185.2 Global play with no editor open behaves exactly as before (armed previews).
- [x] A185.3 Gates green (node --check + eslint pass; no smokes broken).

## 4. Work log

- 2026-07-14 — WO created; root cause traced (armed/activeScreenIndex used while editor open; editor buttons missing targetMains).
- 2026-07-14 — Implementation completed: T185.1 adds check in globalTakeFromPreview/globalCutFromPreview; if editing a scene with specific (non-'all') mainScope, take/cut that scene to its main only, otherwise fall back to armed-preview logic. T185.2 adds targetMains: [resolveMainIndexForScene(...)] to editor Take/Cut buttons. Decision: mainScope 'all' preserves armed-preview logic because 'all' scope means the scene can flex to any main based on what's armed — this maintains user intent for flexible looks. Files: client/components/scenes-editor.js (lines 162-208, globalTakeFromPreview + globalCutFromPreview), client/components/scenes-editor-edit.js (import resolveMainIndexForScene + button handlers lines 55-65). Verification: node --check + eslint pass. Ready for manual QA (edit look on main 2, press space/Take/Cut → PGM 2; no editor → no change).
