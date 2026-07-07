# WO-140 — WO-122 completion: finish 2 splits, re-scope the rest, correct the record

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-122](./122_WO_SPLIT_REMAINING_PRODUCTION_FILES_OVER_500.md)
**Status:** Planned
**Priority:** Medium
**Date:** 2026-07-07
**Depends on:** WO-138. Can run in parallel with WO-139.

---

## 1. Problem

WO-122 claims "Server: none remaining over 500 LOC" and has batch acceptance boxes checked, but `node tools/ci/check-max-file-lines.js` fails with 17 violations (7 in scope). Batch boxes were checked based on `wc -l` + editor diagnostics only — the §5 verification gates were never run. The record must reflect reality.

## 2. Tasks

### Finish now (mechanical splits per WO-122 §3 strategy)
- [ ] T140.1 Split `client/components/device-view-inspector-gpu-video-modeline.js` (643) to ≤500 with a thin aggregator.
- [ ] T140.2 Split `client/tools/electron-launcher/renderer.js` (610) to ≤500 with a thin aggregator.

### Defer with note
- [ ] T140.3 `client/lib/scene-state.js` (537): defer — core operator state touched by WO-139's take fix; splitting in the same window multiplies regression risk. Add a dated deferral note to WO-122 §2.2.

### Re-scope out (amend WO-122 §1)
- [ ] T140.4 Exclude from scope: `template/lower-thirds/lt-engine.js`, `template/led_grid_test.js` (standalone CEF templates, no bundler), `scripts/exfat/install-exfat-systemd-units.sh`, `scripts/lib/install-helpers.sh` (shell installers, barely over). Either exclude the categories or grant a 550-line ceiling — record the owner decision.

### Correct the record in WO-122
- [ ] T140.5 Remove stale entries (e.g. `client/lib/device-view-host-channels.js` listed at 576 — already split).
- [ ] T140.6 Reword batch acceptance boxes that assert "behavior unchanged / parity maintained" verified only by `wc -l` as "pending §5".
- [ ] T140.7 Check WO-122 §5 items ONLY with actual command output pasted into its work log.

## 3. Acceptance criteria

- [ ] A140.1 `node tools/ci/check-max-file-lines.js` reports ZERO violations for the re-scoped WO-122 file set (output pasted in work log).
- [ ] A140.2 `npm run lint` + `npm run test:ci` green after the two new splits.
- [ ] A140.3 WO-122 file is internally consistent: scope, remaining-files table, checkboxes and work log all match the checker output.

## 4. Work log

- 2026-07-07 — WO created. Violation list at creation time: 7 in-scope files (643/610/578/537/522/520/518 lines).
