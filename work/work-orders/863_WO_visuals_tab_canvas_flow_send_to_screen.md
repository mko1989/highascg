# WO-863 — Visuals tab: audio-reactive canvas, 3D / Flow views, send to a screen destination; tab order

**Area:** godot-client, engine, audio
**Status: DONE (2026-10-30, Godot 23515/0, box: screenshots + Send probe on ch 3 — INFO shows the shm producer, STOP cleans up)**

Owner, 30.10: "as for the gui side of visuals there should be a new tab in the main ui with visuals. also we need a reorder of the
tabs should be from the left, Live Timeline, Visuals, Previs, Audio, Devices, (multiview should only appear when its created)
Settings. in the visuals tab there should a canvas in the middle at the top send to screen dest. in the inspector options. ability
to change the view from a 3d viewport (i assume) to a flow workflow."

Builds on [WO-858](./858_WO_godot_audio_reactive_visuals_report.md) (Godot as the live-visuals engine; research, nothing built) and
[WO-861](./861_WO_realtime_audio_parts_buses.md) (the audio "parts" buses, DONE).

## 1. Investigation

- **Tabs.** `godot/client/app/shell.gd:75-106` adds Live, Previs, Timeline, Audio, Devices, Multiview, Settings in that order;
  `--tab=N` picks by index (`shell.gd:107`), `sources.tab_requested` and the header buttons pick by node / control, so only
  `--tab` indices move with a reorder. Multiview is always shown; `multiview_tab.gd:118` `enabled()` already knows whether a
  multiview exists (`channelMap.multiviewEnabled` and a multiview channel, `D.mv_channels`).
