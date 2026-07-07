# WO-144 — Compose-preview defects: per-channel ADD failures + consumer recycle churn

**Status:** Planned
**Priority:** High (visible PGM hitches + broken previews on some channels)
**Date:** 2026-07-07
**Depends on:** WO-141 (land on clean main). Parallelizable with WO-145/146/147.
**Related:** WO-57, WO-58, WO-63, WO-71, WO-72, WO-110.

---

## 1. Problem (confirmed from `log/caspar_2026-07-04.log`)

The webUI "live" preview attaches a persistent Caspar consumer per channel: `ADD <ch>-701 FILE media/highascg_preview/chN.jpg … -update 1`, Node watches file mtime and broadcasts WS events.

1. **`ADD 3-701` and `ADD 5-701` are rejected with `400 ERROR` on every recycle** while ch1/ch2 succeed — those channels are not FILE-consumable (or config mismatch), yet the code retries forever. Preview is genuinely broken on those channels.
2. **Full detach/attach recycle on every config save / project load / reconcile** — 426 `REMOVE x-701` events in one day; a REMOVE/ADD on the live PGM channel causes a visible output hitch (acknowledged in a code comment).
3. Constant benign-noise REMOVEs of legacy consumer indices (98, 700) every cycle.

Key files: `src/preview/compose-preview-consumer.js`, `compose-preview-ffmpeg-jpeg.js`, `compose-preview-activity.js`, `compose-preview-mode.js`; lifecycle `src/bootstrap/compose-preview-lifecycle.js`; API `src/api/routes-compose-preview.js`.

## 2. Tasks

- [ ] T144.1 Probe channel validity once (INFO or first-ADD result) and blocklist channels that reject ADD; surface the blocklist via WS/status + `routes-compose-preview.js` so the UI shows "preview unavailable on ch N" instead of silent retry.
- [ ] T144.2 Make `refreshComposePreviewConsumers` diff-based: compare desired vs running consumer signatures per channel; only detach/attach channels whose args actually changed; NEVER recycle the on-air PGM channel's consumer unless its own signature changed.
- [ ] T144.3 Move legacy-index cleanup (REMOVE 98/700) behind a first-run-only sweep flag.
- [ ] T144.4 Add/extend a smoke test covering: blocklisted channel does not retry; unchanged config save causes zero REMOVE/ADD.

## 3. Acceptance criteria

- [ ] A144.1 `node --test tools/smoke/smoke-timeline-compose-preview.test.js` + new smoke green (output in work log).
- [ ] A144.2 A full day of caspar log shows ZERO `ADD x-701` 400 errors and REMOVE x-701 count near zero during normal operation (paste grep counts).
- [ ] A144.3 Config save while a look is on PGM → no visible hitch on the PGM output (manual check, note in log).
- [ ] A144.4 UI/status shows which channels have preview available vs blocklisted.

## 4. Work log

- 2026-07-07 — WO created; defects confirmed against caspar log (426 REMOVEs/day, persistent 400s on ch3/ch5).
