# Project triage — 2026-07-03

> **Purpose:** Durable snapshot of work-order queue decisions and deep-dive research from the 2026-07-03 triage session.  
> **Living index:** [`project_status.md`](./project_status.md) — update that file when individual WO statuses change.

---

## 1. Status decisions applied

| Bucket | WOs | New status | Rationale |
|--------|-----|------------|-----------|
| **Future module** | 30, 17, 19 | Deferred — not in current roadmap | Previs/tracking packaging and features parked until re-prioritized |
| **Deprecated (partial)** | 79 file-browser WO — **Phase B only** | Cloud Share abandoned | Phase A dual-pane browser shipped; leader-autosave WO is **separate** and still active |
| **Next** | 110, 98, 90, 82, 81, 80, 78 | Priority queue | Active engineering focus |

### Future module (30, 17, 19)

| WO | File | Notes |
|----|------|-------|
| 30 | [30_WO_PREVIS_TRACKING_MODULE.md](./30_WO_PREVIS_TRACKING_MODULE.md) | Phase 1 landed; Phase 2–3 (installer split, acceptance automation) not scheduled |
| 17 | [17_WO_3D_PREVIS.md](./17_WO_3D_PREVIS.md) | Substantial code in tree; not active work; blocked on WO-30 packaging |
| 19 | [19_WO_PERSON_TRACKING.md](./19_WO_PERSON_TRACKING.md) | No server-side pipeline started; blocked on WO-30 |

### Two separate WO-79 documents (do not conflate)

These share the number **79** but are unrelated work streams.

| WO | File | Status | Summary |
|----|------|--------|---------|
| 79a | [79_WO_DUAL_PANE_FILE_BROWSER_AND_WETRANSFER_PUSH.md](./79_WO_DUAL_PANE_FILE_BROWSER_AND_WETRANSFER_PUSH.md) | Phase A shipped; Phase B deprecated | MC-style server file browser; **cloud Share** (see below) not pursued |
| 79b | [79_WO_LEADER_AUTOSAVE_LIVE_REPLICATION.md](./79_WO_LEADER_AUTOSAVE_LIVE_REPLICATION.md) | **In progress** | Leader autosave edits push to follower; Phase B fallback + A79 hardware QA pending |

#### What is “cloud Share”? (file-browser WO only)

**Not** leader/follower replication. It is **Phase B** of the file-browser WO:

- Operator selects recording(s) or media in the dual-pane **Files** modal
- Clicks **Share ▾** → WeTransfer, Google Drive, OneDrive, etc.
- **Server-side Puppeteer** (headless Chromium on the playout box) opens the real cloud website, logs in with a saved profile (`cloud-share-browser-login.sh`), and uses `setInputFiles` to upload from **server disk** — files never copy through the operator laptop
- Goal: post-show handoff of large `.mp4` recordings without SSH or manual laptop upload

Most of Phase B was **coded** (`cloud-upload-runner.js`, recipes, routes, Share UI) but **live WeTransfer QA** (T79.B.1 spike on hardware) was never finished — that scope is **deprecated**, not the file browser.

#### Leader autosave WO (still active)

When the leader edits looks (autosave, no explicit Save), the follower should receive the updated show within ~3 s debounce. Phase A (`project-push-debounce.js`) shipped. Still open:

- Phase B: ping `activeShowRevision` fallback if push missed
- Acceptance A79.1–A79.4 (especially hardware: eggs leader + stick follower)

### Next — priority queue (110, 98, 90, 82, 81, 80, 78)

