# WO-883 — Shaders only in Visuals; the Visuals canvas as a Live source; a "Screen size" canvas

**Area:** godot-client, engine
**Status: DONE (31.10, Godot 24087/0; box: ring 3840×1792 listed by /api/shm/sources and in the open Sources ▸ Live list,
played on ch 3 and PRINTed 1:1; Templates tab screenshot without shaders)**

Owner, 31.10 (after WO-881 noted the Caspar-side shaders are black with `cefEnableGpu` off): *"I want the shaders to be only
in visuals. And leave templates to lower thirds etc. When visuals shm is started it should appear in live tab of the
sources so it can be used in looks as a layer. Is there already a canvas size setting for the visuals? So they render on a
canvas that is equal to for instance the dioda screen dest."*

## 1. Investigation

- **Two shader paths.** The Caspar one: shader templates (`template/shaders/player.js`, WebGL2 in CEF) reached from the
  Sources Templates tab's Shaders group (`source_lists_model.gd` GROUPS, WO-661), the + menu's *Shader FX…*
  (`media_add_menu.gd`, WO-606), a shader row's right-click *Edit shader…* and click-to-audition (`media_panel.gd`), and the
  logo click → Shader Live (`app/shell.gd`). The Visuals one: the same 190 library shaders compiled on the Godot
  RenderingDevice (WO-874) and sent to Caspar over shm (WO-742/743/863) — no CEF.
- **The ring existed only while Send was on.** `visuals_tab.gd` `send()` started `viewport_publisher` and stopped it on
  Send off, so `shm://visuals` was never a source on its own. WO-744 already lists any live non-Caspar ring in
  `GET /api/shm/sources` and the Live list (`shm_sources_model.gd`), and a look layer with `shm://<name>` plays as
  `PLAY … SHM NAME` (e2e-proven there). The Caspar producer re-opens a ring that starts after PLAY or restarts, about
  twice a second (`caspar-build/src-v2/src/modules/shm/producer/shm_producer.cpp:5-6,47,82-90`).
- **The Live list re-reads rings only when its tab is shown or on ↻** (`live_sources_panel.gd` `reload()`); the Sources
  sidebar is always visible, so a ring started from Visuals would not show until ↻.
- **Canvas size.** Output ▸ Render offered 720 / 1080 / 540 p at the screen's aspect (`visuals_model.gd` RENDER_SIZES,
  `render_size()`); for the Dioda wall (3840×1792) the largest was 2314×1080 and Caspar scaled it up. No 1:1 option.
- **Old projects keep shader layers in looks** (wesele 37, dtlodz 23, llkk 17 refs …; mhp_harder none). Those layers still
  play through CEF (black while `cefEnableGpu` is off) — the look editor shows them, they are only no longer offered.
- **Stale rings.** `/dev/shm/highascg-visuals` (07:07) and `-visuals-game` (06:49) were left by this morning's tests with no
  process mapping them; removed.

## 2. What was done

- **Shaders only in Visuals** (entry points only; the Shader Live / Shader FX modules stay for old looks, unreferenced):
  - `features/live/media_panel.gd`: the Templates provider drops `kind == "shader"` rows; no `/api/shaders` fetch, no ⚠
    group warning, no audition / *Edit shader…* wiring.
  - `features/live/media_add_menu.gd`: *Shader FX…* removed.
  - `app/shell.gd`: the logo click opens the Visuals tab (was Shader Live).
- **The canvas as a Live source** (`features/visuals/`):
  - `visuals_model.gd`: `output.ring` (bool, project slice); `play_body(…, ring)` takes a ring name.
  - `visuals_page.gd`: Output ▸ *Live source (shm://visuals)* switch (`ring_toggled`); `set_sending` shows its state.
  - `visuals_tab.gd`: `_sync_ring()` — the ring runs while `output.ring` is on **or** Send is on; Send off keeps a Live-source
    ring; a project load starts / stops it from its slice. `can_publish()` split from `can_send()`. The canvas keeps
    rendering while the ring runs, also with the tab hidden. `--visuals-ring=<name>` (dev) so a probe client never writes
    the operator's ring.
  - `features/live/live_sources_panel.gd`: polls `/api/shm/sources` every 3 s while shown (a missed poll keeps the rows);
    the existing key check skips the rebuild when nothing changed.
- **Screen size** (`visuals_model.gd` `SIZE_SCREEN = 3`, `visuals_page.gd`): Render ▸ *Screen size* (listed first) = the
  screen destination's own resolution, even-rounded, at most 8192 wide; 1080 p until the screen is known. Stored as size 3
  so the old 0–2 presets keep their meaning.
- Dev probe `--probe-visuals-ring=<s>[:scene[:size[:shader]]]` (`visuals_probes.gd`): ring on, fps / skipped readbacks
  every 5 s, a canvas shot, ring off.
- `media_panel.gd`: the `--sources-tab` comment had stale indices (Live is 3; 2 is the hidden Placeholders).
- Tests: `test_visuals_model.gd` (Screen size sizes, even-rounding, the 8192 cap, `ring` only for a real bool — a string
  made Godot's `==` throw inside `slice_of`, caught by this test; the page round-trip; no box → the ring says why);
  `test_source_lists.gd` (Templates filters shaders, no Shader FX…, logo → Visuals).

## 3. What was verified

- Godot suite 24087 / 0; `run-client.sh --check` boot OK after every edit.
- Box, a probe client on a private Xvfb (`--visuals-ring=probe883`, Render = Screen size, screen Dioda):
  - `GET /api/shm/sources` → `{"name":"probe883","width":3840,"height":1792,"fps":50,"writer":"godot","signal":true}`;
  - `PLAY 3-990 shm://probe883` → INFO `3840 × 1792, signal true`; `PRINT 3` is 3840×1792 and shows the Rings canvas
    1:1 (the Godot canvas shot and Caspar's frame match; sh-sa-ribbons was near-black in both: audio-reactive, no audio);
  - ring off → the segment is unlinked; layer 3-990 cleared afterwards.
- The Sources ▸ Live list, open before the ring started (`--sources-tab=3`), showed **visuals · 3840×1792 · 50 fps ·
  godot** without a ↻ (screenshot).
- Templates tab (screenshot): Templates 20, Lower thirds 11, no Shaders group.
- **Cost at Screen size (uncapped probe, small window; Xvfb's full-size window present caps at ~30–38 fps by itself):**
  Rings 3840×1792 + ring 77 fps; sh-sa-ribbons 3840×1792 + ring 62 fps; the same shader at 2314×1080 133 fps; 0 skipped
  readbacks throughout. The 27.5 MB/frame readback + copy dominates. 50 fps fits, with little headroom for heavy shaders
  in the operator GUI — Render ▸ 1080 p (Caspar scales) is the fallback.
- **Not proven:** the operator GUI itself at Screen size on the real display (relaunched with this code, not probed).
  A drag of the Live row onto a look in the GUI (WO-744's e2e proved the look TAKE path for `shm://`).
