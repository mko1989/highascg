# Work order: Per-main look spaces, global looks, and main selector UI

## 1. Current behavior (baseline — verify before implementation)

### 1.1 Data model (today)

- All looks are stored in a **single flat array**: `SceneState.scenes` (`web/lib/scene-state.js`).
- A “look” is a `Scene` object: `id`, `name`, `layers[]`, `defaultTransition`, etc. There is **no** `screenIndex`, `mainId`, or `global` field on a scene.
- `activeScreenIndex` only selects:
  - which **Caspar program/preview channel pair** is used for take/preview/compose;
  - which entry in `programResolutions` / `getCanvasForScreen` drives pixel layout.
- **Switching “Screen 1 / Screen 2” does not change which looks appear in the deck** — the same list is always shown; only the routing/canvas context changes.

### 1.2 Persistence and recall

| Path | What is stored | Notes |
|------|----------------|--------|
| **Browser `localStorage`** key `casparcg_scenes_v1` | `scenes`, `liveSceneId`, `previewSceneId`, `activeScreenIndex`, `globalDefaultTransition` | Hot reload; no per-main partitioning. |
| **Project export/import** (`web/lib/project-state.js`) | `sceneState.getExportData()` embedded under `scenes` in project JSON v1 | Same flat `scenes` array; `loadFromData` replaces entire `scenes`. |
| **Server persistence** (`index.js` + `persistence.get('scene_deck')`) | **Only** look `id` + `name` list (+ optional `previewSceneId`, `sceneSnapshots` via WS) | For Companion; full layer data can be pushed in snapshots but is not the primary long-term file format. |
| **WS** `scene_deck_sync` | Pushes look list + full `sceneSnapshots` for take-before-save | All looks in one payload. |

### 1.3 Implication

Implementing “each main has its own looks” is a **schema + UX + migration** change, not a small CSS tweak. Recall paths (localStorage, project file, server snapshot) must agree on a single extended model and migration rules.

---

## 2. Requirements (from product)

1. **Per-main look spaces**  
   - By default, a look is visible / editable only in the context of **one** main (one PGM/PRV pair), unless explicitly saved as **global** (see below).
   - Operators should not see the other main’s “private” looks in that main’s deck (unless global).

2. **Global looks**  
   - A look can be **saved with both mains selected** (or an explicit “Save as global” / multi-select) so it appears in **both** mains’ spaces and is the **same** definition (single `scene` id, shared layers).

3. **Main strip UI**  
   - For each main: a control showing **its name** and an **eye** icon.  
   - **Selection**: active main is visually **blue** (extends today’s “which main we’re outputting to” for compose/take).  
   - **Global save affordance**: when the interaction model allows **both** mains to be selected, saving a look creates/updates a **global** look (see §3.2).  
   - **Eye**: toggles **on/off the look editor** for that main (hide/show that main’s column or panel — exact layout in §4).

4. **Order of work**  
   - **First**: lock down save/recall semantics and data shape + migration.  
   - **Then**: implement UI and wiring.

---

## 3. Proposed data model (for review)

### 3.1 Scene scope (minimum viable)

Add to each `Scene` (or parallel wrapper — prefer inline on `Scene` for one export tree):

- `mainScope: '0' | '1' | '2' | '3' | 'all'`  
  - **`'0'..'3'`** — look belongs to that main index only (0-based, aligned with `activeScreenIndex` and `channelMap` indices).  
  - **`'all'`** — global look (shown under every main that exists in current `screenCount`).

**Alternative (equivalent):** `mainIds: number[]` with length 1 = single main, length N = same look shared (global when `length === screenCount` or explicit `[0,1,…]`).  
Recommendation: use **`mainScope: 'all' | string digit`** for a stable JSON shape and easy migration.

### 3.2 Rules

- **New look** (default): `mainScope` = **current** `activeScreenIndex` as string (`'0'`, …).  
- **Global look**: set `mainScope: 'all'` when user confirms save with **both/all mains** selected in the save flow (or a dedicated “Global look” toggle that only appears when `screenCount > 1`).  
- **Listing**: when `activeScreenIndex === k`, show scenes where `mainScope === String(k) || mainScope === 'all'`.  
- **Uniqueness**: name collisions can be per-`(mainScope)` or global to the project — product decision; recommend **per main for private**, allow duplicate names across mains, **global names unique** among `mainScope === 'all'` (or show both with badge).

### 3.3 Migration (existing users)

- **Option A (conservative):** all existing looks → `mainScope: '0'` (first main only). Mult-main users must reassign or duplicate into main 2.  
- **Option B (continuity):** if `screenCount` (from state) is **1**, keep behavior; if `screenCount > 1` on first load after upgrade, set all existing looks to `mainScope: 'all'` so nothing disappears from any main until the user tightens scope.  
- **Recommendation:** document both; pick **B** if the goal is zero surprise on upgrade, **A** if the goal is strict separation immediately.

`migrateScene` in `web/lib/scene-state-helpers.js` must set default `mainScope` when missing.

### 3.4 Export / project / server

