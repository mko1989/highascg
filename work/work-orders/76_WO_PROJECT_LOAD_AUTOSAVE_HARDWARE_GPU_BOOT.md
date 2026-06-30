# Work Order 76: Project load/autosave correctness, same-machine hardware UX, GPU boot snapshot

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Shipped (code + smoke tests 2026-06-29); live QA on booth hardware optional  
**Priority:** High (operator workflow — wrong project after reboot, spurious hardware modal, unintended Caspar restart on load)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on (required reading):**
- [61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md](./61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md) — show vs machine profile split on leader/follower
- [54_WO_HOT_BACKUP_LEADER_FOLLOWER_REPLICATION.md](./54_WO_HOT_BACKUP_LEADER_FOLLOWER_REPLICATION.md) — project push/receive
- [35_WO_GPU_PHYSICAL_CONNECTOR_STABILITY.md](./35_WO_GPU_PHYSICAL_CONNECTOR_STABILITY.md) — `gpuPhysicalTopology`, xrandr pairing
- [62_WO_PROJECT_SCOPED_MEDIA_ROOT.md](./62_WO_PROJECT_SCOPED_MEDIA_ROOT.md) — project media roots per slug
- [docs/wiki/api/project.md](../../docs/wiki/api/project.md) — save/load/autosave API contract

**Operator report (2026-06-29):**
- After server restart, expect **last edited state (autosave)** for the **active** project.
- Loading a **different** project must **not** merge that project's autosave (or another slug's autosave).
- Hardware mismatch modal still appears on load — should be gone (client + server on same machine; only deployment mode now).
- Loading a project must **not** auto-apply hardware / restart Caspar — operator verifies Device View first, then applies manually.
- GPU port layout drifts at boot — capture `xrandr --query` early (Openbox autostart) so Web UI can align topology on first open.
- **Test laptop:** GPU exposes **4 ports**; no obvious A/B bank pairs (unlike production WO-35 profile).

---

## 1. Problem statement

| Symptom | Impact |
|---------|--------|
| Reboot restores **saved** project file, not **newer autosave** | Operator loses last looks/timeline edits after power cycle |
| Load another project sometimes shows **“Hardware does not match”** modal | Friction on single-box installs; blocks air prep |
| **Apply saved hardware** path runs snapshot + OS + Caspar apply on load | Unwanted Caspar restart mid-show-prep |
| Device View GPU map wrong until operator refreshes / saves layout | Cabling UI does not match physical ports after cold boot |
| Leader/backup project sync semantics unclear | Risk of overwriting follower wiring or stale autosave on wrong slug |

**Goal:** Correct autosave semantics, make load **looks-only by default** on the unified same-machine client, and seed GPU topology from an early-boot xrandr capture.

---

## 2. Current architecture (as implemented)

### 2.1 On-disk layout

| Path | Role |
|------|------|
| `~/highascg/projects/<slug>.json` | Named project (explicit Save) |
| `~/highascg/projects/_autosave/<slug>.json` | Autosave draft for slug (debounced client + server) |
| `.highascg-state.json` → `web_project_active_slug` | Active project slug |
| USB `HIGHASCGEXF/projects/` + `_autosave/` | Field catalog (boot pull when follower / non-leader) |
| Bridge `HIGHASCGDAT/projects/` + `_autosave/` | Production sync (mtime newest wins for autosave pull) |

**Save/autosave:** `persistProject` writes main + `_autosave/`, then `pushProjectSlugToVolumes` copies **only that slug** to USB/bridge when mounted.

**Read paths:**
- `readProjectFile(slug)` — main file only (+ USB pull-if-newer for main)
- `readAutosaveFile(slug)` — autosave only (+ volume pull-if-newer)
- `loadFullProject()` — active slug main **merged** with autosave via `pickNewerFullProject` (non-empty looks win; then newer `savedAt`)

### 2.2 API behaviour today

