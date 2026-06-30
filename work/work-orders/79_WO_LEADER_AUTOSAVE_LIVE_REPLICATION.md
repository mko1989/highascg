# Work Order 79: Leader autosave → follower live show sync

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Phase A shipped 2026-06-29 (debounced autosave push); Phase B fallback optional  
**Priority:** High (operator expectation: backup tracks leader edits without explicit Save)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Operator report (2026-06-29):**
- **Leader:** eggs host, `leaderAvailable`, paired to laptop stick follower.
- **Action:** Removed looks on leader (autosave path — no explicit Save).
- **Expected:** Follower auto-refreshes show (looks removed on backup).
- **Actual:** Follower unchanged until manual refresh / explicit save / reconnect.

**Builds on:**
- [76_WO_PROJECT_LOAD_AUTOSAVE_HARDWARE_GPU_BOOT.md](./76_WO_PROJECT_LOAD_AUTOSAVE_HARDWARE_GPU_BOOT.md) — autosave semantics (explicitly **no** replication on autosave today)
- [54_WO_HOT_BACKUP_LEADER_FOLLOWER_REPLICATION.md](./54_WO_HOT_BACKUP_LEADER_FOLLOWER_REPLICATION.md) — `pushProjectToPeer`, reconcile
- [78_WO_REPLICATION_TRUST_HOSTNAME_AND_RSYNC_SSH.md](./78_WO_REPLICATION_TRUST_HOSTNAME_AND_RSYNC_SSH.md) — `highascg####` labels in inspector

**Operator doc (update when shipped):** `docs/reference/hot-backup-replication.md`

---

## 1. Root cause (confirmed in code)

| Path | Calls `onProjectSavedForReplication`? | Follower updated? |
|------|----------------------------------------|-------------------|
| `POST /api/project/save` | **Yes** → `pushProjectToPeer` | Yes (HTTP push) |
| `POST /api/project/autosave` | **No** — only `persistProject(..., { writeAutosave: true })` | **No** |
| Follower `reconcileFromLeader` | N/A (pull) | Only on connect, refresh-connection, peer **restart** (instanceId change) |
| `GET /api/replication/export/project` | N/A | Uses `loadFullProject()` (**includes autosave merge**) — but nothing triggers pull on leader autosave |

**Gap:** Leader autosave writes `projects/_autosave/<slug>.json` locally but **never notifies the follower**. WO-76 documented this as intentional (“Explicit Save pushes main file”). Operator workflow expects **live backup** to track debounced edits.

**Relevant files:**
- `src/api/routes-data.js` — autosave handler (lines ~233–278): no replication hook
- `src/replication/replication-service.js` — `ctx.onProjectSavedForReplication` wired only to explicit save path
- `src/replication/peer-client.js` — ping tick has no `showRevision` / `savedAt` compare for project pull

---

## 2. Product behaviour (normative — target)

| Scenario | Leader | Follower |
|----------|--------|----------|
| Operator edits looks (debounced autosave) | Writes `_autosave/<active>.json` | Receives **show slice** within debounce window (see §3) |
| Operator explicit Save | Writes main + autosave; push (today) | Receives show slice (unchanged) |
| Leader removes looks via autosave | Autosave file updated | Follower looks removed after sync |
| Follower Device View / GPU map | Unchanged | **Never** overwritten (existing `stripDeviceLocalFromProject`) |
| Offline follower | — | Catches up on next successful ping / reconnect |

**Non-goals:**
- Replicate `_autosave/` as a separate file on follower disk — push **merged effective show** (same as `export/project` / `loadFullProject`).
- Push on every keystroke — debounce coalesced with client autosave (~2–5 s) + server-side coalesce.

---

