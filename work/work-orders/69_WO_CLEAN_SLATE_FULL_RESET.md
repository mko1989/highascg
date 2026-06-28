# Work Order 69: Clean-slate full reset (internal wipe, preserve bridge + exFAT)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Draft — no implementation started  
**Priority:** Medium (operator / lab tooling — enables repeatable backup-sync QA on installed rigs)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Related:**
- [52_WO_BRIDGE_DISK_PARTITION_AND_USB_SYNC.md](./52_WO_BRIDGE_DISK_PARTITION_AND_USB_SYNC.md) — **preserve** `HIGHASCGDAT` bridge + `HIGHASCGEXF` USB trees
- [47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md](./47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md) — boot mtime sync after reset
- [62_WO_PROJECT_SCOPED_MEDIA_ROOT.md](./62_WO_PROJECT_SCOPED_MEDIA_ROOT.md) — `media/projects/<slug>/` on internal disk
- [59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md](./59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md) — existing **factory reset** (config + empty project only)
- [39_WO_SETTINGS_SYSTEM_HARDWARE.md](./39_WO_SETTINGS_SYSTEM_HARDWARE.md) — Nuclear tab, `checkNuclearPassword`, `sudo -n` helpers
- [61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md](./61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md) — bulk clone vs clean internal state
- [67_WO_LOGS_MODAL_CATEGORIES_AND_SUPPORT_BUNDLE.md](./67_WO_LOGS_MODAL_CATEGORIES_AND_SUPPORT_BUNDLE.md) — optional pre-reset support bundle

**Operator entry point (target):** **Settings → Nuclear** → **Clean slate reset** (with confirmation + optional nuclear password).

---

## 1. Problem statement

| Need | Today | Gap |
|------|-------|-----|
| Test **bridge / USB boot sync** on a “fresh” internal install | Manual `rm -rf` of projects, media, config — error-prone | No audited, mount-aware script |
| Reset an **installed production box** without wiping field kits on stick or bridge library | Factory reset clears **config + active project** only (`POST /api/config/reset`, `performFactoryReset()`) | **Other project JSON files**, **internal media**, **state**, **logs**, **replication pairing** remain |
| Trigger from Web UI on headless rig | Nuclear tab has reboot / restart WM only | No clean-slate action; no sudo wrapper |

**Goal:** One **clean-slate full reset** that returns the **internal HighAsCG working tree** to defaults while **never deleting or modifying** content on external/removable volumes — including the **bridge partition** (`HIGHASCGDAT`), **HighAsCG USB stick** (`HIGHASCGEXF`), and **any other partition or USB drive** that is mounted or bind-linked under the media tree (e.g. `media/bridge`, `media/exfat`, `media/drive`, symlinks into `/media` or `/mnt`).

**Safety principle (non-negotiable):** For media deletion, **when in doubt, skip**. A false negative (leaving internal junk) is acceptable; a false positive (deleting stick/bridge/field-kit media) is not.

**Primary use case:** Lab / backup-box QA — wipe internal state, reboot, verify exFAT/bridge sync repopulates configs, projects, and media as expected.

**Secondary use case:** Occasional “start fresh” on an installed system when operators accept losing **internal-only** copies (bridge/USB kits remain the source of truth).

---

## 2. Scope boundaries

### 2.1 In scope (v1)

| Area | Action |
|------|--------|
| **Modular config** | Delete `~/highascg/config/*.json` (except non-settings files if any — see §4.1); reload **repo defaults** (`src/config/defaults*`) |
| **Monolithic config** | Remove `~/highascg/highascg.config.json` if present |
| **Runtime state** | Clear `~/highascg/.highascg-state.json`, `~/highascg/.module-state.json`, `config/.highascg-state.json` if duplicated |
| **Projects** | Delete **all** `~/highascg/projects/*.json` and `~/highascg/projects/_autosave/**`; then create **empty Untitled** project (reuse `buildDefaultUntitledProject` / `project-store`) |
| **Internal media** | Delete files under media root **only when proven internal-only** — see §3.2 (fail-safe mount graph) |
| **OS layout persistence** | Call existing `clearPersistedOsLayout({ reason: 'clean slate reset' })` |
| **Caspar generated XML** | Remove / regenerate `config/casparcg.config` (or path from `caspar_server.json`) after defaults load |
| **In-memory / buffers** | Clear HighAsCG log buffer; optional truncate Caspar log file (stretch) |
| **Web UI trigger** | **Settings → Nuclear** button + confirmation dialog |
| **CLI** | `highascg-clean-slate-reset.sh [--dry-run] [--yes]` runnable on SSH |

