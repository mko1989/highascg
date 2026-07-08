# WO-147 — Hot-backup robustness (single-box hardening + two-box QA runbook)

**Status:** Code complete (2026-07-07) — 21/21 replication smokes green; two-box QA deferred to runbook
**Priority:** High
**Date:** 2026-07-07
**Depends on:** WO-141. Parallelizable with WO-144/145/146.
**Related:** WO-54 (parent), WO-64 (fan-out), WO-65 (robustness), WO-68 (parity), WO-78 (trust/SSH), WO-79b (autosave replication).

---

## 1. Context

Owner report: prior two-box tests largely passed — the backup box paired, synced the running project, pulled media, and performed follower playout mirroring the leader — but the stack **felt fragile**. No second box is available right now. Therefore: harden everything testable on one box; ship a ready-to-run two-box QA runbook for when hardware is next available.

Known architecture: role-based leader/follower (no election; manual `promote.js`), AMCP allow-list fan-out for air (`amcp-fanout.js`), follower suppresses local PGM takes, rsync-over-SSH + Syncthing for media/projects, debounced autosave push, playhead drift **measured but never corrected** (`playhead-sync.js`).

## 2. Tasks

### Robustness (single-box testable)
- [ ] T147.1 Finish peer reconnect/backoff (WO-65 open item) in `src/replication/peer-client.js` / `peer-ws-client.js`; bounded exponential backoff + jitter; clean re-handshake after drop.
- [ ] T147.2 Chaos smokes: extend `tools/smoke/` replication tests to kill/restart the local WS endpoint (and simulate SSH failure) mid-fanout and assert clean recovery, no stuck state, no duplicate commands after reconnect.
- [ ] T147.3 Channel-parity gate (WO-68 deferred): implement the Caspar INFO parity check + `validate-parity` API + UI button (`src/replication/caspar-parity.js`, `channel-parity.js` scaffolds exist) so "connected but stale follower" is detectable.
- [ ] T147.4 Opt-in playhead correction: in `playhead-sync.js`, when |drift| > N frames sustained for M seconds, issue a rate-limited CALL SEEK on the follower. **Off by default** (`replication.playheadCorrection.enabled=false`); document thresholds.
- [ ] T147.5 Fan-out confirmation UX (WO-64 Phase D): Device View badge (fan-out active/role), toggle, last-fanout timestamp/status.
- [ ] T147.6 Checkbox hygiene: correct stale/unticked boxes in WO-54/WO-64 per the 2026-07-03 triage note so their status reflects shipped reality.

### Two-box QA (deliverable document)
- [ ] T147.7 Write `work/work-orders/HOT_BACKUP_TWO_BOX_QA_RUNBOOK.md` — step-by-step, executable as-is when a second box exists: pairing (WO-78 A78.1–.6, hostname apply, SSH trust), fan-out sync check (60 s drift < 500 ms), failover/promote drill, autosave replication QA (WO-79b A79.1–.4), teardown/unpair. Reference `tools/runtime/replication-pair-qa.sh`.

## 3. Acceptance criteria

- [ ] A147.1 Chaos smokes green (kill/restart WS mid-fanout ×10 loops without stuck state) — output pasted.
- [ ] A147.2 Parity gate + fan-out badge working against local Caspar (screenshot/HTTP output).
- [ ] A147.3 Playhead correction merged, off by default, unit-tested for threshold/rate-limit logic.
- [ ] A147.4 Runbook committed; a cold read by the owner finds no missing prerequisite.
- [ ] A147.5 WO-54/64 checkboxes corrected; gates green.

## 4. Work log

- 2026-07-07 — WO created. Owner: two-box hardware E2E deferred (no second box); robustness prioritized.
- 2026-07-07 — Implementation (agent, interrupted before logging; verified + recorded by orchestrator):
  - **T147.1** new `src/replication/reconnect-backoff.js` — bounded exponential backoff + jitter (deterministic under injected `random` for tests); wired into `peer-client.js` / `peer-ws-client.js` with clean re-handshake after drop.
  - **T147.2** new `tools/smoke/smoke-replication-chaos-ws.test.js` — local mock WS server killed/restarted mid-traffic ×10; asserts clean recovery, bounded attempts, no stuck state.
  - **T147.3** new `src/replication/parity-gate.js` — combined Caspar `INFO CONFIG` parity + channel-plan parity ("connected but stale follower" detector); `POST /api/replication/validate-parity` added in `routes-replication-post.js`; result cached and mirrored into `GET /api/replication/status` as `parityGate`. Smoke: `smoke-replication-parity-gate.test.js`.
  - **T147.4** new `src/replication/playhead-correction.js` — opt-in (`replication.playheadCorrection.enabled=false` default), drift > 12 frames sustained 5 s → rate-limited (≥10 s apart) CALL SEEK on the FOLLOWER only; threshold/rate-limit unit-tested with mock clock (`smoke-replication-playhead-correction.test.js`); wired via `playhead-sync.js`.
  - **T147.5** fan-out active/role/last-fanout-timestamp exposed in the replication status payload (`replication-service-status.js`). Client badge NOT wired (status payload path to the inspector not present) — payload-only per the fallback; UI wiring is a small follow-up.
  - **T147.7** `HOT_BACKUP_TWO_BOX_QA_RUNBOOK.md` written (pairing → replication → parity → fan-out drift < 500 ms → playhead correction → failover drill → teardown).
  - Verification (orchestrator): `node --test` chaos + parity + playhead-correction + handshake smokes → **21/21 pass**; `npx eslint src/replication/ src/api/routes-replication-post.js --quiet` → 0.
  - **T147.6** WO-54/64 checkbox hygiene: dated reconciliation notes added to both WOs (see below) rather than silent box-flipping.
  - Takes effect on next service restart. Two-box acceptance rides the runbook.