| Route | Autosave merge? | Applies hardware to server config? |
|-------|-----------------|-----------------------------------|
| `GET /api/project` | **Yes** (`loadFullProject`) | No |
| `POST /api/project/load` **no slug** (active) | **No** — `readProjectFile` only if file exists | **Yes** (`applyHardwareConfigFromProject`) |
| `POST /api/project/load` **with slug** | **No** — intentional | **Yes** |
| `GET /api/project/file/:slug` | **No** — raw file for picker | No |

**Bootstrap:** `client/lib/server-project-sync.js` → `fetchProjectFromServer()` tries `GET /api/project` first (autosave merge OK), then `POST /api/project/load {}` (merge **broken** when main file exists).

### 2.3 Leader ↔ backup (hot replication)

| Direction | Mechanism | Machine profile |
|-----------|-----------|-----------------|
| Leader → follower | `POST /api/replication/project` with `stripDeviceLocalFromProject` | **Stripped** — `deviceGraph`, `screenDestinations`, `osDisplay`, `casparServer`, `gpuPhysicalTopology`, `fingerprint` never travel |
| Follower merge | `mergeSharedProjectIntoLocal(existing, incoming)` | Local machine slices **preserved** |
| Follower activate | `commitReplicatedProject` | Caspar regenerate **only when active slug changes** |
| Leader save hook | `onProjectSavedForReplication` → `pushProjectToPeer` | Pushes show slice + media rsync |
| exFAT boot pull | `shouldAllowExfatPullShowData()` | **Blocked** when `leaderOwnsActiveShow` |

**Implication:** Backup box keeps its own Device View; show content (looks, timelines, routing *definitions*) follows leader. Autosave on follower is local per slug — not replicated as a separate file (leader push writes main project JSON).

### 2.4 Client hardware reconcile on import

`client/lib/project-import-flow.js`:

| `source` | Modal bypass? |
|----------|---------------|
| `server-bootstrap`, `server-reconnect` | Yes when `sameMachine` **or** soft OS/Caspar-only drift |
| `load-modal`, `file` | **No** — modal can appear |
| Policy `apply_saved` / `keep_live` in localStorage | Can auto-apply or skip modal |

`applyFull()` → `applyProjectHardware()` → `POST /api/device-snapshot/apply`, `POST /api/settings/apply-os`, `POST /api/caspar-config/apply` (restart).

Load modal wires `onApplyServerProject` → `POST /api/project/load` when user chooses **Apply saved hardware**.

---

## 3. Product behaviour (normative — target)

### 3.1 Autosave rules

| Scenario | Expected |
|----------|----------|
| **Server restart / bootstrap** (active slug unchanged) | Return **merged** project: `pickNewerFullProject(main, autosave)` for **active slug only** |
| **Explicit load** of slug B (picker, `POST /api/project/load` with slug) | Return **main file only** for slug B — **never** `_autosave/B.json` unless operator chooses “restore autosave draft” (future; out of scope unless requested) |
| **Autosave** while editing slug A | Writes `_autosave/A.json` only; does not change active slug |
| **Switch active slug** | Previous slug's autosave remains on disk; not loaded for other slugs |

### 3.2 Same-machine load UX (unified client)

HighAsCG now runs **client + server on one box** only.

| Action | Expected |
|--------|----------|
| Load project (modal or file) | **Looks-only import** — no hardware reconcile modal |
| Optional banner | Soft reminder: “Verify Device View before air” (existing keep-live banner OK) |
| Apply hardware | **Manual only** — Device View actions / Settings / explicit “Apply project hardware” if we keep it |

Remove or gate `showProjectHardwareReconcileModal` when:
- `sameMachine === true` (hostname match in `hardwareConfig.fingerprint`), **or**
- `HIGHASCG_UNIFIED_CLIENT` / always true in production builds.

**Do not** call `applyProjectHardware` from load path.

### 3.3 Server load must not mutate playout stack