### 2.2 Explicitly preserved (never touch)

| Path / volume | Reason |
|---------------|--------|
| `/home/casparcg/bridge/**` | WO-52 bridge partition — canonical media + config sync source |
| `/home/casparcg/exfat/**` | WO-47 HighAsCG USB stick — field kit + boot-prefer configs |
| **Any subtree under `~/highascg/media/` that is a mount point, bind mount, or on a non-internal block device** | Includes `media/bridge`, `media/exfat`, `media/drive`, operator USB mounts, symlinks to removable media — see §3.2 |
| **Any path resolved via `findmnt -T` to fstype `exfat`, `vfat`, `ntfs`, `fuseblk`, or a `/dev/*` source on a different `st_dev` than the repo root** | Covers random USB sticks and bridge volumes regardless of label |
| Repo code (`~/highascg/src`, `client`, `node_modules`, …) | Reset is **data**, not reinstall |
| `/etc/highascg/display-mode`, NVIDIA pool, system packages | Out of scope |

### 2.3 Out of scope (v1)

- Reformatting or repartitioning bridge/USB
- Wiping **persistence overlay** on live USB (`casper-rw`) — different WO
- Uninstalling Tailscale / Syncthing / replication pairing secrets on bridge (bridge `configs/` untouched)
- Automatic **reboot** after reset (recommend **Restart HighAsCG** + optional operator reboot; stretch: offer checkbox)
- Clearing browser **localStorage** / offline drafts (operator hard-refresh; document in UI note)

### 2.4 Distinction from existing factory reset

| Feature | Device View / `POST /api/config/reset` | Clean slate (this WO) |
|---------|----------------------------------------|------------------------|
| Config → defaults | Yes | Yes |
| Active project → empty Untitled | Yes | Yes |
| **All** project files removed | No | **Yes** |
| Internal media cleared | No | **Yes** (fail-safe mount-aware — §3.2) |
| State JSON wiped | Partial | **Yes** |
| Bridge / USB untouched | N/A | **Yes (required)** |

---

## 3. Architecture

### 3.1 Components

```text
Web UI (Nuclear tab)
    → POST /api/system/setup/clean-slate-reset  { password?, confirm: "CLEAN SLATE" }
        → checkNuclearPassword (reuse routes-system-setup.js)
        → src/system/clean-slate-reset.js (orchestrator, Node — can run without root for most paths)
        → sudo -n /usr/local/lib/highascg/highascg-clean-slate-reset.sh [--dry-run]
              → mount detection, internal-only deletes, JSON manifest to stdout
        → configManager.factoryReset() + project-store empty Untitled + clearPersistedOsLayout
        → POST side effects: clear log buffer, regenerate Caspar config, WS broadcast config/project reload
    → Response: { ok, deleted: { projects, mediaFiles, configFiles }, skipped: { reason }, dryRun? }
```

**Security model:** Same as reboot / server update — **fixed-path root helper**, no user-controlled shell fragments. Node may perform user-owned deletes directly; helper handles edge cases (root-owned files, bind-mount checks).

### 3.2 Mount-aware media deletion (normative — fail-safe)

Media root: `getMediaIngestBasePath(config)` — default `~/highascg/media`; honour `local_media_path` when set (same rules apply to that directory).

**Design rule:** Never use blind `rm -rf "$MEDIA_ROOT"/*`. Walk candidates individually; skip entire protected subtrees. If mount introspection fails, **skip all media deletion** and return an error in the JSON summary (do not partially guess).

#### 3.2.1 Known linked paths (always skip)

These paths are **always** excluded from deletion when they exist (even before mount detection), because production images bind external volumes here:

