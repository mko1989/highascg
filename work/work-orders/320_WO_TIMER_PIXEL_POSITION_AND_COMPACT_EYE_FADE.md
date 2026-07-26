# WO-320 — Countdown timer needs pixel-precise position; compact-timer eye icon should fade

**Status: DONE — Part B landed b168f25; Part A implemented 2026-07-26 late: posX/posY px override in countdown-engine (padding-anchor, empty = preset fallback, headless-verified both modes), inputs in the panel settings form AND the standalone countdown inspector; server untouched (opaque config passthrough).**

**Source:** todos22.07.26 — "the countdown timer needs precise position in pixels and in the small
compact timer the eye icon should perform fade in/out."

Two asks. Part B (eye fade) is a one-line client fix — the server pipeline already exists. Part A
(pixel position) must be built end-to-end (no coarse control exists to refine).

---

## Part B — Compact-timer eye icon should fade (small, do first)

### Root cause
The fade pipeline is fully built server-side; the compact eye button just doesn't use it. The
compact strip lives in the audio-mixer panel: `client/components/audio-mixer-panel.js:185-199` —
the eye button's click handler POSTs `/api/timers/visible { timerId, screenIdx, visible }` at
`:192` with **no `fadeFrames`**, so the server does an instant opacity cut. A second cut-only eye
chip exists at `client/components/timer-control-panel.js:248-257` → `onToggleVisible`
(`:346-354`).

The server already supports fades: `/api/timers/visible` validates and forwards `fadeFrames`
(0–500) — `src/api/routes-screen-timers.js:210-234` — and `screenTimers.setTimerVisible` emits
`MIXER <ch>-<layer> OPACITY <0|1> <frames> linear` when `frames>0`, else a plain cut
(`src/engine/screen-timers.js:237-284`, esp. `:282-284`). The full screen-timer inspector already
drives it: `client/components/inspector-screen-timer.js:120-137` has explicit Fade In/Out buttons
calling `postVisible(visible, FADE_FRAMES)` with `FADE_FRAMES = 25` (`:19`).

### Fix
Add `fadeFrames` (reuse `FADE_FRAMES = 25`, or a shared constant) to the compact eye button's POST
body at `client/components/audio-mixer-panel.js:192`. Apply the same to the
`timer-control-panel.js:348` chip **if** the owner wants it there too (see Ambiguities). No server
change.

**Opacity target caveat:** a fade-to-visible fades to the per-screen stored on-air opacity
(engine `screen-timers.js:280`; slider at `inspector-screen-timer.js:152-174`), not necessarily
1.0. Make the compact eye's fade target that stored opacity, not a hardcoded 1 — match the existing
Fade In behavior rather than inventing a new one.

### Constraints / acceptance (Part B)
- Client-only change → **`npm run build:client`** (vite → `dist-web/`) + kiosk reload; the server
  serves built `dist-web/`, not `client/`. Service restart alone is not enough.
- `/api/timers/*` are `requireCaspar: true` (`src/api/router.js:359-362`) — needs a live Caspar to
  exercise; verify on-box (no existing test asserts `fadeFrames` — `test/wo-208-smoke-tests.js`
  covers timers but not this).
- **Acceptance:** clicking the compact eye ramps opacity over ~25 frames (visible fade in/out on
  the output), fading to the stored on-air opacity, not an instant cut. No new eslint warnings.

---

## Part A — Pixel-precise countdown position (build end-to-end)

### Root cause — nothing coarse to refine; must be added across 3 layers
Position today is a **7-value preset enum** rendered by static flexbox alignment classes. There is
no numeric coordinate anywhere:

