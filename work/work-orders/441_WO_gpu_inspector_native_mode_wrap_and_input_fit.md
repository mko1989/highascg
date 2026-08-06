# WO-441 — GPU inspector: "Native mode" wraps mid-word; custom W/H/FPS boxes overflow the sidebar

**Status: DONE (2026-08-06 — suite 1858/0/2, built + kiosk F5) — owner eyeball**

Owner (todos06.08.26 items 1-2): "native mode display … always displays the Hz with the z in
the second line. make sure its always displayed in the same line" and "under it are input
boxes with default 1920 1080 where the second box doesnt fit the screen."

## Investigation

- **Hz split mid-word:** `.device-view__kv-val` (the summary-table value cell,
  `09b3-device-view-inspector-sidebar.css`) had `word-break: break-all` — legitimate for long
  unbroken EDID serials, but it licenses a break between ANY two characters, so
  "3840x2160 @ 50 Hz" wrapped inside "Hz". A width tweak could never fix this; the break rule
  itself was wrong for prose-like values.
- **Second box cut off:** the Video Mode row appends `customWidthIn/customHeightIn/customFpsIn`
  into a plain `display:flex` div (`device-view-inspector-gpu.js:401`). Number inputs keep
  their natural intrinsic width (~150 px) unless constrained — three of them plus gaps exceed
  the sidebar width, and flex items refuse to shrink below content size without `min-width: 0`,
  so the Height box (and FPS) overflowed out of view.
- The values themselves (1920/1080 defaults vs the 2160p cable feed) are the saved
  `screen_N_custom_*` consumer settings and out of scope here; the feed note directly above
  ("Output 1: 3840×2160 @ 50 Hz") shows the WO-437 fix reporting correctly.

## What was done

- CSS `.device-view__kv-val`: `word-break: normal; overflow-wrap: anywhere` — wraps at word
  boundaries, still breaks genuinely-too-long tokens (serials).
- `buildGpuInspectorSummaryRows`: the Native-mode string joins with non-breaking spaces
  (U+00A0), so the whole "WxH @ R Hz" stays on one line, per the owner's ask.
- The custom-input flex row: `min-width:0` on the container; each input gets
  `flex: 1 1 0; min-width: 0; width: auto` — three equal columns that actually fit.
- Smoke assertions in `smoke-wo440-441-apply-force-inspector-fit.test.js` pin all three
  (no `break-all` on kv-val, NBSP join present, flex sizing present).

## Verified

- Suite **1860/1858/0/2**, `npm run build:client` clean, kiosk F5'd. Visual confirmation is
  the owner's (sidebar rendering).