| Path under media root | Typical source |
|----------------------|----------------|
| `media/bridge/` | Bind: `/home/casparcg/bridge/media` (WO-52, `HIGHASCGDAT`) |
| `media/exfat/` | Bind: `/home/casparcg/exfat/media` (WO-47, `HIGHASCGEXF`) |
| `media/drive/` | Legacy / operator partition mount at fixed subfolder (WO-38 history; may still exist on older sticks) |

Also skip anything under preserve roots **`/home/casparcg/bridge`** and **`/home/casparcg/exfat`** (direct access, not only via `media/`).

Load additional bind targets from **`config/exfat-sync.json`** → `volumes.*.mediaMount` when present (today: `media/bridge`).

#### 3.2.2 Build protected-subtree set (before any delete)

At script start (Linux only):

1. **`findmnt -R -J -o TARGET,SOURCE,FSTYPE "$MEDIA_ROOT"`** — collect every mount target **under** the media root (includes bind mounts and direct block mounts).
2. Add each target path and **all descendants** to `PROTECTED_SUBTREES` (prefix match).
3. For **each immediate child** of `$MEDIA_ROOT`, run **`findmnt -T "$child"`**:
   - If the path is a mount point, or `TARGET !=` requested path (file lives under a different mount), add that subtree to `PROTECTED_SUBTREES`.
4. Enumerate **all system mount points** that overlap media (fallback): parse `findmnt -R -J /` or `/proc/mounts` for targets prefixed with `$MEDIA_ROOT/`.
5. Record **`ROOT_DEV=$(stat -c %d "$REPO_ROOT")`** and **`MEDIA_ROOT_DEV=$(stat -c %d "$MEDIA_ROOT")`**. If `MEDIA_ROOT` itself is on a different device than `REPO_ROOT`, **skip entire media tree** (whole library is external).

Reuse patterns from `src/system/exfat-sync-status.js` (`findmnt -J -T`) where helpful; the shell helper must not depend on Node.

#### 3.2.3 Per-path delete decision (walker)

For each file or directory under `$MEDIA_ROOT` (depth-first, **do not follow mount points** — use `find -xdev` scoped carefully, or explicit walker that stops at protected prefixes):

| Check | Action if true |
|-------|----------------|
| Path matches any `PROTECTED_SUBTREES` prefix | **Skip** (`reason: protected-mount-subtree`) |
| Path is a mount point (`findmnt -T`) | **Skip** (`reason: mount-point`) |
| `realpath` escapes `$MEDIA_ROOT` or lands under `/home/casparcg/bridge` or `/home/casparcg/exfat` | **Skip** (`reason: preserve-root`) |
| Symlink target resolves outside internal fs or into a protected subtree | **Skip** (`reason: symlink-external`) |
| `stat -c %d` for path ≠ `ROOT_DEV` **and** ≠ `MEDIA_ROOT_DEV` when media root is internal | **Skip** (`reason: foreign-device`) |
| `findmnt -T` fstype ∈ `{exfat,vfat,ntfs,fuseblk,fuse}` | **Skip** (`reason: removable-fstype`) |
| `findmnt -T` source matches `/dev/*` and device major differs from root filesystem | **Skip** (`reason: block-device`) |
| All checks pass — path is on internal filesystem, not under any mount link | **Delete** (file) or **prune** (empty dir, internal only) |

**Dot-system dirs** (`.replication-active/`, `.highascg-thumbnails/`): same rules — delete only when on internal fs and not under a protected subtree.

#### 3.2.4 Failure modes

| Condition | Behaviour |
|-----------|-----------|
| `findmnt` missing or returns error | **Abort media phase**; `ok: false` or `mediaSkipped: "mount detection failed"`; other phases (config/projects) may still run — document choice in implementation (recommend **abort entire reset** if media phase cannot prove safety) |
| Zero files deleted, N skipped | Valid outcome — report counts in JSON |
| Dry-run | Emit `{ "action": "delete"|"skip", "path", "reason"? }` per path; no unlink |

#### 3.2.5 Acceptance tests (automated — required before ship)

