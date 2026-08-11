# WO-484 — a `custom` screen registers a `<video-mode>` that CasparCG already ships

**Status: DONE (11.08.2026, verified: new smoke 4/4, two existing generator guards repointed with
coverage added, suite 1971/1969 pass/0 fail/2 skip)**

## 1. Investigation

Owner 11.08: *"why is there a video mode created for 1920x1080, this is a standard video mode of
1080p50 and should not be created"*.

Correct. The generated config on highascg0916 carried:

```xml
<video-mode>
    <id>1920x1080</id><width>1920</width><height>1080</height>
    <time-scale>50000</time-scale><duration>1000</duration><cadence>960</cadence>
</video-mode>
```

CasparCG's own table has that exact row already — `video_format.cpp:99`:
`{x1080p5000, 1, 1920, 1080, 1920, 1080, 50000, 1000, L"1080p5000", {960}}`. The block is
`1080p5000` spelled differently.

**Cause.** `getModeDimensions()`'s `'custom'` branch (`config-modes.js`) and
`operatorGuiModeDimensions()` (`config-generator-channel-plan.js`) both minted
`modeId: ${w}x${h}, isCustom: true` from the destination's width/height/fps **without checking
whether that triple is already a shipped mode**. `custom` describes how the operator picked the
size, not whether Caspar needs a new mode.

**Why it is not merely untidy.** A channel on a synthesised mode runs as `video_format::custom`, so
a DeckLink consumer cannot match it to a `BMDDisplayMode` by identity and falls back to conversion —
which is what the box logs on exactly those channels:
`Device supports video-format with conversion: 1080p50`.

## 2. What was done

- **`config-modes.js`** — new exported `findStandardModeId(width, height, fps)` (fps compared with a
  0.01 tolerance, since the fractional families are stored as 23.98 / 29.97 / 59.94). Both synthesis
  branches of `getModeDimensions` now return the shipped mode when one matches.
- **`config-generator-channel-plan.js`** — `operatorGuiModeDimensions` does the same.
- **`config-generator-custom-modes.js`** — `pushCustomMode` refuses to register a duplicate.

**Both halves are load-bearing, and the first cut proved it.** Guarding only the emitter made the
suite fail with a config whose operator-GUI channel referenced `<video-mode>1280x720</video-mode>`
while `<video-modes/>` was empty — Caspar refuses to start on an unknown mode id. A resolver that
keeps minting `WxH` and an emitter that refuses to register it is strictly worse than either
behaviour alone.

## 3. What was verified

- `tools/smoke/smoke-no-duplicate-standard-video-mode.test.js` (curated list) — 4/4: 1920x1080@50
  resolves to `1080p5000` with `isCustom: false`; 6144x1536@50 (PGM1's two-head canvas) stays
  custom; the emitter refuses a hand-built duplicate but still emits the real one; every shipped
  mode is findable by its own dimensions; and the cadence arithmetic CasparCG validates
  (`cadence*timescale == 48000*duration`, `server.cpp:239`) holds for the emitted block.
- Two existing generator guards repointed, both of which asserted the old duplicate:
  `smoke-wo242-pixelmap-screens` (1920x1080@50 → now `1080p5000`) and `smoke-wo243-operator-gui`
  (1280x720@30 → now `720p3000`). Coverage was added, not lost: a new case pins that an ultrawide
  2560x1080@50 operator monitor still registers its mode with the right time-scale and cadence.
- Suite **1971 tests, 1969 pass, 0 fail, 2 skip**; eslint clean.

**Owner note on the numbers** (raised in the same message): `time-scale = fps × 1000`,
`duration = 1000`, `cadence = 48000 / fps` is exactly what the generator emits and what CasparCG's
parser requires — 50 fps → 50000/1000/960, 60 fps → 60000/1000/800. The 50p mode on PGM1 was
correct; it is not the half-speed cause (see WO-483 thread).
