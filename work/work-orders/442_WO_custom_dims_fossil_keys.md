# WO-442 — Custom W/H boxes showed seeded 1920/1080 fossils beside a 2160p mode

**Status: DONE (2026-08-06 — suite 1860/0/2, built + kiosk F5; config healed via settings API)**

Owner (follow-up on WO-441): "those saved values of 1920/1080 are nowhere in my config apart
from those boxes, it doesnt make sense at all."

## Investigation

- The values WERE in the config — `config/caspar_server.json:240-245`
  (`screen_1/2_custom_width: 1920, _height: 1080, _fps: 50`) beside `screen_1/2_mode:
  2160p5000` — but the owner never set them. **They are fossils of the WO-437 bug**: cabling
  a source onto a GPU port runs `gpuScreenInheritedSettingsPatch(screenN, source)`
  (`device-view-cable.js:423`), which writes `screen_N_mode` AND `screen_N_custom_*` from the
  resolved feed in one patch. At cable time the pre-WO-437 feed resolver returned the corrupt
  pair `{mode: '2160p5000', width: 1920, height: 1080}` — so the mode saved right and the
  custom keys saved wrong, in the same write.
- The keys are inert while the mode is standard (`custom_*` only feeds the generator when
  mode === 'custom'), but the inspector displayed them in permanently-visible disabled boxes,
  and they would prefill wrong if the owner ever switched to Custom.
- Seed source already fixed: WO-437 made the feed resolver return mode-canonical dims, so
  new cables write consistent pairs.

## What was done

- **Config healed** via `POST /api/settings` (server owns the file): `screen_1/2_custom_*`
  now 3840/2160/50, matching their saved 2160p5000 modes. Verified persisted on disk.
- `device-view-inspector-gpu-video-modeline.js` `syncCustomInputsState`: the custom W/H/FPS
  row is **shown only when the Caspar mode is Custom** (a standard mode fully determines the
  raster; disabled boxes just parroted whatever the keys held). Switching TO Custom prefills
  the boxes from the mode that was just active (`videoModeToResolution(prevStandardMode)`),
  never from stale keys.
- `device-view-inspector-gpu.js`: initial row visibility applied at assembly (the sync
  helper runs before the row div exists).
- Smoke `tools/smoke/smoke-wo442-custom-dims-fossils.test.js` (curated list) pins the
  only-in-Custom rule (sync + assembly) and the prefill-from-active-mode rule.

## Verified

- Suite **1862 tests, 1860 pass, 0 fail, 2 skip**; built + kiosk F5'd.
- On-disk keys confirmed healed. Owner QA: the Video Mode section should now show only the
  mode dropdown for 2160p5000; picking Custom starts from 3840×2160@50.
