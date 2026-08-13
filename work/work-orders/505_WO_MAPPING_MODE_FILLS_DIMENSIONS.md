# WO-505 — Pixel-mapping output: choosing a resolution did not fill width/height

**Status: DONE in repo (13.08.2026 — 4 smokes, suite 2069/2067/0, eslint 0, prettier clean, client rebuilt). NOT deployed to the kiosk — needs a reload.**
**Priority:** Low-Medium (UI correctness; the panel contradicted what it saved)
**Source:** owner `todos13.08.26`: *"in pixel mapping node, when in an output a resolution is chosen from a drop down, it should fill width and height with that resolutions w/h."*
**Related:** [WO-437](./437_WO_mapping_dims_stale_and_gl_sync_mapping_rig.md) — fixed the same
staleness on the SAVE side; this is the display half it left behind.

## 1. Root cause

`client/components/device-view-inspector-mapping.js`:

```js
vMode.onchange = () => {
	customBox.style.display = vMode.value === 'custom' ? 'grid' : 'none'
	if (vMode.value !== 'custom') saveCustom()
}
```

`saveCustom()` correctly derives the standard mode's dimensions (`std.w`/`std.h`) and persists
those — that is WO-437's fix, which stopped a standard mode being saved alongside the hidden custom
inputs' stale numbers. But **nothing wrote those dimensions back into `cW`/`cH`/`cF`**, and the box
was hidden for standard modes. So the inputs kept the previous resolution: the panel disagreed with
what was stored, and switching back to Custom started from the wrong numbers.

WO-437 arguably happened *because* of this — the UI was showing values that were never going to be
saved.

## 2. What was done

New `syncModeFields()` mirrors the selected mode into the inputs and owns their visibility:

- standard mode → fill `cW`/`cH`/`cF` from `MappingNode.videoModeToResolution(mode)`;
- the fields stay **visible but disabled** — a filled field the operator cannot see is not "filled",
  and standard-mode dimensions are derived so they must not be editable;
- custom → re-enabled, values untouched.

Called on `onchange` **and once at mount**, so the panel is consistent the moment it opens rather
than only after the first interaction.

`saveCustom()` is untouched: WO-437's derive-from-mode behaviour is preserved and pinned by a test.

**Judgement call, flagged for owner QA:** "fill width and height" was read as *the operator should
see them*, so the box is now always on screen (disabled for standard modes) instead of hidden. If
you want it hidden again for standard modes, that is a one-line change.

## 3. What was VERIFIED

`tools/smoke/smoke-wo505-mapping-mode-fills-dimensions.test.js` — 4 tests, comment-stripped so the
prose describing the old behaviour cannot satisfy an assertion:

- the helper exists and writes width, height and fps from `videoModeToResolution`;
- it runs on change **and** at first render;
- fields stay visible and become read-only for a standard mode, and the old
  `display = isCustomMode ? 'grid' : 'none'` branch is gone;
- **WO-437 regression guard**: a standard mode still saves `std.w`/`std.h`, never the input values.

Full gate **2069 tests, 2067 pass / 0 fail / 2 skip**; eslint 0; prettier clean; client rebuilt
(`npm run build:client`).

**NOT verified:** on-glass. Owner QA — open a mapping node output, pick a standard mode, confirm W/H
populate and that Apply still generates the right raster.

## 4. Owner action

Kiosk reload (`DISPLAY=:0 xdotool key F5`) to pick up the rebuilt `dist-web/`.

## 5. Work log

- 2026-08-13 — Opened, root-caused to the missing display sync, fixed, 4 smokes incl. a WO-437 guard.