- **Transport to Caspar exists.** `features/shm_out/viewport_publisher.gd` (WO-743) publishes a SubViewport into
  `/dev/shm/highascg-<ring>` through `HshmSink` (`addons/hshm`, the box's debug build is present in `addons/hshm/bin/`);
  `POST /api/play {channel, layer, clip: "shm://<ring>"}` serialises to `PLAY ch-layer SHM NAME <ring>`
  (`src/caspar/amcp-command-plan.js:33-34`, WO-742 producer, live rings `highascg-opgui` / `highascg-pgm1` on the box), and
  `GET /api/shm/sources` lists a ring whose writer is alive (`src/api/routes-shm-sources.js`). No server route is needed to send.
- **Audio.** Every `audio_fft` WS frame carries `parts` (WO-861: kick / snare / hats `{level, onset, n}`, bass, mid, high, tonal,
  loudness, onset, density, arousal, valence, energy, section, drop `{n, age}`) and `beat` (WO-662) — broadcast to every WS
  client (`src/server/ws-server.js` `broadcast`), so the Godot client can drive visuals with `Ws.on("audio_fft")`.
- **Persistence.** A Godot-only top-level project key is wiped by the web autosave unless it is in `CLIENT_OWNED_SLICES`
  (`src/engine/project-client-slices.js:14`, WO-614). Writes go through `Store.project` + `ProjectSync.mark_dirty()`.
- **Inspector.** Tabs `present()` a page into `InspectorPanel.current` while shown and `release()` it when hidden
  (`previs_tab.gd:361-370`).
- **Flow editor.** WO-858 §4: FlowKit is an *editor* plugin (sheets edited in the Godot editor, young, mid-refactor) and a poor
  fit for continuous bus → parameter mapping. Godot's own `GraphEdit` / `GraphNode` run in an exported client, so the Flow view
  is a `GraphEdit` over the WO-858 §6.2 binding table: Audio bus → Shape (gain, attack, release) → Parameter.

## 2. Design

- Tab order: Live, Timeline, Visuals, Previs, Audio, Devices, Multiview (hidden until a multiview exists), Settings.
- Visuals tab: the canvas (the scene's output SubViewport, aspect of the chosen screen) centred at the top; under it the work
  area with a **3D | Flow** switch — 3D = an orbit-camera view into the same `World3D`, Flow = the `GraphEdit` binding graph.
- Inspector page "Visuals": scene parameters (base values, the audio adds on top), Output — screen destination, layer, render
  size, **Send** (opens ring `visuals`, plays it on the screen's PGM channel at the layer; off = STOP, then ring closed). Send only
  on the box (`DevicesTarget.on_box()`, `HshmSink` loaded).
- One built-in scene (rings of instanced bars: pulse, spin, hue, glow, flash). More scenes are WO-858 P1.
- Project slice `project.visuals = {graph, params, output}`; the Send state is not stored (never on air by itself after a load).

## 3. What was done

- `godot/client/features/visuals/` (new):
  - `visuals_model.gd` (pure): `buses_of(frame)` turns the WO-861 parts and the WO-662 beat into 21 flat 0..1 buses (drum
    and drop pulses, levels, section flags). It also holds:
    - `default_graph` / `normalize_graph` (known node types, unique ids, links only bus/shape → shape/param);
    - `evaluate` (base + Σ bound audio, hue wraps, Shape = envelope follower with attack/release, loops cut at depth 16,
      `trace` for the meters);
    - `slice_of(project)`, `screens(cm)`, `render_size`, and the `/api/play` / `/api/stop` bodies.
  - `visuals_scene.gd`: three counter-rotating rings of emissive bars in a MultiMesh, with glow. Parameters: pulse, spin,
    hue, glow, flash.
  - `visuals_flow.gd`: a `GraphEdit` of GraphNodes. Right-click adds a node, Delete removes it, drag links, and each
    node shows a live meter.
  - `visuals_page.gd`: the Inspector page, with base sliders, Screen, Layer, Render (720 / 1080 / 540 p at the screen's
    aspect), Send and a status line.
  - `visuals_tab.gd`: the canvas (a TextureRect of the output SubViewport) at the top, and the 3D | Flow work area.
    - 3D view: a second SubViewport on the same `World3D` with an orbit camera; drag orbits, wheel zooms.
    - Send: starts `viewport_publisher` on ring `visuals`, then `POST /api/play {clip: "shm://visuals"}` on the screen's
      PGM channel. Off: `/api/stop`, then the ring closes.
    - The canvas sleeps when the tab is hidden and not sending.
    - Autoloads are looked up by name, so the tab builds under the headless test runner.
    - Dev flag `--probe-visuals-send=<screen>:<s>` drives Send without a pointer.
- `app/shell.gd`:
  - tab order is Live, Timeline, Visuals, Previs, Audio, Devices, Multiview, Settings;
  - Multiview is `set_tab_hidden` until `multiview_tab.enabled()`;
  - `--tab` also takes a name (`--tab=Previs`), so launchers survive reorders. `run-xr.sh`, its test pin and two
    fixture-probe comments moved from `--tab=1` to `--tab=Previs`.
- `addons/hshm_sink/` (the writer from WO-743) is now installed in the client: the `.gdextension` is tracked, `bin/` is
  not. `run-client.sh` and `godot/extensions/hshm/build.sh` register it in `.godot/extension_list.cfg`. build.sh copies
  the `.so` beside the old one and renames it, because a `cp` over a mapped `.so` crashes the running client (WO-743).
- `src/engine/project-client-slices.js`: `visuals` is in `CLIENT_OWNED_SLICES`, so a web autosave keeps it.
- `tests/test_visuals_model.gd` (6 tests). `tests/test_shm_out.gd` now also covers the loaded sink: a ring opens in
  `/dev/shm` and closing unlinks it. Before this it returned with no assertion when the sink was present.

Not chosen: FlowKit (WO-858 §4; its sheets are edited in the Godot editor, not in an exported client), and a separate VJ
process (WO-858 §9). The owner asked for the canvas inside the main UI, so it renders in the operator client. A crash of
the client stops the ring; Caspar's layer then holds the last frame (WO-742).

## 4. What was VERIFIED

- Godot suite 23515 passed, 0 failed (+6 visuals, + the shm_out loaded-sink path).
- Box, owner client relaunched with `--tab=Visuals`:
  - the screenshot shows the tabs Live · Timeline · Visuals · Previs · Audio · Devices · Settings, with no Multiview
    (`multiviewCh` null on this box);
  - the canvas renders the scene at the Dioda aspect;
  - the Flow graph's meters move with the live USB music;
  - the Inspector page shows "Dioda PGM (ch 1)";
  - Send is enabled once the sink is loaded.
- Send, end to end, with a second client on a private Xvfb (`--probe-visuals-send=1:20`, no pointer on the owner's
  screen):
  - `/dev/shm/highascg-visuals` existed and `GET /api/shm/sources` listed it (1280x720, 50 fps, writer godot,
    signal true);
  - `INFO 3`, layer 1: `<producer>shm</producer>`, name visuals, frames 199, lapped 0, signal true;
  - after stop, layer 1 was empty and the ring was gone.
- Not seen on a screen: the 3D view (it is built and exercised headless, but nobody clicked "3D"), and the picture
  on the Proj output.
- Follow-ups (WO-858 P1): more scenes, scene picker, presets, a look/timeline layer carrying `{scene, params,
  bindings}`.