| Fixture | Expected |
|---------|----------|
| Files under `media/bridge/` with bridge bind active | **0 deleted** |
| Files under `media/exfat/` with USB bind active | **0 deleted** |
| Files under `media/drive/` with partition mounted | **0 deleted** |
| `media/stock/clip.mov` on root fs, no bind | **deleted** |
| Symlink `media/field-kit` → `/mnt/usb/kit` | **0 deleted** (target skipped) |
| Entire `media/` on bridge device (`st_dev` ≠ root) | **0 deleted**, summary explains skip |
| `findmnt` mocked to fail | **0 deleted**, error flagged |

**Dry-run:** must match full run decisions exactly (only skip unlink).

### 3.3 Config defaults

Reuse `ConfigManager.factoryReset()` (`src/config/config-manager.js`) after deleting modular JSON. Ensure emitted config matches **`src/config/defaults.js`** merge — same as today’s factory reset.

**Replication / device graph:** defaults should yield **unpaired** replication and empty/minimal device graph (verify `defaults/replication.json` / `device_graph.json` stubs).

### 3.4 Post-reset sync behaviour

After internal wipe, on **next boot** (or manual **Import / sync** if exposed):

- `highascg-exfat-sync.service --boot` pulls bridge/USB configs, projects, and one-way USB media ingest per `config/exfat-sync.json`.
- Document operator flow: **Clean slate → Restart app → Reboot (recommended) → verify bridge/USB repopulated working tree**.

Optional stretch: API flag `runBootSync: true` invokes `highascg-exfat-sync` oneshot after reset (requires sudoers for sync script if not already).

---

## 4. File inventory

### 4.1 Delete / reset (internal)

| Path | Notes |
|------|-------|
| `~/highascg/config/*.json` | Modular settings; **do not** delete repo template `config/exfat-sync.json` if stored only in repo — today live configs are under `~/highascg/config/` |
| `~/highascg/highascg.config.json` | Legacy monolithic |
| `~/highascg/projects/*.json` | All show files |
| `~/highascg/projects/_autosave/**` | Autosave drafts |
| `~/highascg/.highascg-state.json` | UI persistence |
| `~/highascg/.module-state.json` | Module runtime state |
| `~/highascg/media/**` | **Internal-only** per §3.2 — never paths under `media/bridge`, `media/exfat`, `media/drive`, or any detected mount/bind |
| Generated Caspar XML | Path from config after defaults |

### 4.2 Preserve

| Path | Notes |
|------|-------|
| `/home/casparcg/bridge/**` | Includes `media/`, `configs/`, `projects/`, `drop-update/` |
| `/home/casparcg/exfat/**` | USB stick layout |
| `~/highascg/media/bridge/**`, `~/highascg/media/exfat/**`, `~/highascg/media/drive/**` | Bind-linked external volumes (always skip) |
| Any other mount/bind/symlink target under `media/` | Discovered at runtime (§3.2.2) |

---

## 5. Product behaviour (Web UI)

### 5.1 Nuclear tab addition

Add to `settings-pane-nuclear` (`settings-modal-templates.js`):

```text
── Clean slate reset ──
Wipes internal projects, internal-only media, and settings to defaults.
Does NOT modify bridge (HIGHASCGDAT), USB stick (HIGHASCGEXF), or any drive/bind linked under media/ (including media/bridge, media/exfat, media/drive).
Use before testing backup/sync, or to return this machine to a fresh internal state.

[ Download support bundle first ]  (link to Diagnostics or inline — stretch)

Type CLEAN SLATE to confirm: [________]
[ Clean slate reset ]  (destructive, btn--danger)
```

| Requirement | Detail |
|-------------|--------|
| **Confirmation** | User must type `CLEAN SLATE` (case-sensitive or normalized — document choice) |
| **Password** | Reuse nuclear password gate when `ui.nuclearRequirePassword` is on |
| **Status** | `#set-nuclear-status` or dedicated `#set-clean-slate-status` — show progress + summary counts |
| **After success** | Prompt: “Restart HighAsCG recommended”; offer **Restart app** button (existing endpoint) |
| **Errors** | Show sudoers hint if helper fails (`502` like reboot) |

### 5.2 API

`POST /api/system/setup/clean-slate-reset`

Request body:

