# WO-895 — Visuals playlists: an ordered list of looks and visuals that runs unattended

**Area:** godot-client
**Status: DONE (31.10.26 — Godot --test 24684 passed / 0 failed incl. 242 new asserts, --check boot OK, line limit OK; probe client on Xvfb :93 ran a 3-look playlist A→B→C→A in order with mixed holds, shuffle without repeats, Auto off/on resume; box project untouched. A real node restart was not done — restart survival proven by the slice round-trip test + the resume path)**

## Owner request

Owner, 31.10: *"there also needs to be an option to create playlists of visuals, so operator can set it up and forget."*

## Investigation

File references are as found on 31.10.26; to re-verify at implementation.

Re-verified at implementation (31.10.26, HEAD 2f58ac3a):

- Auto keeps no order of its own: `visuals_autopilot.gd:59` `out = (current + 1) % count` — the next stored look, every
  N bars (`:9` BARS [0, 4, 8, 16, 32]) or on a drop. Its config `cfg_of` (`:17`) knew only `{bars, drops, quantise}`, and the
  Show block's Auto picker (`visuals_show.gd:155` select / `:175` `_emit_auto`) only offered the bar counts.
- The slice is rebuilt key by key: `visuals_model.gd:189` `slice_of` returns a fresh dictionary (`:200`), so any new key of
  `project.visuals` (a `playlists` list) was dropped on every load unless listed there. Looks ride raw through it and are
  made safe later (`visuals_show_ctl.gd:26` `from_slice` → `Looks.normalize`) — the same pattern fits playlists.
- Server side: `src/engine/project-client-slices.js:15` lists `visuals` in `CLIENT_OWNED_SLICES` (WO-863), and
  `preserveClientOwnedSlices` (`:32`) only keeps or replaces the whole key; nothing in `src/` reads `project.visuals`
  otherwise. So a nested `visuals.playlists` and `visuals.auto.playlist` survive web autosaves and server saves as-is — no
  JS change needed.
- Resume (WO-880): the Visuals state is the project slice; a client (re)start or a node restart reloads it through
  `visuals_tab.gd` `_load` → `M.slice_of` → `show_ctl.from_slice()`. Writes go through `_store` (the whole slice into
  `Store.project.visuals`, ProjectSync autosave). Anything stored in the slice therefore restores with it.
- The work area (`visuals_workarea.gd:40` `add_mode`) takes extra modes; 3D, Flow and (WO-894) Shader already use it.
- Name clash: the Inspector already has a Live **"Playlists"** footer (`features/live/playlists_panel.gd`, WO-603): Caspar
  media items on a look layer, planned and played by the node (`/api/playlist/*`). A different thing (server-run media
  playout, not the Godot Visuals canvas), so it is not reused; this feature is called **"Visual playlist(s)"** everywhere
  in the UI (mode button, Auto items, editor texts) to keep the two apart.

- The Visuals Show already has looks, an **Auto** mode that changes look every N bars or on drops
  (`features/visuals/visuals_autopilot.gd`, BARS [0, 4, 8, 16, 32]), and tap tempo.
- Visuals state lives in the project slice `project.visuals` (`{…, looks, auto, …}`). WO-880 resume restores it after a
  restart.
- Auto changes look on the bar counts above or on drops. No ordered sequence of looks exists yet (to re-verify at
  implementation whether Auto already keeps any order).
- Sources ▸ Visuals (WO-885) already gives draggable visuals and scenes, so the entries for a playlist can come from
  the same source.

## Design (approved 31.10.26)

- Named, ordered **playlists** in `project.visuals.playlists`. Each entry is a look or a visual (scene, shader, game).
- Entries are added by dragging from Sources ▸ Visuals or from the looks list.
- Each entry has a hold: a number of bars, a number of seconds, or until the next drop. Seconds is the fallback when
  there is no tempo lock.
- Playlist options: loop (default) or shuffle.
- The active playlist is driven by **Auto**: Auto advances to the next entry when its hold ends. Auto stays the single
  switch.
- The editor is a Visuals work-area mode (alongside 3D, Flow and Shader).
- Entries capture the WO-890 layer stack, so a multi-layer look replays as it was built.
- Survives restart through the WO-880 resume: the active playlist and position restore with the rest of the visuals
  slice.

## Acceptance / verification plan

- Create a playlist of three looks with mixed holds (bars, seconds, until drop). Run it with Auto on; each entry
  appears for its hold, in order, and loops.
