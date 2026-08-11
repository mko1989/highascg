# WO-474 — a New project opens a clean device view: no audio, stream, record or virtual-cam output

**Status: DONE (11.08.2026, verified: offline suite 1947/1945 pass/0 fail/2 skip, eslint 0 errors,
0 files over 500 lines, dist-web rebuilt) — owner QA: hit New project and confirm device view is
empty; then add one of each and confirm they come up Audio 1 / Str1 / Rec1**

Extends [WO-473](./473_WO_FRESH_BOX_STILL_SHIPS_OUTPUTS_AUDIO_AND_REC.md) (record + the audio leak)
to every output family, and retires the rest of
[WO-393](./393_WO_ALLOW_ZERO_STREAM_RECORD_OUTPUTS.md)'s "key absent → seed one default" rule.

## 1. Investigation

Owner 11.08: *"fresh project should have clean device view, no audio, streaming, record, virtual cam
outputs."*

WO-473 cleared the record output and the audio leak off the operator volumes, but three gaps
remained, all of the same shape: **an absent key was treated as "seed one", while an empty array was
treated as "none".** Since `defaults-core.js` never defined `audioOutputs` or `streamOutputs` at
all, a fresh box hit the absent branch every time.

- `src/config/device-graph-suggest.js:222` — `Array.isArray(appConfig.streamOutputs) ? … : [{ id:
  'str_1' }]` drew a **Str1** band in device view on a box with no stream output.
- `src/api/settings-get.js` — the same fallback made `/api/settings` report a phantom `str_1`.
- `client/components/device-view-bands-render.js:332` — the Add button's own fallback meant the
  first "Add stream output" click would have created **Str2**.
- The virtual camera has no default at all, but nothing cleared it either: `virtualCamera` is not
  project state, so `applyHardwareConfigToCtx` never touches it and a New project inherited
  whatever vcam the box had, `vcam_1` band included
  (`device-graph-suggest.js:254` adds it whenever the key exists and `showInDeviceView !== false`).

And for audio specifically, the New-project reset could not clear the box's outputs even with an
empty factory array: `applyHardwareConfigToCtx` deliberately re-adds the box's **monitor-role**
outputs (WO-443). That rule is right for LOADING a project saved on another box — it stops a
foreign monitor device being imposed — but a New project is the explicit reset to factory, which is
a different intent.

## 2. What was done

**`src/config/defaults-core.js`** — `audioOutputs: []` and `streamOutputs: []` now ship alongside
WO-473's `recordOutputs: []`. Present-and-empty, not absent: that is what stops "absent" and "empty"
diverging again, since every phantom-seeding fallback keyed off `undefined`.

**Fallbacks → `[]`** in `device-graph-suggest.js` (stream), `settings-get.js` (stream) and
`device-view-bands-render.js` (the stream Add button) — the record equivalents went in WO-473.

**`src/engine/new-project.js`** — the reset now zeroes `audioOutputs`, `streamOutputs` and
`recordOutputs` and deletes `virtualCamera` from the saved config, next to the existing
`extraLiveSources: []`. `ConfigManager.save()` replaces rather than merges (`this.config = {
...newConfig }`, `_saveModular` rewrites each slice), so the deleted key really goes; a missing
`virtualCamera` normalises to `enabled: false`, so `isVirtualCameraEnabled()` stops the v4l2 bridge
on the resulting `change` event rather than throwing.

**Gate renamed and broadened** — `smoke-fresh-box-no-record-output.test.js` →
`smoke-fresh-box-clean-device-view.test.js` (curated list updated). It now pins: all three factory
arrays present-and-empty and no `virtualCamera`; the New-project hardwareConfig carrying none of
them; `createNewProject` resetting all four (source-text guard, since it needs no server); no
literal `rec_1` **or** `str_1` fallback in the four call sites; plus WO-473's staged-slice checks
for `record_outputs.json`, `device_graph.json` and the `audio_outputs.json` sync excludes.

**WO-393's guard repointed, with the reason recorded in the test:** "key absent → seed one default"
is gone for stream outputs as well as record outputs. Its core rule — an empty array must survive a
round-trip and never be re-seeded — is untouched and still asserted.

**WO-425's `!('audioOutputs' in cfg)` assertion** relaxed to `cfg.audioOutputs ?? [] === []`: the
key is present-and-empty now, which satisfies the same intent.

## 3. What was verified

- `npm run test:ci` — **1947 tests, 1945 pass, 0 fail, 2 skip**.
- Factory probe: `recordOutputs=[] streamOutputs=[] audioOutputs=[]`, no `virtualCamera`.
- `eslint` 0 errors (1 pre-existing warning), 0 files over 500 lines, `npm run build:client` rebuilt
  dist-web (three of the changed files are client-side).

**Not verified live:** `highascg.service` is down, so device view itself was not observed. Owner QA
as in the status line.
