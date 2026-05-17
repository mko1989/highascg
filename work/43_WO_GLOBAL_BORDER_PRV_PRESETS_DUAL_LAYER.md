# WO-43 — Global border: PRV edit bus, PGM dual-layer presets, snapshot sync

**Status:** In progress — Phase A implemented (builders + API, state, preview, inspector, take path). Caspar hardware QA recommended.

**Scope:** Web UI (`inspector-panel-views.js`), client preview AMCP (`scenes-preview-runtime.js`), scene persistence (`scene-state.js`), Caspar command builders (`src/engine/global-border.js`), scene take (`src/engine/scene-take-lbg.js`), HTTP API (`src/api/routes-scene.js`).  
**Related:** WO-09 (global border), multiview preset slot pattern (`web/lib/multiview-state.js`).

---

## 1. Objective

1. **PRV edit bus (replaces “mirror” wording)**  
   - Toggle label reflects **PRV on channel N** (from `channelMap.previewChannels[screen]`), not a generic “mirror” string.  
   - When enabled, **AMCP for border parameter changes targets only the PRV Caspar channel** (layer **997**). PGM stack is not updated on every slider move so operators can match PRV to program without strobing ch1.  
   - **Save preset** always snapshots the **PGM air** border definition (what was last successfully pushed to the program stack / tracked snapshot), not the transient PRV-only edits unless those have been merged.

2. **Disable PRV bus → UI matches PGM**  
   - Turning **PRV off** reapplies **border property values in the Web UI** from the **last known PGM border snapshot** (`type`, `params`, `enabled`, `fadeDuration`, `artnetPatch`, `activePgmLayer`) so numbers match what is on **PGM** (ch1 in typical routing), not the PRV-only draft.

3. **Preset library (multiview-style growth)**  
   - Per-screen preset list persisted with `globalBorders[screen]` (project / localStorage).  
   - **Slot count** = `max(2, highestSavedSlotIndex + 2)` so empty tail slots always exist (e.g. no saves → slots `1–2`; after saving slot `1` → slots `1–3`).  
   - Each preset stores a **trimmed border payload** (no `mirrorBorderOnPrv`, no nested `borderPresets`).

4. **Preset recall = crossfade between CG layers 998 and 996 (PGM channel)**  
   - Maintain **`activePgmLayer`** in state: `998` or `996` — whichever layer is currently **visible** on PGM for the global border stack.  
   - On recall: **inactive** layer receives **`CG … UPDATE`** (or **`ADD+PLAY+UPDATE`** if that layer was never primed) with the preset’s template data, then mixer crossfade:  
     `MIXER <pgm>-<from> OPACITY 0 <dur>`  
     `MIXER <pgm>-<to> OPACITY 1 <dur>`  
   - After success, set `activePgmLayer` to the **to** layer and merge preset fields into `globalBorders[screen]`.  
   - Scene **take** path (`scene-take-lbg.js`) must use **`incoming.globalBorder.activePgmLayer`** (default **998**) instead of a hard-coded layer so looks stay consistent with the stack.

5. **Teardown**  
   - Disabling global border or clearing should target **both** PGM stack layers **998** and **996** when cleaning Caspar (avoid orphan templates), while PRV **997** remains conditional on mirror/meta as today.

---

## 2. API

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/scene/border-preset-crossfade` | `{ channel, fromLayer, toLayer, border, fadeDuration, inactiveMode: "add"\|"update" }` | `{ lines: string[] }` |

Server builds lines via `buildGlobalBorderPresetCrossfadeLines` in `global-border.js` (normalized border, `inactiveMode` chooses ADD vs UPDATE on **to** layer).

---

## 3. Client responsibilities

- **Inspector:** toggle copy, dynamic preset grid, save/recall wired to `sceneState` + `api.post` + `postAmcpPreviewPipeline` (or raw batch) including `MIXER <ch> COMMIT` when lines contain `DEFER`.  
- **`createScenesPreviewRuntime`:**  
  - PGM slot uses **`activePgmLayer`** (998/996).  
  - When **PRV edit** is on, `globalBorderCasparSlots` returns **only** `{ previewCh, 997 }`.  
  - On successful push to **PGM** 998/996, call `sceneState.noteGlobalBorderPushedToPgm(mainIdx, payload)`.  
  - **Clear slots:** PGM **998 + 996** + optional PRV **997** per meta/rules.

---

## 4. Acceptance criteria

1. With **PRV on ch N** enabled, inspector adjustments issue AMCP only to **PRV** layer **997**; PGM not spammed.  
2. Disabling **PRV** restores inspector fields from **PGM snapshot** (or last PGM push).  
3. Preset slot row count follows **`max(2, maxSavedSlot + 2)`**.  
4. Recalling a preset performs **UPDATE/ADD on inactive** layer then **opacity crossfade** 998↔996 on the **program** channel; `activePgmLayer` updates.  
5. Scene take uses **`activePgmLayer`** from the incoming look’s `globalBorder`.  
6. WO kept in sync as implementation lands; tests / manual Caspar log checklist in WO-09 style optional follow-up.

---

## 5. Risks

| Risk | Mitigation |
|------|------------|
| UPDATE on empty inactive layer | Client passes `inactiveMode: "add"` until meta/`pgmBorderLayerPrimed` marks layer ready. |
| Dual-layer + PRV 997 layer budget | Document 996/997/998 reserved for global border stack + PRV mirror. |
| Snapshot stale vs external AMCP | Document limitation; future: INFO/template query. |

---

## 6. Implementation log (short)

| Area | Done |
|------|------|
| `src/engine/global-border.js` | `buildGlobalBorderPresetCrossfadeLines`, layer constants |
| `src/api/routes-scene.js` | `POST /api/scene/border-preset-crossfade` |
| `web/lib/scene-state.js` | `activePgmLayer`, `pgmAirSnapshot`, `borderPresets`, preset CRUD, PRV-off PGM resync |
| `web/components/scenes-preview-runtime.js` | PRV-only slots when flag on; clear 998+996; `recallGlobalBorderPreset`; PGM snapshot hooks |
| `web/lib/amcp-preview-batch.js` | Shared batch sender |
| `src/engine/scene-take-lbg.js` | Incoming/current border layer resolution + dual clear on teardown |
| Inspector / scene-list / migrate | UI + look migration for `activePgmLayer` |