- **UI (preset dropdown only):** corner/inspector settings form
  `client/components/timer-control-panel-settings-form.js:90-108` (`positionSelect`, options
  `center/top-left/top-right/bottom-left/bottom-right`, saved to `newConfig.position` `:145`,
  POSTed to `/api/timers/assign` `:150`; reused by screen-timer inspector via `buildTimerSettings`,
  `inspector-screen-timer.js:184`). Standalone countdown inspector
  `client/components/inspector-countdown.js:43-49` (`POSITION_OPTIONS`, 7 presets), rendered
  `:235-246`, saved `:400`. Size is a separate **vw** number input, not px.
- **Config model:** `position` is a string preset; size is `timerFontSize` in **vw**
  (`template/countdown/countdown-engine.js:38-56`: `position:'center'`, `timerFontSize:15`). No
  `posX`/`posY`/`left`/`top`/anchor fields exist.
- **On-air template (flexbox 9-zone snap):** `template/countdown/countdown-engine.js:32-36`
  `POSITIONS`; `applyPositionClass()` (`:148-153`) maps `config.position` → a
  `countdown-pos-<preset>` class; `template/countdown/countdown.html:29-35` — those rules set only
  `align-items`/`justify-content`/`text-align`. Root is full-frame `position:relative` (`:16`),
  timer child is `position:absolute` (`:20`). **No px/left/top/translate anywhere.**
- **Server is an opaque passthrough:** `config` flows through `/api/timers/assign` untouched
  (`src/engine/screen-timers.js:123-124`, ADD `:176-180`, UPDATE `:129-132`, restore `:410-412`) —
  it does not interpret `position`, so new fields ride through automatically.

### Fix direction (spans 3 layers; storage needs no server change)
1. **Client UI** — add numeric px `posX`/`posY` inputs alongside the preset in
   `timer-control-panel-settings-form.js:90-108` and `inspector-countdown.js:235-246` (+ save blocks
   `:400`, form `:140-147`). Define preset↔px precedence (recommend: px offset/override applies only
   when set, else fall back to the preset — see Ambiguities).
2. **Server** — none required for storage (opaque passthrough). Optionally extend validation to
   bound the new numeric fields.
3. **On-air template** — add `posX`/`posY` to `DEFAULT_CONFIG` (`countdown-engine.js:38-56`), apply
   as inline `left`/`top` px on the absolutely-positioned timer element in
   `applyPositionClass()`/`render()` (`:148-173`), and adjust `countdown.html:20-35` so px offsets
   are not overridden by the flexbox preset rules (px override must win when set). Template files are
   loaded directly by CEF, so they generally do **not** need the vite build — only `client/` does.

### Constraints (Part A)
- Client half needs **`npm run build:client`** + kiosk reload; template half is loaded by CEF
  directly (no build), but changes render ON AIR — keep defaults identical to today so existing
  countdowns don't move (px unset ⇒ current preset behavior, bit-for-bit).
- No existing test covers `position`/geometry; verify on-box against the output monitor.

### Acceptance (Part A)
- Operator can set an exact px X/Y for the countdown; the on-air timer lands at those pixels on the
  output, and an unset px value renders exactly as today's preset.
- Preset↔px precedence behaves per the owner's chosen rule; switching presets with px unset still
  works.
- `npm run test:ci` → 0 fail; no new eslint warnings.

---

## Ambiguities for the owner
1. **Coordinate reference frame (A):** px relative to the channel raw resolution (e.g. 1920×1080),
   the CEF template canvas, or percent? And is X/Y the timer element's top-left or its center? The
   full-frame `position:relative` root makes absolute px on the child straightforward once the
   reference and anchor are fixed.
2. **Preset vs pixels coexistence (A):** keep the 7 presets and add an optional px override
   (recommended), or replace presets with free X/Y? Needs a defined precedence (px wins when set).
3. **Which eye buttons fade (B):** only the audio-mixer compact strip (the literal "small compact
   timer"), or also the `timer-control-panel.js` chip? Fixed `FADE_FRAMES=25` or configurable?
4. **Fade target (B):** confirm the compact-eye fade should target the per-screen stored on-air
   opacity (matching the existing Fade In), not a hardcoded 1.0.
