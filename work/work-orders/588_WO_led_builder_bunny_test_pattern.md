# WO-588 — LED test pattern: "Bunny builds the wall" (full LED grid only)

**Status: IMPLEMENTED 03.10.26, round 2 same day (§4: speed setting, darker colours, no white). Rendered and probed in headless Chrome through the real template; offline smoke 10/10; client rebuilt, kiosk reloaded, server restarted. Not yet seen on a real LED wall.**

Owner, 03.10: *"create a new test card pattern where the main character from the logo highascg bunny is building the test pattern for the led wall. so it should only be available when full led grid is on. by building i mean the character should come into the canvas from outside carrying a led panel and placing it in its place. lets say it starts with gray panels like right now the test pattern has, and the character replaces the panels into another color (red for instance), when he is done with all panels he changes the color to another one."*

## 1. Investigation

- **Live template** is `led_grid_test.html` + `led_grid_test.js` + `led_grid_test-render.js` (`src/api/routes-led-test-card.js:14` `TEMPLATE = 'led_grid_test'`). `template/led_test_pattern/` (ES-module copy, `patterns.js`) is not loaded by any route and was left alone.
- **Layering** (`led_grid_test.html`): `#patternLayer` z0 → `#root` grid of `.panel` divs z1 (CSS grid, `1fr` cells, so cell *k* spans exactly `k·W/cols`) → `#screensMode` z4 (circle/cross/meta) → `#spec` z5 → `#center` eye z100. Every non-`grid-white` pattern paints `#patternLayer` and turns panels translucent (`root--transparent-panels`).
- **Pattern is global, grid is per channel.** The modal's pattern `<select>` applies to every enabled channel, while `gridByChannel` decides per channel whether `showLedGrid` is sent (`client/lib/led-test-apply.js`). So "only available with Full LED grid" needs two gates: the modal option, and the template itself, for channels that are in screens mode.
- **Character art**: `ch_both_open_green.png` / `ch_left_closed_green.png` / `ch_right_closed_green.png` (512×666, tracked). These are the same glyphs the center eye blinks with. The PNGs are used instead of the 1–2 MB embedded-PNG SVGs.
- **Size budget**: render.js 256 lines, led_grid_test.js 288. The builder goes in its own file (500-line limit).

## 2. What was done

- **`template/led_grid_test-builder.js` (new).** `renderBunnyBuilder(layer, data)` / `stopBunnyBuilder()`.
  - *Wall canvas* in `#patternLayer`, under the grid, so the R×C labels and seams stay on top. It starts with every cell painted in the default `.panel` gradient (the "gray like now") and repaints only the cell that was just placed.
  - *Actor canvas* `#builderActors` (z150, transparent, above everything) with the bunnies, the carried panels (lifted: scaled 1.05 with a drop shadow, settling into place over 0.28 s) and a white drop flash. Each bunny walks in from offscreen at its target row, holding the panel's trailing edge, with a hop and waddle. It blinks with the same left/right-closed sequence as the eye, then walks back out empty-handed.
  - *Order*: bottom row first (a wall goes up), left → right. Each bunny enters from the **nearer** side; the exact middle column alternates by row.
  - *Phases*: when every cell has the phase colour and all bunnies have left, there is a 1.2 s pause and then the next colour. The cycle is `#ff0000 → #00ff00 → #0000ff → #ffffff → red …` at full saturation, because it is a panel test.
  - *Scale*: bunny height = `clamp(cellH × 1.15, 32, H × 0.4)`, walk speed = `max(0.45 W, 2.5 cellW)` px/s. A trip looks the same at any resolution or grid density.
  - *Workers*: `charCount` (the existing "Bouncing characters" number) = how many bunnies work at once, capped at 12 and at the number of cells. They start 0.45 s apart. With the default 3 bunnies a 20×10 wall takes roughly 2 min per colour.
- **`template/led_grid_test-render.js`.** `builderOn = pat === 'led-builder' && data.showLedGrid === true`. With the grid off it falls back to the default look (no translucent-panel class). `resetPatternLayer` always calls `stopBunnyBuilder()`, so any CG UPDATE or pattern change removes the actor canvas and its rAF.
- **`template/led_grid_test.html`.** Loads the builder between the core and render scripts. `.root--builder .panel` = transparent background + dark seams, so the colours are not dimmed by the 15 % black that other patterns get.
- **`client/components/led-test-modal.js`.** New option *Animated: Bunny builds the wall*. `syncBuilderAvailability()` disables it (label: "needs Full LED grid") unless some channel has Full LED grid in the merged stored + checkbox map. If the last grid is unticked while it is selected, the select drops to `grid-white` and saves. The character-count field also shows for this pattern, labelled *Builder bunnies*.

