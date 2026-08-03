# WO-411 — Test pattern: resolution repeated in the Output line + bouncing-character bump box (todos03.08 additions)

**Status: DONE (2026-08-03 — suite green, service restarted; owner eyeball owed: pop the LED test pattern once)**
**Priority:** Normal (owner todos03.08.26 lines 11–12, added after WO-408's first fix)
**Source:** `work/work-orders/todos03.08.26`
**Related:** WO-408 (first half of the double-resolution fix — the top meta line)

## 1. Investigation

1. **"now it displays it once at the top and then the second time after screen consumer"** —
   WO-408 fixed the TOP line (`resolutionLabel` no longer repeats resolution-named modes),
   but the SECOND meta line ("Output: …") appends the video mode too:
   `routes-led-test-card.js:112-114` built `connectorLabel += ' · screen' + ' · 1728x960'` —
   literally "after screen consumer". The startup path had the same suffix in its fallback
   (`startup-led-test-pattern.js`, two build sites: `PGM ch N · <videoMode>`).
2. **"bouncing character has too big bump box … bounces off the wall too early on left and
   right"** — `led_grid_test-render.js` draws each glyph **aspect-fitted inside** a
   250×250 `bounceSize` square (`drawW = bounceSize * ratio`, centered by `offsetX`) but
   collides the FULL square against the walls. Narrow glyphs (ratio < 1) reversed
   `offsetX` px before their visible edge touched — horizontal only, matching the report
   (vertically these glyphs fill the box).
   Note: `led-grid-test-core.js` + `led-grid-test-patterns.js` are **orphans** — referenced
   by nothing (an unwired split of `led_grid_test.js`/`-render.js`); the live template loads
   `led_grid_test.js` + `led_grid_test-render.js` per `led_grid_test.html:333-334`.

## 2. What was done

- `routes-led-test-card.js` — no `videoMode` suffix on the Output line ("once at the top is
  enough"); the `outputRole` (screen/decklink) suffix stays.
- `startup-led-test-pattern.js` — both fallback sites drop the mode suffix.
- `led_grid_test-render.js` (live) **and** `led-grid-test-patterns.js` (orphan, kept in
  sync) — collision now uses the drawn glyph rect (`x + offsetX ± drawW`), so a bounce
  happens when the visible character touches the border; the random glyph swap on bounce is
  unchanged (next frame re-derives the new glyph's box).

## 3. What was VERIFIED to work

- `node --check` on both template files; offline suite green (counts in commit); service
  restarted so the label changes are live. Template JS reloads on the next `CG ADD`
  (test-pattern invocations are always fresh adds).
- Owner QA: open the LED test pattern — resolution once (top line only), characters bounce
  at their visible edges.

## 4. Round 2 (03.08 later): character size relative to the screen (todos03.08 addition)

Owner: *"the bouncing character needs to have relative size to the size of the screen,
right now on smaller screen its too big."* The box was a fixed `bounceSize = 250` px in both
copies (`template/led_grid_test-render.js:61`, `template/led-grid-test-patterns.js:61`).

**Done:** `bounceSize = max(40, round(min(width, height) × 0.26))` — 26% of the shorter
screen dimension reproduces the original look on the 1728×960 main screen exactly
(0.26 × 960 ≈ 250) and scales down on smaller outputs (720×576 → 150 px). `baseSpeed` now
equals `bounceSize` (was independently 250) so travel speed stays proportional to size.
Both template copies updated in sync (the WO-411 rule).

**Verified:** `node --check` both files; scaling table sanity-run (1728×960→250,
1920×1080→281, 720×576→150, min-clamp 40). Templates load fresh on every CG ADD — no build
or restart needed. Owner QA: pop the test pattern on a small output.
