# Work Order 106: Project create/save/load pipeline hardening

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Complete (v2)

**Deferred / follow-up (v2 landed 2026-07-02):** replication tombstones, shared default project template, autosave/live-deck merge, mirror fallback warning, CI smoke wiring.
**Priority:** High — project persistence is the operator's show data; silent loss/rollback is unacceptable in live production
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on / touches:**
- `src/engine/project-store.js` — slug, read/write, autosave files, legacy migration
- `src/engine/project-scenes.js` — `persistProject`, `validateIncomingProject`, deck-sync merge, autosave merge
- `src/engine/new-project.js`, `src/engine/project-volume-sync.js`
- `src/api/routes-data.js` — `/api/project/*` handlers, `handleProjectList`
- `src/utils/persistence.js` — `.highascg-state.json` mirror
- `client/app.js` (autosave + `persisted` save), `client/lib/project-state.js`, `client/lib/project-files.js`, `client/lib/server-project-sync.js`, `client/lib/header-bar.js`, `client/components/load-project-modal.js`

---

## 1. Problem statement (from 2026-07-02 pipeline review)

The pipeline works day-to-day but has structural weaknesses:

### 1.1 Competing writers / race conditions
- **Three concurrent write paths** hit `persistProject` with fresh `savedAt` stamps: HTTP `POST /api/project/autosave` (client `triggerAutosave`, `client/app.js` ~197–230), HTTP `POST /api/project/save` fired from the `sceneState.on('persisted')` handler (`client/app.js` ~272–282), and WS `scene_deck_sync` (750 ms debounce in `project-scenes.js`). Whichever lands last wins; autosaves regularly bounce with `409 stale_saved_at` when deck sync wins the race.
- **Dual save on every scene edit**: `sceneState.change` schedules autosave AND (~1 s later) the localStorage `persisted` event fires a **full `/api/project/save`**. Redundant disk/network churn, and `save` broadcasts `project_sync` which can clobber another tab's in-progress edits.
- **Deck sync writes only the `scenes` slice** (`mergeDeckSyncIntoProject`) while autosave sends the full export — last-writer-wins on `timelines`/`multiview`/`programOutput` depending on timing.