No server change: `routes-led-test-card.js` already passes `pattern`, `cols`, `rows` and `charCount` through in grid mode.

## 3. What was VERIFIED

- **Headless Chrome, real template** (`src/media/headless-chrome-cdp`, `file://…/led_grid_test.html` + `update(...)`, 1920×1080, 8×4, 3 bunnies). Frames at 1.5 / 12 / 20 s: bunnies carry red panels in from both edges, the bottom rows fill first, labels/seams/circle/cross/meta stay on top, and the whole wall is red at 20 s. No page errors.
- **Colour-cycle probe** (wall-canvas `getImageData` at each cell centre, 4×2, 2 bunnies, 60 s): `…./R...` → all R at 7.5 s → G from the bottom row at 9 s → all G 15 s → B 22.6 s → W 31.6 s → **R again** at 39 s and onward. Gray → red → green → blue → white → red confirmed.
- **Fallback**: `update({showLedGrid:false, pattern:'led-builder'})` gives the normal screens card (eye + meta), and `#builderActors` is removed.
- **Offline**: `smoke-wo588-led-builder-pattern.test.js` 7/7 (order/side helpers run in a vm, plus template gate, script wiring and modal gate source pins), registered in `run-offline-tests.js`. Full curated suite: 2550 tests, 2547 pass, **1 fail, unrelated**: `smoke-wo577-shader-controls` trips on `data/shaders/sh-sa-fluidic-space.json` (a "Value" control label), a git-ignored runtime file from the WO-586 import, so it is local to this box and not part of this change. `check-max-file-lines`: 0 over. ESLint: no new findings (2 pre-existing warnings in the modal; templates are lint-ignored).
- `npm run build:client` → `led-builder` is present in `dist-web/assets/main-*.js`; kiosk reloaded (F5).
- **NOT verified / owner QA**:
  - On a real LED wall via Caspar's CEF: smoothness at the channel frame rate, and how the bunny reads at small cell sizes. 20×10 on 1080p gives a ~124 px bunny.
  - Whether full-white phases on a big wall are wanted (power/brightness). Dropping white is a one-line edit to `BUILDER_COLORS`.
  - The modal gate in the real UI: untick every Full LED grid box and the option greys out.

## 4. Round 2 (03.10) — speed setting, darker colours, no white

Owner, after the first look: *"its way too quick. needs a speed setting. no need for the full white it would be too bright. the red is also too bright. it shouldnt be full colors but rather darker versions."*

**Done:**
- **Colours**: `BUILDER_COLORS = ['#800000', '#008000', '#000080']` (half-level primaries). White is removed, so the cycle is gray → red → green → blue → red …. The drop flash went from 70 % to 30 % white for the same reason.
- **Speed setting** `builderSpeed` 1–10, default **3**. `ledBuilderPace(level) = level / 10`, so 10 is the round-1 pace (the "way too quick" one) and 3 is 0.3×. Walk speed scales by the pace. Placing, the pause between colours and the stagger between bunnies are divided by it. The hop rate scales by √pace so a slow walk doesn't look like slow motion. Blinks stay real-time.
- **Modal**: *Builder speed (1 slow – 10 fast)* number field, shown only for this pattern and stored in `highascg_led_test_builder_speed`. `led-test-apply.js` already spreads all settings into the POST, so it needed no change.
- **Route** (`routes-led-test-card.js`): it builds an explicit payload, so `builderSpeed` (clamped 1–10, default 3) is now added to the grid payload. **Server change → service restarted.**

**Verified:**
- Headless Chrome, 1920×1080, 8×4, 3 bunnies, wall-canvas probe of all 32 cells once a second. Whole wall red at **20.0 s with speed 10** and **66.2 s at the default** (3.3×, as designed). Colours seen across 90 s: only the two gray gradient tones, `128,0,0` and `0,128,0`; no white. Frame at 12 s: dark-red panels, bunnies carrying.
- Route exercised offline with a stubbed AMCP: `builderSpeed` 7 → 7, missing → 3, 99 → 10, both in the response and in the CG ADD data.
- Smoke 10/10 (+ pace mapping, route pin, modal field). Full curated suite: 2553 tests, 2550 pass, 1 fail, which is the same unrelated `data/shaders/sh-sa-fluidic-space.json` failure as §3. 0 files over 500 lines; no new lint warnings. Client rebuilt (`led-test-builder-speed` is in the bundle), kiosk reloaded, `highascg` restarted (PID 2621 → 74632, `/api/state` 200). A live test card was not put up from here, because that would go on air.
- **Owner QA**: pick a speed on the wall, and check that 50 % colours are dark enough. They are a single constant, so 40 % / 30 % is a one-line change.