`POST /api/project/load` should:
- Set active slug, ensure media dir, return project JSON
- **Not** call `applyHardwareConfigFromProject` by default (or gate behind `body.applyHardware === true`)

Hardware apply + Caspar restart remain **explicit** APIs (`/api/device-snapshot/apply`, `/api/settings/apply-os`, `/api/caspar-config/apply`).

### 3.4 GPU boot snapshot (xrandr)

Early in X session (Openbox autostart, **before** or **after** `apply-layout.sh` — document choice):

```bash
DISPLAY=:0 xrandr --query > "${HOME}/highascg/data/runtime/boot-xrandr-query.txt"
# optional: --verbose + timestamp sidecar
```

Server on first Device View / GPU layout probe:
1. Prefer live `xrandr` when `DISPLAY` available
2. Else read `data/runtime/boot-xrandr-query.txt` (if fresh, e.g. &lt; 24 h, same boot id)
3. Feed `discoverGpuPhysicalTopologyFromXrandr(raw)` (`src/utils/gpu-topology-xrandr.js`)

**4-port laptop profile:** When `xrandr` lists 4 outputs with **no A/B pairs**, topology builder should emit **4× `gpu_pN` rows** (one xrandr name each) — not assume WO-35 production 4× paired jacks. Extend `discoverGpuPhysicalTopologyFromXrandr` or add `discoverGpuPhysicalTopologyFromXrandrFlat` when pair count === output count.

Reference capture script (revive from deprecated): `work/deprecated/tools/gpu-map-reboot-capture.sh`.

---

## 4. Implementation plan

### Phase A — Server autosave merge fix

- [x] **T76.A.1** Add `loadProjectForSlug(slug, { mergeAutosave: boolean })` in `project-store.js` or `project-scenes.js` — single source of truth
- [x] **T76.A.2** `POST /api/project/load`: `mergeAutosave: true` only when **no** `slug`/`id` in body (active project bootstrap); `false` when explicit slug
- [x] **T76.A.3** `GET /api/project` — keep `mergeAutosave: true` for active slug
- [x] **T76.A.4** Smoke: main older than autosave → bootstrap returns autosave; explicit load of same slug returns main only
- [x] **T76.A.5** Document in `docs/wiki/api/project.md`

### Phase B — Load = looks only (client + server)

- [x] **T76.B.1** `project-import-flow.js`: for `load-modal`, `file`, and same-machine — skip modal; always `importLooks()`; never `applyFull()` from load
- [x] **T76.B.2** Remove or no-op `onApplyServerProject` from `load-project-modal.js` import deps
- [x] **T76.B.3** `routes-data.js` `POST /api/project/load`: remove default `applyHardwareConfigFromProject` (or `applyHardware: true` opt-in)
- [x] **T76.B.4** Keep `injectHardwareConfigToProject` on **save/autosave** only
- [ ] **T76.B.5** Regression: bootstrap/reconnect still hydrates looks; Device View unchanged until operator applies

### Phase C — GPU boot xrandr capture

- [x] **T76.C.1** Add `tools/runtime/capture-boot-xrandr.sh` (writes under `data/runtime/`, creates dir, logs timestamp)
- [x] **T76.C.2** Wire into `scripts/setup/09-openbox-autostart.sh` after `DISPLAY=:0` export (run once per session)
- [x] **T76.C.3** Server: `src/utils/gpu-topology-xrandr.js` or device-view boot path reads snapshot when live probe empty
- [x] **T76.C.4** 4-port flat topology: when ≤4 DP-only outputs, one `gpu_pN` per xrandr line (`prefersFlatXrandrTopology`)
- [x] **T76.C.5** Optional: include snapshot in support bundle (`gpu-display-snapshot.js`)

### Phase D — Replication / volume clarity (docs + tests)