### 1.2 Split-brain / dual stores
- `persistProject` (`project-scenes.js` ~421–469) writes **main file, autosave file, and `persistence.set('web_project')` mirror non-transactionally**. If the `projects/` write throws (it's caught and only warn-logged), the state mirror still updates → `.highascg-state.json` and `projects/<slug>.json` diverge, and `loadFullProject` may later serve the stale mirror as a "fallback", masking the broken file.
- `src/api/routes-mixer.js` (~190, ~289) reads/writes `persistence.get('web_project')` **directly**, bypassing the canonical `projects/` store and all validation.
- `web_project` is not in persistence `IMMEDIATE_KEYS`, so the mirror lags up to 200 ms behind the file (crash window).

### 1.3 Slug / identity problems
- **Slug algorithm mismatch**: server `projectSlugFromName` (NFKD → `[a-z0-9_]`, `project-store.js` 21–31) vs client `projectFileIdFromName` (`[^\w.-]+`, `client/lib/project-files.js` ~260). Non-ASCII or punctuated names produce different ids client vs server — client `save` posts `{ project, id }` with an id the server ignores in favor of its own slug.
- **Rename leaks files**: saving under a new name writes a new slug file, old slug file (and its `_autosave/` twin) is never deleted; `prevSlug` is captured in `routes-data.js` (~89, ~296) but unused. There is **no delete or rename API** at all — the `projects/` dir on this machine has 35 files including 6 Syncthing `*.sync-conflict-*` copies that all show up in the load modal as separate projects.

### 1.4 Validation / durability gaps
- `isProjectSaveNewerOrEqual` returns `true` when either `savedAt` is missing/unparsable (`project-scenes.js` ~366–372) — timestampless saves bypass rollback protection.
- `readProjectFile`/`readAutosaveFile` swallow JSON parse errors and return `null` — a corrupted project silently "doesn't exist"; no operator-visible error, no quarantine of the bad file.
- `migrateLegacySingleProject` uses a **plain `writeFileSync`** (`project-store.js` 74), not the tmp+rename pattern every other write uses.
- `POST /api/project/load` with an explicit slug uses `mergeAutosave: false` (`routes-data.js` ~153) — switching to a project **ignores its autosave recovery file**; only the active-project GET path merges autosave. After a crash, loading the same show from the modal discards the newest autosaved work.

### 1.5 Client-side robustness
- Autosave failure (including 409 rejection) is only `console.warn` (`client/app.js` ~212) — operator believes work is saved.
- `markServerProjectSynced()` runs even when the bootstrap project fetch **fails** (`client/lib/server-project-sync.js` ~112), so a client with stale state is then allowed to push over newer server data.
- Header "Save to file" download and client export omit `hardwareConfig` (server injects it only on server-side save), so downloaded project files are not full backups.
- `GET /api/project/list` never returns `sizeBytes`, but the load modal expects it (`client/lib/project-files.js` 16, 50) — the Size column is always empty.

### 1.6 Duplication
- Default empty project defined twice: `src/engine/new-project.js` (`buildNewUntitledProject`) and `client/lib/default-project.js` — must be kept in sync by hand.

---

## 2. Goal (normative)

1. **One writer discipline**: a scene edit results in exactly one server persist path (deck sync OR autosave, not both plus a full save), with well-defined slice-merge semantics.
2. **No silent divergence** between `projects/<slug>.json` and the state mirror; failed canonical writes must fail loudly and must NOT update the mirror.
3. **One slug algorithm**, shared (server exports it; client uses server-provided slug from responses instead of recomputing).
4. **Rename/delete lifecycle**: renaming migrates the file (old file removed or tombstoned), delete API exists, sync-conflict files are surfaced as conflicts (deduped), not as independent projects.
5. **Corruption is visible**: unparsable project files are quarantined (`<slug>.json.corrupt-<ts>`) and reported in `/api/project/list`; loads never silently return "nothing".
6. **Autosave recovery works on explicit load**: loading a slug offers/merges its newer autosave the same way the active-project path does.
7. **Operator feedback**: autosave/save failures surface as a UI toast/status, not console-only.

---

## 3. Recommended approach

### 3.1 Consolidate write paths (highest value)
- Drop the full `/api/project/save` from the `persisted` handler in `client/app.js`; let `scene_deck_sync` + autosave own incremental persistence, keep explicit Save button as the only `project/save` caller.
- Make `mergeDeckSyncIntoProject` and autosave share a single merge helper with per-slice `savedAt` awareness, or have autosave send only slices the client actually changed.

### 3.2 Fix persistProject ordering
- Write main file first; on failure **abort** (no mirror update, no autosave write), return `{ ok: false, error }` up through the route so the client gets a 500 and can warn the operator.
- Add `web_project`/`web_project_active_slug` both to immediate-flush keys, or drop the `web_project` mirror entirely in favor of reading the file (preferred end state — mirror only kept for legacy fallback one release).

### 3.3 Slug + lifecycle
- Export `projectSlugFromName` shape to the client (or return slug in save/autosave responses — server already stamps `slug` on the project; make client trust it).
- Implement `POST /api/project/rename` (write new, delete old + autosave) and `DELETE /api/project/:slug` (move to `projects/_trash/`). On save-with-new-name, use the captured `prevSlug` to clean up.
- In `listProjectFiles`, group `*.sync-conflict-*` under their base slug and mark `conflict: true`; UI shows one row with a conflict badge.

### 3.4 Validation & recovery
- Quarantine unparsable files on read; include `{ slug, error: 'corrupt' }` rows in list output.
- On explicit slug load, run `pickNewerFullProject(main, autosave)` just like the active path (optionally behind a `recover: true` flag with UI prompt).
- `migrateLegacySingleProject` → tmp+rename.

### 3.5 Client feedback
- `project-autosaved` event already exists; add `project-autosave-failed` and surface in the header status area (red dot + tooltip with reason, incl. 409 details).
- Don't call `markServerProjectSynced()` when the bootstrap fetch failed; instead retry, and block pushes until a fetch succeeds (or operator confirms).
- Add `sizeBytes` (from `statSync`) to `listProjectsFromVolumes` catalog rows.
- Include `hardwareConfig` in the file download path by fetching the server copy (`GET /api/project/file/:slug`) instead of exporting client state.

---

## 4. Tasks

- [x] **T106.1** Remove duplicate full-save on `persisted`; single incremental path (deck sync + autosave). Verify no regression in `scene_deck_sync` round-trip.
- [x] **T106.2** `persistProject`: main-write-first, abort on failure, propagate error to HTTP response; mirror update only after successful file write.
- [x] **T106.3** Slug unification: server returns authoritative `slug` in save/autosave/new responses; client stops computing `projectFileIdFromName` for server calls.
- [x] **T106.4** Rename cleanup using `prevSlug` + `POST /api/project/rename` + `DELETE /api/project/:slug` (trash folder, not hard delete) + load-modal delete/rename UI.
- [x] **T106.5** Sync-conflict dedup in list + conflict badge in load modal.
- [x] **T106.6** Corrupt-file quarantine + list reporting; `migrateLegacySingleProject` atomic write.
- [x] **T106.7** Autosave merge on explicit slug load (recovery parity with active-project path).
- [x] **T106.8** UI: autosave-failed indicator; bootstrap-failed push gate; `sizeBytes` in list; download uses server file (with `hardwareConfig`).
- [x] **T106.9** `routes-mixer.js`: route through `persistProject`/`loadFullProject` instead of raw `web_project` access.
- [x] **T106.10** Smoke tests: concurrent autosave+deck-sync ordering, failed-write no-mirror-update, rename cleanup, corrupt-file quarantine, slug parity for `"Zażółć #1"`-style names.

---

## 5. Acceptance criteria

1. Editing scenes produces no `/api/project/save` traffic; only deck sync + autosave. Explicit Save still broadcasts `project_sync`.
2. Killing write permission on `projects/` makes save/autosave return 5xx and the UI shows a failure indicator; `.highascg-state.json` is NOT updated with the failed payload.
3. Renaming a project leaves exactly one `<newslug>.json` (+ autosave); old files gone/trashed. Projects can be deleted from the load modal.
4. A project named with diacritics/punctuation round-trips with identical slug client and server.
5. Corrupting a project file by hand → list shows it as corrupt, file is quarantined, no silent `{}`.
6. After simulated crash (autosave newer than main), loading that slug from the modal restores the autosaved content.
7. Load modal Size column populated; downloaded project JSON contains `hardwareConfig`.

---

## 6. Rollout / risk notes

- T106.2 changes failure semantics — deploy behind careful testing; a box with a full disk previously "kept working" off the mirror.
- Keep the `web_project` mirror read-fallback for one release before removal; log a deprecation warning when the fallback is actually used.
- Coordinate with replication (`src/replication/replicate-projects.js`) — rename/delete must push tombstones or peers will resurrect old slugs.

---

## Work Log

### 2026-07-02 — Initial WO (from full pipeline review)

- Captured findings from the project create/save/load review (competing writers, split-brain mirror, slug drift, missing rename/delete, silent corruption, autosave-recovery gap on explicit load).
- **Instructions for Next Agent:** Start with T106.1 + T106.2 (they remove the majority of race/divergence risk with small diffs). T106.4/T106.5 change list semantics — sync with the load-modal UI before landing. Do not remove the `web_project` mirror in the same batch as T106.2.

### 2026-07-02 — WO-106 v1 implementation (agent)

**Server**
- `persistProject` now writes the main file first and throws on failure; mirror/autosave update only after success (`project-scenes.js`). `web_project` added to persistence immediate-flush keys.
- Save/autosave return `{ slug, activeSlug }`; save/autosave rename retires `prevSlug` via `retireProjectSlug()` → `projects/_trash/`.
- `POST /api/project/rename`, `DELETE /api/project/:slug`; explicit slug load merges autosave (`mergeAutosave: true`) and sets `_recoveredFromAutosave` when newer autosave wins.
- `project-store.js`: atomic legacy migration, corrupt-file quarantine, trash retire, sync-conflict filename parsing.
- `project-volume-sync.js`: `sizeBytes` in catalog, `finalizeProjectCatalog()` dedupes Syncthing conflicts, corrupt rows in list.
- `routes-mixer.js`: uses `loadFullProject` + `persistProject` instead of raw `persistence.set('web_project')`.

**Client**
- Removed `/api/project/save` from `sceneState.on('persisted')` — deck sync + autosave only (`app.js`).
- Autosave failures dispatch `project-autosave-failed`; header indicator shows red reason (`header-bar.js`). API errors carry `reason` + `status`.
- Bootstrap blocks push when server project fetch fails (`server-project-sync.js`).
- Unified `projectFileIdFromName` with server NFKD slug; `projectState.projectSlug` from server responses.
- Load modal: conflict/corrupt badges, delete button, autosave recovery via `loadProjectFileById`, Size column via `sizeBytes`.
- Shift+Save download fetches server file (includes `hardwareConfig`).

**Tests:** `tools/smoke/smoke-project-pipeline-hardening.test.js` (slug parity, persist failure, quarantine, conflict dedup).

**Deferred / follow-up**
- Replication tombstones on rename/delete (coordinate with `replicate-projects.js`).
- Concurrent autosave+deck-sync ordering integration test (unit coverage only).
- Default empty project still duplicated client/server (`new-project.js` vs `default-project.js`).

**Instructions for Next Agent:** Exercise rename/delete on a dev box with Syncthing conflict files; add replication tombstones before field deploy; consider wiring `smoke-project-pipeline-hardening.test.js` into `package.json` `test:ci` if not already present.

### 2026-07-02 — WO-106 v2 follow-up (agent)

**Replication tombstones**
- `src/replication/project-tombstone.js`: leader pushes `POST /api/replication/project-tombstone`; follower retires non-active slugs.
- `retireSlugWithReplication()` in `routes-data.js` on save-rename, rename API, and delete API.

**Autosave / deck-sync race**
- `enrichProjectScenesFromLiveDeck()` merges `ctx.sceneDeck.sceneSnapshots` into autosave payload before persist.

**Shared default project**
- `data/default-empty-project.json` — single template used by `new-project.js` and `client/lib/default-project.js`.

**Other**
- `loadFullProject` logs deprecation warning when `web_project` mirror fallback is used.
- `tools/smoke/smoke-project-pipeline-hardening.test.js` added to `test:ci` curated bundle (tombstone + deck merge tests).

**Instructions for Next Agent:** Fix pre-existing flaky `smoke-project-scenes.test.js` “fills layer payloads…” (needs mocked `loadFullProject`, not live disk). Consider removing `web_project` mirror after one release if fallback is never hit in logs.
