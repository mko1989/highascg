# WO-917 — Pixel map: an intensity override switch for playing with it in the previs

**Area:** mapping, lighting
**Status: DONE (31.10.26 — live: override on → 1792 mapped beams lit in the picture colour, W 0; off → 0; 50 % → i 0.502; GUI e2e 11/11)**

Owner, 31.10.26 (right after WO-916 took the PixelLines' dimmer away from the map):
> Still want to play around with it in the previz so do switch in the mapping to override the intensity level.

Follows [WO-916](916_WO_pixel_map_always_on_console_output.md) (pixel colour only; the WO-915 `fixed "1=255 53=0 … 68=0"`
removed from the 56 PixelLines so the LD owns dimmer and white).

## Investigation (31.10, Opus)

- **Why the previs is dark now.** The previs decodes the engine's own universe buffer of each head
  (`follow-service.js` `visual()` → `engine.frameOf(fx)`, ~`:263-272`); the pixel map writes only the mapped pixels'
  colour channels into it (`pixel-map-service.js` `write()` → `writePixel`, ~`:273-281`). Pixel Line IP `Mode11 70DMX`
  ch1 = Dimmer, GDTF default 0 → every bar dark until something opens it. WO-915 used the patch `fixed` text for that,
  WO-916 removed it.
- **The white segments.** Pixels 17–32 of the head (`Array 125…140`, offsets 53–68) are W segments with GDTF default 255
  on the same LEDs; the proposal maps only the 16 RGB cells. With the dimmer open they wash every bar white (found in
  WO-915) — an override that only opens the dimmer would show white bars, so it also has to hold the unmapped pixels
  dark.
- **Where an override belongs.** Not the patch `fixed` (per head, hand-typed, lives on after the play session; the
  owner asked for a switch "in the mapping"). `pixelMapSettings` is the pixel map's own server-owned settings block
  (WO-893/916), already saved by the window's Save with the smoothing / console rows — one more field there.
- **Reach.** The engine buffer is what this box sends to the heads when its DMX master lists the universe
  (`follow-engine.js` `_live`); with the master off (the shop) it is previs only. The console output (WO-916) is built
  from the colours, not this buffer — stays colour only either way.

## Plan

1. `pixelMapSettings.intensity = { override (default false), level % (default 100) }` (pixel-map-settings.js).
2. pixel-map-model.js: `intensityPlan(fx, mappedPixels)` (the head's `Dimmer` channels + its unmapped pixels) and
   `writeIntensity(buf, fx, plan, level)`; the service's `write()` applies it per mapped head while `override` is on.
3. Godot pixel map window: an "Intensity" row — "Override" switch + level %, saved with the other settings.

## What was done (31.10, Opus)

- **`src/fixtures/pixel-map-settings.js`** — `intensity { override (bool, default false), level (0…100 %, default 100) }`;
  a POST of `{ intensity }` alone keeps the rest; all-default still drops the key.
- **`src/fixtures/pixel-map-model.js`** — `intensityPlan(fx, mappedPixels)` = the head's GDTF `Dimmer` channels + its
  pixels no mapping drives; `writeIntensity(buf, fx, plan, level)` writes the dimmers at the level (any resolution,
  big-endian) and those pixels black via `writePixel(…, null)` (so subtractive heads go dark too).
- **`src/fixtures/pixel-map-service.js`** — `write()` applies it per mapped head while `override` is on, before the
  mapped colours; the plan is cached per resolved mapping list (WeakMap). `/live` reports `intensity`. Off = nothing is
  written, so the head's own values (GDTF defaults / programmer / patch `fixed`) come back on the next tick.
- **Godot `pixel_map_console.gd`** — a third row "Intensity [Override] [100 %]" (level greyed while off), saved with
  the other settings. Its tooltip says it also goes on the wire when this box's DMX output sends the universe, and that
  the console output stays colour only. `settings_from` reads booleans with `is bool` (a non-bool `== true` is a
  GDScript runtime error — also fixed for `console.enabled`).
- **Live**: override switched ON at 100 % in mhp_harder (`POST /api/fixtures/pixelmap/settings`) so the previs shows the
  map right away; the owner toggles it in the window. DMX master still off → nothing on the wire from this box.

## Verified (31.10)

- **Offline**: new `smoke-wo917-pixel-map-intensity.test.js` (7: plan = Dimmer + 30 unmapped pixels; level 50 % → 128,
  W + other cells 0, mapped cells untouched; 16-bit dimmer; settings defaults / partial write / junk refused; service
  through the real FollowEngine with the master off: off → dimmer 0 / W 255, on → 255 / 0, 40 % → 102, off → back;
  wiring pin). Pixel-map smokes 807 / 893 / 897 / 915 / 916: 89 pass. Godot suite 25 588 passed, 0 failed (new
  `test_console_intensity_row`).
- **GUI e2e** `07_pixel_map` (sandbox, real window, Art-Net on 127.0.0.1:6455): 11 passed — new step ticks Override +
  Save → u18 slot 421 (Dimmer) 255 and slot 473 (W 1) 0; unticks + Save → 0 / 255.
- **Live on the box** (`GET /api/tracking/fixtures` = what the previs decodes; temporary `PLAY 2-90 #FFFF6600` on the
  Dioda PGM, cleared after): override on → 1792 of 2688 PixelLine beams lit (the 16 RGB cells × 56 heads), every one
  c [1, 0.4, 0], 0 whitish (W segments dark); off → 0 lit; 50 % → beam i 0.502.