- **Project JSON:** bump to **v2** *or* keep `version: 1` with additive fields on each scene (backward compatible if importers ignore unknown fields).  
- **Companion / `scene_deck`:** include `mainScope` (or `mainIds`) for each look in the list and in snapshots so external automation can filter; document breaking vs additive change for companion-module consumers.

---

## 4. UI/UX (Looks tab)

1. **Main row** (replace or extend current `scenes-screen-tab` / `renderScreenTabs`):  
   - One pill per main: **label** = user-facing name (from `channelMap.virtualMainChannels[i].name` or `Screen {i+1}`).  
   - **Active** = blue; sets `activeScreenIndex` and filters deck + compose routing (unchanged for AMCP — already keyed off index).  
   - **Multi-select** for save: e.g. Ctrl/Cmd-click second main, or checkboxes, or a “Select mains: ☐1 ☐2” in save dialog — product to choose one pattern.

2. **Eye (visibility)**  
   - Per main: **eye on** = show that main’s look **column** (or deck strip / split panel). **Eye off** = hide that main’s **editor** section only; does not delete looks.  
   - Persist eye state: `ui.mainEditorVisible: boolean[]` in settings or `sceneState` (prefer **settings** or a small `localStorage` key to avoid project noise).

3. **Layout** (implementation detail — separate spike)  
   - **Option 1:** Single deck list filtered by `activeScreenIndex` (minimal change) — *does not* give side-by-side columns.  
   - **Option 2:** **Columns** — one column per main (when eye on), each column lists only that main’s private + global looks; **active** column still highlighted. Matches earlier “columns of look editors” direction.

4. **Save / duplicate flows**  
   - **Save (new)**: default scope = active main only.  
   - **Save as global** (or multi-main): set `mainScope: 'all'`.  
   - **Duplicate**: inherit scope or ask — default to active main.

---

## 5. Engineering tasks (ordered)

### Phase 0 — Design sign-off (no code)

- [ ] Confirm migration strategy (A vs B in §3.3).  
- [ ] Confirm unique naming rules.  
- [ ] Confirm exact multi-select pattern for “save on both mains.”  
- [ ] Confirm Companion/HTTP API: whether `/api` exposes filtered decks per main for automation.

### Phase 1 — Schema + migration + tests (core)

- [ ] Add `mainScope` (or agreed field) to `Scene`; extend `migrateScene`.  
- [ ] Filter `getScenesForActiveMain()` (or list methods used by deck) by `activeScreenIndex` + `mainScope === 'all'`.  
- [ ] Update `addScene` / `duplicateScene` to set scope from current main or save dialog.  
- [ ] Extend `getExportData` / `loadFromData` and `localStorage` persist blob; version key bump if needed (`casparcg_scenes_v2`).  
- [ ] Unit-style or manual test matrix: import old project, import new project, two mains, global vs private.

### Phase 2 — Looks tab UI

- [ ] Main pills + active (blue) styling + optional multi-select for save.  
- [ ] Eye toggles; persist `mainEditorVisible[]`; layout: filtered single deck vs column layout (as decided).  
- [ ] “Save as global” / dual-main save when `screenCount > 1`.  
- [ ] Update `renderSceneDeck` / `scene-list` to use filtered list; ensure “Apply to all looks” only applies to **visible** or **all in scope** — product call.

### Phase 3 — Integrations

- [ ] `scene_deck_sync` payload: include `mainScope` per look; server persistence shape if required.  
- [ ] `GET /api/state` / scene list for Companion: document new fields.  
- [ ] Timeline: if looks are referenced by id, ensure timeline clips resolve when a look is private to another main (warn or filter).

### Phase 4 — Polish

- [ ] Settings copy / tooltips: explain global vs per-main.  
- [ ] Empty state when a main has no private looks (globals still show).

---

## 6. Risks and open questions

- **Take/Cut** always targets `programChannels[activeScreenIndex]` — stays true; private look on main 0 must not be takable to main 1 without user switching main and having a look there (or a global look).  
- **Previs / PIP / selection-sync** use `activeScreenIndex` — verify all call sites when deck is split by main.  
- **Performance:** large projects with many looks — filtering is O(n) per render; acceptable until proven otherwise.  
- **Offline mode** — same localStorage rules.

---

## 7. Out of scope (unless added later)

- Per-main **different** global defaults for transition (today one `globalDefaultTransition`).  
- Syncing look contents across mains (two copies) — not required if `mainScope: 'all'` is the single source of truth.  
- Role-based security hiding looks.

---

## 8. References (code)

- `web/lib/scene-state.js` — `scenes`, persist, `getExportData` / `loadFromData`  
- `web/lib/scene-state-helpers.js` — `migrateScene`  
- `web/lib/project-state.js` — project envelope  
- `web/components/scene-list.js` / `scenes-editor.js` — deck and tabs  
- `web/app.js` — `buildSceneDeckPayload`, `scene_deck_sync`  
- `src/config/routing.js` + `channel-map-from-ctx.js` — `screenCount`, `virtualMainChannels` for labels  

---

*Document version: 1.0 — draft for implementation planning.*
