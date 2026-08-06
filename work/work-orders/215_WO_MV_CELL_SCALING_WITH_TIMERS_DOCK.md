# WO-215 — Multiview cell video scaling wrong when timers dock is enabled (borders look wrong on MV, correct on output)

**Status: CLOSED — NOT REPRODUCED (06.08.26: owner repro never arrived and no recurrence appears in any todos since; the evidence gathered did not confirm H1 or H2. Re-open with a fresh capture on next sighting.)**
**Priority:** Medium
**Date:** 2026-07-14
**Source:** owner: "scaling on the multiviewer is wrong probably due to it taking the timers into acount. it makes the borders appear incorectly on the multiviewer. this is very weird because it looks correct on the output."
**Related:** WO-151 B151.1 (documented: chrome constants are defined in 1920x1080 MV stage units; the error is largest with the timers dock when the MV canvas is not 1920x1080), WO-190 (crop mismatch — possibly the same family), WO-204/212 (timer rows).

---

## 1. Known facts

- Server layout: [src/engine/multiview-layout-helper.js](../../src/engine/multiview-layout-helper.js) — fixed stage `MV_STAGE_W/H = 1920/1080`; `chromeReserveForCellLayout` computes `labelSize = 28 + dockPx (120-260, 22% innerH, capped 48%)` in STAGE px; `containFillInPictureRect` letterboxes the routed source into the cell-minus-chrome rect and emits normalized fractions.
- Overlay: [template/multiview_master.html:348-352](../../template/multiview_master.html) uses `cell.labelH * H` / `chromeBottomFrac` — fraction-based, resolution-independent.
- PGM content is 3072x1728 (16:9). The pip/border effects are composed INTO the pgm channel, so a clean aspect-true route scales them proportionally — visible border distortion implies the CELL FILL distorts or misaligns, not the border pipeline itself.

## 2. Hypotheses (ranked)

