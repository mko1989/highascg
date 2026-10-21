**Status: DONE (2026-10-21) — Godot --test 20626/0 (new case fails on the old line); server coercion reproduced with node. Owner QA: pick Custom on a 1080p50 screen in the box client, type a size.**

# WO-639 — Picking "Custom" for a screen destination's video mode jumps straight back

Owner, 21.10: *"it doesnt let me change a screen destination's resolution to custom, jumps back right to what it
was"*

## Investigation

- The Godot destination page (`godot/client/features/devices/destination_inspector.gd` `_screen_page`) unlocks the
  Width / Height / Frame rate fields only while the select says Custom (`le.editable = custom`). Picking Custom sends
  `DM.video_mode_patch("custom")` = `{videoMode: "custom", width, height, fps, inheritsProjectFps: false}` with the
  destination's **current** size (`destinations_model.gd:145`).
- The server files an explicit `custom` whose size is a shipped mode under that mode: `src/config/screen-destinations.js`
  `stdFromDims` (WO-486, commit 4c04902d; WO-484 does the same at config generation). Reproduced:
  `normalizeDestination({mode:'pgm_prv', videoMode:'custom', width:1920, height:1080, fps:50})` → `1080p5000 1920 1080 50`.
- The tab reloads after every patch, and `show_destination` rebuilds the page from the stored record. The select
  goes back to 1080p5000 and the size fields lock again. A custom size can't be typed: the fields only open on
  Custom, and Custom never sticks. The web form (`client/components/device-view-destinations-inspector-form.js:267`)
  sends the same patch.

## What was done

- `destination_inspector.gd`: `_custom_for` holds the destination whose select the operator set to Custom (by
  picking it or by typing a size). A rebuild for that destination keeps Custom selected and the size fields open.
  Picking a real mode, or showing another destination, ends it. The patch itself is unchanged: web parity per the
  golden, and it still clears `inheritsProjectFps`.
- The server's coercion stays. WO-486 is owner-requested ("it should just be 1080p50"), and custom-at-a-shipped-size
  really is that mode for Caspar (WO-484: a synthesised duplicate runs as `video_format::custom` and breaks DeckLink
  mode matching). A size the operator types that is not a shipped mode (e.g. 2560x1080) is stored as custom, as before.
- The web form is not changed (being retired under WO-609).

## What was VERIFIED

- `godot/client/tests/test_devices_destination_form.gd` `test_custom_survives_the_reload`: pick Custom on the
  1080p5000 golden case, rebuild from the unchanged record → Custom stays selected and width is editable; picking
  1080p2500 ends it; switching to another destination ends it. With the sticky line reverted, it fails 2 assertions
  (`expected custom got 1080p5000`, `size open expected true got false`).
- Godot `--test` 20626 passed, 0 failed.
- **Owner QA:** in the box client, Devices → a screen on 1080p50 → Video mode Custom → type 2560 × 1080 → it stays
  custom after the reload.
