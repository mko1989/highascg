# WO-908 — Visuals A/B banks: one on air, the other in PRV to prepare, a crossfader to mix or take

**Area:** godot-client, engine
**Status: DONE (31.10.26 — Godot suite 25320/0 incl. test_visuals_dj.gd; box: A/B on/edit/AUTO/CUT/mix/off on the owner GUI, Caspar ch2 shm 50/s throughout)**

## Owner request (31.10.26)
"id like to add a dj style dual screen to the visuals. bank a/b. one is on screen while the other is in prv for
preparation (or mixed together when wanted)" (with the APC40 profile, WO-909).

## 1. Investigation (before any change)
- The Visuals already have two decks (`visuals_mixer.gd`, WO-877/890): `decks[2]`, `live`, `x` = deck 1's weight, the MIX
  shader `mix(a, b, x) * master`. But the idle deck is a transition buffer only: `_apply()` clears it as soon as a fade
  ends (`if i != live and not fading(): decks[i].clear()`), and only `go(force)` (a look, the autopilot) loads it — so
  nothing can be prepared off air, and `x` only ever moves towards `live`.
- Every editor writes the tab's one `slice` (`visuals_tab.gd`): the layer list (`page.layers_changed` → `_go(false)` in
  place on `mixer.deck()`), the parameters (`scene.params = M.evaluate(slice.graph, …)` every frame, `scene` = the
  live deck), Flow (`slice.graph`), Shader mode, camera drive (`cam_ctl` → `mixer.deck().cam`) and MIDI (through the
  page's controls). A second bank therefore needs a second picture *and* a way to point all these at it.
- A look (`visuals_looks.gd`) is exactly a picture: `KEYS = layers, params, graph, camera`; `capture` / `apply` swap it
  into a slice and keep output, sync, looks, auto, playlists.
- Look recalls: `visuals_show_ctl.gd recall()` (buttons, keys 1–9, MIDI pads, autopilot) and
  `visuals_playlist_ctl.gd _show()` (a running playlist, a double-click) both end in `tab._go(true)`.
- `visuals_tab.gd` is 468 lines (500 limit) → the feature has to live in its own file with one-line hooks.

## 2. What was done
- **`visuals_mixer.gd` `dj` mode:** both decks render and are never cleared; `x` is a free crossfader (`set_x`),
  `take(cut)` moves it to the other side over `fade_s` (`goal`) or jumps; `air()` = the crossfader's side, `weight(i)`;
  `live` = the bank being edited. In DJ mode every `go()` is in place into the edited deck — faded when it has a share
  of the canvas, cut when it is PRV (nobody sees it). `set_dj(false)` keeps the bank on air as `live`; the other fades
  out and is emptied by the existing non-DJ path. DJ off = byte-for-byte the old behaviour (existing mixer tests pass).
- **`visuals_dj.gd` (new):** the tab's slice keeps holding the *edited* bank, `slice.dj = {on, edit, x, other}` the other
  bank's picture. `focus(i)` swaps the two pictures (Looks.capture/apply) and the Flow states (`_env` ↔ `_env_other`) —
  the decks already run both, so nothing restarts and every editor (layer list, params, Flow, Shader, MIDI, camera)
  works unchanged. `step()` evaluates the other bank's own Flow graph into its deck every frame (audio reacts on both).
  When a take lands (the crossfader comes to rest on the other side) editing moves to the new PRV bank. A/B on: the
  picture on air stays on its deck, the PRV deck starts as a copy of it. A/B off: the bank on air becomes the picture.
  UI: a PRV view left of the canvas (the bank off air; tags "PRV B ✎" / "PGM A" or "PGM A 47 % + B 53 %", ✎ = edited),
  and a bar under both: A/B toggle · Edit A / Edit B · A ── crossfader ── B · AUTO · CUT. A drop on a view goes into the
  bank it shows. `from_slice()` re-reads the banks on a load / remote sync / undo without jumping the crossfader.
- **Looks in A/B:** a recall by hand (button, key, MIDI pad, playlist double-click) loads into PRV only (`dj.to_prv()`);
  the autopilot (`recall(next, true)`) and a running playlist (`_show(e, true)`) load PRV and AUTO-take it.
- **Burst** (button, Space) fires on the deck on the canvas (`mixer.deck_of(mixer.air())`), not the edited one.
- **MIDI:** new targets `xfade` (range, picked up like every fader), `take`, `cut` (buttons) — present only while A/B is
  on; the APC40 map binds its crossfader (CC 15) to `xfade`.
- `visuals_model.gd slice_of` keeps `dj` raw (like looks / playlists); `visuals_dj.gd` normalizes it.

## 3. Verified
- Godot suite: 25320 passed, 0 failed. New `tests/test_visuals_dj.gd` (mixer DJ mode: PRV cut, both decks kept, AUTO over
  fade_s, no reverse on a second AUTO, mix weights, CUT, off keeps air + empties the other; tab: on = copy in PRV, pick →
  PRV only, bank swap keeps both decks and the PRV edit, a landed take moves editing, x saved, MIDI crossfader mixes;
  autopilot takes; reload keeps A/B; off keeps the bank on air). `test_midi_pickup` asserts CC 15 → xfade; APC map
  size 46. Smoke `smoke-wo908-visuals-ab-banks.test.js` (4).
- Box, owner GUI (DP-4, pointer driven, Visuals on air on ch2 layer 1): A/B on → PRV B ✎ / PGM A; Particles unmuted at
  99 % in B showed in PRV only (PGM black); AUTO → PGM B with the particles, editing moved to PRV A; crossfader at 53 %
  → "PGM A 47 % + B 53 %" with both mixed; CUT back to A, A/B off → the owner's original picture on air and in the
  stored project (`dj` gone, both layers 0 %). Caspar OSC during A/B with both decks rendering: presented 50/s, shm
  50/s; the screen's dropped counter went 33 → 36 across two GUI relaunches (the ring pauses while Godot restarts).
- Owner QA: a real set with the APC40 crossfader; whether the PRV view's size next to the canvas is right on DP-4.
