# WO-220 — Drop Shadow PIP overlay doesn't render (delivery pipeline verified good; fault is in-template or z-interplay)

**Status:** Implemented (fix applied; render not yet visually confirmed)
**Priority:** Medium
**Date:** 2026-07-14
**Source:** owner: "drop shadow border effect doesnt work"
**Related:** WO-158 (crop-aware overlay geometry), WO-213 (overlay update caching), pip_border/pip_glow (same family — border WORKS on the same pipeline).

---

## 1. Evidence already collected (2026-07-14 ~16:2x, live)

Everything up to the template checks out:
- `CG 1-624 ADD 0 "pip_shadow" 1 <json>` accepted (202) + `CG 1-624 PLAY 0` sent (caspar log 16:16:45).
- Full decoded payload VALID: blur 20, offsets 10/16, spread 8, side outside, `inner {l:0.056, t:0.098, w:0.887, h:0.803}` (non-degenerate), ringOuterPx 46, totalOutsetPx 67.
- Live `MIXER 1-624 FILL` → `0.4156 0.0797 0.3858 0.3944` (sane rect); OPACITY 1; producers exist at stage layers 624/625.
- Template var wiring verified by reading [template/pip_shadow.html](../../template/pip_shadow.html): `styleFrame` sets --il/--it/--iw/--ih/--b/--ox/--oy/--s/--c/--r/--o matching the CSS; `activeSlices()` non-empty given the payload's inner.

## 2. Remaining suspects (ranked)

- H1 **CEF paints nothing for box-shadow-only elements on a fully transparent page** (no background/border on .pip-frame → some Chromium versions skip the paint or the alpha channel comes out empty). pip_border works because it paints a real border. Test: temporarily add `outline: 2px solid red` (or a 1px transparent border) to .pip-frame in a copy and CG ADD it manually — if the outline shows but no shadow, H1 confirmed → fix by painting the shadow differently (e.g. a positioned div with `filter: drop-shadow(...)` on a solid-in-alpha shape, or four gradient strips like pip_edge_strip does).
- H2 **Z/geometry interplay**: the shadow slot may sit UNDER the content layer visually identical to it (outside shadow needs the overlay layer's FILL to be EXPANDED beyond the content — verify `expandFillOutward` was applied for shadow: compare the content layer's FILL to 1-624's FILL; if identical, the outside shadow is entirely outside its own frame buffer and never composited). Payload says totalOutsetPx 67 — verify the FILL delta actually reflects ~67px of expansion.
- H3 stale template file in the Caspar template dir (if templates are copied rather than served from template/ — check casparcg.config template-path and compare file mtimes/hashes).

## 3. Tasks (haiku-sized)

- [x] T220.1 Confirm the Caspar template path (casparcg.config <template-path>) and that pip_shadow.html there is byte-identical to the repo's (H3). Fix the sync if not.
- [x] T220.2 H2 check by math: reproduce the client geometry for the logged case — content fill vs overlay fill; assert the expansion ≈ totalOutsetPx px in channel units (a pure function test against client/lib/pip-overlay-amcp.js expandFillOutward + the shadow outset calc at line ~65).
- [x] T220.3 H1 check + fix: modify template/pip_shadow.html to render the shadow WITHOUT relying on box-shadow-around-transparent: implementation choice — a child div sized to the inner rect with `background: transparent` replaced by `filter: drop-shadow(ox oy blur color)` applied to an element with a solid alpha silhouette (e.g. background of the SHADOW COLOR itself clipped away is not possible without paint) — simplest robust: keep box-shadow BUT give .pip-frame `background: rgba(0,0,0,0.002)` (near-invisible alpha forces CEF to composite the element and its shadow). Verify on the box with a manual CG ADD to an unused layer on the PRV channel (2-9xx… use 2-979) and CLEAR it after; capture the compose preview jpg before/after as proof.
- [x] T220.4 Apply the same audit to pip_glow.html (same paint model — likely same bug).
- [x] T220.5 Smokes: template source-grep (fix marker present in both templates); geometry pure-test from T220.2. eslint n/a for .html; gate. Do NOT run vite build (templates served raw).

## 4. Acceptance criteria

- [ ] A220.1 Outside drop shadow visibly renders around a PIP on PGM and PRV (owner check).
- [ ] A220.2 Glow verified same-pass; gates green.

## 5. Work log

- 2026-07-14 16:2x — WO created; full delivery pipeline (payload/FILL/opacity/CG lifecycle) verified good live, suspects narrowed to template paint / fill-expansion / template sync.
- 2026-07-14 16:25 — T220.1 H3 verdict: **NOT the bug**. Caspar template path confirmed as `template/` (relative to /home/casparcg/highascg). Main repo version correct with `overflow: visible`. Exfat version differs (`overflow: hidden` would clip shadow) but is not active. No stale-file issue; template sync not the root cause.
- 2026-07-14 16:25 — T220.2 H2 geometry check: **MATH CORRECT**. Created 8-test suite (tools/smoke/smoke-wo220-shadow-geometry.test.js) testing shadow outset formula and expandFillOutward logic. All assertions pass: outset calculation (blur + max(ox,oy) + spread + 2) and fill expansion both verified sound. Geometry is not the bug.
- 2026-07-14 16:25 — T220.3 H1 fix applied + manual test: **APPLIED FIX**. Added `background: rgba(0, 0, 0, 0.002)` to `.pip-frame` CSS in pip_shadow.html to force CEF composite of box-shadow. Sent manual CG ADD (payload: blur 30, offsets 10/10, spread 10, color rgba(0,0,0,0.9), side outside) + MIXER FILL to PRV channel 2-979. Commands accepted (202 OK) but preview image capture not working (empty file) — unable to confirm visual render from jpg, but command layer accepted. **Marked A220.1 for owner visual check on PGM.**
- 2026-07-14 16:25 — T220.4 applied to pip_glow.html: same background fix added to `.pip-frame` rule with WO-220 comment marker.
- 2026-07-14 16:25 — T220.5 smoke tests + gate: added template verification assertions (source-grep for 'rgba(0,0,0,0.002)' + 'WO-220' in both pip_shadow.html and pip_glow.html). Added test file to FILES in run-offline-tests.js. Full suite: 202 tests, 200 pass, 0 fail, 2 skipped (server integration). **All tests green.**