- [x] **T76.D.1** Assert `receiveProjectFromPeer` never applies peer `hardwareConfig` machine slices (strip + merge path in `smoke-replication-project-receive.test.js`)
- [x] **T76.D.2** Clarify in `docs/reference/hot-backup-replication.md`: autosave is local; leader push is main JSON at save time
- [x] **T76.D.3** Verify `pullAutosaveSlugFromVolumesIfNewer` only runs for **read** of matching slug (`readAutosaveFile` slug guard + volume path contract test)

---

## 5. Key files

| Area | Files |
|------|-------|
| Autosave merge | `src/engine/project-scenes.js`, `src/engine/project-store.js`, `src/api/routes-data.js` |
| Volume sync | `src/engine/project-volume-sync.js`, `src/system/exfat-sync.js` |
| Replication | `src/replication/replicate-projects.js`, `src/config/config-classify.js` |
| Client load | `client/lib/project-import-flow.js`, `client/components/load-project-modal.js`, `client/lib/server-project-sync.js` |
| Hardware apply | `client/lib/project-hardware-apply.js`, `src/engine/project-hardware-config.js` |
| GPU topology | `src/utils/gpu-topology-xrandr.js`, `client/lib/device-view-gpu-port-topology.js`, `src/bootstrap/device-graph-boot-sync.js` |
| Autostart | `scripts/setup/09-openbox-autostart.sh` |

---

## 6. Acceptance criteria

- [x] Reboot → Web UI shows **autosaved** looks when autosave `savedAt` newer than main file (active slug) — `loadProjectForSlug` + POST load without slug.
- [x] Load project B from modal → shows **main** project B; no autosave merge; **no** hardware modal on same machine.
- [x] Load does **not** restart Caspar or run `apply-os` / device-snapshot apply (default `applyHardware: false`; client looks-only).
- [x] Operator can still apply hardware manually from Device View after reviewing cabling.
- [ ] After cold boot, first Device View open shows GPU ports consistent with `boot-xrandr-query.txt` on test laptop (4 ports) — **live QA**.
- [x] Leader push to backup still updates looks; backup Device View / GPU map unchanged (strip/merge + smoke tests).

---

## 7. Test plan

1. Edit looks only → wait for autosave → `systemctl restart` HighAsCG server → confirm looks restored.
2. Save named project → edit again → autosave newer → Load same project from modal → confirm **saved** version (not autosave) unless we add explicit “restore draft” later.
3. Load different slug → confirm no cross-slug autosave bleed.
4. Load on single box → no hardware modal; Caspar uptime unchanged (no restart).
5. Reboot → open Device View → GPU port count/order matches `xrandr --query` captured at autostart.
6. Paired leader/follower: save on leader → follower gets looks; follower GPU config unchanged.

---

## Work Log

### 2026-06-29 — Investigation (agent)

**Done:**
- Traced save/load/autosave paths: `project-store.js`, `project-scenes.js`, `project-volume-sync.js`, `routes-data.js`.
- Identified **autosave gap**: `POST /api/project/load` without slug uses `readProjectFile` only; does not call `loadFullProject` when main file exists.
- Traced leader/follower sharing: `stripDeviceLocalFromProject`, `mergeSharedProjectIntoLocal`, `commitReplicatedProject` (Caspar regen on slug change only).
- Confirmed hardware modal still shown for `load-modal` / `file` sources; `applyFull()` triggers Caspar apply path.
- Confirmed `POST /api/project/load` always runs `applyHardwareConfigFromProject` (config write, not Caspar restart — client `applyProjectHardware` does restart).
- Reviewed Openbox autostart (`09-openbox-autostart.sh`) — no xrandr capture today; WO-35 capture script in `work/deprecated/tools/`.

**Root causes:**
1. Split merge logic between GET and POST load endpoints.
2. Hardware reconcile modal not disabled for unified same-machine load.
3. Load modal still wires optional full hardware apply.
4. No early-boot xrandr artifact for GPU topology when Web UI opens before live probe stabilizes.