```json
{
  "password": "<optional nuclear password>",
  "confirm": "CLEAN SLATE",
  "dryRun": false
}
```

Response (example):

```json
{
  "ok": true,
  "dryRun": false,
  "deleted": { "projectFiles": 3, "mediaFiles": 128, "configFiles": 12 },
  "skipped": {
    "mediaFiles": 842,
    "mediaReasons": { "protected-mount-subtree": 800, "foreign-device": 42 }
  },
  "notes": ["Empty Untitled project created", "Reboot recommended to run exFAT boot sync"]
}
```

Register route in `src/api/routes-system-setup.js` (or thin `routes-clean-slate.js` required from router).

---

## 6. Privilege / sudoers

Add **`/usr/local/lib/highascg/highascg-clean-slate-reset.sh`** with **`NOPASSWD`** for service user (`casparcg`):

```bash
casparcg ALL=(root) NOPASSWD: /usr/local/lib/highascg/highascg-clean-slate-reset.sh
```

Document in `docs/HIGHASCG_PASSWORDLESS_SUDO.md`. Install hook: `scripts/exfat/install-exfat-systemd-units.sh` or `scripts/install-phase4.sh` (alongside `highascg-webui-server-update.sh`).

**Helper constraints:**

- Accept only `--dry-run` and `--yes` flags (no arbitrary paths).
- Log to stdout as JSON lines for Node to parse.
- Exit non-zero on mount-detection failure or any unexpected error; partial deletes must be reported with skip reasons.
- **Must implement §3.2 in full** — no shortcut `rm -rf` on `media/`.

Node **may** run most deletes as `casparcg` without sudo when ownership is correct; helper is for mount inspection and root-owned edge files.

---

## 7. Tasks

### Phase A — Script + mount safety

- [ ] **T69.A.1** Implement `scripts/runtime/highascg-clean-slate-reset.sh` — §3.2 fail-safe mount graph, known paths (`media/bridge`, `media/exfat`, `media/drive`), dry-run, JSON summary with skip reasons.
- [ ] **T69.A.2** Smoke tests per §3.2.5 (fixture dirs + mocked `findmnt` / bind layout); `npm run smoke:clean-slate-reset` or extend exfat smoke harness.
- [ ] **T69.A.3** Install helper + sudoers fragment; document in `HIGHASCG_PASSWORDLESS_SUDO.md`.
- [ ] **T69.A.4** Code review gate: second reviewer confirms no code path can `rm -rf` under a protected mount prefix.

### Phase B — Server orchestration

- [ ] **T69.B.1** `src/system/clean-slate-reset.js` — invoke helper, `factoryReset()`, clear state files, empty all projects + save Untitled.
- [ ] **T69.B.2** `POST /api/system/setup/clean-slate-reset` — confirm string, nuclear password, dry-run support.
- [ ] **T69.B.3** Post-reset: clear log buffer, trigger Caspar config regen hook (same path as settings save / factory reset).
- [ ] **T69.B.4** Idempotency: second run on already-empty tree returns `ok` with zero counts.

### Phase C — Web UI

- [ ] **T69.C.1** Nuclear tab UI — confirm field, destructive button, status text.
- [ ] **T69.C.2** Wire `settings-modal.js` — call API, handle dry-run preview (stretch: “Preview what would be deleted”).
- [ ] **T69.C.3** Optional link to Diagnostics support bundle before reset.

### Phase D — Docs + QA

- [ ] **T69.D.1** Operator doc: `docs/wiki/storage/clean-slate-reset.md` (or section in bridge/USB doc) — when to use, reboot/sync flow, what is preserved.
- [ ] **T69.D.2** Manual QA checklist (§8).
- [ ] **T69.D.3** Update `project_status.md` when shipped.

---

## 8. Manual QA checklist