| WO | File | Remaining work (summary) |
|----|------|--------------------------|
| 110 | [110_WO_LOOKS_CANVAS_THUMBNAIL_ACCURACY_AND_OPERATOR_NETWORK.md](./110_WO_LOOKS_CANVAS_THUMBNAIL_ACCURACY_AND_OPERATOR_NETWORK.md) | T110.2 live on-air verify only |
| 101 | [101_WO_BACKEND_ROBUSTNESS.md](./101_WO_BACKEND_ROBUSTNESS.md) | Done |
| 98 | [98_WO_REPO_INTEGRITY_AND_HYGIENE.md](./98_WO_REPO_INTEGRITY_AND_HYGIENE.md) | v1 complete; optional clean-clone CI verification (WO-99) |
| 90 | [90_WO_ISO_THIRD_PARTY_LICENSES_FOLDER.md](./90_WO_ISO_THIRD_PARTY_LICENSES_FOLDER.md) | T90.D2 live ISO QA remains |
| 82 | [82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md](./82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md) | T82.13–T82.25 manual QA; refresh helper smoke added |
| 81 | [81_WO_STREAM_RECORD_LOGS_AND_NO_RESTART_DIRTY.md](./81_WO_STREAM_RECORD_LOGS_AND_NO_RESTART_DIRTY.md) | Smoke T81.14–T81.17 done; acceptance A81.x |
| 80 | [80_WO_XRANDR_CUSTOM_MODE_FORCE_RESOLUTION.md](./80_WO_XRANDR_CUSTOM_MODE_FORCE_RESOLUTION.md) | modeCreation status UI done; A80 hardware reboot QA |
| 78 | [78_WO_REPLICATION_TRUST_HOSTNAME_AND_RSYNC_SSH.md](./78_WO_REPLICATION_TRUST_HOSTNAME_AND_RSYNC_SSH.md) | Two-box pair QA A78.1–A78.2, A78.4–A78.6 |

### Excluded from this triage (user already aware)

**WO-111–121** — 500-line file split cluster + CI enforcement. WO-117 in progress (mixer split done 2026-07-03).

---

## 2. Deep dive: Companion / looks / timeline (59, 60, 63, 72, 75)

These are largely **code-complete**; remaining work is mostly **manual QA** and one **deferred phase**.

### WO-75 — Timeline Companion button preview

- **Done:** T75.1–T75.13 (satellite client, picker modal, ruler thumbnails, smoke)
- **Open:** **T75.14** only — manual QA with real Companion (modal pick, typed coords, visual match Stream Deck)
- **Verdict:** ~95% done; field sign-off only

### WO-72 — Companion compose preview polish

- **Done:** Phases A, B, C, E (label styling, quadrant badges, preview traffic gate, map-only channels)
- **Open QA:** T72.A4, B5, C5, E5 — hardware/readability checks
- **Open code:** **Phase D entirely deferred** (T72.D1–D5 custom mosaic layouts — 5 tasks)
- **Open tests:** T72.E4 — unit/smoke for 2-screen preset count
- **Verdict:** Production-usable; Phase D is a future enhancement

### WO-63 — Looks deck live compose preview thumbs

- **Done:** T63.0–T63.2.1 (channel resolver, deck paint, edit-mode isolation)
- **Open:** T63.2.2, T63.3.1–3 — all **manual QA** (PRV/PGM parity, Companion visual match, update `project_status`)
- **Verdict:** Implementation done; needs operator validation on hardware with `ffmpeg_jpeg` mode

### WO-60 — CG-only looks deck visual

- **Done:** T60.0–T60.2.5 (detection, CSS states, Puppeteer render API, deck thumb wiring)
- **Open:** T60.1.3 manual QA (multi-main, global looks)
- **Optional:** T60.3.1 debounced regen on inspector edits; T60.3.2 settings toggle
- **Verdict:** ~90% done; polish items are nice-to-have

### WO-59 — Device View server inspector (fps + network)

- **Done:** T59.0–T59.4.1 — full implementation (inspector rewrite, project fps, network apply API, installer, migration matrix)
- **Open:** T59.4.2 operator doc snippet; §9 manual QA checklist (6 items)
- **Stale note:** Work log line still says "Draft — not started"; passes 1–2 completed the work
- **Verdict:** Code shipped; needs rig QA + one doc line

---

## 3. Deep dive: Hot backup stack (54, 64, 65, 68)

**Important:** WO-54 and WO-64 have **stale task checkboxes** — work logs say core phases shipped, but markdown boxes were never ticked.

### WO-64 — AMCP fan-out (status: Phase A–C shipped)

- **Shipped (per work log 2026-06-27):** `amcp-fanout.js`, `peer-caspar-connection.js`, hooks in `amcp-client.js` / `amcp-batch.js`; field validation: takes/transitions in sync
- **Checkbox problem:** All T64.A–G boxes still `[ ]` despite shipped status
- **Actually open (Phases D–G):**
  - **D:** Look confirmation on follower (`look-confirm.js`, `confirm-look` API, status fields)
  - **E:** Debounced project push on confirmed look only
  - **F:** Device View fan-out badge, mode toggle, validate parity button
  - **G:** Smoke tests + **hardware E2E** (60s drift <500ms, failover scenarios)
