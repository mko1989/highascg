# WO-710 — Auto tracking overlay in the Live tab and the Previs main tab

**Status: DONE (23.10.26) client side. Verified: Godot model tests, boot check, windowed render probe with fake data, source-text smoke. NOT verified: against the live server (WO-708/709 endpoints not deployed yet), clicking in the real tabs, owner QA.**

Contract: the WO-708..711 shared contract (scratchpad `wo708-contract.md`; API + WS section). Server side is WO-708/709, PTZ is WO-711.

Owner, 23.10.26:
> in live and previs main tab there should be a tracking overlay, smallish where i can do quick adjustments to each detected person. meaning if they should be pined as 1...9 with the pin comes quick sets, follow with at least 1 fixture, ability to quickly adjust how many should follow. the same for, if there are any cameras that are meant to be tracked by this

> after a while with no person detected the fronts should reset to a home position

## Investigation

- Live tab root: `godot/client/features/live/live_tab.gd` (VSplitContainer). The operator picture lives in `stack` (a clipping `Control`): video, tiles, `stage3d` (3D view), then `_view_switch()` top-left (live_tab.gd:72). The Inspector is a separate column to the right of the whole tab (shell), so the top-right corner of `stack` never covers it.
- Previs main tab root: `godot/client/features/previs/previs_tab.gd` (HSplitContainer). Its `stack` (previs_tab.gd:~74) holds the 3D SubViewportContainer, the coverage note (bottom) and `track_view`. Same reasoning: top-right of `stack`.
- previs_tab.gd was exactly 500 lines (CI limit), so the host change is one added line paid for by reflowing two header-comment lines into one.
- WS plumbing: `Ws` autoload (`core/ws.gd`) has `signal message(type, data)`; marker_driver.gd:299-306 listens in `_on_ws` for `tracking:follow` / `tracking:markers`. The overlay does the same for `tracking:auto`, and re-fetches on `Ws.connected`.
- HTTP: `Api.get_json` / `Api.post_json` (`core/api.gd:26-31`) return `{ok, status, data, error, reason}`; used as-is.
- Godot JSON gives floats for every number (api.gd note): ids are compared through `id_key()` (3.0 == 3), counts cast with `int()`.
- A file named `features/previs/tracking/tracking_overlay.gd` already exists (camera-picture overlay, WO-616 T3b). To avoid a clash the new files are `auto_overlay.gd` / `auto_overlay_model.gd`.
- Arrow-key trap (memory: godot-arrows-focus-nav...): every overlay button is created by one helper with `focus_mode = FOCUS_NONE`, so they never take focus and never steal arrows from the views.

## Done

- `godot/client/features/previs/tracking/auto_overlay_model.gd` (pure): `rows()`, `label()` (presenter name, else "Person w3" / "Person c1.7"), `short_key`, `ptz_cams` (enabled only), `signature` (person keys + PTZ chips), `count_text` (0 = "share"), `step_count`, `pin_target` (same pin again = 0), `toggle_ptz`, `home_text` ("home", "home · manual", "home in Ns"), `step_after` (3..600, step 5), `has_content`.
- `godot/client/features/previs/tracking/auto_overlay.gd`: a `PanelContainer`, top-right of its parent, 78 % opaque dark panel, 11 px font, collapsible to a chip ("▾ Track N" / "▸ Track N · home", collapse state shared by both instances). Hidden unless the data has persons or a pool.
  - Row per person: name, `→N` (heads following now), pins 1..9 (toggle buttons; active pin again unpins). Pinned persons get a second line: `− count +` and one chip per PTZ camera.
  - Footer: home state text, "Home now", "after − 10s +".
  - POSTs: `/api/tracking/auto/pin {key, slot}`, `/api/tracking/auto/slot {slot, heads}` / `{slot, ptz}`, `/api/tracking/auto/home {now:true}` / `{after_s}`. Errors show in a small red status label in the chip row for 5 s.
  - Rows are rebuilt only when the signature changes (person set / PTZ chips); everything else updates in place, so 5 Hz broadcasts do not flicker. Head count and PTZ toggles update optimistically so a fast second click steps from the new value; the next broadcast confirms.
  - First data from `GET /api/tracking/auto` at start and on reconnect (a 404 before deploy is silently ignored), then `tracking:auto` pushes.
- Hosts: `live_tab.gd` (const + `stack.add_child(AutoOverlay.new())` after the view switch), `previs_tab.gd` (one preload line after `_coverage_note`, shows in both 3D and Camera mode).
- Contract points that fit differently: the stepper's "−" from 1 returns to "share" (0), the only way back to the default, rather than stopping at 1; "+" is capped at the pool size. Slots 1..9 but only the first person per slot is meaningful. A pinned person who left (slot key kept for `lost_s`) is not listed (`persons` only).

## Verified

- `godot/client/tests/test_auto_overlay_model.gd`: 8 tests (rows, label, has_content/ptz, count stepper bounds, pin/ptz toggle, home text + after stepper, signature stability). Whole Godot suite headless: 21266 passed, 0 failed.
- `run-client.sh --check`: boot OK, no script errors (with both hosts instancing the overlay).
- Windowed render probe (temporary scene, fake data through `adopt()`, removed afterwards): screenshots `/tmp/claude-1000/-home-casparcg/daed53bd-d6cf-409c-8b5b-90a4cc140fc5/scratchpad/ao_expanded.png`, `ao_empty.png`, `ao_chip.png`.
- `tools/smoke/smoke-wo710-tracking-overlay.test.js`: 4 tests pass (both hosts instance it, endpoints match the contract, focus_mode none, line limits). Needs registering in tools/ci/run-offline-tests.js by the lead.

## Owner QA / not verified

- Against the real server once WO-708/709 are deployed: pins, head counts, PTZ chips, Home now, after_s.
- Look and placement in the real Live (2D and 3D) and Previs tabs (the render probe used a plain background); overlap with the Live toolbar at narrow widths.