1. **Bridge bind (`media/bridge`):** Seed bridge `media/`; add files under `media/bridge/` and `media/stock/`; run clean slate; verify **bridge files unchanged**, internal `stock/` cleared.
2. **USB bind (`media/exfat`):** Stick inserted; files under `media/exfat/` preserved; exFAT root untouched.
3. **Operator USB at `media/drive`:** Mount arbitrary exFAT USB (or legacy drive mount); verify **zero** files removed from stick.
4. **Symlink into `/mnt`:** `media/kit` → removable mount; verify skip.
5. **No external mounts:** Internal `media/projects/`, `media/stock/` cleared; defaults loaded; empty Untitled opens.
6. **Whole media on bridge device:** If `media/` shares bridge `st_dev`, entire media phase skipped with clear message.
7. **Nuclear password on/off:** Gate behaves like reboot.
8. **Dry-run:** Decisions match full run; no unlink.
9. **Mount detection failure:** Simulate (rename `findmnt` in test); reset aborts media phase or whole reset per §3.2.4.
10. **Support bundle** (if linked): downloadable immediately before reset.

---

## 9. Open decisions (resolve in first PR)

| ID | Question | Proposal |
|----|----------|----------|
| O1 | Auto-run boot sync after reset? | **No** in v1 — document reboot; stretch API flag |
| O2 | Delete Caspar log file tail? | **Truncate** or leave — default **leave** |
| O3 | Clear `~/highascg/log/*.log` HighAsCG logs? | **Yes** internal logs only |
| O4 | Require support bundle download before reset? | **No** — optional link only |
| O5 | `confirm` string | **`CLEAN SLATE`** (exact match) |
| O6 | Restart app automatically after reset? | **Prompt** operator; one-click restart (existing API) |
| O7 | Abort entire reset if media mount detection fails? | **Yes** — fail-safe default |

---

## 10. Related files (implementation hints)

| Area | Path |
|------|------|
| Factory reset (config) | `src/config/config-manager.js`, `index.js` `resetConfigToDefaults` |
| Factory reset (UI) | `client/lib/default-project.js`, `device-view-actions.js` |
| Nuclear API | `src/api/routes-system-setup.js` |
| Nuclear UI | `client/components/settings-modal-templates.js`, `settings-modal.js` |
| exFAT sync map | `config/exfat-sync.json` |
| Mount detection (reference) | `src/system/exfat-sync-status.js` (`findmnt -J -T`) |
| exFAT volume map | `src/system/exfat-sync-map.js` |
| Systemd bind units | `scripts/exfat/install-exfat-systemd-units.sh` (`media/bridge`, `media/exfat`) |
| Media root | `src/media/local-media-paths.js` |
| Projects | `src/engine/project-store.js` |
| OS layout clear | `src/utils/os-config.js` `clearPersistedOsLayout` |
| Sudoers doc | `docs/HIGHASCG_PASSWORDLESS_SUDO.md` |

---

## Work Log

### 2026-06-28 — WO drafted (operator request)

**Work done:**
- Created WO-69 from operator request: clean-slate full reset script + Web UI Nuclear entry; preserve bridge (`HIGHASCGDAT`) and USB exFAT (`HIGHASCGEXF`); wipe internal projects, mount-aware internal media, configs to defaults.
- Reviewed existing factory reset (`POST /api/config/reset`), Nuclear tab / `checkNuclearPassword`, WO-52 bridge vs internal media bind, `exfat-sync.json` pairs.

**Status:** Draft — no implementation started.

**Instructions for Next Agent:** Implement **Phase A** script + §3.2.5 mount safety tests first (highest risk). Treat media deletion as **deny-by-default**. Then **T69.B.1** orchestrator. Wire Nuclear UI last.

---

### 2026-06-28 — Operator clarification (mount-linked media safety)

**Work done:**
- Expanded §3.2 to **fail-safe mount graph** — never blind `rm -rf` on `media/`.
- Explicit always-skip paths: `media/bridge`, `media/exfat`, `media/drive`, plus any bind/mount/symlink discovered via `findmnt`.
- Covers arbitrary USB drives linked under media, not only `HIGHASCGEXF` / `HIGHASCGDAT`.
- Added §3.2.5 automated acceptance tests, T69.A.4 review gate, O7 abort-on-mount-detection-failure.

**Instructions for Next Agent:** Implement walker + protected-subtree builder before any delete logic; run §3.2.5 fixtures in CI.

---

*Work Order created: 2026-06-28 | Series: Operator diagnostics / storage QA | Parent: 00_PROJECT_GOAL.md*
