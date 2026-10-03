# WO-589 — Lower-thirds engine template: "Confetti Center" (screen-centered, confetti on title reveal)

**Status: IMPLEMENTED 03.10.26, round 2 same day (§4: no box, no underline) — rendered in headless Chrome through the real engine (centering, burst, studio hold-in, stop mid-burst, replay all probed); offline suite has one unrelated failure (§3). Server not restarted; owner: look at it on PRV/PGM through Caspar CEF.**

Owner, 03.10: *"i need a template based on the lower thirds engine that is centered on the screen and has a confeti animation on the title reveal"*

## 1. Investigation

- **Engine contract** (`template/lower-thirds/lt-engine.js` + `lt-engine-controls.js`): a variant calls `LTEngine.init({ containerSel, titleSel, subtitleSel, applyStyles, animateIn, animateOut })`. The engine handles the Caspar `update/play/stop/next/...` lifecycle, the animation queue, data mapping (`title`/`f0`/`name`, `subtitle`/`f1`/`role`), typography/box overrides and `speed` (= `gsap.globalTimeline.timeScale`).
- **Positioning is engine-owned.** `applyStyles` (`lt-engine.js:240-277`) anchors the container horizontally via `position` left/center/right and always writes `marginBottom = marginY` once margins are set (the studio defaults set them: `marginX 77 / marginY 43`). Every existing variant is `align-self: flex-end` (bottom-anchored). There is no vertical "center" in the engine. The variant `applyStyles` callback runs **last** (`lt-engine.js:283`), so a variant can override the anchoring.
- **`boxScale`** sets `transformOrigin` from `position` + `bottom` (`lt-engine.js:381-382`). That is wrong for a centered graphic.
- **Studio hold-in** (`studioHoldIn`) runs `animateIn` at `timeScale(1000)` and expects the end frame. **`studioReplay`** re-runs `animateIn` while state is 2, so `animateIn` must be self-resetting.
- **Studio export** (`src/cg-studio/export-template.js`) rewrites the first `:root {}` block with only `--primary/--text`, and replaces the first `<h1>` and the first `<p>` (or a `.subtitle` div's `<p>`). The template therefore must keep colours as `var(--x, fallback)` with no `:root` block, and must use a single `<p>` subtitle.
- **Catalog registration** is hard-coded in four places: `src/api/routes-lower-thirds.js` `TEMPLATE_CATALOG`, `src/cg-studio/template-scan.js` `BUILTIN_NAMES`, `src/engine/scene-template-cg.js` `DEFAULT_CG_DATA_BY_TEMPLATE`, and `tools/runtime/generate-lt-thumbnails.js`. The studio defaults are in `src/cg-studio/lt-param-registry.js` `getDefaultPayload`.

## 2. What was done

- **`template/lower-thirds/lt-confetti-center.html` (new).**
  - *Centering:* the container is `margin: auto` in the flex body, so it is centered on both axes. The variant `applyStyles` re-asserts `margin: auto` after the engine's anchoring, so `position`/`marginX`/`marginY` (including studio drag) are deliberately ignored. A `boxScale` override is re-originated to `center center`.
  - *Look:* a dark rounded card. The title is 76 px / 800 weight, an accent rule in `--primary`, and the subtitle is uppercase and letter-spaced in `--primary`.
  - *Reveal:* the card unfolds `scaleX 0→1` (0.45 s). The title pops `scale 0.4→1` with `back.out(2.2)`. **Confetti fires 0.12 s into the pop** from the title's rect. The rule grows from the center, then the subtitle rises in. `animateIn` resolves when the text is done (~1.45 s) and does **not** wait for the confetti, so a stop isn't held behind a 4 s burst.
  - *Confetti:* a full-frame canvas (z10, above the card). There are 180 strips or dots in `--primary` (weighted ×2), `--text` and a fixed festive palette. They use **closed-form** linear-drag + gravity motion (`x = x0 + v·(1−e^{−kt})/k`, gravity term `(g/k)(t − (1−e^{−kt})/k)`), plus sway, spin and a cosine "flip". Each particle has a 3.0–4.4 s life with a 0.8 s fade. A **GSAP tween** drives the clock rather than a raw rAF loop, so the burst obeys the engine's `speed` and the studio's ×1000 hold-in lands on the cleared end frame.
  - *Out:* the card fades and scales to 0.94 while the confetti canvas fades with it. Then the burst is killed and the canvas cleared.
- **Registration:** the id is added to the four catalog points in §1. `getDefaultPayload('lt-confetti-center')` gives the studio `position: center`, title 76 / subtitle 30, weight 800. The style vocabulary is unchanged, so `smoke-lt-engine-registry-sync` needs no edit.
- **Thumbnail:** `thumbnails/lt-confetti-center.png` was made with the generator's exact parameters, run for this one template only so the other PNGs don't churn.

## 3. What was VERIFIED

Headless Chrome (`src/media/headless-chrome-cdp`), real template file:
- `update({ position: 'left', marginX: 77, marginY: 43 })` + `play()` → container center measured at **(960, 540)**, with no page errors.
- Frames at ~0.35 s (card + title popping), ~1.45 s (burst mid-air, card fully revealed) and ~5 s (settled, no confetti) were viewed by eye. `stop()` → empty frame.
- Confetti canvas pixel count (non-zero alpha):
  - `?studio=1` `studioHoldIn()`: **0**
  - mid-burst: ~12 000
  - after `stop()` once the out finished: **0**, canvas `opacity` restored to `""`
  - `play()` again: ~11 000 at opacity 1, so the burst refires.
- `node tools/ci/check-max-file-lines.js`: 0 over. ESLint on the touched JS: clean.
- Offline suite: **1 failure, unrelated.** `smoke-wo577-shader-controls` flags `sh-sa-fluidic-space.json: junk label "Value"` from the WO-586 shader import (3ee91a4). None of the files touched here are involved.
- Prettier `--check` warns on `routes-lower-thirds.js`, `lt-param-registry.js` and `scene-template-cg.js`, but those three already warn at HEAD (pre-existing). `template-scan.js` stays clean.

**Owner QA:** load it on a channel through Caspar CEF, check confetti smoothness at broadcast frame rate, and decide whether the confetti should sit above the card (current) or behind it.

## 4. Round 2 (03.10): no box, no underline

Owner: *"no box underneath the name and title and also no underline"*.

- Removed the card (background, radius, shadow, padding/min-width) and the `.rule` element plus its tween. Because the dark card no longer sits behind the text, the title and subtitle get a two-layer text shadow (tight 2–4 px + soft 12–18 px) so they stay legible over arbitrary video.
- The reveal is now: title pops (`back.out`), confetti fires 0.12 s in, subtitle rises at +0.35 s. The card-unfold step is gone (nothing left to unfold), so `animateIn` resolves at ~0.8 s.
- **Re-verified** in headless Chrome over a blue→gold→white gradient background:
  - center still (960, 540) with `position: left` + margins passed in;
  - no errors; text legible on dark and light areas;
  - confetti px: hold-in 0 / mid-burst ~13 000 / after stop 0 / replay ~12 000.
- Thumbnail regenerated.