- Shuffle: every entry plays once per pass; no entry repeats back to back when more than one is left.
- No tempo lock (tap tempo off): seconds holds advance on time.
- Stop Auto mid-entry, restart it: it resumes from the current entry or the next one, as stated in the editor.
- Restart the node with a playlist active: the playlist, its position and Auto state restore (WO-880 path).
- A multi-layer entry reproduces its layer stack, checked against the look it was saved from.
- Godot suite green, `run-client.sh --check` clean, no file over 500 lines.
- Box: probe client on a private Xvfb with `--tab=Visuals`; build a three-entry playlist through the probe, run it,
  screenshot each entry, and check the journal after a node restart.

## What was done

### Model, pure (`features/visuals/visuals_playlist.gd`, new)

`project.visuals.playlists` = `[{id, name, mode: loop|shuffle, entries, order, at}]`; an entry =
`{kind: look|visual, name, layers, (look keys), hold: bars|seconds|drop, bars, seconds}`.

- **Entries capture the stack.** A look entry is a *copy* of the look made through `Looks.normalize` (every
  `visuals_looks.gd KEYS` key — layers with faders/mute/blend, params, Flow graph, and WO-896's `camera` when present), so
  it replays as built even after the look is overwritten or deleted, and `apply()` recalls it with `Looks.apply`. A
  Sources ▸ Visuals row becomes a one-layer stack (`Layers.from_payload`) that keeps the running params/Flow.
- **Holds** (`hold_done`): bars count the box's *locked* beats (4 per bar); seconds count time; until-drop waits for a rise
  of the WO-861 drop count. `seconds` is each entry's fallback: while no tempo is locked, bars and drop holds end after it
  (no beat to count, no music to drop) — the design's "seconds is the fallback with no tempo lock".
- **Order**: `order` (this pass) + `at` are stored, so the position restores. Loop = in order. Shuffle = Fisher–Yates per
  pass; a new pass never starts with the entry that just played while more than one is left (`pass_order`).
- **Edits keep the position** (`add_entry` / `remove_entry` / `move_entry` → `_remap`): the running entry stays the
  current one (a removed current entry hands over to the next); shuffle keeps its pass order, new entries join its end.
- `normalize` makes stored lists safe (≤16 playlists, ≤64 entries, unique ids, ints again after JSON, a bad order rebuilt).

Why pure: every rule above is unit-tested without a scene tree; the UI and glue are thin.

### Run time (`visuals_playlist_ctl.gd`, new; `visuals_show_ctl.gd`, `visuals_autopilot.gd`)

- **Auto stays the single switch**: `auto.playlist` (added to `cfg_of`) names the playlist Auto runs. With one, the look
  cycling gets `bars 0 / drops off` (`auto_cfg`) — picked looks still land on the beat — and the playlist advances on its
  entries' holds; with none, `Auto.step` sees exactly the old config, so look cycling is unchanged.
- Switching on (editor **Run**, or Auto ▸ "Visual playlist · …") shows the entry it is on with the fade and starts its
  hold from zero. So **Auto off and on again replays the current entry** (stated in the Run tooltip).
- Each advance crossfades like a look recall (`_go(true)`), stores the slice (new `at`/`order`), and lights the stored look
  it equals. A reload (`from_slice`) never recalls; it only restarts the hold if the running position moved (so another
  client's autosave broadcast does not reset a running hold). Deleting the running playlist turns Auto off.
- `show_ctl.status()` adds "Visual playlist <name> 2/3 B · next in 3 bars / 12 s (no tempo locked) / on a drop".
- `visuals_show_ctl.gd`: 6 small edits (preload, `plist`, `from_slice`, `step`, the Auto handler, status).

### Editor (`visuals_playlist_panel.gd`, new; `visuals_tab.gd` +3 lines)

Work-area mode **"Visual playlist"** (`work.add_mode("playlist", …)` in `visuals_tab.gd _ready`): picker + New, name
(Enter/focus-out keeps it), Loop/Shuffle, Run, ✕; the entries in order, each with ▶ on the current one, hold
(Bars / Seconds / Until drop), bars and seconds SpinBoxes (RULES.md via `core/numeric_field.gd`, installed tree-wide; the
seconds field's tooltip says it is the no-tempo fallback for bars/drop), ▲ ▼ ✕. Drops: Sources ▸ Visuals rows (parsed by
`Catalog.parse`) and look buttons — onto a row = before it, elsewhere = at the end; the first drop creates a playlist.
Double-click an entry = show it now (and continue from there).

### Show block (`visuals_show.gd`)

Look buttons are drag sources (`Playlist.look_drag` payload `{type: "visual_look", look}`); the Auto picker lists
"Visual playlist · <name>" after the bar counts (`set_playlists`), Drops is disabled while a playlist runs (its entries'
holds decide).

### Slice (`visuals_model.gd` +2 lines)

`slice_of` keeps `playlists` raw (like `looks`); `visuals_playlist_ctl.gd from_slice` normalizes it.

### Probe (`visuals_playlist_probe.gd`, new; `visuals_tab.gd` hook)

`--probe-visuals-playlist=<dir>[:<s>]`: ProjectSync off and the tab's Store connections dropped (never writes or takes in
the box project), builds A/B/C through the editor's drop path, runs, shoots canvas + window per entry, Auto off/on, shuffle.

### Tests (`tests/test_visuals_playlist.gd`, new, 8 tests / 242 asserts)

Entries from drops (look stack + faders + params replay = `Looks.showing` match), normalize + **normalize → JSON → normalize
round trip** of a running shuffled playlist (order, `at` as int, `auto.playlist`), loop order, shuffle (60 passes × n = 2/3/5:
each pass a permutation, zero back-to-back repeats), holds (bars on locked beats, seconds, drop, no-tempo fallbacks,
status texts), edits keeping the position, the tab end-to-end (mode, drops, holds via the row widgets, Run, order + loop
on time, Auto off → frozen, Auto on → current entry again, double-click), reload keeps the run / moved position restarts the
hold / delete turns Auto off / no playlist → the look cycling's own bars.

## What was VERIFIED

- `./run-client.sh --test`: **24684 passed, 0 failed** (final run). The previous full run had 1 failure in
  `test_tab_undock::test_move_to_second_and_back` (Previs tab undock, `app/`, not touched here; failed alone as well, then
  green on the final run — another agent's WIP at the time). Baseline before this WO: 24246 / 0.
- `./run-client.sh --check`: boot OK. `node tools/ci/check-max-file-lines.js`: 0 files over 500 (`visuals_tab.gd` 463).
- Probe client on a private Xvfb :93 (`--tab=Visuals --visuals-ring=probe895`, isolated XDG_DATA_HOME, no pointer):
  - Loop with mixed holds, no tempo locked: A (4 s) at 0.06 s → B (2 bars → 5 s fallback) at 4.09 s → C (until drop → 4 s
    fallback) at 9.82 s → A at 13.82 s. Each entry's stack equals its look's (`stack = its look's: true`), B's 60% fader
    kept, the stored look lit (0/1/2). One run showed C held 7.5 s: the box's beat locked mid-entry, and with a lock an
    until-drop hold waits for a drop (by design), falling back once the lock went again.
  - Auto off: picture frozen on the current entry; on again: same entry, hold 0 ms.
  - Shuffle, 1 s holds, 10 changes: `[0, 1, 2, 0, 1, 2, 0, 1, 2, 1]` and `[1, 0, 2, 1, 2, 0, 2, 0, 1, 2]` — every
    entry once per pass, 0 back-to-back repeats.
  - Screenshots (session scratchpad): `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo895b/window-1.png`
    … `window-4.png` (editor + Auto "Visual playlist · Visual playlist 1" + status line), `entry-1-A.png` …
    `entry-4-A.png` (canvas per entry); first run in `…/scratchpad/wo895/` (5 entries).
  - Box project untouched: `GET /api/project` visuals md5 `d295dec4…` identical before and after both runs, no
    `playlists` key (rev moved 481 → 483 from another client's autosaves with identical content).
- Restart survival: proven by `test_normalize_and_restart_round_trip` (slice → JSON → `slice_of` → normalize: playlists,
  pass order, position and `auto.playlist` identical) and `test_reload_keeps_the_run` (a stored running playlist loads
  running on its entry, no recall); the server keeps the whole `visuals` key (Investigation). **A real node restart was
  not done** (other agents were probing; instructed not to restart the service).

### Not verified / owner QA

- Drag-and-drop by hand (look button → editor, Sources row → editor) — the drop handlers are exercised by the tests and
  the probe, the mouse drag itself was not driven (no pointer automation).
- Bars holds against a real locked tempo end to end on the box (unit-tested with a beat grid; the box's beat was mostly
  unlocked during the probe).
- Two operator clients running Auto on the same project would both advance the playlist (each stores `at`).
- Pre-existing quirk seen while testing: `M.normalize_graph(null)` returns `default_graph()` with int attack/release,
  a normalized graph has floats, so an unsaved default graph never equals its normalized copy (`Looks.showing` misses);
  harmless after a save/reload.

## Dependencies

- **WO-890** (dynamic visual layers, per-layer shaders): entries capture the layer stack. Implementation waits for it.
- **WO-880**: resume after restart. The playlist state rides on the same slice.
- **WO-885**: Sources ▸ Visuals is the drag source for playlist entries.
- Autopilot (`features/visuals/visuals_autopilot.gd`): Auto becomes the playlist driver. Its existing look-cycling
  behaviour must stay the default when no playlist is set.
