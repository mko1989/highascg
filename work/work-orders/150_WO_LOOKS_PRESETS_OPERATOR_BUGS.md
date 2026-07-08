# WO-150 — Looks & presets operator bug sweep (owner todos 2026-07-07)

**Status:** Planned
**Priority:** High (operator-facing correctness on air)
**Date:** 2026-07-07
**Source:** `work/todos07.07.26` (owner)
**Related:** WO-59/60/63 (looks cluster), WO-139 (take), scene-take/scene-transition engine files.

---

## 1. Bugs (owner-reported)

- [ ] B150.1 **Wrong look gets on preview after transition.** After a take/transition completes, PRV shows a different look than expected. Investigate the PRV re-arm path after take (`src/engine/scene-take.js`, `scene-transition.js`, `live-scene-state` PRV bookkeeping, client `scenes-preview-*`). Define expected: PRV keeps the look that was armed before the take (or the configured next-look behavior) — confirm intent with owner before fixing.
- [x] B150.2 **Looks editor uses wrong resolution basis:** screen is 3072×1728 but editor treats it as 1080p; self-corrects after leaving/re-entering the look editor. Smells like stale/late-arriving screen-resolution state on first entry (`getResolutionForScreen` in `client/components/scenes-editor-logic.js`, settings/screen_destinations load order). Fix = resolve resolution before first layout pass or re-layout when it arrives. *(2026-07-08 — fixed client-side; see work log.)*
- [x] B150.3 **PGM-only channels: cannot arm a look on PRV to save a preset from PRV.** Allow choosing a look as PRV (UI arm state only — no Caspar preview route needed on PGM-only) so "save preset from PRV" works. Files: `scene-take-pgm-only.js`, scenes deck client logic, preset save path. *(2026-07-08 — fixed as client-arm-state only; engine untouched.)*
- [x] B150.4 **Look presets cannot be removed or replaced (overwrite).** Add delete + overwrite-with-confirm to the preset UI + API/persistence (`client/lib/scene-state*` look presets, project persistence). *(2026-07-08 — remove now confirms; overwrite already confirmed; reload persistence bug fixed — see work log.)*
- [x] B150.5 **Cannot load a look preset to PGM with auto transition.** Add "recall to PGM with transition" (uses the default/global transition like a normal take) as an option next to the existing recall behavior. *(2026-07-08 — "Auto" recall button; reuses POST /api/scene/take, no engine change.)*
- [ ] B150.6 **Two-screen preset recall transitions sequentially — must be simultaneous.** The per-screen takes run awaited one after another; batch both channels' transition starts (same pattern as WO-139: build both channels' DEFER batches first, then commit both channels back-to-back, or interleave commits before any wait). Files: preset recall path → `scene-take.js` / take orchestration across `targetIdxs`.

## 2. Approach notes

- B150.6 is the same "frame-locked" discipline WO-139 applied to look→timeline: never `await` a full channel's fade before starting the next channel's — schedule all, commit all, then wait once.
- B150.1/B150.2 need short reproduction + state-flow reading before any code; both look like state-ordering bugs, not engine bugs.
- Each fix gets/extends a smoke where the logic is server-side; client-only fixes get manual QA steps in this WO.

## 3. Acceptance criteria

- [ ] A150.1 Each bug has a dated work-log entry: root cause → fix → verification (smoke output or operator check).
- [ ] A150.2 Operator confirms on hardware: PRV correct after transitions; looks editor correct at 3072×1728 on first entry; PGM-only PRV-arm + preset save; preset delete/overwrite; recall-to-PGM with transition; two-screen recall simultaneous.
- [ ] A150.3 Gates green (`lint`, `test:ci`) after each fix.

## 4. Work log

- 2026-07-07 — WO created from `work/todos07.07.26`.