## 3. Implementation options

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| **A — Hook autosave → debounced push** (recommended v1) | After successful autosave, call debounced `pushProjectToPeer(ctx, runtime, project)` with **same project payload** autosave wrote | Minimal change; reuses existing receive path | Leader pushes full project JSON on each debounced autosave (bandwidth) |
| **B — `showRevision` on ping + follower pull** | Leader ping includes `activeShowSavedAt` or hash of merged project; follower reconciles when value changes | Pull model; leader not blocked on push failure | Extra reconcile traffic every ping interval; need dedupe |
| **C — Hybrid** | Leader debounced push (A) + follower ping fallback (B) if push missed | Robust | More moving parts |
| **D — WS project event** | Leader broadcasts `project_updated` on replication WS; follower applies | Lowest latency | New WS message type + ordering |

**Recommendation:** **A** for v1 (match operator mental model “leader is source of truth”). Add **B** as v1.1 fallback when push fails but peer reachable.

**Server debounce:** `src/replication/project-push-debounce.js` — coalesce autosave pushes per slug, default **3000 ms** (`HIGHASCG_REPL_PROJECT_PUSH_DEBOUNCE_MS`).

**Payload:** Use `stripDeviceLocalFromProject(project)` — same as save hook. Project object from autosave already has updated looks.

**Follower apply:** Existing `receiveProjectFromPeer` → `mergeSharedProjectIntoLocal` → `commitReplicatedProject`. Ensure **slug unchanged** path still updates in-memory deck + `scheduleProjectSyncBroadcast` (today `commitReplicatedProject` may skip Caspar regen — OK).

---

## 4. Tasks

### Phase A — Leader autosave push (ship first)

- [x] **T79.1** `src/replication/project-push-debounce.js` — debounced `scheduleProjectPushToPeer(ctx, project)`
- [x] **T79.2** `routes-data.js` autosave success path → `scheduleProjectPushToPeer` (leader only; skip when replication disabled)
- [x] **T79.3** Ensure push uses merged semantics if autosave only touched `_autosave/` (pass autosaved `project` body — already correct)
- [x] **T79.4** Log at info: `[replication] project push (autosave)` vs `(save)` for support

### Phase B — Follower catch-up fallback

- [ ] **T79.5** Add `activeShowRevision` to ping: `sha256(stripDeviceLocal(loadFullProject)).slice(0,12)` + `activeShowSavedAt`
- [ ] **T79.6** Follower ping tick: if leader revision ≠ last applied → `reconcileFromLeader` (debounced, max 1/min)
- [ ] **T79.7** Inspector: “Show sync” timestamp / “last received from leader” on follower

### Phase C — Tests + docs

- [x] **T79.8** Smoke: leader autosave triggers one debounced push; follower merge removes look
- [ ] **T79.9** Update `docs/reference/hot-backup-replication.md` — autosave replicates; explicit Save still writes main file
- [ ] **T79.10** Update WO-76 §2.3 table (autosave row)

---

## 5. Acceptance

- [ ] **A79.1** Leader deletes a look; within ~5 s follower project (active slug) no longer contains that look **without** explicit Save.
- [ ] **A79.2** Explicit Save still works; no double-push storm (debounce coalesces).
- [ ] **A79.3** Follower `deviceGraph` / GPU topology unchanged after autosave sync.
- [ ] **A79.4** Hardware QA: eggs host leader + laptop stick follower — reproduce operator scenario fixed.

---

## 6. Work log

### 2026-06-29 — Root cause analysis

- Traced `POST /api/project/autosave` — no `onProjectSavedForReplication`.
- Confirmed `export/project` already merges autosave via `loadFullProject()` but follower never pulls on leader edit.
- Operator scenario (eggs leader, stick follower, remove looks) fails by current design, not pairing bug.

**Instructions for next agent:** Phase B (ping `activeShowRevision` fallback) if field QA sees missed pushes. Hardware QA A79.4 on eggs leader + stick follower.

### 2026-06-29 — Phase A implementation

- Added `project-push-debounce.js` (default 3s, `HIGHASCG_REPL_PROJECT_PUSH_DEBOUNCE_MS`).
- Autosave success → `scheduleProjectPushToPeer`; explicit save unchanged (immediate).
- `pushProjectToPeer` logs `(save|autosave|reconcile)` reason.
- Smoke: `smoke-replication-project-push-debounce.test.js`.