- **Known gap:** ~10s/min playhead drift → handed to WO-65

### WO-65 — Robustness / failover / playhead sync

- **Done:** T65.B1–B3, B5 (playhead sync core + smoke); T65.C1 (queue metrics); T65.D1–D2, D5 (promote/yield + smoke)
- **Open Phase A (measurement):** T65.A1–A3 — drift logging + CLI measurement tool
- **Open Phase B UI:** T65.B4 — Device View drift indicator (status API exists)
- **Open Phase C:** T65.C2–C4 — reconnect backoff finish, validate-caspar-parity API/button, parallel fan-out benchmark
- **Open Phase D UX:** T65.D3–D4 — planned switchover confirm, `leaderEpoch` demotion on rejoin
- **Open Phase E:** T65.E1–E2 — look-confirm + debounced push (overlaps WO-64 Phase D/E)
- **Open Phase F (field sign-off):** T65.F1–F4 — 60s drift ≤200ms, mid-clip promote, network pull, old leader rejoin
- **Verdict:** Core fan-out works; confirmation UX, drift correction UI, and field sign-off remain

### WO-68 — Connection status + channel parity

- **Done:** A68.1–A68.4 (inspector panels, refresh API, channel mismatch summary, auto-regenerate)
- **Open:** T68.5 auto-refresh on bridge startup; T68.6 leader ping follower Caspar before fan-out gate; A68.5 field sign-off after restart
- **Verdict:** v1 shipped; 3 operational hardening items + field QA

### WO-54 — Leader/follower replication (parent)

- **Shipped (per work logs):** Role machine, config classify, show-data replication, live-state mirror, Device View UX, Syncthing staging, CT-SS clock, smoke tests (14 pass)
- **Checkbox problem:** Phases 0–6 tasks mostly still `[ ]` — stale
- **Actually open:**
  - T7.4 mDNS / persistent leader registry (optional v2)
  - **T7.5 E2E two-box** with different wiring
  - T8.4 Syncthing REST smoke
  - T9.3–T9.4 CT-SS native listener + lag tuning on real boxes
- **Disposition:** WO-64 superseded Phase 3 live-state mirror for air; WO-54 remains pairing/project/media foundation
- **Verdict:** Core replication works; E2E hardware verification is the main gap

---

## 4. Deep dive: Boot / QA (66, 77)

### WO-66 — Boot drop update + Web UI updates tab

- **Done:** Phases 1–4 fully implemented (retain/consume policy, version API, GitHub check, Settings apply tab, smoke test)
- **Open docs:** E1 `EXFAT_SERVER_UPDATE.md`, E2 `USB_STICK_AFTER_FLASH.md`
- **Open seed:** T5.1–T5.2 `drop-update/applied/` in starter layout
- **Open hardware QA:** A3 stamp match after reboot; A6 legacy migration; T6.1–T6.3 cold-boot retain/consume, late USB insert, Web UI apply on stick
- **Verdict:** Code complete; needs stick hardware validation + 2 doc files

### WO-77 — Stick boot QA test suite

- **Done:** Phase A — `stick-boot-test/` runner + tests 01–10
- **Open Phase A:** T77.A.4 — one paragraph in `STICK_QUICK_START.md`
- **Open Phase B:** Installer reminder after flash, optional tmux appendix, CI syntax-check
- **Open Phase C:** Tests 11–13 (replication, companion, GPU display), JSON report mode, cold-boot-twice checklist
- **Open Phase D:** Produce-script gate, `run.sh` in drop-update seed, sign-off template
- **Open acceptance:** Full bench PASS on reference laptop + 24h re-run
- **Verdict:** Read-only suite exists; integration into flash workflow and expanded coverage not done

---

## 5. Deep dive: Media / sync / partition (52, 61, 62)

### WO-62 — Project-scoped media root