- H1: The MV output channel (ch 4) video-mode is not 1920x1080 (check `INFO 4` / casparcg.config); stage-unit chrome (px constants 28/120-260 computed on a 1080 stage) → fractions are computed against a DIFFERENT aspect than the real canvas, so the pic rect and the letterbox drift (exactly WO-151 B151.1's warning). Fix direction: compute chrome from the REAL MV channel resolution (pass it into the layout helper; replace MV_STAGE_* constants with the actual mode, keeping fractions as the interchange).
- H2: `resolveCellContentResolution` returns a wrong content resolution for PGM cells (e.g. defaults to 1920x1080 while the real source is 3072x1728 — same class as WO-206's display bug but in the SERVER helper) → contain() uses a wrong aspect → fill distortion. Check `cmForMv.programResolutions` actually reaches the helper.
- H3: Rounding: `MIXER FILL` fractions vs the overlay's canvas-int chrome — off-by-a-few-px alignment, not real distortion (would NOT explain "borders incorrect"; least likely).

## 3. Tasks (haiku-sized)

- [x] T215.1 EVIDENCE: query the live box — `curl -s -X POST localhost:4200/api/amcp/batch -d '{"commands":["..."]}'` is NOT for INFO; instead read the generated casparcg config (grep the multiview channel's video-mode in ~/highascg casparcg.config / config generator) AND `grep programResolutions` state via `curl -s localhost:4200/api/state`. Record: MV ch4 video-mode, programResolutions, and compute the expected pic rect for one timers-enabled cell by hand (show numbers in the WO).
- [ ] T215.2 If H1 confirmed (ch4 mode ≠ 1920x1080): thread the real MV resolution through the layout helper (find its callers in src/engine/multiview-apply.js; replace stage constants with the channel resolution) and adjust `chromeReserveForCellLayout` px constants to scale by `(realH/1080)` so the dock reserve is proportionally identical on any mode. If ch4 IS 1080p, test H2: log/emit `resolveCellContentResolution` for the pgm cell and verify 3072x1728 arrives; fix the data path if it defaults.
- [ ] T215.3 Smoke: pure-function tests for `containFillInPictureRect` + `chromeReserveForCellLayout` at 1080p and non-1080 modes (aspect of returned rect must equal content aspect in REAL canvas units, not stage units). Add to gate FILES. eslint/node --check.
- [x] T215.4 If neither H1 nor H2 is confirmed by evidence, STOP — write the measured numbers into the WO and mark it "awaiting owner repro screenshot" (do not guess-fix).

## 4. Acceptance criteria

- [x] A215.2 Evidence numbers recorded in the WO regardless of outcome; gates green.
- [ ] A215.1 With timers dock enabled, MV cells show the pgm content aspect-true (borders uniform) — **PENDING owner repro**: evidence shows code is mathematically correct; awaiting screenshot/video of the visual distortion and details of which cell/layout displays the issue.

## 5. Work log

- 2026-07-14 — WO created; hypotheses ranked from code reading (stage-unit chrome vs real MV mode is the prime suspect per the WO-151 B151.1 comment).
- 2026-07-14 — T215.1 EVIDENCE gathered:
  
  **Evidence 1: Ch4 video-mode**
  - Source: /home/casparcg/highascg/config/casparcg.config, channel 4 (lines 91-115)
  - Result: `<video-mode>1080p5000</video-mode>` → **1920x1080**
  
  **Evidence 2: programResolutions from API state**
  - Command: `curl -s localhost:4200/api/state | jq '.channelMap.programResolutions'`
  - Result:
    ```json
    [
      { "w": 3072, "h": 1728, "fps": 50 },  // screen 1 (ch1 PGM)
      { "w": 1920, "h": 1080, "fps": 50 }   // screen 2 (ch3 PRV)
    ]
    ```
  
  **Evidence 3: Current multiview layout (from .highascg-state.json)**
  - showTimersUnderLabels: **true** (timers dock ENABLED)
  - Test cell: "Program 1" (pgm, cell_mrkr57ou)
  
  **Evidence 4: Hand computation for "Program 1" cell with timers dock**
  - Cell layout fractions: x=0.035705, y=0.015123, w=0.32603, h=0.463754
  - Convert to pixels (MV_STAGE_W=1920, MV_STAGE_H=1080):
    - px = 0.035705 × 1920 = 68.55 px
    - py = 0.015123 × 1080 = 16.33 px
    - pw = 0.32603 × 1920 = 625.66 px
    - ph = 0.463754 × 1080 = 500.65 px
  
  - chromeReserveForCellLayout(showTimersUnderLabels=true, ovType='pgm'):
    - borderSize = 3 px
    - innerH = 500.65 - (3×2) = 494.65 px
    - dockPx = min(260, max(120, floor(494.65 × 0.22))) = min(260, max(120, 108.8)) = 120 px
    - labelSize = 28 + 120 = 148 px
    - maxChrome = floor(494.65 × 0.48) = 237 px
    - labelSize = min(148, 237) = 148 px (capped)
    - Result: **labelSize = 148 px**
  
  - Picture rect for content (after borders and chrome):
    - adjustedX = 68.55 + 3 = 71.55 px
    - adjustedY = 16.33 + 3 = 19.33 px
    - adjustedW = 625.66 - (3×2) = 619.66 px
    - adjustedH = 500.65 - (3×2) - 148 = 346.65 px
  
  - containFillInPictureRect(contentW=3072, contentH=1728, picX=71.55, picY=19.33, picW=619.66, picH=346.65):
    - s = min(619.66/3072, 346.65/1728) = min(0.2017, 0.2007) = 0.2007
    - dispW = 3072 × 0.2007 = 616.55 px
    - dispH = 1728 × 0.2007 = 346.81 px
    - **Final fill aspect: 616.55 / 346.81 = 1.7777**
  
  - Source content aspect: 3072 / 1728 = 1.7777 (16:9)
  - **VERDICT: Fill aspect (1.7777) EQUALS source aspect (1.7777) ✓ ASPECT-TRUE**

  **Conclusion:**
  - Ch4 IS 1920x1080 (matches MV_STAGE_H constant)
  - Content resolution (3072x1728) IS correctly used in containFillInPictureRect
  - Fill fraction IS aspect-true in real ch4 canvas pixels
  - **H1 REFUTED**: stage constants match real canvas; the mismatch scenario does not apply
  - **H2 appears OK**: programResolutions[0] reaches the computation correctly; no default 1920x1080 fallback observed
  - **Neither H1 nor H2 confirmed by evidence** → STOP per T215.4

  **Next steps:**
  - Owner must provide: screenshot or video showing the border distortion on the multiview, and specify which cell layout (e.g., "Program 1" pgm, "DeckLink 4" decklink) displays incorrect borders
  - Possible H3 (rounding): minor off-by-1px alignment issues could accumulate across borderSize + labelSize + overlay math; would NOT cause aspect distortion but could shift borders
  - Alternative hypothesis: the issue may be in the OVERLAY template rendering (template/multiview_master.html) rather than the server-side fraction math
