# godot/client/features/settings — sweep 29.10.2026 (batch 036)

Files: 23 · lines: 2787 · findings: 0 BUG-HIGH, 5 BUG, 0 DEAD, 0 RISK, 5 QUALITY

## godot/client/features/settings/about_model.gd
- `OK`
## godot/client/features/settings/alsa_mixer_model.gd
- `OK`
## godot/client/features/settings/alsa_mixer_panel.gd
- `BUG` godot/client/features/settings/alsa_mixer_panel.gd:21,56-58 — the panel cannot recover when ALSA card 0 does not exist. `_card` starts at 0 and the first request is `?card=0`. The server answers `card not found` when the card list is non-empty and lacks that card (src/audio/alsa-mixer-controls.js, `cards.length && !cards.some(c => c.card === card)`), as an error body with no card list. Failing case: a box whose sound cards are numbered 1 and 2 (USB interface that was card 0 unplugged) → "Could not load ALSA mixer (card not found)…", `_cards` is never filled so no card can be picked, and Refresh re-asks card 0. The `suggested` fallback at :67 only runs after a successful load. Fix: on `card not found`, retry once without `card` or fall back to `/api/audio/devices` / the cards list.
- `BUG` godot/client/features/settings/alsa_mixer_panel.gd:146-152 — the fader's 100 ms throttle drops the final value for changes that are not a mouse drag. `drag_ended` posts the last value only for dragging; mouse-wheel ticks and arrow keys (VSlider is focusable and `scrollable`) go through `value_changed` only. Failing case: two wheel ticks 40 ms apart → label shows N+2, the server received N+1 and nothing else follows. Fix: a trailing timer that posts the latest value 100 ms after the last change.
- `BUG` godot/client/features/settings/alsa_mixer_panel.gd:84-85,187-190 — strips are rebuilt from the stale `_payload` captured at load time; a successful `_post` never updates it. Failing case: set Master to 80 %, switch the view Playback → All → Playback (or any `_render()` trigger) → the fader jumps back to the load-time value although the hardware is at 80 %. Fix: write the change into the control dict in `_payload` after a successful POST, or reload.
- `QUALITY` godot/client/features/settings/alsa_mixer_panel.gd:77-78 — `_render()` sets "No %s controls on this card." (:87) and the next line `_status.text = "%d control(s) on card %d."` overwrites it, so that message is only ever visible after a view switch.
## godot/client/features/settings/decklink_pane.gd
- `OK`
## godot/client/features/settings/live_audio_model.gd
- `OK`
## godot/client/features/settings/live_audio_pane.gd
- `BUG` godot/client/features/settings/live_audio_pane.gd:115-119,136 — Save silently resets the saved headphones OpenAL device when it is not in the live device list. `_fill_from_settings()` rebuilds `_pv_device` from `M.preview_devices(_devices)` ("Default sink" + currently listed devices) and `_select()` leaves index 0 when the saved name is absent; `_save()` then writes `_meta(_pv_device)` = "". The slot pickers handle this case by adding "<saved> (saved)" (line 105-106); this one does not. Failing case: `audioPreviewDevice = "USB Headset"`, the headset unplugged (or `/api/audio/devices` fails → `_devices = []`), user changes anything else and presses Save config → `audioPreviewDevice` becomes "". Fix: append the saved name as a "(saved)" entry like the slots do.
## godot/client/features/settings/network_model.gd
- `OK`
## godot/client/features/settings/network_pane.gd
- `QUALITY` godot/client/features/settings/network_pane.gd:109-121 — "Prefix length" is a plain LineEdit holding a number, but it is not opted into the number-field maths (RULES.md "Input fields" 2; core/numeric_field.gd `math_line()`, which the header says plain-LineEdit number fields must use). Typing `48/2` → apply_body rejects it ("Prefix length must be 1–32"). Focus-selects-value (rule 1) is covered by the tree-wide `NumericField.install`.
## godot/client/features/settings/nuclear_pane.gd
- `QUALITY` godot/client/features/settings/nuclear_pane.gd:137-151 — `_heading()` / `_note()` are copies of `pane_kit.gd` `heading()` / `note()` (same colours and font size). The same private copies exist in tailscale_pane.gd:175-189 and updates_pane.gd:139-153. Use `K.heading(self, …)` / `K.note(self, …)`.
## godot/client/features/settings/os_password_model.gd
- `OK`
## godot/client/features/settings/pane_kit.gd
- `OK`
## godot/client/features/settings/settings_form.gd
- `OK`
## godot/client/features/settings/settings_model.gd
- `OK`
## godot/client/features/settings/settings_panes.gd
- `OK`
## godot/client/features/settings/settings_tab.gd
- `OK`
## godot/client/features/settings/system_model.gd
- `OK`
## godot/client/features/settings/system_pane.gd
- `OK`
## godot/client/features/settings/tailscale_model.gd
- `OK`
## godot/client/features/settings/tailscale_pane.gd
- `BUG` godot/client/features/settings/tailscale_pane.gd:106-110,77-79 — the status refresh overwrites the unsaved Advanced checkboxes. `_render()` does `_auto.button_pressed = …`, `_routes.button_pressed = …`, `_assist.button_pressed = …` from the server config on every refresh (only `_host` is guarded by `has_focus()`). After Log in, `_poll_until` is set 120 s ahead and a 3 s timer refreshes until connected. Failing case: click Log in (login pending), tick "Accept subnet routes", wait ≤3 s → the box un-ticks itself; pressing Save preferences then saves the old value. Fix: only fill the checkboxes on first load / after a save, or track a dirty flag.
- `QUALITY` godot/client/features/settings/tailscale_pane.gd:175-189 — `_heading()` / `_note()` duplicate pane_kit.gd (see nuclear_pane.gd).
## godot/client/features/settings/updates_model.gd
- `OK`
## godot/client/features/settings/updates_pane.gd
- `QUALITY` godot/client/features/settings/updates_pane.gd:139-153 — `_heading()` / `_note()` duplicate pane_kit.gd (see nuclear_pane.gd).
## godot/client/features/settings/variables_model.gd
- `OK`
## godot/client/features/settings/variables_pane.gd
- `OK`
