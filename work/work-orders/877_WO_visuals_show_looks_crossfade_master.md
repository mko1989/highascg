# WO-877 — Visuals show controls: looks (cues) with a crossfade, master fader + blackout, show keys

**Area:** godot-client
**Status: DONE (31.10: Godot suite + Xvfb canvas probe; on air on Caspar ch 6 via PRINT — Send, master half, blackout, back, crossfade, Send off)**

Loop task (owner 31.10): *"work on the visuals (shaders, audio reactivity, games etc) until you feel it's in a very good shape
and ready for a show."*

## 1. Investigation — what a show needs that the Visuals lacked

- **Every change was a hard cut.** `visuals_stage.gd` `set_layers()` freed the scenes and built the new ones in the same world
  (WO-873); a shader pick recompiled in place (WO-874). On a screen that is a one-frame jump to a different picture — fine
  in rehearsal, a glitch on a show.
- **No cues.** A "look" (scene + layer 2 + shader + game + base parameters + the Flow graph's reaction) had to be rebuilt by
  hand through four pickers and eight sliders between songs.
- **No master or blackout.** The only way to take the visuals off a screen was Send off — Caspar then *holds the last frame*
  (WO-742), the opposite of black.
- **No keys.** Burst was a button only.
- **Stale game ring (found by this WO's suite run).** `test_game_launcher.gd` "no ring → not live" failed on the box: the
  Xvfb test of WO-876 had left `/dev/shm/highascg-visuals-game` behind (its window was killed, it cannot unlink). The Game
  scene showed that ring's last frame as live until the reader's 500 ms signal-loss timer — so every start of the Game scene
  after a closed window would flash the old picture.
- **Unchanged shader recompiled on every project reload.** `_load()` (every `project_changed`) ended in `set_shader(cfg)`,
  and `shadertoy_rd.gd` `use()` compiles SPIR-V and the scene resets its time — the shader jumped back to t = 0 on any
  autosave round trip.
- `viewport_publisher.gd`: a resize re-opened the ring at the default 50 fps instead of the rate Send asked for.

## 2. What was done

- `visuals_mixer.gd` (new): two decks (SubViewport + own World3D + Stage each), one live. `go(main, overlay, shader, s, force)`:
  same scenes on air → only the shader; else the idle deck takes the new scenes and fades in over `s` (0 = cut); when a fade
  ends the old deck is emptied (`Stage.clear()`) and stops rendering. The canvas (`out_vp`, what Send publishes) is a 2D
  pass: `mix(deck A, deck B, x) × master`. Master = the fader, or black in a blackout, moving at 1 / 0.4 s. Audio frames
  go to both decks (a spectrum fading out still moves). Chosen over in-world fades because scenes share nothing (particles,
  a shader quad, a game screen): only the rendered pictures can be mixed generally; the second 3D render costs only during
  a fade.
- `visuals_looks.gd` (new, pure): a look = `scene, overlay, shader, game, params, graph` + name — never output, sync or
  sensitivity. `capture`, `apply`, `normalize` (through the model's own slice rules, ≤ 12, names ≤ 40), `showing`, `auto_name`
  ("Tunnel + Particles · ribbons"), `key_index` (1–9, keypad too). Stored in `project.visuals.looks` (client-owned slice).
- `visuals_show.gd` (new): the page's Show block on top — look buttons (click recalls; right-click: save the current picture
  over it, rename, delete; buttons never take focus so Space / digits stay show keys), Save look, Fade (0–10 s, stored as
  `project.visuals.fade`, default 1 s), Master fader + Blackout (runtime only — a blackout never survives a restart).
- `visuals_tab.gd`: the mixer replaces the single viewport (`scene` is now the live deck's stage; the 3D orbit view follows the
  live deck's world). Scene and shader picks fade too; a look's shader config is fetched (and cached) **before** its fade
  starts, so it never fades in dark. Show keys while the tab is shown: **1–9** looks, **Space** burst, **B** blackout. The
  dev probes moved to `visuals_probes.gd` (line limit); shots add a mid-fade and a half-master frame.
- `visuals_stage.gd`: `want()` (shared with the mixer), `clear()`, `start_scene` ("" for the idle deck); `set_shader()` with the
  same config is a no-op (no recompile, no time jump).
- `scenes/game.gd`: live only after two fresh frames since the signal came; `game_launcher.gd` `stop()` unlinks the ring.
- `viewport_publisher.gd`: re-open after a resize at the same fps.

## 3. What was VERIFIED

- Godot suite 24043 / 0, incl. `test_visuals_show.gd` (30 checks: capture/apply round trip and copy semantics, normalize, keys,
  mixer fade halfway/done/old deck emptied and asleep, no fade for the same scenes, 0 s cut, force, sleep, blackout half after
  0.2 s and black after 0.4 s, back to the fader level, the same shader keeps its time) and the updated tab test.
- The stale-ring fix against the real leftover ring: Game scene stepped 120 frames over 2 s → 0 live frames (was live at once).
- Xvfb, the real client (`--probe-visuals-shots`, scratchpad `w877/`): every scene as before (deck GPU 0.09–0.25 ms), then a
  2 s fade game+spectrum → tunnel+particles caught at x = 0.50 (both pictures on the canvas), and the master at 0.50 (the
  picture at half brightness, fade done).
- On air, 31.10 07:0x: the real client on Xvfb :377 with `--probe-visuals-channel=6 --probe-visuals-onair=<dir>`
  (`visuals_probes.gd` `onair`; ch 6 is a 1080p50 channel with no consumer, so nothing reached a wall). Each step
  PRINTs Caspar's ch 6 through the node (`e2e_probe.gd` `print_once`) and reads the canvas at the same moment:
  Send (tunnel+particles) air luma 48 / canvas 55 · master 0.5 → 20 / 22 · blackout → 0 · back → 34 / 32 · a 1 s
  crossfade to rings → 6 / 6 · Send off → layer empty (alpha 0). Air follows the canvas within a frame or two.
- Keys on the operator GUI (1–9, B, Space) are covered by the suite only: no key automation on the owner's :0.