- **Done:** T62.1–T62.21 — full server + client implementation + automated smokes
- **Checkbox problem:** Acceptance criteria A1–A4 still `[ ]` but mirror implemented tasks — **stale**
- **Actually open:** T62.18 optional migration script (dry-run); **T62.22–T62.23 manual** (copy project to second machine, USB ingest path)
- **Verdict:** Shippable; field portability QA only

### WO-61 — Rsync peer sync + network settings

- **Done:** T0.1–T0.6 smart config (device graph strip on replication); T2.1–T2.4 Tailscale via **WO-91**
- **Not started:** **T1.1–T1.8** entire rsync peer sync stack (exclude manifest, job runner, API routes, Settings UI, Device View buttons, smoke, docs)
- **Not started:** **T3.1–T3.5** Syncthing service UI (beyond WO-54's API client)
- **Not started:** T4.1–T4.3 unified Network sync settings tab
- **Verdict:** Only classification/Tailscale done; **rsync operator UI is the big missing piece**

### WO-52 — Bridge disk partition + USB sync

- **Done:** Phases A–D (bridge mount, exfat-sync v2, USB media ingest one-way, USB config pairs)
- **Open:**
  - C4 — Settings "Import USB media" button (optional)
  - **E1–E4** — operator docs (create bridge partition Win/Linux), starter zip update, Settings mount status UI + dry-run
  - **F1–F2** — unit tests + smoke for one-way walker
- **Verdict:** Core plumbing works; operator-facing docs/UI polish remains

---

## 6. Recommended priority (researched groups)

If knocking these down in order of impact:

1. **Hot backup field sign-off** — WO-68 (3 items) + WO-65.F + WO-54.T7.5 — unblocks confidence in production pairs
2. **WO-64 checkbox hygiene + Phases D–G** — confirmation UX is the main functional gap after fan-out
3. **Companion/looks QA burst** — WO-75.14, 63.3.x, 72 QA items, 59 §9 — one hardware session
4. **WO-61 T1 rsync UI** — operators still lack bulk peer sync controls
5. **WO-66/77 stick validation** — boot/update path needs hardware proof

---

## 7. Follow-ups (not done in triage session)

- [ ] Tick stale checkboxes on WO-54, WO-64, WO-62 to match work logs
- [ ] Consider consolidated "QA-only backlog" WO for manual sign-off items
- [ ] Refresh `project_status.md` active/in-progress table beyond the Next queue (still partial)

---

*Created: 2026-07-03 | Source: agent triage session | Do not delete — append dated addenda below if queue changes.*

### Addenda

#### 2026-07-03 (Next queue — session 6)

- **WO-101:** Load-bearing void `.catch` sweep — `index.js` boot paths, replication service/peer/ws/hooks, live-thumb refresh, AMCP send queue.
- **Still Next:** WO-82/78/81/80 hardware QA; WO-90 T90.D2; WO-110 T110.2 live verify; WO-101 removed from queue.

#### 2026-07-03 (Next queue — session 5)

- **WO-80:** Device View Apply GPU status now shows `modeCreation` summary (`os-mode-creation-status.js` + `device-view-bands-render.js`).
- **WO-82:** `smoke-device-view-refresh.test.js` — `mergeDeviceViewMutation` + `normalizeRefreshMode` (3 tests).
- **WO-110:** T110.8 done — `computeContainDestRect` in `fill-math.js`; smoke in `smoke-cg-deck-thumb-contain.test.js`.
- **Still Next:** WO-82/78/81/80 hardware QA; WO-90 T90.D2; WO-110 T110.2 live JPG verify.

#### 2026-07-03 (Next queue — session 4)

- **WO-101:** T101.1 — `swallow()` sweep on CEF bridge (`cef-interactive-*`, `cef-focus-registry`) + API routes (`routes-amcp`, `routes-mixer*`, `routes-scene-border`, `routes-audio`, `routes-ftb`, `routes-pip-overlay`, `routes-caspar-config`, `routes-state`, `get-state`, `host-live-webpage`, `companion-connection-status`).
- **WO-90:** T90.A4 — collector pins CEF tarball LICENSE, `casparcg-scanner` deb copyright, enhanced binary LICENSE from playout path.
- **WO-78:** Restored `tools/smoke/smoke-replication-ssh-setup.test.js` (5 tests pass; stick-boot test-11 dependency).
- **Still Next:** WO-82/78/81/80 hardware QA; WO-90 T90.D2 live ISO QA; WO-110 T110.2 on-air verify.

#### 2026-07-03 (Next queue — session 3)

- **WO-81:** Fixed remaining false dirty on stream/record remove + stream/record cable sinks; `caspar-restart-dirty-policy.js`; smoke T81.14–T81.17 in `smoke-streaming-channel-status.test.js` (19 tests pass).
- **WO-80:** `modeCreation` in apply-os response (`os-config.js` + `settings-os.js`); T80.D.2 smoke extended in `smoke-xrandr-custom-mode.js`.
- **Still Next:** WO-82/78 hardware QA; WO-80 A80 reboot QA; WO-81 A81.x manual acceptance; WO-101 T101.1 CEF sweep.

#### 2026-07-03 (Next queue — session 2)

- **WO-110:** T110.2 dimension helper + smoke; T110.12 already in `test-12-exfat-network-conf.sh` (restored stick-boot suite).
- **WO-101:** T101.0 scene-take `swallow()` sweep; T101.4 async `project-store` with per-file queue + shutdown flush.
- **WO-90:** T90.A3 npm manifest row; T90.C1–C4 API `/api/system/licenses`, `/licenses/` static, setup + diagnostics links, support bundle snippet; `COMPLIANCE-ISO.md` regenerated.
- **WO-98:** `check-require-integrity.js` + `run-local-ci.sh` clean-clone step restored from git (local `projects/*.sync-conflict-*` still fail guard until purged).
- **Still Next:** WO-82/81/80/78 (mostly QA/smokes); WO-90 T90.A4 + T90.D2 live ISO QA; WO-101 T101.1 CEF/routes sweep.

#### 2026-07-03 (correction)

- **WO-79 is two documents**, not one deprecated bucket.
- **File browser WO:** Phase A (dual-pane browser) shipped; only **Phase B cloud Share** deprecated.
- **Leader autosave WO:** Still **in progress** — not deprecated.

#### 2026-07-07 (stabilization addendum)

- **Incident:** operator UI completely blocked — `ReferenceError: can't access lexical declaration before initialization` in the scenes bundle. Root cause: the WO-122 split left `getPlayback` referenced above its destructuring in `client/components/timeline-editor.js` (intra-module TDZ, minified as `C`). Three more split casualties: missing `syncSendToWithChannelMap` transport export, missing `escapeHtml` import in `sources-panel-helpers.js`, and a **server parse error** (duplicate `enrichProjectScenesFromLiveDeck` in `src/engine/project-scenes.js`). All Jul 5–7 work had been uncommitted and unverified (WO-122 §5 gates never run).
- **Response (WO-138…142):** full-tree WIP snapshot (`wip/2026-07-07-pre-stabilize`, tag `wip-snapshot-2026-07-07`); all fixes applied; chunk hygiene (`shared` chunk leaf-only, device-view import cycle dissolved via `lib/device-view-randr-norm.js`); all gates green (repo-integrity, eslint 0 errors, test:ci, build). WO-139 shipped frame-locked look→timeline take. WO-140 finished the last WO-122 splits and corrected its record. WO-142 dependency audit analyzed (Zoom purge pending, tailscale snap duplicate flagged).
- **History:** Jul 5–7 delta partitioned onto `main` as 6 coherent commits (`0268652`…`376de39`): server refactor / chunk fix / client refactor / host-live feature / timeline-take feature / docs. `config/*.json` runtime churn deliberately left uncommitted (live box rewrites them; consider gitignoring runtime-rewritten configs — open question). `docs/wiki-site` regenerates with embedded timestamps and churns similarly.
- **Stash:** `stash@{0}` (2026-06-24) archived to `work/archive/stash0-local-fixes-pre-pull.patch` and dropped — both hunks superseded by `72a5246`/`ea9851f`.
- **Backlog:** WO-143 (script reorg), WO-144 (preview defects), WO-145 (vcam stream spike), WO-146 (state monitor), WO-147 (hot-backup robustness), WO-148 (branding hardening) written and queued.
- **Mirror:** push to backup box pending at time of writing (last successful sync 2026-06-27, rsync code 23 — vanished replication temp file; re-run with `DEPLOY_RSYNC_EXCLUDE`).