**Instructions for Next Agent:**
1. Start with **Phase A** (server merge flag) — smallest fix for reboot autosave.
2. Then **Phase B** — remove modal + server hardware apply on load; run smoke tests in `tools/smoke/smoke-project-hardware-config.test.js` area.
3. **Phase C** — autostart script + flat 4-port topology; test on reported laptop.
4. Update `project_status.md` when phases ship.

### 2026-06-29 — Phase A shipped (agent)

**Done:**
- Added `loadProjectForSlug(slug, { mergeAutosave })` in `src/engine/project-scenes.js`; refactored `loadFullProject` to use it.
- `POST /api/project/load`: explicit `slug`/`id` → main file only; omit slug → `loadFullProject()` (autosave merge).
- Documented merge rules in `docs/wiki/api/project.md`.
- Smoke tests in `tools/smoke/smoke-project-scenes.test.js` for both merge modes.

**Instructions for Next Agent:**
1. Implement **Phase C** — boot xrandr capture + flat 4-port topology when ready.
2. Manual QA for T76.B.5 (bootstrap + load from modal on live box).

### 2026-06-29 — Phase B shipped (agent)

**Done:**
- `project-import-flow.js`: `load-modal` and `file` sources always looks-only (no hardware modal, no `applyProjectHardware`).
- `load-project-modal.js`: removed `onApplyServerProject`; after import calls `POST /api/project/load` with slug only (activates server slug, no hardware apply).
- `POST /api/project/load`: `applyHardwareConfigFromProject` gated behind `applyHardware: true` (default off).
- Docs updated for `applyHardware` field.

**Instructions for Next Agent:**
1. Phase C — `capture-boot-xrandr.sh` + Openbox autostart + flat 4-port topology.
2. Live QA: load project from modal — no modal, Caspar unchanged, Device View unchanged until manual apply.

### 2026-06-29 — Phase C shipped (agent)

**Done:**
- `tools/runtime/capture-boot-xrandr.sh` → `~/highascg/data/runtime/boot-xrandr-query.txt` + meta JSON.
- Openbox autostart runs capture before `apply-layout.sh`; installer copies to `/usr/local/bin/highascg-capture-boot-xrandr.sh`.
- `src/utils/boot-xrandr-snapshot.js` — read with 24 h max age; used by `hardware-info`, `gpu-topology-drm`, `gpu-topology-xrandr`.
- Flat 4-port laptop topology: `prefersFlatXrandrTopology` (≤4 DP-only lines → one `gpu_pN` per output).
- `gpu-physical-map.js`: saved `gpuPhysicalTopology` in config wins over live probe for mapping.
- Support bundle includes `bootXrandr` summary.
- Smoke: `smoke-boot-xrandr-snapshot.test.js`, flat topology case in `smoke-gpu-physical-map.test.js`.

**Instructions for Next Agent:**
1. Phase D — replication docs/tests (`receiveProjectFromPeer` machine slice guard).
2. On installed hosts: re-run `sudo bash scripts/setup/09-openbox-autostart.sh` to pick up autostart capture line.
3. Live QA: cold boot → open Device View → GPU port count matches boot xrandr capture.

### 2026-06-29 — Phase D shipped (agent)

**Done:**
- `smoke-replication-project-receive.test.js` — strip + merge path keeps follower `deviceGraph`, `osDisplay`, `gpuPhysicalTopology`, `fingerprint`; leader `screenDestinations` + looks apply.
- `docs/reference/hot-backup-replication.md` — new section on project files, autosave, USB/bridge, replication (autosave not replicated).
- `smoke-project-volume-sync.test.js` — autosave path contract per slug; `smoke-project-store` — `readAutosaveFile` slug guard.

**Instructions for Next Agent:**
1. Live QA on test laptop: reboot → Device View GPU ports vs `data/runtime/boot-xrandr-query.txt`.
2. Optional: full `receiveProjectFromPeer` integration test if `persistProject` export mocking is refactored.
